import {
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  BadRequestException,
  Inject,
  Logger,
} from '@nestjs/common';
import { InjectRepository }  from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache }    from 'cache-manager';

import { Wallet }      from '../database/entities/wallet.entity';
import { WalletTopup } from '../database/entities/wallet-topup.entity';
import { Transaction } from '../database/entities/transaction.entity';
import { WebhookDto }  from './dto/webhook.dto';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectRepository(Wallet)
    private walletRepo: Repository<Wallet>,

    @InjectRepository(WalletTopup)
    private topupRepo: Repository<WalletTopup>,

    @InjectRepository(Transaction)
    private transactionRepo: Repository<Transaction>,

    @Inject(CACHE_MANAGER)
    private cacheManager: Cache,

    private dataSource: DataSource,
  ) {}

  // ── API 3: POST /payments/webhook ──────────────────────────────
  async handleWebhook(dto: WebhookDto) {

    // ── Pre-flight checks (outside transaction to avoid locking) ──

    // 1. Find the transaction
    const transaction = await this.transactionRepo.findOne({
      where: { transaction_id: dto.transaction_id },
    });
    if (!transaction) {
      throw new NotFoundException(`Transaction ${dto.transaction_id} not found`);
    }

    // 2. Idempotency guard — already processed, return early
    if (transaction.processed) {
      return {
        message:        'Webhook already processed — skipping',
        transaction_id: transaction.transaction_id,
        payment_status: transaction.payment_status,
      };
    }

    if (new Date() > transaction.expires_at) {
  throw new BadRequestException(
    'Payment link expired — please create a new topup request'
  );
}

    // 3. Find the linked topup
    const topup = await this.topupRepo.findOne({
      where: { topup_id: transaction.topup_id },
    });
    if (!topup) {
      throw new NotFoundException(`Topup ${transaction.topup_id} not found`);
    }

    // ── Wrap all DB writes in a single atomic transaction ──────────
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {

      if (dto.payment_status === 'success') {

        // Ensure wallet row exists (use the same queryRunner manager)
        const walletExists = await queryRunner.manager.findOne(Wallet, {
          where: { user_id: topup.user_id },
        });
        if (!walletExists) {
          await queryRunner.manager.save(Wallet, {
            user_id: topup.user_id,
            balance: 0,
          });
        }

        // ✅ FIX: Atomic increment — no read-then-write race condition
        // "balance = balance + X" is evaluated atomically by PostgreSQL
        await queryRunner.manager
          .createQueryBuilder()
          .update(Wallet)
          .set({ balance: () => `balance + ${Number(topup.amount)}` })
          .where('user_id = :userId', { userId: topup.user_id })
          .execute();

        // Update topup status
        await queryRunner.manager.update(
          WalletTopup,
          { topup_id: topup.topup_id },
          { status: 'success' },
        );
      }

      if (dto.payment_status === 'failed') {
        await queryRunner.manager.update(
          WalletTopup,
          { topup_id: topup.topup_id },
          { status: 'failed' },
        );
      }

      // Mark transaction as processed (idempotency flag)
      await queryRunner.manager.update(
        Transaction,
        { transaction_id: dto.transaction_id },
        { payment_status: dto.payment_status, processed: true },
      );

      await queryRunner.commitTransaction();

    } catch (err) {
      await queryRunner.rollbackTransaction();
      this.logger.error('Webhook DB transaction failed, rolled back', err);
      throw new InternalServerErrorException('Payment processing failed — please retry');
    } finally {
      await queryRunner.release();
    }

    // ── Invalidate Redis cache (best-effort, never breaks the payment) ──
    if (dto.payment_status === 'success') {
      try {
        await this.cacheManager.del(`wallet:balance:${topup.user_id}`);
      } catch (cacheErr) {
        this.logger.warn(
          `Cache invalidation failed for user ${topup.user_id}: ${cacheErr.message}`,
        );
      }
    }

    return {
      message:        `Payment ${dto.payment_status} — wallet updated`,
      transaction_id: dto.transaction_id,
      payment_status: dto.payment_status,
    };
  }
}