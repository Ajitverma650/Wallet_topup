import { Module }                    from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule }              from '@nestjs/typeorm';
import { CacheModule }               from '@nestjs/cache-manager';
import { redisStore }                from 'cache-manager-ioredis-yet';

import { Wallet }      from './database/entities/wallet.entity';
import { WalletTopup } from './database/entities/wallet-topup.entity';
import { Transaction } from './database/entities/transaction.entity';

// these 2 will still show red until we create them next
import { WalletModule }   from './wallet/wallet.module';
import { PaymentsModule } from './payments/payments.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    TypeOrmModule.forRootAsync({
      imports:    [ConfigModule],
      inject:     [ConfigService],
      useFactory: (config: ConfigService) => ({
        type:        'postgres' as const,
        url:          config.get<string>('DATABASE_URL'),
        entities:    [Wallet, WalletTopup, Transaction],
        synchronize: true,
        ssl:         { rejectUnauthorized: false },
      }),
    }),

    CacheModule.registerAsync({
      isGlobal:   true,
      imports:    [ConfigModule],
      inject:     [ConfigService],
      useFactory: async (config: ConfigService) => ({
        store: redisStore,
        url:   config.get<string>('REDIS_URL'),
        ttl:   60,
      }),
    }),

    WalletModule,
    PaymentsModule,
  ],
})
export class AppModule {}