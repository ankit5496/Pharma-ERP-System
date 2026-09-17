import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';

import type { LicenceRegister, LicenceSummary } from '@pharma-erp/types';

import { Roles } from '../auth/auth.decorators';
import { SkipAudit } from '../common/audit/audit.decorators';

import { CreateLicenceDto, UpdateLicenceAlertDto, UpdateLicenceDto } from './dto/licence.dto';
import { LicencesService } from './licences.service';

/**
 * The Licence & Compliance register — US-MD-04.
 *
 * `@Roles('ADMIN', 'QUALITY_OFFICER')` sits on the CLASS, not on each route.
 * The criterion is "license records must only be visible to Admin and
 * Quality/Compliance roles", and a class-level guard covers every route this
 * controller ever gains — including the one somebody adds in six months
 * without reading this comment.
 *
 * Note what that means for reads: unlike the party register, which every
 * signed-in role may list because a storekeeper needs the supplier names,
 * GET is gated here too. Licence records are the restricted thing.
 *
 * MANAGEMENT is excluded despite its read-everything role elsewhere. The
 * criterion names two roles; see LICENCE_VISIBLE_TO in @pharma-erp/types.
 */
@Controller('licences')
@Roles('ADMIN', 'QUALITY_OFFICER')
export class LicencesController {
  constructor(private readonly licences: LicencesService) {}

  /** The register, plus the lead time that decides which rows read as expiring. */
  @Get()
  @SkipAudit('Read-only master data.')
  async list(): Promise<LicenceRegister> {
    return this.licences.list();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateLicenceDto): Promise<LicenceSummary> {
    return this.licences.create(dto);
  }

  /**
   * Changes the warning lead time.
   *
   * A fixed path, declared BEFORE `:id`, because Nest matches routes in
   * declaration order and `alert` would otherwise be parsed as a licence id —
   * and ParseUUIDPipe would answer "validation failed" to a perfectly good
   * request.
   */
  @Patch('alert')
  async setAlert(@Body() dto: UpdateLicenceAlertDto): Promise<LicenceRegister> {
    return this.licences.setAlertLeadDays(dto.alertLeadDays);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLicenceDto,
  ): Promise<LicenceSummary> {
    return this.licences.update(id, dto);
  }

  /** Retires a licence. Soft delete; the database trigger refuses a real one. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.licences.remove(id);
  }
}
