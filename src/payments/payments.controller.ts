import { Controller, Post, Body } from '@nestjs/common';
import { PaymentsService }  from './payments.service';
import { WebhookDto }       from './dto/webhook.dto';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  // POST /payments/webhook
  @Post('webhook')
  handleWebhook(@Body() dto: WebhookDto) {
    return this.paymentsService.handleWebhook(dto);
  }
}