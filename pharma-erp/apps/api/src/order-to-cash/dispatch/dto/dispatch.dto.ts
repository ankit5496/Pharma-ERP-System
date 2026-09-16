import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

const QUANTITY = /^\d{1,11}(\.\d{1,3})?$/;

export class CreateDispatchLineDto {
  @IsUUID()
  batchAllocationId!: string;

  @Matches(QUANTITY, { message: 'quantityDispatched must be a positive decimal.' })
  quantityDispatched!: string;
}

export class CreateDispatchDto {
  @IsISO8601()
  dispatchDate!: string;

  @IsOptional() @IsString() @MaxLength(255) transporterName?: string;
  @IsOptional() @IsString() @MaxLength(32) vehicleNumber?: string;
  /** Lorry receipt number from the transporter. */
  @IsOptional() @IsString() @MaxLength(64) lrNumber?: string;
  @IsOptional() @IsString() @MaxLength(32) ewayBillNumber?: string;

  @IsOptional() @IsString() @MaxLength(1000) notes?: string;

  /** At least one line — an empty consignment is not a despatch. */
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateDispatchLineDto)
  lines!: CreateDispatchLineDto[];
}
