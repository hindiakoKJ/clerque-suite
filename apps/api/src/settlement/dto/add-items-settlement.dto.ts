import { IsArray, IsUUID } from 'class-validator';

export class AddItemsToSettlementDto {
  @IsArray()
  @IsUUID('all', { each: true })
  orderPaymentIds: string[];
}
