
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository }              from '@nestjs/typeorm';
import { Repository }                    from 'typeorm';
import { v4 as uuidv4 }                from 'uuid';

import { Wallet }      from '../database/entities/wallet.entity';
import { WalletTopup } from '../database/entities/wallet-topup.entity';
import { Transaction } from '../database/entities/transaction.entity';
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
  ) {}

  // POST /wallet/topup — will be filled in next phase
  async createTopup(dto: CreateTopupDto) {
    return { message: 'createTopup stub' };
  }

  // POST /wallet/topup/initiate — will be filled in next phase
  async initiateTopup(dto: InitiateTopupDto) {
    return { message: 'initiateTopup stub' };
  }

  // GET /wallet/:user_id — will be filled in next phase
  async getBalance(userId: string) {
    return { message: 'getBalance stub' };
  }

  // GET /wallet/topup/:topup_id — will be filled in next phase
  async getTopupStatus(topupId: string) {
    return { message: 'getTopupStatus stub' };
  }
}