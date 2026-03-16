import { Module }       from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Wallet }      from '../database/entities/wallet.entity';
import { WalletTopup } from '../database/entities/wallet-topup.entity';
import { Transaction } from '../database/entities/transaction.entity';

import { WalletController } from './wallet.controller';
import { WalletService }    from './wallet.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Wallet, WalletTopup, Transaction]),
  ],
  controllers: [WalletController],
  providers:   [WalletService],
})
export class WalletModule {}