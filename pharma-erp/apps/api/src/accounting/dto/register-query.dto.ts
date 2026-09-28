import { IsDateString } from 'class-validator';

import type { RegisterQuery } from '@pharma-erp/types';

/**
 * The date range both registers are asked for.
 *
 * BOTH DATES ARE REQUIRED. A register with an open end is a different report —
 * it changes size as invoices are raised, so two people running "the September
 * register" a day apart would get different figures out of the same screen.
 */
export class RegisterQueryDto implements RegisterQuery {
  @IsDateString({ strict: true }, { message: 'from must be a date, as YYYY-MM-DD.' })
  from!: string;

  @IsDateString({ strict: true }, { message: 'to must be a date, as YYYY-MM-DD.' })
  to!: string;
}
