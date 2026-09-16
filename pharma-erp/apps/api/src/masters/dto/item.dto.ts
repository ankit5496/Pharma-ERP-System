import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

import type { O2cItemType, PriceControlType, ScheduleCategory } from '@pharma-erp/types';

const ITEM_TYPES = ['RAW_MATERIAL', 'PACKAGING', 'FINISHED_GOOD', 'CONSUMABLE'] as const;
const SCHEDULE_CATEGORIES = [
  'NONE',
  'OTC',
  'SCHEDULE_G',
  'SCHEDULE_H',
  'SCHEDULE_H1',
  'SCHEDULE_H1X',
  'SCHEDULE_X',
  'OTHER',
] as const;
const PRICE_CONTROL_TYPES = ['NONE', 'DPCO', 'NLEM', 'OTHER'] as const;

type AssertSame<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _typesMatch: AssertSame<(typeof ITEM_TYPES)[number], O2cItemType> = true;
const _schedulesMatch: AssertSame<(typeof SCHEDULE_CATEGORIES)[number], ScheduleCategory> = true;
const _controlsMatch: AssertSame<(typeof PRICE_CONTROL_TYPES)[number], PriceControlType> = true;
void _typesMatch;
void _schedulesMatch;
void _controlsMatch;

const MONEY = /^\d{1,10}(\.\d{1,2})?$/;
const PERCENT = /^(100(\.0{1,2})?|\d{1,2}(\.\d{1,2})?)$/;

/**
 * Creating a finished product from the sales-order screen.
 *
 * The fields mirror what that form offers, in the Order-to-Cash vocabulary.
 * The service maps them onto the SHARED item register, which is authoritative
 * — this is a convenience route, not a second item master.
 */
export class CreateItemDto {
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  code!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name!: string;

  @IsIn(ITEM_TYPES)
  itemType!: O2cItemType;

  /**
   * Accepted and validated, but NOT stored: the shared register has no
   * pack-size column. Rejecting the field would break the form; silently
   * dropping it without saying so would be worse. See the service.
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  packSize?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  unitOfMeasure?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  hsnCode?: string;

  @IsOptional()
  @Matches(PERCENT, { message: 'gstRatePercent must be between 0 and 100.' })
  gstRatePercent?: string;

  @IsOptional()
  @IsIn(SCHEDULE_CATEGORIES)
  scheduleCategory?: ScheduleCategory;

  @IsOptional()
  @Matches(MONEY, { message: 'mrp must be a decimal amount, e.g. "125.50".' })
  mrp?: string;

  @IsOptional()
  @IsIn(PRICE_CONTROL_TYPES)
  priceControlType?: PriceControlType;
}
