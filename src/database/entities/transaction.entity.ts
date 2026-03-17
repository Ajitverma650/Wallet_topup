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
  transaction_id: string;        // e.g. "TXN87654"

  @Column()
  topup_id: string;              // links back to wallet_topups

  @Column({ nullable: true })
  payment_link: string;          // UPI payment URL

  @Column({ nullable: true })
  qr_code: string;      // base64 QR string

  @Column({ type: 'timestamp' })   // ← ADD THIS
  expires_at: Date;

  @Column({ default: 'pending' })
  payment_status: PaymentStatus;  // pending | success | failed

  @Column({ default: false })
  processed: boolean;            // for idempotent webhook handling

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}