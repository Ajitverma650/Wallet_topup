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

  async handleWebhook(dto: WebhookDto) {

    // 1. Quick existence check — outside transaction, no lock
    const exists = await this.transactionRepo.findOne({
      where: { transaction_id: dto.transaction_id },
    });
    if (!exists) {
      throw new NotFoundException(`Transaction ${dto.transaction_id} not found`);
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    // Track if transaction is still active — key fix
    let committed = false;

    try {
      // 2. Locked read — prevents race condition
      const transaction = await queryRunner.manager.findOne(Transaction, {
        where: { transaction_id: dto.transaction_id },
        lock:  { mode: 'pessimistic_write' },
      });

      if (!transaction) {
        throw new NotFoundException(`Transaction ${dto.transaction_id} not found`);
      }

      // 3. Idempotency check
      if (transaction.processed) {
        // commit instead of rollback — cleaner, releases lock
        await queryRunner.commitTransaction();
        committed = true;
        return {
          message:        'Webhook already processed — skipping',
          transaction_id: transaction.transaction_id,
          payment_status: transaction.payment_status,
        };
      }

      // 4. Expiry check
      if (transaction.expires_at && new Date() > transaction.expires_at) {
        throw new BadRequestException(
          'Payment link expired — please create a new topup request'
        );
      }

      // 5. Find linked topup
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

        await queryRunner.manager.update(WalletTopup,
          { topup_id: topup.topup_id },
          { status: 'success' },
        );
      }

      if (dto.payment_status === 'failed') {
        await queryRunner.manager.update(WalletTopup,
          { topup_id: topup.topup_id },
          { status: 'failed' },
        );
      }

      // Mark processed — always last
      await queryRunner.manager.update(Transaction,
        { transaction_id: dto.transaction_id },
        { payment_status: dto.payment_status, processed: true },
      );

      await queryRunner.commitTransaction();
      committed = true;

    } catch (err) {
      // Only rollback if we haven't already committed
      if (!committed && queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }
      // Re-throw HTTP exceptions as-is
      if (err?.status) throw err;
      this.logger.error('Webhook transaction failed, rolled back', err);
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
        this.logger.warn(`Cache invalidation failed: ${cacheErr.message}`);
      }
    }

    return {
      message:        `Payment ${dto.payment_status} — wallet updated`,
      transaction_id: dto.transaction_id,
      payment_status: dto.payment_status,
    };
  }
}