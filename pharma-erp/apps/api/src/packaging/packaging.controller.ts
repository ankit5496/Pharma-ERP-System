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
  Query,
} from '@nestjs/common';

import type { PackagingAvailability, PackagingRequirementView } from '@pharma-erp/types';

import { Roles } from '../auth/auth.decorators';
import { SkipAudit } from '../common/audit/audit.decorators';

import { CreatePackagingRequirementDto, UpdatePackagingRequirementDto } from './dto/packaging.dto';
import { PackagingService } from './packaging.service';

/**
 * The Packaging Requirement Master — US-MD-06.
 *
 * Reads are open to every signed-in role, deliberately: the people who need to
 * know what a pack consumes and whether the stock exists are the packing line
 * and the buyer, not just whoever wrote the specification down.
 *
 * Writes are Admin and Production Officer. Pack composition is a manufacturing
 * judgement — which component stops the line is a shop-floor fact — which is
 * the opposite of the job-work register, where the billing model made it a
 * commercial one.
 */
@Controller('packaging/requirements')
export class PackagingController {
  constructor(private readonly packaging: PackagingService) {}

  @Get()
  @SkipAudit('Read-only master data.')
  async list(): Promise<PackagingRequirementView[]> {
    return this.packaging.list();
  }

  /**
   * What a batch of `batchQuantity` would consume, and whether the stock for it
   * exists — US-MD-06 criteria 2 and 3.
   *
   * A GET with the batch size as a query parameter, because it computes and
   * stores nothing. Asking the same question twice must cost nothing and change
   * nothing.
   */
  @Get(':id/availability')
  @SkipAudit('Computes nothing persistent.')
  async availability(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('batchQuantity') batchQuantity?: string,
  ): Promise<PackagingAvailability> {
    return this.packaging.availability(id, batchQuantity ?? '0');
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles('ADMIN', 'PRODUCTION_OFFICER')
  async create(@Body() dto: CreatePackagingRequirementDto): Promise<PackagingRequirementView> {
    return this.packaging.create(dto);
  }

  @Patch(':id')
  @Roles('ADMIN', 'PRODUCTION_OFFICER')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePackagingRequirementDto,
  ): Promise<PackagingRequirementView> {
    return this.packaging.update(id, dto);
  }

  /**
   * Retires a specification. Admin only — retiring the last active one for a
   * product stops work orders being raised for it, which is a wider
   * consequence than editing a component list.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('ADMIN')
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.packaging.remove(id);
  }
}
