import { IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

/**
 * Request shape for a job-work dispatch and its invoice — US-JW-05.
 *
 * NO `invoiceBasis`. Control 7 says the basis is auto-derived from the billing
 * model and "the user must NOT see an editable Full Value / Conversion Charge
 * selector" — so the field does not exist on the request, the screen has no
 * control for it, and `forbidNonWhitelisted` turns an attempt to send one into
 * a 400. The database's `job_work_invoices_basis_matches_model` CHECK is the
 * last line: even a direct SQL INSERT cannot store the contradictory pair.
 *
 * `unitValue` IS accepted, but only means anything under OWN_PROCUREMENT, where
 * the finished-goods value is a per-dispatch commercial figure the agreement
 * does not carry. Under PURE_CONVERSION the service REJECTS it rather than
 * ignoring it — ignoring would let a caller believe they had billed the goods.
 */

const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;
const CALENDAR_DAY_MESSAGE = 'must be a calendar date in YYYY-MM-DD form, with no time part';

/** Matches DECIMAL(14,3) — finished goods are counted to three places. */
const QUANTITY = /^\d{1,11}(\.\d{1,3})?$/;
const QUANTITY_MESSAGE = 'must be a quantity with at most 3 decimal places, sent as a string';

/** Matches DECIMAL(14,4) — a unit value carries four. */
const MONEY = /^\d{1,10}(\.\d{1,4})?$/;
const MONEY_MESSAGE = 'must be an amount with at most 4 decimal places, sent as a string';

export class CreateJobWorkDispatchDto {
  @IsUUID()
  jobWorkOrderId!: string;

  /** The finished batch being returned. Must be RELEASED; checked server-side. */
  @IsUUID()
  batchId!: string;

  @Matches(QUANTITY, { message: `dispatchedQuantity ${QUANTITY_MESSAGE}` })
  dispatchedQuantity!: string;

  @IsOptional()
  @Matches(CALENDAR_DAY, { message: `dispatchDate ${CALENDAR_DAY_MESSAGE}` })
  dispatchDate?: string;

  /** OWN_PROCUREMENT only. See the class comment. */
  @IsOptional()
  @Matches(MONEY, { message: `unitValue ${MONEY_MESSAGE}` })
  unitValue?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
