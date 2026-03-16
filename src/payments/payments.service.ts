import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository }       from 'typeorm';

import { Wallet }      from '../database/entities/wallet.entity';
import { WalletTopup } from '../database/entities/wallet-topup.entity';
import { Transaction } from '../database/entities/transaction.entity';
import { WebhookDto }  from './dto/webhook.dto';

@Injectable()
export class PaymentsService {
  constructor(
    @InjectRepository(Wallet)
    private walletRepo: Repository<Wallet>,

    @InjectRepository(WalletTopup)
    private topupRepo: Repository<WalletTopup>,

    @InjectRepository(Transaction)
    private transactionRepo: Repository<Transaction>,
  ) {}

  // POST /payments/webhook — will be filled in next phase
  async handleWebhook(dto: WebhookDto) {
    return { message: 'webhook stub' };
  }
}