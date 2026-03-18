import { Module }                    from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule }              from '@nestjs/typeorm';
import { CacheModule }               from '@nestjs/cache-manager';
import Keyv from 'keyv';
import KeyvRedis from '@keyv/redis';

import { Wallet }      from './database/entities/wallet.entity';
import { WalletTopup } from './database/entities/wallet-topup.entity';
import { Transaction } from './database/entities/transaction.entity';

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
      useFactory: async (config: ConfigService) => {
        const redisUrl = config.get<string>('REDIS_URL') || 'redis://localhost:6379';
        
        try {
          const store = new KeyvRedis(redisUrl);
          return { stores: [new Keyv({ store, ttl: 600000 })] };
        } catch (err) {
          console.error('[CacheModule] Failed to connect to Redis!', err);
          throw err;
        }
      },
    }),

    WalletModule,
    PaymentsModule,
  ],
})
export class AppModule {}