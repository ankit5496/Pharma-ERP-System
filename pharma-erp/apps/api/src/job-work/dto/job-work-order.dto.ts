import { IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

/**
 * Request shapes for job-work orders — US-JW-01.
 *
 * WHAT IS ABSENT IS THE POINT. There is no `billingModel`, no `agreementId`,
 * no `productId` and no `brand` on either class. With the global pipe's
 * `forbidNonWhitelisted: true`, a client that sends one of them gets a 400
 * naming the field rather than having it quietly dropped — so control 3
 * ("user cannot independently change the billing model") is enforced by the
 * request shape itself, before any service code runs.
 *
 * The agreement and the billing model are read off the chosen mapping's
 * agreement in JobWorkOrdersService; the product and brand ARE the mapping.
 */

/** A calendar day, not an instant — a delivery date is a day in a diary. */
const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;
const CALENDAR_DAY_MESSAGE = 'must be a calendar date in YYYY-MM-DD form, with no time part';

/**
 * Matches DECIMAL(14,3), the quantity precision used throughout production.
 *
 * A string, not a number: JSON has only doubles, and a quantity that arrives
 * as 1000.1 having left as 1000.1 is luck rather than a guarantee.
 */
const QUANTITY = /^\d{1,11}(\.\d{1,3})?$/;
const QUANTITY_MESSAGE =
  'must be a quantity with at most 3 decimal places, sent as a string';

export class CreateJobWorkOrderDto {
  @IsUUID()
  principalId!: string;

  /**
   * One row of the agreement's product-brand mapping.
   *
   * Carries BOTH the product and the brand, which is why US-JW-01's validations
   * 2 and 3 need no separate check: a product the agreement does not cover has
   * no mapping row to name.
   */
  @IsUUID()
  mappingId!: string;

  @Matches(QUANTITY, { message: `quantity ${QUANTITY_MESSAGE}` })
  quantity!: string;

  @Matches(CALENDAR_DAY, { message: `deliveryDate ${CALENDAR_DAY_MESSAGE}` })
  deliveryDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

/**
 * A change to an order.
 *
 * Quantity, delivery date and notes are the whole editable surface. Changing
 * who the work is for, or on what terms, is a different order — not an edit of
 * this one — and the absent fields are what make that true.
 */
export class UpdateJobWorkOrderDto {
  @IsOptional()
  @Matches(QUANTITY, { message: `quantity ${QUANTITY_MESSAGE}` })
  quantity?: string;

  @IsOptional()
  @Matches(CALENDAR_DAY, { message: `deliveryDate ${CALENDAR_DAY_MESSAGE}` })
  deliveryDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string | null;
}
