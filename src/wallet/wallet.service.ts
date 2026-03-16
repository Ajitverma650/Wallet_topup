import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository }       from 'typeorm';
import { v4 as uuidv4 }    from 'uuid';
import { CACHE_MANAGER }    from '@nestjs/cache-manager';


import type { Cache } from 'cache-manager';

import { Wallet }           from '../database/entities/wallet.entity';
import { WalletTopup }      from '../database/entities/wallet-topup.entity';
import { Transaction }      from '../database/entities/transaction.entity';
import { CreateTopupDto }   from './dto/create-topup.dto';
import { InitiateTopupDto } from './dto/initiate-topup.dto';

@Injectable()
export class WalletService {
  constructor(
    @InjectRepository(Wallet)
    private walletRepo: Repository<Wallet>,

    @InjectRepository(WalletTopup)
    private topupRepo: Repository<WalletTopup>,

    @InjectRepository(Transaction)
    private transactionRepo: Repository<Transaction>,
    
    @Inject(CACHE_MANAGER)
    private cacheManager: Cache,
  ) {}

  // ── API 1: POST /wallet/topup ──────────────────────────────────
  async createTopup(dto: CreateTopupDto) {

    // 1. Validate amount is not zero or negative
    if (dto.amount <= 0) {
      throw new BadRequestException('Amount must be greater than 0');
    }

    // 2. Generate unique topup ID → "TUP" + 10 random chars
    const topup_id = `TUP${uuidv4().replace(/-/g, '').slice(0, 10).toUpperCase()}`;

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

  // ── API 2: POST /wallet/topup/initiate ────────────────────────
  async initiateTopup(dto: InitiateTopupDto) {

    // 1. Find the topup request
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

    // 2. Generate transaction ID
    const transaction_id = `TXN${uuidv4().replace(/-/g, '').slice(0, 10).toUpperCase()}`;

    // 3. Mock UPI payment link (looks like a real UPI deep-link)
    const payment_link = `upi://pay?pa=wallet@upi&pn=WalletApp&am=${topup.amount}&tn=${transaction_id}&cu=INR`;

    // 4. Mock QR code (base64 encoded version of the payment link)
    const qr_code = Buffer.from(payment_link).toString('base64');

    // 5. Save transaction to DB
    const transaction = await this.transactionRepo.save({
      transaction_id,
      topup_id:       dto.topup_id,
      payment_link,
      qr_code,
      payment_status: 'pending',
      processed:      false,
    });

    return {
      transaction_id: transaction.transaction_id,
      payment_link:   transaction.payment_link,
      qr_code:        transaction.qr_code,
      status:         transaction.payment_status,
    };
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
    return { message: 'getTopupStatus stub' };
  }
}