import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';

import type { NotificationFeed } from '@pharma-erp/types';

import { SkipAudit } from '../common/audit/audit.decorators';

import { MarkNotificationsDto } from './dto/mark-notifications.dto';
import { NotificationsService } from './notifications.service';

/**
 * The notification bell — US-COMP-01.
 *
 * No `@Roles(...)`: everyone signed in has a bell. What is IN it is decided by
 * role inside the service, per source, like the dashboard.
 *
 * Note that MANAGEMENT is read-only platform-wide, so RolesGuard refuses its
 * POST here. No current source notifies MANAGEMENT; a future one that does
 * will need that rule revisited.
 */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @SkipAudit('Read-only; notifications are derived from records that carry their own history.')
  async feed(): Promise<NotificationFeed> {
    return this.notifications.feed();
  }

  @Post('read')
  @HttpCode(HttpStatus.OK)
  @SkipAudit('A person marking their own notification read changes no record.')
  async mark(@Body() dto: MarkNotificationsDto): Promise<NotificationFeed> {
    return this.notifications.mark(dto.keys, dto.read);
  }
}
