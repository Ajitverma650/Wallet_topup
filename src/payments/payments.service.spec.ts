import { Test, TestingModule }   from '@nestjs/testing';
import { getRepositoryToken }     from '@nestjs/typeorm';
import { CACHE_MANAGER }          from '@nestjs/cache-manager';
import { NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { DataSource }             from 'typeorm';

import { PaymentsService } from './payments.service';
import { Wallet }          from '../database/entities/wallet.entity';
import { WalletTopup }     from '../database/entities/wallet-topup.entity';
import { Transaction }     from '../database/entities/transaction.entity';

// ── QueryRunner mock ───────────────────────────────────────────────────────
const createMockQueryRunner = (overrides: Partial<any> = {}) => ({
  connect:             jest.fn(),
  startTransaction:    jest.fn(),
  commitTransaction:   jest.fn(),
  rollbackTransaction: jest.fn(),
  release:             jest.fn(),
  manager: {
    findOne:            jest.fn(),
    save:               jest.fn(),
    update:             jest.fn(),
    createQueryBuilder: jest.fn().mockReturnValue({
      update:  jest.fn().mockReturnThis(),
      set:     jest.fn().mockReturnThis(),
      where:   jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({}),
    }),
  },
  ...overrides,
});

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
describe('PaymentsService', () => {
  let service:         PaymentsService;
  let transactionRepo: ReturnType<typeof mockRepo>;
  let topupRepo:       ReturnType<typeof mockRepo>;
  let cacheManager:    ReturnType<typeof mockCache>;
  let dataSource:      { createQueryRunner: jest.Mock };
  let queryRunner:     ReturnType<typeof createMockQueryRunner>;

  beforeEach(async () => {
    queryRunner  = createMockQueryRunner();
    dataSource   = { createQueryRunner: jest.fn().mockReturnValue(queryRunner) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: getRepositoryToken(Wallet),      useFactory: mockRepo },
        { provide: getRepositoryToken(WalletTopup), useFactory: mockRepo },
        { provide: getRepositoryToken(Transaction), useFactory: mockRepo },
        { provide: CACHE_MANAGER,                   useFactory: mockCache },
        { provide: DataSource,                      useValue: dataSource },
      ],
    }).compile();

    service         = module.get(PaymentsService);
    transactionRepo = module.get(getRepositoryToken(Transaction));
    topupRepo       = module.get(getRepositoryToken(WalletTopup));
    cacheManager    = module.get(CACHE_MANAGER);
  });

  afterEach(() => jest.clearAllMocks());

  // ──────────────────────────────────────────────────────────────────────────
  // handleWebhook — pre-flight guards
  // ──────────────────────────────────────────────────────────────────────────
  describe('handleWebhook — pre-flight guards', () => {

    it('should throw NotFoundException when transaction_id not found', async () => {
      transactionRepo.findOne.mockResolvedValue(null);

      await expect(
        service.handleWebhook({ transaction_id: 'MISSING', payment_status: 'success' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should return early (idempotency) if transaction already processed', async () => {
      transactionRepo.findOne.mockResolvedValue({
        transaction_id: 'TXN-1',
        processed:      true,
        payment_status: 'success',
      });

      const result = await service.handleWebhook({
        transaction_id: 'TXN-1',
        payment_status: 'success',
      });

      expect(result.message).toContain('already processed');
      // queryRunner should never be created
      expect(dataSource.createQueryRunner).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when linked topup not found', async () => {
      transactionRepo.findOne.mockResolvedValue({
        transaction_id: 'TXN-1',
        processed:      false,
        topup_id:       'TUP-1',
      });
      topupRepo.findOne.mockResolvedValue(null);

      await expect(
        service.handleWebhook({ transaction_id: 'TXN-1', payment_status: 'success' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // handleWebhook — success path
  // ──────────────────────────────────────────────────────────────────────────
  describe('handleWebhook — success path', () => {

    beforeEach(() => {
      transactionRepo.findOne.mockResolvedValue({
        transaction_id: 'TXN-1',
        processed:      false,
        topup_id:       'TUP-1',
      });
      topupRepo.findOne.mockResolvedValue({
        topup_id: 'TUP-1',
        user_id:  'U1',
        amount:   500,
      });
      // Wallet already exists
      queryRunner.manager.findOne.mockResolvedValue({ user_id: 'U1', balance: 200 });
    });

    it('should use atomic SQL increment (not read-then-write)', async () => {
      cacheManager.del.mockResolvedValue(undefined);

      await service.handleWebhook({ transaction_id: 'TXN-1', payment_status: 'success' });

      // createQueryBuilder should have been called for the atomic increment
      expect(queryRunner.manager.createQueryBuilder).toHaveBeenCalled();
    });

    it('should commit the transaction on success', async () => {
      cacheManager.del.mockResolvedValue(undefined);

      await service.handleWebhook({ transaction_id: 'TXN-1', payment_status: 'success' });

      expect(queryRunner.commitTransaction).toHaveBeenCalled();
      expect(queryRunner.rollbackTransaction).not.toHaveBeenCalled();
    });

    it('should invalidate Redis cache after successful payment', async () => {
      cacheManager.del.mockResolvedValue(undefined);

      await service.handleWebhook({ transaction_id: 'TXN-1', payment_status: 'success' });

      expect(cacheManager.del).toHaveBeenCalledWith('wallet:balance:U1');
    });

    it('should still commit even if Redis cache.del throws', async () => {
      cacheManager.del.mockRejectedValue(new Error('Redis down'));

      // Should NOT throw — Redis failure is swallowed
      await expect(
        service.handleWebhook({ transaction_id: 'TXN-1', payment_status: 'success' }),
      ).resolves.not.toThrow();

      expect(queryRunner.commitTransaction).toHaveBeenCalled();
    });

    it('should create wallet if one does not exist for the user', async () => {
      queryRunner.manager.findOne.mockResolvedValue(null); // no wallet
      cacheManager.del.mockResolvedValue(undefined);

      await service.handleWebhook({ transaction_id: 'TXN-1', payment_status: 'success' });

      expect(queryRunner.manager.save).toHaveBeenCalledWith(Wallet, {
        user_id: 'U1',
        balance: 0,
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // handleWebhook — failed path
  // ──────────────────────────────────────────────────────────────────────────
  describe('handleWebhook — failed path', () => {

    beforeEach(() => {
      transactionRepo.findOne.mockResolvedValue({
        transaction_id: 'TXN-2',
        processed:      false,
        topup_id:       'TUP-2',
      });
      topupRepo.findOne.mockResolvedValue({
        topup_id: 'TUP-2',
        user_id:  'U1',
        amount:   200,
      });
    });

    it('should not touch wallet balance on failed payment', async () => {
      await service.handleWebhook({ transaction_id: 'TXN-2', payment_status: 'failed' });

      // createQueryBuilder (atomic balance increment) should NOT be called
      expect(queryRunner.manager.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('should not invalidate Redis cache on failed payment', async () => {
      await service.handleWebhook({ transaction_id: 'TXN-2', payment_status: 'failed' });

      expect(cacheManager.del).not.toHaveBeenCalled();
    });

    it('should still commit the transaction on failed payment', async () => {
      await service.handleWebhook({ transaction_id: 'TXN-2', payment_status: 'failed' });

      expect(queryRunner.commitTransaction).toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // handleWebhook — DB transaction failure / rollback
  // ──────────────────────────────────────────────────────────────────────────
  describe('handleWebhook — DB failure & rollback', () => {

    it('should rollback and throw InternalServerErrorException on DB error', async () => {
      transactionRepo.findOne.mockResolvedValue({
        transaction_id: 'TXN-3',
        processed:      false,
        topup_id:       'TUP-3',
      });
      topupRepo.findOne.mockResolvedValue({
        topup_id: 'TUP-3',
        user_id:  'U1',
        amount:   300,
      });
      // Simulate DB failure mid-transaction
      queryRunner.manager.findOne.mockResolvedValue({ user_id: 'U1', balance: 0 });
      const qb = {
        update:  jest.fn().mockReturnThis(),
        set:     jest.fn().mockReturnThis(),
        where:   jest.fn().mockReturnThis(),
        execute: jest.fn().mockRejectedValue(new Error('DB error')),
      };
      queryRunner.manager.createQueryBuilder.mockReturnValue(qb);

      await expect(
        service.handleWebhook({ transaction_id: 'TXN-3', payment_status: 'success' }),
      ).rejects.toThrow(InternalServerErrorException);

      expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
    });
  });
});
