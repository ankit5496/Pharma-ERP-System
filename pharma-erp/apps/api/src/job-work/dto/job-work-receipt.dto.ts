import { IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

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
