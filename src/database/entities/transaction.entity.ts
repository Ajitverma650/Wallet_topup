import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn,
  Index
} from 'typeorm';

export type PaymentStatus = 'pending' | 'success' | 'failed';

@Entity('transactions')
export class Transaction {

  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ unique: true })
  transaction_id: string;

  @Index()
  @Column()
  topup_id: string;

  @Column({ nullable: true })
  payment_link: string;


  @Column({ type: 'timestamp', nullable: true })
  expires_at: Date | null;

  @Column({ default: 'pending' })
  payment_status: PaymentStatus;

  @Column({ default: false })
  processed: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}