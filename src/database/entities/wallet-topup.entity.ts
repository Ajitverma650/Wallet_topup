import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn,
  Index
} from 'typeorm';

export type TopupStatus = 'pending' | 'initiated' | 'success' | 'failed';

@Entity('wallet_topups')
export class WalletTopup {

  @PrimaryGeneratedColumn()
  id: number;
  

  @Column({ unique: true })
  topup_id: string;              // e.g. "TUP123456"

  @Column()
  user_id: string;               // e.g. "U123"

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: number;                // e.g. 500.00

  @Column({ default: 'pending' })
  status: TopupStatus;           // pending | initiated | success | failed

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}