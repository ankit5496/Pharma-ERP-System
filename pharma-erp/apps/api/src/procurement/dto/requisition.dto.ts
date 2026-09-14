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
  PACKAGING_LEVELS,
  REQUISITION_STATUSES,
  type CreateRequisitionRequest,
  type PackagingLevel,
  type RequisitionStatus,
  type UpdateRequisitionRequest,
} from '@pharma-erp/types';

import { IsDecimalString, trim } from './common.dto';

/**
 * Body of `POST /api/v1/procurement/requisitions` — a manually raised one.
 *
 * No `status`, no `triggerType`, no `requestedById`, no stock figures. A
 * requisition submitted here is always OPEN and always MANUAL; the requester
 * is the signed-in user and the stock snapshot is read from the database.
 * Accepting any of them from a client would let a requisition claim a
 * shortage that never existed, or claim the system raised it.
 */
export class CreateRequisitionDto implements CreateRequisitionRequest {
  @IsUUID()
  itemId!: string;

  /**
   * Optional: defaults to the item's configured reorder quantity when absent,
   * and remains editable. The default is applied in the service, which is the
   * only layer that can read the item.
   */
  @IsOptional()
  @IsDecimalString('Required quantity')
  requiredQuantity?: string;

  /**
   * The production run this material is for.
   *
   * Optional. A requisition raised to restock a material that several runs
   * consume has no single plan to name, and demanding one would only produce
   * an arbitrary answer. When given, the service rejects a cancelled or
   * completed plan.
   */
  @IsOptional()
  @IsUUID()
  productionPlanId?: string;

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

  // -------------------------------------------------------------------------
  // What the material is for, and where it sits in the pack
  // -------------------------------------------------------------------------
  // Every id below is validated as a UUID here and then RESOLVED THROUGH THE
  // TENANT-SCOPED CLIENT in the service. That second step is what actually
  // enforces isolation: a well-formed uuid belonging to another company would
  // pass this layer and fail there, which is the correct division — this
  // layer knows shapes, the service knows what exists.

  @IsOptional()
  @IsUUID()
  finishedProductId?: string;

  @IsOptional()
  @IsString()
  @trim()
  @MaxLength(128)
  packVariant?: string;

  @IsOptional()
  @IsUUID()
  packagingComponentId?: string;

  @IsOptional()
  @IsIn(PACKAGING_LEVELS, {
    message: `Packaging level must be one of: ${PACKAGING_LEVELS.join(', ')}`,
  })
  packagingLevel?: PackagingLevel;

  @IsOptional()
  @IsDecimalString('Quantity per unit')
  quantityPerUnit?: string;

  /** Defaults to mandatory in the service when absent. */
  @IsOptional()
  @IsBoolean()
  isMandatory?: boolean;
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
