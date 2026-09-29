import {
  IsISO8601,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

import {
  REQUISITION_STATUSES,
  type CreateRequisitionRequest,
  type RequisitionStatus,
  type UpdateRequisitionRequest,
} from '@pharma-erp/types';

import { DECIMAL_PATTERN, IsDecimalString, trim } from './common.dto';

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
   * REQUIRED. It used to default to the item's configured reorder quantity —
   * a fixed figure with no relationship to what anybody had ordered, and the
   * concept this module no longer has. Somebody raising a requisition by hand
   * knows how much they want; the service refuses a blank one and says so.
   */
  // ONE CHECK WITH ONE MESSAGE, and not two decorators, because the error
  // formatter reports a single constraint per field: adding `IsDefined`
  // alongside the pattern produced two and only the pattern's message
  // survived, so a blank box was answered with "must be a number with at most
  // 4 decimal places" — true, and useless to somebody who left it empty.
  //
  // The sentence therefore has to read correctly for both cases: nothing
  // typed, and something typed that is not a quantity.
  @Matches(DECIMAL_PATTERN, {
    message: 'Enter how much to buy, as a number with at most 4 decimal places.',
  })
  requiredQuantity!: string;

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
  // WHAT THE PACK IS MADE OF IS NOT ASKED HERE, and that is the point.
  //
  // This form used to take a finished product, a pack variant, a packaging
  // component, a packaging level, a quantity per unit and a mandatory flag —
  // six fields describing a PRODUCT's packaging, on a document that requests
  // the purchase of one material. They belong to the Packaging Requirement
  // master, which is where they are maintained and where the Required stock
  // calculation reads them from.
  //
  // What the material is FOR travels a different way: a requisition Auto
  // raised carries `salesOrderId` and `salesOrderItemId`, and the finished
  // product is read back through that line. One fact, one place.
  // -------------------------------------------------------------------------
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
