import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsString,
  MaxLength,
} from 'class-validator';

import { NOTIFICATION_KEY_MAX_LENGTH } from '@pharma-erp/types';

export class MarkNotificationsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(NOTIFICATION_KEY_MAX_LENGTH, { each: true })
  keys!: string[];

  /** true marks read; false marks unread again. */
  @IsBoolean()
  read!: boolean;
}
