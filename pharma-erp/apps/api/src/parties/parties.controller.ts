import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseFilePipeBuilder,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';

import {
  DOCUMENT_MAX_BYTES,
  PARTY_TYPES,
  type CustomerDocumentSummary,
  type PartySummary,
  type PartyType,
} from '@pharma-erp/types';

import { Roles } from '../auth/auth.decorators';
import { SkipAudit } from '../common/audit/audit.decorators';

import { DocumentsService } from './documents.service';
import { CreatePartyDto, UpdatePartyDto } from './dto/party.dto';
import { PartiesService } from './parties.service';

/**
 * The party register — US-MD-02.
 *
 * Suppliers and customers on one controller because they are one table: a
 * distributor that also supplies cartons is a single legal entity, and
 * splitting the routes would force the UI to guess which one to call.
 *
 * Reads are open to every signed-in role: a storekeeper raising a goods
 * receipt needs the supplier list. Writes are narrower, and retiring is
 * narrower still.
 */
@Controller('parties')
export class PartiesController {
  constructor(
    private readonly parties: PartiesService,
    private readonly documents: DocumentsService,
  ) {}

  /** `type` filters to one side; SUPPLIER and CUSTOMER both include BOTH. */
  @Get()
  @SkipAudit('Read-only master data.')
  async list(@Query('type') type?: string): Promise<PartySummary[]> {
    return this.parties.list(type);
  }

  /**
   * The code the next party of a type would take, for the form to show before
   * anything is saved.
   *
   * Declared BEFORE any `:id` route so the literal segment matches first —
   * otherwise "next-code" is read as a party id and refused by the UUID pipe.
   */
  @Get('next-code')
  @SkipAudit('Reads a number; reserves nothing.')
  async nextCode(@Query('type') type: string): Promise<{ code: string }> {
    if (!PARTY_TYPES.includes(type as PartyType)) {
      throw new BadRequestException('Choose a party type.');
    }

    return this.parties.previewCode(type as PartyType);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles('ADMIN', 'PURCHASE_MANAGER', 'SALES_MANAGER')
  async create(@Body() dto: CreatePartyDto): Promise<PartySummary> {
    return this.parties.create(dto);
  }

  @Patch(':id')
  @Roles('ADMIN', 'PURCHASE_MANAGER', 'SALES_MANAGER')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePartyDto,
  ): Promise<PartySummary> {
    return this.parties.update(id, dto);
  }

  /**
   * Retires a party. Admin only — purchase and sales both read this register,
   * so withdrawing an entry affects more than one desk.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('ADMIN')
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.parties.remove(id);
  }
  // ---------------------------------------------------------------------------
  // Customer documents
  // ---------------------------------------------------------------------------
  //
  // Nested under the party because a document has no identity apart from the
  // customer it belongs to — there is no register of documents, only a
  // customer's paperwork.

  /** What is on file. Never returns the bytes; see the download route. */
  @Get(':id/documents')
  @SkipAudit('Read-only listing.')
  async listDocuments(@Param('id', ParseUUIDPipe) id: string): Promise<CustomerDocumentSummary[]> {
    return this.documents.list(id);
  }

  /**
   * Stores a file against a customer.
   *
   * The multer limit refuses an oversized upload at the boundary, before the
   * bytes are ever buffered in full — the service checks again, because the
   * service is what a future caller might reach without passing through here.
   */
  @Post(':id/documents')
  @Roles('ADMIN', 'SALES_MANAGER')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: DOCUMENT_MAX_BYTES } }))
  async uploadDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile(
      new ParseFilePipeBuilder().build({
        fileIsRequired: true,
        exceptionFactory: () => new BadRequestException('Choose a file to upload.'),
      }),
    )
    file: Express.Multer.File,
  ): Promise<CustomerDocumentSummary> {
    return this.documents.upload(id, file);
  }

  /**
   * The bytes.
   *
   * `Content-Disposition: attachment` unconditionally: an uploaded file is
   * content this application did not author, and a PDF or an image rendered
   * inline runs in the origin's own context. Downloading it makes the browser
   * hand it to the operating system instead, which is the whole difference.
   */
  @Get(':id/documents/:documentId/content')
  @SkipAudit('Read-only.')
  async downloadDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Res() response: Response,
  ): Promise<void> {
    const document = await this.documents.download(id, documentId);

    // The filename is quoted and stripped of quotes and control characters: it
    // came from an upload, and a header that can be broken out of is a header
    // that can inject another.
    const safeName = document.fileName.replace(/["\r\n\\]/g, '_');

    response.setHeader('Content-Type', document.contentType);
    response.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    response.setHeader('Content-Length', String(document.content.length));
    // Nothing in a shared cache: these are one company's compliance documents.
    response.setHeader('Cache-Control', 'private, no-store');
    response.send(document.content);
  }

  /** Withdraws a document. A soft delete — the trigger refuses anything else. */
  @Delete(':id/documents/:documentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('ADMIN', 'SALES_MANAGER')
  async removeDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ): Promise<void> {
    return this.documents.remove(id, documentId);
  }
}
