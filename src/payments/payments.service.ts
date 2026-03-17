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

  // 1. Quick existence check only — no lock yet
  const exists = await this.transactionRepo.findOne({
    where: { transaction_id: dto.transaction_id },
  });
  if (!exists) {
    throw new NotFoundException(`Transaction ${dto.transaction_id} not found`);
  }

  // 2. Open transaction FIRST — then do locked read inside it
  const queryRunner = this.dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    // 3. SELECT FOR UPDATE — locks the row
    // Second request waits here until first commits/rollbacks
    const transaction = await queryRunner.manager.findOne(Transaction, {
      where: { transaction_id: dto.transaction_id },
      lock:  { mode: 'pessimistic_write' },  // ← the fix
    });

    // ← ADD THIS — null check after locked read
    if (!transaction) {
     await queryRunner.rollbackTransaction();
         throw new NotFoundException(`Transaction ${dto.transaction_id} not found`);
    }

    // 4. Idempotency check — now race-condition safe
    // Because row is locked, no other request can read it here
    if (transaction.processed) {
      await queryRunner.rollbackTransaction();
      return {
        message:        'Webhook already processed — skipping',
        transaction_id: transaction.transaction_id,
        payment_status: transaction.payment_status,
      };
    }

    // 5. Expiry check — inside lock
    if (transaction.expires_at && new Date() > transaction.expires_at) {
      await queryRunner.rollbackTransaction();
      throw new BadRequestException(
        'Payment link expired — please create a new topup request'
      );
    }

    // 6. Find linked topup — inside transaction
    const topup = await queryRunner.manager.findOne(WalletTopup, {
      where: { topup_id: transaction.topup_id },
    });
    if (!topup) {
      throw new NotFoundException(`Topup ${transaction.topup_id} not found`);
    }

    if (dto.payment_status === 'success') {

      // Ensure wallet exists
      const walletExists = await queryRunner.manager.findOne(Wallet, {
        where: { user_id: topup.user_id },
      });
      if (!walletExists) {
        await queryRunner.manager.save(Wallet, {
          user_id: topup.user_id,
          balance: 0,
        });
      }

      // Atomic balance increment
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

    // Mark processed — last step
    await queryRunner.manager.update(
      Transaction,
      { transaction_id: dto.transaction_id },
      { payment_status: dto.payment_status, processed: true },
    );

    await queryRunner.commitTransaction();

  } catch (err) {
    await queryRunner.rollbackTransaction();
    // Re-throw NestJS HTTP exceptions as-is — don't wrap them
    if (err?.status) throw err;
    this.logger.error('Webhook DB transaction failed, rolled back', err);
    throw new InternalServerErrorException('Payment processing failed — please retry');
  } finally {
    await queryRunner.release();
  }

  // Cache invalidation — outside transaction, best-effort
  const topup = await this.topupRepo.findOne({
    where: { topup_id: exists.topup_id },
  });
  if (dto.payment_status === 'success' && topup) {
    try {
      await this.cacheManager.del(`wallet:balance:${topup.user_id}`);
    } catch (cacheErr) {
      this.logger.warn(
        `Cache invalidation failed: ${cacheErr.message}`,
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