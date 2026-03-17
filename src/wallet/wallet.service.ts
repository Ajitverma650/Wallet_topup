import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  Logger,
  Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository ,DataSource}       from 'typeorm';
import { randomUUID }       from 'crypto';
import { CACHE_MANAGER }    from '@nestjs/cache-manager';

import * as QRCode from 'qrcode';

import type { Cache } from 'cache-manager';

import { Wallet }           from '../database/entities/wallet.entity';
import { WalletTopup }      from '../database/entities/wallet-topup.entity';
import { Transaction }      from '../database/entities/transaction.entity';
import { CreateTopupDto }   from './dto/create-topup.dto';
import { InitiateTopupDto } from './dto/initiate-topup.dto';

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);
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

  // ── API 1: POST /wallet/topup ──────────────────────────────────
  async createTopup(dto: CreateTopupDto) {

    // 1. Validate amount is not zero or negative
    if (dto.amount <= 0) {
      throw new BadRequestException('Amount must be greater than 0');
    }

    // 2. Generate unique topup ID → "TUP" + 10 random chars
    const topup_id = `TUP-${Date.now()}-${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;

    // 3. Create wallet for this user if it doesn't exist yet
    let wallet = await this.walletRepo.findOne({
      where: { user_id: dto.user_id },
    });
    if (!wallet) {
      wallet = await this.walletRepo.save({ user_id: dto.user_id, balance: 0 });
    }

    // 4. Save the topup request to DB with status = pending
    const topup = await this.topupRepo.save({
      topup_id,
      user_id: dto.user_id,
      amount:  dto.amount,
      status:  'pending',
    });

    // 5. Return response matching assignment spec
    return {
      topup_id: topup.topup_id,
      user_id:  topup.user_id,
      amount:   topup.amount,
      status:   topup.status,
    };
  }
async initiateTopup(dto: InitiateTopupDto) {

    // Pre-flight checks — outside transaction
    const topup = await this.topupRepo.findOne({
      where: { topup_id: dto.topup_id },
    });
    if (!topup) {
      throw new NotFoundException(`Topup ${dto.topup_id} not found`);
    }
    if (topup.status !== 'pending') {
      throw new BadRequestException(
        `Topup is already ${topup.status} — cannot initiate again`
      );
    }

    // Generate IDs + payment details — no DB yet
    const transaction_id = `TXN-${Date.now()}-${randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase()}`;

    const payment_link  = `upi://pay?pa=wallet@upi&pn=WalletApp&am=${topup.amount}&tn=${transaction_id}&cu=INR`;
    const qr_code = await QRCode.toDataURL(payment_link, { width: 300, margin: 2 });

    // ACID transaction — both writes succeed or both roll back
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Write 1 — save transaction row
      const savedTxn = await queryRunner.manager.save(Transaction, {
        transaction_id,
        topup_id:       dto.topup_id,
        payment_link,
        payment_status: 'pending',
        processed:      false,
        expires_at:     new Date(Date.now() + 10 * 60 * 1000),
      });

      // Write 2 — update topup status to "initiated"
      await queryRunner.manager.update(WalletTopup,
        { topup_id: dto.topup_id },
        { status: 'initiated' },
      );

      await queryRunner.commitTransaction();

      return {
         transaction_id: savedTxn.transaction_id,
         payment_link:   savedTxn.payment_link,
         qr_code,        // ← generated fresh, returned but not stored
         status:         savedTxn.payment_status,
       };

    } catch (err) {
      await queryRunner.rollbackTransaction();
      this.logger.error('initiateTopup transaction failed, rolled back', err);
      throw new InternalServerErrorException('Could not initiate payment — please retry');

    } finally {
      await queryRunner.release();
    }
  }
  // ── API 4: GET /wallet/:user_id ───────────────────────────────
  async getBalance(userId: string) {

    // 1. Build cache key for this user
    const cacheKey = `wallet:balance:${userId}`;

    // 2. Check Redis first
    const cached = await this.cacheManager.get(cacheKey);
    if (cached) {
      return {
        user_id:        userId,
        wallet_balance: cached,
        source:         'cache',   // shows where data came from
      };
    }

    // 3. Cache miss — query Postgres
    const wallet = await this.walletRepo.findOne({
      where: { user_id: userId },
    });

    if (!wallet) {
      throw new NotFoundException(`Wallet not found for user ${userId}`);
    }

    // 4. Store in Redis with 60 second TTL
    await this.cacheManager.set(cacheKey, wallet.balance, 60000);

    return {
      user_id:        wallet.user_id,
      wallet_balance: wallet.balance,
      source:         'database',  // shows where data came from
    };
  }

  
  // GET /wallet/topup/:topup_id — will be filled in next phase
  async getTopupStatus(topupId: string) {

  const topup = await this.topupRepo.findOne({
    where: { topup_id: topupId },
  });

  if (!topup) {
    throw new NotFoundException(`Topup ${topupId} not found`);
  }

  // find linked transaction if it exists
  const transaction = await this.transactionRepo.findOne({
    where: { topup_id: topupId },
  });

  return {
    topup_id:       topup.topup_id,
    status:         topup.status,
    transaction_id: transaction?.transaction_id ?? null,
  };
    }
}
