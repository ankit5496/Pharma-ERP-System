import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsISO8601,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import {
  PURCHASE_ORDER_STATUSES,
  type ConvertRequisitionRequest,
  type CreatePurchaseOrderLineRequest,
  type CreatePurchaseOrderRequest,
  type PurchaseOrderStatus,
} from '@pharma-erp/types';

import { IsDecimalString, trim } from './common.dto';

export class CreatePurchaseOrderLineDto implements CreatePurchaseOrderLineRequest {
  @IsUUID()
  itemId!: string;

  @IsOptional()
  @IsUUID()
  requisitionId?: string;

  /**
   * Optional so a DRAFT can be parked half-filled. A placed order still needs
   * all three, enforced in `PurchaseOrdersService.create` where the draft flag
   * is visible — and a draft line with no quantity is dropped rather than
   * stored as a zero nobody typed.
   */
  @IsOptional()
  @IsDecimalString('Quantity')
  quantity?: string;

  @IsOptional()
  @IsDecimalString('Rate')
  rate?: string;

  @IsOptional()
  @IsDecimalString('Tax rate')
  taxRatePercent?: string;
}

export class CreatePurchaseOrderDto implements CreatePurchaseOrderRequest {
  @IsUUID()
  vendorId!: string;

  @IsOptional()
  @IsISO8601()
  expectedDeliveryDate?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  // Two years of credit is not a payment term, it is a typo.
  @Max(365)
  @Type(() => Number)
  paymentTermsDays?: number;

  @IsOptional()
  @IsString()
  @trim()
  @MaxLength(1000)
  notes?: string;

  /**
   * Save without placing the order.
   *
   * A draft is inert: nothing can be received or invoiced against it, and it
   * stays fully editable. Absent means a real order, because that is the
   * safer default — an order nobody meant to place is visible and can be
   * cancelled, whereas a draft nobody meant to leave as a draft is a delivery
   * that never arrives.
   */
  @IsOptional()
  @IsBoolean()
  saveAsDraft?: boolean;

  /**
   * Optional, and may be empty — on a DRAFT. "At least one line" is enforced by
   * the service for a placed order, and again by `submitDraft` when a draft is
   * finally placed, which is the check that actually matters: a draft can sit
   * for a week and be edited in between.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseOrderLineDto)
  lines?: CreatePurchaseOrderLineDto[];
}

/** Header-only edit. Lines are not patchable — replace the draft instead. */
export class UpdatePurchaseOrderDto {
  /**
   * The order's status, when the edit changes it.
   *
   * Here rather than only on `POST /:id/status` so that the edit dialog saves a
   * record in one request: the alternative was two calls from the browser, with
   * the second able to fail after the first had already written. The transition
   * rules are untouched — the service hands this straight to the same
   * `changeStatus`, which owns them.
   */
  @IsOptional()
  @IsIn(PURCHASE_ORDER_STATUSES)
  status?: PurchaseOrderStatus;

  /** Draft orders only; the service refuses a vendor change on a placed order. */
  @IsOptional()
  @IsUUID()
  vendorId?: string;

  @IsOptional()
  @IsISO8601()
  expectedDeliveryDate?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  @Type(() => Number)
  paymentTermsDays?: number;

  @IsOptional()
  @IsString()
  @trim()
  @MaxLength(1000)
  notes?: string | null;

  /**
   * Replacement lines. DRAFT ORDERS ONLY — the service refuses them on a live
   * order, because a line already received against cannot be rewritten without
   * making the receipt a lie.
   *
   * Replaced wholesale rather than patched: a partial line edit needs stable
   * line ids across the wire, and an order being drafted has no reason to
   * carry that complexity.
   */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'A purchase order needs at least one line' })
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseOrderLineDto)
  lines?: CreatePurchaseOrderLineDto[];
}

/** Body of `POST /requisitions/:id/convert`. */
export class ConvertRequisitionDto implements ConvertRequisitionRequest {
  @IsUUID()
  vendorId!: string;

  @IsDecimalString('Rate')
  rate!: string;

  @IsDecimalString('Tax rate')
  taxRatePercent!: string;

  @IsOptional()
  @IsISO8601()
  expectedDeliveryDate?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  @Type(() => Number)
  paymentTermsDays?: number;
}

export class ChangePurchaseOrderStatusDto {
  @IsIn(PURCHASE_ORDER_STATUSES, {
    message: `Status must be one of: ${PURCHASE_ORDER_STATUSES.join(', ')}`,
  })
  status!: PurchaseOrderStatus;
}
