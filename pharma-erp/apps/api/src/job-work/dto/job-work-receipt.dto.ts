import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/**
 * Request shape for a job-work material receipt — US-JW-02.
 *
 * NO OWNERSHIP FIELD. US-JW-02 says the stock ownership tag is system-set, so
 * it is not accepted here at all: with `forbidNonWhitelisted`, sending one is a
 * 400 rather than a value the service has to remember to overwrite.
 *
 * NO VENDOR, RATE, TAX OR PURCHASE REFERENCE either. This is not a purchase,
 * and the request shape is the first place that is true.
 */

const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;
const CALENDAR_DAY_MESSAGE = 'must be a calendar date in YYYY-MM-DD form, with no time part';

/** Matches DECIMAL(18,4), the precision stock_lots holds. */
const QUANTITY = /^\d{1,14}(\.\d{1,4})?$/;
const QUANTITY_MESSAGE = 'must be a quantity with at most 4 decimal places, sent as a string';

/**
 * One material on the challan.
 *
 * The principal ships a formulation's worth of material at once — an API, a
 * filler, a lubricant — on a single document. Each arrives with its own batch
 * marking, its own dates and its own quantity, so each is described separately
 * here while the document they came on is described once, above.
 */
export class JobWorkMaterialReceiptLineDto {
  @IsUUID()
  itemId!: string;

  /** The principal's batch/lot marking on the container. */
  @IsString()
  @MaxLength(64)
  @Matches(/\S/, { message: 'batchNumber must not be blank' })
  batchNumber!: string;

  @Matches(QUANTITY, { message: `receivedQuantity ${QUANTITY_MESSAGE}` })
  receivedQuantity!: string;

  @IsOptional()
  @Matches(CALENDAR_DAY, { message: `manufacturingDate ${CALENDAR_DAY_MESSAGE}` })
  manufacturingDate?: string;

  @IsOptional()
  @Matches(CALENDAR_DAY, { message: `expiryDate ${CALENDAR_DAY_MESSAGE}` })
  expiryDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

/**
 * A quality user's decision on a whole consignment.
 *
 * ONE DECISION FOR THE RECEIPT. A principal delivers a consignment and it is
 * accepted or it is not; the per-drum decision is the purchased-material model
 * and belongs on the incoming-QC screen.
 */
export class DecideJobWorkReceiptDto {
  @IsIn(['APPROVED', 'ON_HOLD', 'REJECTED'], {
    message: 'decision must be APPROVED, ON_HOLD or REJECTED',
  })
  decision!: 'APPROVED' | 'ON_HOLD' | 'REJECTED';

  /** A COA or test reference. Optional; the remarks are what is insisted on. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  testReference?: string;

  /**
   * Required for a hold or a rejection, checked in the service because the rule
   * is conditional on the decision.
   */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class CreateJobWorkMaterialReceiptDto {
  @IsUUID()
  jobWorkOrderId!: string;

  /**
   * The principal's own document number.
   *
   * Named for what it is. US-JW-02 is explicit that it "must NOT be treated as
   * a Purchase Invoice", and the surest way to honour that is for the word
   * "invoice" to appear nowhere on this record.
   */
  @IsString()
  @MaxLength(64)
  @Matches(/\S/, { message: 'deliveryChallanNumber must not be blank' })
  deliveryChallanNumber!: string;

  /** The date on the challan, which is not always the day it is keyed in. */
  @Matches(CALENDAR_DAY, { message: `receiptDate ${CALENDAR_DAY_MESSAGE}` })
  receiptDate!: string;

  /**
   * The materials on the challan — at least one.
   *
   * AN ARRAY EVEN FOR ONE, because a delivery of three materials is one event
   * and has to be recorded as one: the store officer who is interrupted after
   * the second must not leave the company holding two of the three with two lot
   * numbers already spent. The service validates every line before it writes
   * any of them, inside a single transaction.
   *
   * The ceiling is generous rather than meaningful: no formulation has 200
   * materials, and the limit exists so a malformed request cannot ask the
   * numbering series for an unbounded run of lot numbers.
   */
  /** A note about the delivery as a whole. Per-material notes are on the line. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'A receipt needs at least one material on it.' })
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => JobWorkMaterialReceiptLineDto)
  lines!: JobWorkMaterialReceiptLineDto[];
}
