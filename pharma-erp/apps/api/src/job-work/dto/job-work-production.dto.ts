import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

import { JOB_WORK_PRODUCTION_STATUSES, type JobWorkProductionStatus } from '@pharma-erp/types';

/**
 * Request shapes for the job-work production order.
 *
 * WHAT IS NOT ACCEPTED is the point of these. No order number — the series
 * allocates it. No product, principal, agreement or billing model — all four
 * follow from the job-work order, and letting a request name its own would be a
 * way to raise an order for one principal against another's material. No
 * material at all: the receipt already holds it.
 */

const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;
const CALENDAR_DAY_MESSAGE = 'must be a calendar date in YYYY-MM-DD form, with no time part';

/** Matches DECIMAL(14,3), the precision the column holds. */
const QUANTITY = /^\d{1,11}(\.\d{1,3})?$/;
const QUANTITY_MESSAGE = 'must be a quantity with at most 3 decimal places, sent as a string';

export class CreateJobWorkProductionOrderDto {
  @IsUUID()
  jobWorkOrderId!: string;

  /**
   * The approved consignment whose material this will consume.
   *
   * Required, not inferred. An order may hold several approved receipts, and
   * guessing which one a batch is being made from would put the wrong drums on
   * the paperwork.
   */
  @IsUUID()
  materialReceiptId!: string;

  /** Defaults to what the job-work order asked for when omitted. */
  @IsOptional()
  @Matches(QUANTITY, { message: `plannedQuantity ${QUANTITY_MESSAGE}` })
  plannedQuantity?: string;

  @IsOptional()
  @Matches(CALENDAR_DAY, { message: `plannedStartOn ${CALENDAR_DAY_MESSAGE}` })
  plannedStartOn?: string;

  @IsOptional()
  @Matches(CALENDAR_DAY, { message: `plannedCompletionOn ${CALENDAR_DAY_MESSAGE}` })
  plannedCompletionOn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

/**
 * What may change after the order is raised.
 *
 * The plan and the stage, and nothing else. Which job-work order and which
 * receipt a batch is made against are what the order IS; changing either would
 * be a different order wearing the same number.
 */
export class UpdateJobWorkProductionOrderDto {
  @IsOptional()
  @Matches(QUANTITY, { message: `plannedQuantity ${QUANTITY_MESSAGE}` })
  plannedQuantity?: string;

  @IsOptional()
  @Matches(CALENDAR_DAY, { message: `plannedStartOn ${CALENDAR_DAY_MESSAGE}` })
  plannedStartOn?: string | null;

  @IsOptional()
  @Matches(CALENDAR_DAY, { message: `plannedCompletionOn ${CALENDAR_DAY_MESSAGE}` })
  plannedCompletionOn?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string | null;

  /**
   * The next stage.
   *
   * WHICH transitions are legal is decided by the service, not here: the rule
   * depends on where the record currently is, which a request-shape validator
   * cannot see.
   */
  @IsOptional()
  @IsIn([...JOB_WORK_PRODUCTION_STATUSES], {
    message: `status must be one of: ${JOB_WORK_PRODUCTION_STATUSES.join(', ')}`,
  })
  status?: JobWorkProductionStatus;
}
