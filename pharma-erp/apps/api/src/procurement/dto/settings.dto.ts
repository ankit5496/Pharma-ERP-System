import { IsBoolean } from 'class-validator';

import type { UpdateProcurementSettingsRequest } from '@pharma-erp/types';

/**
 * Body of `PATCH /api/v1/procurement/settings`.
 *
 * The flag is REQUIRED rather than optional, unlike most PATCH bodies in this
 * module. There is one setting, and the only caller is a toggle that always
 * knows which way it is being moved; accepting an absent value would mean
 * deciding what an empty PATCH means, and every answer to that is a trap.
 */
export class UpdateProcurementSettingsDto implements UpdateProcurementSettingsRequest {
  @IsBoolean({ message: 'Auto creation must be true or false.' })
  autoRequisitionEnabled!: boolean;
}
