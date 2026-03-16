import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken }  from '@nestjs/typeorm';
import { CACHE_MANAGER }       from '@nestjs/cache-manager';
import { NotFoundException, BadRequestException } from '@nestjs/common';

import { WalletService }  from './wallet.service';
import { Wallet }         from '../database/entities/wallet.entity';
import { WalletTopup }    from '../database/entities/wallet-topup.entity';
import { Transaction }    from '../database/entities/transaction.entity';

// ── Shared mock factories ──────────────────────────────────────────────────
const mockRepo = () => ({
  findOne: jest.fn(),
  save:    jest.fn(),
  update:  jest.fn(),
});

const mockCache = () => ({
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
});

// ── Test suite ─────────────────────────────────────────────────────────────
describe('WalletService', () => {
  let service:         WalletService;
  let walletRepo:      ReturnType<typeof mockRepo>;
  let topupRepo:       ReturnType<typeof mockRepo>;
  let transactionRepo: ReturnType<typeof mockRepo>;
  let cacheManager:    ReturnType<typeof mockCache>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WalletService,
        { provide: getRepositoryToken(Wallet),      useFactory: mockRepo },
        { provide: getRepositoryToken(WalletTopup), useFactory: mockRepo },
        { provide: getRepositoryToken(Transaction), useFactory: mockRepo },
        { provide: CACHE_MANAGER,                   useFactory: mockCache },
      ],
    }).compile();

    service         = module.get(WalletService);
    walletRepo      = module.get(getRepositoryToken(Wallet));
    topupRepo       = module.get(getRepositoryToken(WalletTopup));
    transactionRepo = module.get(getRepositoryToken(Transaction));
    cacheManager    = module.get(CACHE_MANAGER);
  });

  afterEach(() => jest.clearAllMocks());

  // ──────────────────────────────────────────────────────────────────────────
  // createTopup
  // ──────────────────────────────────────────────────────────────────────────
  describe('createTopup', () => {

    it('should reject amount <= 0', async () => {
      await expect(
        service.createTopup({ user_id: 'U1', amount: 0 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject negative amount', async () => {
      await expect(
        service.createTopup({ user_id: 'U1', amount: -100 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should create a wallet if one does not exist, then return topup', async () => {
      walletRepo.findOne.mockResolvedValue(null);
      walletRepo.save.mockResolvedValue({ user_id: 'U1', balance: 0 });
      topupRepo.save.mockResolvedValue({
        topup_id: 'TUP-123',
        user_id:  'U1',
        amount:   500,
        status:   'pending',
      });

      const result = await service.createTopup({ user_id: 'U1', amount: 500 });

      expect(walletRepo.save).toHaveBeenCalledWith({ user_id: 'U1', balance: 0 });
      expect(result.status).toBe('pending');
      expect(result.amount).toBe(500);
    });

    it('should reuse existing wallet if one already exists', async () => {
      walletRepo.findOne.mockResolvedValue({ user_id: 'U1', balance: 200 });
      topupRepo.save.mockResolvedValue({
        topup_id: 'TUP-456',
        user_id:  'U1',
        amount:   100,
        status:   'pending',
      });

      await service.createTopup({ user_id: 'U1', amount: 100 });

      // save should NOT be called to create a new wallet
      expect(walletRepo.save).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // initiateTopup
  // ──────────────────────────────────────────────────────────────────────────
  describe('initiateTopup', () => {

    it('should throw NotFoundException when topup_id does not exist', async () => {
      topupRepo.findOne.mockResolvedValue(null);

      await expect(
        service.initiateTopup({ topup_id: 'NONEXISTENT' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when topup is not pending', async () => {
      topupRepo.findOne.mockResolvedValue({ topup_id: 'TUP-1', status: 'success' });

      await expect(
        service.initiateTopup({ topup_id: 'TUP-1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should create a transaction and return payment_link and qr_code', async () => {
      topupRepo.findOne.mockResolvedValue({
        topup_id: 'TUP-1',
        status:   'pending',
        amount:   500,
      });
      transactionRepo.save.mockResolvedValue({
        transaction_id: 'TXN-999',
        payment_link:   'upi://pay?pa=wallet@upi',
        qr_code:        'base64string==',
        payment_status: 'pending',
      });

      const result = await service.initiateTopup({ topup_id: 'TUP-1' });

      expect(result.transaction_id).toBe('TXN-999');
      expect(result.payment_link).toContain('upi://pay');
      expect(result.qr_code).toBeDefined();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // getBalance
  // ──────────────────────────────────────────────────────────────────────────
  describe('getBalance', () => {

    it('should return cached balance if Redis hit', async () => {
      cacheManager.get.mockResolvedValue(1500);

      const result = await service.getBalance('U1');

      expect(result.wallet_balance).toBe(1500);
      expect(result.source).toBe('cache');
      expect(walletRepo.findOne).not.toHaveBeenCalled();
    });

    it('should query DB on cache miss then cache the result', async () => {
      cacheManager.get.mockResolvedValue(null);
      walletRepo.findOne.mockResolvedValue({ user_id: 'U1', balance: 750 });

      const result = await service.getBalance('U1');

      expect(result.wallet_balance).toBe(750);
      expect(result.source).toBe('database');
      expect(cacheManager.set).toHaveBeenCalledWith('wallet:balance:U1', 750, 60000);
    });

    it('should throw NotFoundException when wallet does not exist', async () => {
      cacheManager.get.mockResolvedValue(null);
      walletRepo.findOne.mockResolvedValue(null);

      await expect(service.getBalance('NOSUCHUSER')).rejects.toThrow(NotFoundException);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // getTopupStatus
  // ──────────────────────────────────────────────────────────────────────────
  describe('getTopupStatus', () => {

    it('should throw NotFoundException for unknown topup_id', async () => {
      topupRepo.findOne.mockResolvedValue(null);

      await expect(service.getTopupStatus('BADID')).rejects.toThrow(NotFoundException);
    });

    it('should return status and null transaction_id when no transaction linked', async () => {
      topupRepo.findOne.mockResolvedValue({ topup_id: 'TUP-1', status: 'pending' });
      transactionRepo.findOne.mockResolvedValue(null);

      const result = await service.getTopupStatus('TUP-1');

      expect(result.status).toBe('pending');
      expect(result.transaction_id).toBeNull();
    });

    it('should return transaction_id when transaction exists', async () => {
      topupRepo.findOne.mockResolvedValue({ topup_id: 'TUP-1', status: 'success' });
      transactionRepo.findOne.mockResolvedValue({ transaction_id: 'TXN-999' });

      const result = await service.getTopupStatus('TUP-1');

      expect(result.transaction_id).toBe('TXN-999');
    });
  });
});
