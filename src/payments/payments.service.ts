import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
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

  // ── API 3: POST /payments/webhook ──────────────────────────────
  async handleWebhook(dto: WebhookDto) {

    // 1. Find the transaction
    const transaction = await this.transactionRepo.findOne({
      where: { transaction_id: dto.transaction_id },
    });

    if (!transaction) {
      throw new NotFoundException(
        `Transaction ${dto.transaction_id} not found`
      );
    }

    // 2. Idempotency check — if already processed, skip silently
    if (transaction.processed) {
      return {
        message:        'Webhook already processed — skipping',
        transaction_id: transaction.transaction_id,
        payment_status: transaction.payment_status,
      };
    }

    // 3. Find the linked topup
    const topup = await this.topupRepo.findOne({
      where: { topup_id: transaction.topup_id },
    });

    if (!topup) {
      throw new NotFoundException(
        `Topup ${transaction.topup_id} not found`
      );
    }

    // 4. Handle success path
    if (dto.payment_status === 'success') {

      // Find or create wallet for this user
      let wallet = await this.walletRepo.findOne({
        where: { user_id: topup.user_id },
      });
      if (!wallet) {
        wallet = await this.walletRepo.save({
          user_id: topup.user_id,
          balance: 0,
        });
      }

      // Add topup amount to wallet balance
      const newBalance = Number(wallet.balance) + Number(topup.amount);
      await this.walletRepo.update(
        { user_id: topup.user_id },
        { balance: newBalance },
      );

      // Update topup status → success
      await this.topupRepo.update(
        { topup_id: topup.topup_id },
        { status: 'success' },
      );
    }

    // 5. Handle failed path
    if (dto.payment_status === 'failed') {
      await this.topupRepo.update(
        { topup_id: topup.topup_id },
        { status: 'failed' },
      );
    }

    // 6. Mark transaction as processed (idempotency flag)
    await this.transactionRepo.update(
      { transaction_id: dto.transaction_id },
      {
        payment_status: dto.payment_status,
        processed:      true,
      },
    );

    return {
      message:        `Payment ${dto.payment_status} — wallet updated`,
      transaction_id: dto.transaction_id,
      payment_status: dto.payment_status,
    };
  }
}