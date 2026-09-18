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

import type { JobWorkAgreementSummary } from '@pharma-erp/types';

import { Roles } from '../auth/auth.decorators';
import { SkipAudit } from '../common/audit/audit.decorators';

import { CreateJobWorkAgreementDto, UpdateJobWorkAgreementDto } from './dto/job-work.dto';
import { JobWorkService } from './job-work.service';

/**
 * The Principal & Job-Work Agreement register — US-MD-05.
 *
 * Reads are open to every signed-in role, deliberately: a Production Officer
 * about to run a job-work batch needs the principal's brand name and pack
 * design to put the right carton on the line. Withholding that would make the
 * register useless to the people it exists to inform.
 *
 * Writes are narrower. The billing model decides what gets invoiced and on
 * whose material, which is a commercial decision rather than a manufacturing
 * one — so Admin and Sales Manager, the same pairing that owns the customer
 * side of the party register.
 *
 * US-MD-05 states no visibility rule of its own; contrast the licence register,
 * where the criterion named the roles and the whole controller is gated.
 */
@Controller('job-work/agreements')
export class JobWorkController {
  constructor(private readonly jobWork: JobWorkService) {}

  @Get()
  @SkipAudit('Read-only master data.')
  async list(): Promise<JobWorkAgreementSummary[]> {
    return this.jobWork.list();
  }

  /**
   * The reference the next agreement would take, so the form can show it
   * before saving. A prediction; nothing is reserved.
   *
   * Declared before any `:id` route so the literal segment is matched first.
   */
  @Get('next-reference')
  @SkipAudit('Reads a number; reserves nothing.')
  async nextReference(): Promise<{ agreementReference: string }> {
    return this.jobWork.previewReference();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles('ADMIN', 'SALES_MANAGER')
  async create(@Body() dto: CreateJobWorkAgreementDto): Promise<JobWorkAgreementSummary> {
    return this.jobWork.create(dto);
  }

  @Patch(':id')
  @Roles('ADMIN', 'SALES_MANAGER')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateJobWorkAgreementDto,
  ): Promise<JobWorkAgreementSummary> {
    return this.jobWork.update(id, dto);
  }

  /** Retires an agreement. Admin only — it governs what a principal is billed. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('ADMIN')
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.jobWork.remove(id);
  }
}
