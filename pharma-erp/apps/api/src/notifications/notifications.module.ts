import { Module } from '@nestjs/common';

import { LicencesModule } from '../licences/licences.module';

import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/** The notification bell — US-COMP-01. Imports each module it takes a source from. */
@Module({
  imports: [LicencesModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
})
export class NotificationsModule {}
