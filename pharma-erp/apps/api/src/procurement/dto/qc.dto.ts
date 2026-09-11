import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import { QC_DECISIONS, type QcDecision, type RecordQcDecisionRequest } from '@pharma-erp/types';

import { trim } from './common.dto';

/**
 * Body of `POST /api/v1/procurement/qc/lots/:id/decision`.
 *
 * `remarks` is optional here but required by the service for a rejection or a
 * hold — the rule depends on the decision, which is easier to state once in
 * the service than to express across three conditional validators.
 */
export class RecordQcDecisionDto implements RecordQcDecisionRequest {
  @IsIn(QC_DECISIONS, { message: `Decision must be one of: ${QC_DECISIONS.join(', ')}` })
  decision!: QcDecision;

  @IsOptional()
  @IsString()
  @trim()
  @MaxLength(64)
  testReference?: string;

  @IsOptional()
  @IsString()
  @trim()
  @MaxLength(1000)
  remarks?: string;
}
