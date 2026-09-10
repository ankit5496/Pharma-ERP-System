import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsISO8601,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

import {
  REQUISITION_STATUSES,
  type CreateRequisitionRequest,
  type RequisitionStatus,
  type UpdateRequisitionRequest,
} from '@pharma-erp/types';

import { IsDecimalString, trim } from './common.dto';

/**
 * Body of `POST /api/v1/procurement/requisitions`.
 *
 * No `status`, no `requestedById`, no stock figures: the status is decided by
 * `asDraft`, the requester is the signed-in user, and the stock snapshot is
 * read from the database. Accepting any of them from a client would let a
 * requisition claim a shortage that never existed.
 */
export class CreateRequisitionDto implements CreateRequisitionRequest {
  @IsUUID()
  itemId!: string;

  @IsDecimalString('Required quantity')
  requiredQuantity!: string;

  @IsOptional()
  @IsUUID()
  preferredVendorId?: string;

  @IsOptional()
  @IsISO8601()
  requiredByDate?: string;

  @IsOptional()
  @IsString()
  @trim()
  @MaxLength(1000)
  notes?: string;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  asDraft?: boolean;
}

export class UpdateRequisitionDto implements UpdateRequisitionRequest {
  @IsOptional()
  @IsDecimalString('Required quantity')
  requiredQuantity?: string;

  @IsOptional()
  @IsUUID()
  preferredVendorId?: string | null;

  @IsOptional()
  @IsISO8601()
  requiredByDate?: string | null;

  @IsOptional()
  @IsString()
  @trim()
  @MaxLength(1000)
  notes?: string | null;
}

/** Body of the status-change action. */
export class ChangeRequisitionStatusDto {
  @IsIn(REQUISITION_STATUSES, {
    message: `Status must be one of: ${REQUISITION_STATUSES.join(', ')}`,
  })
  status!: RequisitionStatus;
}
