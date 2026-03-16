import { IsString, IsIn } from 'class-validator';

export class WebhookDto {
  @IsString()
  transaction_id: string;

  @IsString()
  @IsIn(['success', 'failed'])
  payment_status: 'success' | 'failed';
}