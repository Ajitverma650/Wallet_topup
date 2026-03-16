import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn
} from 'typeorm';

@Entity('wallets')
export class Wallet {

  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  user_id: string;               // e.g. "U123"

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  balance: number;                // e.g. 1500.00

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}