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

/** Quantities carry three decimals; money carries two. Both travel as strings. */
const QUANTITY = /^\d{1,11}(\.\d{1,3})?$/;
const MONEY = /^\d{1,12}(\.\d{1,2})?$/;
const PERCENT = /^(100(\.0{1,2})?|\d{1,2}(\.\d{1,2})?)$/;

export class CreateSalesOrderItemDto {
  @IsUUID()
  itemId!: string;

  @Matches(QUANTITY, { message: 'quantityOrdered must be a positive decimal, e.g. "120.000".' })
  quantityOrdered!: string;

  /** Defaults to the item's MRP when omitted — see the service. */
  @IsOptional()
  @Matches(MONEY, { message: 'unitPrice must be a decimal amount, e.g. "45.50".' })
  unitPrice?: string;

  @IsOptional()
  @Matches(PERCENT, { message: 'discountPercent must be between 0 and 100.' })
  discountPercent?: string;
}

export class CreateSalesOrderDto {
  @IsUUID()
  customerId!: string;

  @IsISO8601()
  orderDate!: string;

  @IsOptional()
  @IsISO8601()
  requestedDeliveryDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  /**
   * At least one line. An order with no lines has no value, no tax and nothing
   * to allocate — it would sit in the list looking like work that never was.
   */
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateSalesOrderItemDto)
  items!: CreateSalesOrderItemDto[];
}
