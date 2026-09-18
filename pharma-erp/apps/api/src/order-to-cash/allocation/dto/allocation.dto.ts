import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const QUANTITY = /^\d{1,11}(\.\d{1,3})?$/;

/**
 * Adjusts a live allocation.
 *
 * THE BATCH CANNOT BE CHANGED. Which batch is reserved is FEFO's decision, and
 * letting it be edited by hand would make the rule advisory — the whole point
 * is that the oldest stock leaves first and nothing quietly ages out on the
 * shelf. To reserve a different batch, release this allocation and allocate
 * again; FEFO then picks, and the fact that it was released is on the record.
 *
 * The QUANTITY can be adjusted, because that is an ordinary correction: a
 * picker finds a short case, or the customer trims the order before it ships.
 * It is bounded on both sides in the service — never above what the batch still
 * has free, never below what has already been dispatched from it, and never
 * above what the order line asked for.
 *
 * ALLOCATED only. Once any part has shipped, the allocation is a record of a
 * movement rather than a reservation.
 */
export class UpdateAllocationDto {
  @IsOptional()
  @Matches(QUANTITY, { message: 'quantityAllocated must be a positive decimal, e.g. "10.000".' })
  quantityAllocated?: string;

  /** A free note against the reservation. */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
