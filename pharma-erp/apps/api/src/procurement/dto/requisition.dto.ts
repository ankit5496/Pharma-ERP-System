import { IsISO8601, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

import {
  REQUISITION_STATUSES,
  type CreateRequisitionRequest,
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
   * Required for a manual requisition, but optional here: the requirement is
   * conditional on the trigger type, which this layer cannot see. The service
   * enforces presence and rejects a cancelled or completed plan.
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
