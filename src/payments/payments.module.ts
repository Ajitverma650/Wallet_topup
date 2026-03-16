
import { Module }       from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Wallet }      from '../database/entities/wallet.entity';
import { WalletTopup } from '../database/entities/wallet-topup.entity';
import { Transaction } from '../database/entities/transaction.entity';

import { PaymentsController } from './payments.controller';
import { PaymentsService }    from './payments.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Wallet, WalletTopup, Transaction]),
  ],
  controllers: [PaymentsController],
  providers:   [PaymentsService],
})
export class PaymentsModule {}