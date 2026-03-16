import { IsString, IsIn } from 'class-validator';
import { ApiProperty }    from '@nestjs/swagger';

export class WebhookDto {
  @ApiProperty({ example: 'TXN-1710000000000-XYZ789AB', description: 'Transaction ID from POST /wallet/topup/initiate' })
  @IsString()
  transaction_id: string;

  @ApiProperty({ enum: ['success', 'failed'], example: 'success', description: 'Final payment status from payment provider' })
  @IsString()
  @IsIn(['success', 'failed'])
  payment_status: 'success' | 'failed';
}