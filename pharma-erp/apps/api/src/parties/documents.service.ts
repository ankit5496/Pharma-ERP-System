import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import {
  DOCUMENT_CONTENT_TYPES,
  DOCUMENT_MAX_BYTES,
  type CustomerDocumentSummary,
} from '@pharma-erp/types';

import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';

/**
 * A customer's paperwork — drug licence, GST certificate, purchase agreement.
 *
 * THE BYTES LIVE IN POSTGRES. The obvious alternative is a folder on this
 * service's filesystem, and on the hosted deployment that loses everything: no
 * persistent disk is declared, so the container's filesystem is destroyed on
 * every deploy while the row pointing at it survives. In the database the file
 * is in the same backups as the rest of the data and under the same row-level
 * security, so one company physically cannot read another's paperwork — which
 * a filesystem path, being only a string, does not give you.
 *
 * CUSTOMERS ONLY, checked here rather than in the schema. Whether a party is a
 * customer is a column on another table, which a CHECK constraint cannot read.
 *
 * The listing never selects `content`. A register of six documents would
 * otherwise pull thirty megabytes through the connection to render six
 * filenames.
 */
/** Everything a listing needs, and deliberately never `content`. */
const SUMMARY_SELECT = {
  id: true,
  fileName: true,
  contentType: true,
  sizeBytes: true,
  createdAt: true,
  uploadedBy: { select: { fullName: true } },
} as const;

function toSummary(row: {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: Date;
  uploadedBy: { fullName: string } | null;
}): CustomerDocumentSummary {
  return {
    id: row.id,
    fileName: row.fileName,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    uploadedBy: row.uploadedBy?.fullName ?? null,
    uploadedAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async list(partyId: string): Promise<CustomerDocumentSummary[]> {
    await this.requireCustomer(partyId);

    const documents = await this.prisma.scoped.customerDocument.findMany({
      where: { partyId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: SUMMARY_SELECT,
    });

    return documents.map(toSummary);
  }

  /**
   * Stores an uploaded file against a customer.
   *
   * Size is checked against the BUFFER, not against any length the client
   * claimed: a stated size is a number somebody sent, and the database's CHECK
   * constraint compares the stored count to the stored bytes precisely so the
   * two cannot drift.
   */
  async upload(
    partyId: string,
    file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
  ): Promise<CustomerDocumentSummary> {
    const tenantId = this.tenantContext.requireTenantId();
    const userId = this.tenantContext.getUserId();

    if (!userId) {
      // Unreachable through the guard, which resolves the user before any
      // handler runs. Stated because the column is NOT NULL and an upload with
      // no uploader is not a record anyone could act on.
      throw new BadRequestException('The acting user could not be resolved for this upload.');
    }

    const party = await this.requireCustomer(partyId);

    if (!file?.buffer?.length) {
      throw new BadRequestException('The file is empty. Choose a file and try again.');
    }

    if (file.buffer.length > DOCUMENT_MAX_BYTES) {
      throw new BadRequestException(
        `That file is ${(file.buffer.length / (1024 * 1024)).toFixed(1)} MB. The limit is ` +
          `${DOCUMENT_MAX_BYTES / (1024 * 1024)} MB — documents are stored in the database, so a ` +
          'large one slows every screen that reads it. Scan at a lower resolution, or split it.',
      );
    }

    // The browser states the type and a browser can be made to state anything,
    // so this is a whitelist of what will be ACCEPTED rather than a check that
    // the bytes really are what they claim. What it buys is that a stored
    // document is always served back as a type a browser renders inertly.
    if (
      !DOCUMENT_CONTENT_TYPES.includes(file.mimetype as (typeof DOCUMENT_CONTENT_TYPES)[number])
    ) {
      throw new BadRequestException(
        `"${file.mimetype}" is not a document type this register accepts. Upload a PDF, or a ` +
          'JPEG, PNG or WebP image.',
      );
    }

    const created = await this.prisma.scoped.customerDocument.create({
      data: {
        tenantId,
        partyId: party.id,
        fileName: file.originalname.trim().slice(0, 255) || 'document',
        contentType: file.mimetype,
        sizeBytes: file.buffer.length,
        // As a plain byte view: multer types its buffer as possibly backed by
        // a SharedArrayBuffer, which the column's own type does not admit.
        content: new Uint8Array(file.buffer),
        uploadedById: userId,
      },
      select: { id: true },
    });

    // Read back rather than mapping the create's result: the scoped client does
    // not narrow a create to its `select`, so the uploader relation is not on
    // it — and the alternative, returning a summary with the name left blank,
    // makes the row change the moment the list refreshes.
    const saved = await this.prisma.scoped.customerDocument.findUniqueOrThrow({
      where: { id: created.id },
      select: SUMMARY_SELECT,
    });

    return toSummary(saved);
  }

  /** The bytes, for a download. The only place `content` is selected. */
  async download(
    partyId: string,
    documentId: string,
  ): Promise<{ fileName: string; contentType: string; content: Buffer }> {
    const document = await this.prisma.scoped.customerDocument.findFirst({
      where: { id: documentId, partyId, deletedAt: null },
      select: { fileName: true, contentType: true, content: true },
    });

    if (!document) throw new NotFoundException('That document does not exist.');

    return {
      fileName: document.fileName,
      contentType: document.contentType,
      // Copied through the byte view rather than `Buffer.from(uint8)`: the
      // driver types the column's buffer as possibly shared, and Buffer.from
      // does not accept that union.
      content: Buffer.from(document.content.buffer.slice(0) as ArrayBuffer),
    };
  }

  /**
   * Withdraws a document.
   *
   * A soft delete, and not a choice this method could make differently: a
   * trigger refuses the hard delete outright. A licence that made a customer
   * eligible to be sold to is evidence the sale was lawful at the time, and
   * removing it removes the evidence.
   */
  async remove(partyId: string, documentId: string): Promise<void> {
    const document = await this.prisma.scoped.customerDocument.findFirst({
      where: { id: documentId, partyId, deletedAt: null },
      select: { id: true },
    });

    if (!document) throw new NotFoundException('That document does not exist.');

    await this.prisma.scoped.customerDocument.update({
      where: { id: document.id },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * The party must exist and must be a customer.
   *
   * Documents hang off the customer relationship — a licence, a GST
   * certificate, an agreement — and a vendor's paperwork belongs with the
   * vendor's own records, not here. Refusing loudly is better than quietly
   * accepting a file nowhere in the UI will ever show.
   */
  private async requireCustomer(partyId: string): Promise<{ id: string }> {
    const party = await this.prisma.scoped.party.findFirst({
      where: { id: partyId, deletedAt: null },
      select: { id: true, code: true, partyType: true },
    });

    if (!party) throw new NotFoundException('That party does not exist.');

    if (party.partyType !== 'CUSTOMER') {
      throw new BadRequestException(
        `Documents are held against customers. "${party.code}" is a ` +
          `${party.partyType.toLowerCase().replace(/_/g, ' ')}.`,
      );
    }

    return { id: party.id };
  }
}
