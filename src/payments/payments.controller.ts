import { Controller, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { WebhookDto }      from './dto/webhook.dto';

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  // POST /payments/webhook
  @ApiOperation({
    summary: 'Handle payment provider webhook',
    description:
      'Called by the payment provider after UPI payment completes. ' +
      'Credits the wallet on success or marks topup as failed. ' +
      'Idempotent — safe to retry if the provider sends duplicate events.',
  })
  @ApiResponse({ status: 201, description: 'Webhook processed — wallet updated or already processed' })
  @ApiResponse({ status: 400, description: 'Invalid payload (bad status value)' })
  @ApiResponse({ status: 404, description: 'Transaction or topup not found' })
  @Post('webhook')
  handleWebhook(@Body() dto: WebhookDto) {
    return this.paymentsService.handleWebhook(dto);
  }
}