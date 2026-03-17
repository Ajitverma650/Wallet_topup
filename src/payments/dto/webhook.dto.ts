import { IsString, IsIn, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class WebhookDto {
  @ApiProperty({ example: 'TXN-1710000000000-XYZ789AB' })
  @IsString()
  @IsNotEmpty({ message: 'transaction_id should not be empty' })
  transaction_id: string;

  @ApiProperty({ enum: ['success', 'failed'] })
  @IsString()
  @IsIn(['success', 'failed'])
  payment_status: 'success' | 'failed';
}