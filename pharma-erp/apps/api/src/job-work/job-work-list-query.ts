import { Transform } from 'class-transformer';
import { IsIn, IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * The filters every Job Work register accepts.
 *
 * ONE DTO FOR TEN LISTS, and one `where` builder under it, because the
 * alternative is ten spellings of "created between these dates" that agree
 * until somebody edits one of them. The Procure-to-Pay lists have had this
 * shape since they were built; this is the same contract on the other module.
 *
 * APPLIED IN THE DATABASE, not on the page. The Job Work screens used to fetch
 * every record and filter the array they had just been handed, which produces
 * a register whose count is right, whose rows are right, and whose pager is
 * wrong — and which fetches a hundred rows to show three.
 */
export class JobWorkListQueryDto {
  /** Free text over whatever the list decides is searchable. */
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MaxLength(120)
  search?: string;

  /**
   * A status value belonging to THIS list's own vocabulary.
   *
   * Deliberately a plain string rather than an enum: a receipt, a production
   * order and a batch have three different status sets, and one enum covering
   * all of them would accept "RELEASED" on a consignment. Each service
   * validates its own against the values it actually has.
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  status?: string;

  /** Inclusive, on the record's own creation date. */
  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  /** Inclusive to the END of the day named — see `dateRange`. */
  @IsOptional()
  @IsISO8601()
  dateTo?: string;

  /**
   * Whoever created the record, by id.
   *
   * BY ID, NOT BY NAME. The screen lets somebody type a name and pick a person
   * — names are how people are remembered — but what travels is the id, so two
   * colleagues called Patel do not silently share a filter.
   */
  @IsOptional()
  @IsUUID()
  createdById?: string;

  /** Whose work it is. */
  @IsOptional()
  @IsUUID()
  principalId?: string;

  @IsOptional()
  @IsIn(['PURE_CONVERSION', 'OWN_PROCUREMENT'])
  billingModel?: 'PURE_CONVERSION' | 'OWN_PROCUREMENT';

  /**
   * THE TWO SCOPING IDS, which are not filters the reader sets.
   *
   * They narrow a list to one parent — the consignments against one job-work
   * order, the batches against one production order — and they are how the
   * detail views and the forms read a subset.
   *
   * DECLARED HERE RATHER THAN AS A SEPARATE `@Query('jobWorkOrderId')`
   * PARAMETER, and that is not a tidying. The validation pipe runs with
   * `forbidNonWhitelisted`, so it judges the WHOLE query string against this
   * one DTO: a key the DTO does not name is a 400, however the controller
   * happens to read it. Leaving them out took every one of those calls down.
   */
  @IsOptional()
  @IsUUID()
  jobWorkOrderId?: string;

  @IsOptional()
  @IsUUID()
  productionOrderId?: string;

  /**
   * The batch register's SECOND date range — the day the batch was made.
   *
   * BESIDE `dateFrom`/`dateTo` RATHER THAN INSTEAD OF THEM. A batch is
   * looked up by the date on the carton at least as often as by when the row
   * was written, and the two are different days: manufacturing is entered
   * afterwards. Only the batch list reads these; every other register ignores
   * them, which is why they are optional here rather than a second DTO.
   */
  @IsOptional()
  @IsISO8601()
  manufacturedFrom?: string;

  @IsOptional()
  @IsISO8601()
  manufacturedTo?: string;
}

/**
 * A batch that has been opened but not yet packed.
 *
 * NOT A STORED STATUS. `release_status` is PENDING from the moment a batch is
 * opened, so it covers both "waiting on production to finish packing" and
 * "waiting on the quality officer to decide" — two different queues, two
 * different people, one column. The screens have always drawn them as separate
 * badges; this is the filter value that names the first of them, and the batch
 * list turns it into `packed_on IS NULL`.
 */
export const PACKAGING_DUE = 'PACKAGING_DUE';

/**
 * A batch the quality officer has already ruled on, whatever the ruling.
 *
 * THE 'RELEASED' TAB ON THE BATCH RELEASE SCREEN IS THIS SET — released, on
 * hold, rejected and blocked together — and it is a set the stored column
 * cannot name: 'not PENDING' is four values out of five, and asking for four
 * statuses to get one tab is how a filter ends up disagreeing with the tab it
 * sits on. The tab asks for DECIDED and the query says `NOT PENDING`.
 */
export const DECIDED = 'DECIDED';

/**
 * A created-between clause, or nothing when neither end is given.
 *
 * `dateTo` IS INCLUSIVE OF THE WHOLE DAY. A person filtering to the 10th means
 * everything that happened on the 10th; `lte` against midnight would silently
 * drop a day's work, which is the kind of wrong that looks like missing data.
 */
export function createdBetween(
  dateFrom?: string,
  dateTo?: string,
): { gte?: Date; lte?: Date } | undefined {
  if (!dateFrom && !dateTo) return undefined;

  const range: { gte?: Date; lte?: Date } = {};

  if (dateFrom) range.gte = new Date(`${dateFrom.slice(0, 10)}T00:00:00.000Z`);
  if (dateTo) range.lte = new Date(`${dateTo.slice(0, 10)}T23:59:59.999Z`);

  return range;
}

/**
 * The part of a `where` every Job Work list shares: when it was created, and
 * by whom.
 *
 * THE CREATOR'S COLUMN IS NAMED BY THE CALLER, because the models do not agree
 * on what to call it — a receipt is `receivedById`, an issue `issuedById`, a
 * batch `recordedById`, an order `createdById`. They all mean "the person whose
 * record this is", which is what the filter asks about, and the difference is
 * historical rather than meaningful.
 *
 * THE DATE COLUMN IS NAMED BY THE CALLER TOO, for the same sort of reason:
 * a dispensing record carries `issued_at` beside its `created_at`, and the
 * screen shows the first of them. Filtering the column the reader is NOT
 * looking at is how a date range comes to disagree with the dates on the rows
 * it returned. The two happen to be written together today, which is exactly
 * why this is worth pinning down now rather than after somebody lets a
 * storekeeper enter the date the material actually left.
 *
 * Returns an object to spread, so a caller can put its own clauses beside it.
 */
export function jobWorkListWhere(
  query: JobWorkListQueryDto,
  creatorField = 'createdById',
  dateField = 'createdAt',
): Record<string, unknown> {
  const created = createdBetween(query.dateFrom, query.dateTo);

  return {
    ...(created ? { [dateField]: created } : {}),
    ...(query.createdById ? { [creatorField]: query.createdById } : {}),
  };
}

/**
 * A status the caller recognises, or undefined.
 *
 * AN UNKNOWN STATUS IS IGNORED RATHER THAN REFUSED. The filter travels in the
 * URL, and a stale link naming a status that has since been renamed should
 * show the unfiltered register rather than a 400 — the register is the useful
 * answer, and the alternative is a page somebody cannot get back from.
 */
export function statusIn<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
): T | undefined {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

/**
 * The whole `where` for a list OF JOB-WORK ORDERS — the shared clauses above
 * plus the three an order has of its own: whose work it is, how it is billed,
 * and the free-text search.
 *
 * SHARED BETWEEN THE ORDER LIST AND THE REGISTER, which are two readings of
 * the same rows: the register groups those orders by principal and agreement
 * and totals them. Two spellings of "search a job-work order" would drift, and
 * the register is exactly the screen where a filter that quietly means
 * something slightly different is hardest to notice — every figure on it is a
 * total, and a total is right or wrong with nothing in between.
 *
 * THE SEARCH REACHES THROUGH THE MAPPING to the principal's brand name and to
 * our own product's name and code, because those are what the order is known
 * by in conversation. The order number alone would make the box useless to
 * anyone who has not got the number in front of them.
 */
export function jobWorkOrderWhere(query: JobWorkListQueryDto): Record<string, unknown> {
  const search = query.search?.trim();

  return {
    ...jobWorkListWhere(query),
    ...(query.principalId ? { principalId: query.principalId } : {}),
    ...(query.billingModel ? { billingModel: query.billingModel } : {}),
    ...(search
      ? {
          OR: [
            { orderNumber: { contains: search, mode: 'insensitive' } },
            { principal: { name: { contains: search, mode: 'insensitive' } } },
            { principal: { code: { contains: search, mode: 'insensitive' } } },
            { mapping: { principalBrandName: { contains: search, mode: 'insensitive' } } },
            { mapping: { bom: { product: { name: { contains: search, mode: 'insensitive' } } } } },
            { mapping: { bom: { product: { code: { contains: search, mode: 'insensitive' } } } } },
          ],
        }
      : {}),
  };
}
