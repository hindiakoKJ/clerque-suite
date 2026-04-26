import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';

// ─── Constants mirrored from auth.service.ts ──────────────────────────────
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

// ─── Minimal mock factory ──────────────────────────────────────────────────

function makePrismaMock() {
  return {
    tenant: {
      findUnique: jest.fn(),
    },
    user: {
      findFirst: jest.fn(),
      update:    jest.fn(),
    },
    loginLog: {
      count:  jest.fn(),
      create: jest.fn().mockResolvedValue({}),
    },
    userAppAccess: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    userSession: {
      create: jest.fn().mockResolvedValue({ id: 'session-1' }),
    },
  };
}

function makeJwtMock() {
  return {
    sign:   jest.fn().mockReturnValue('mock-jwt-token'),
    verify: jest.fn(),
    decode: jest.fn(),
  };
}

/** A minimal active user fixture */
const MOCK_USER = {
  id:           'user-1',
  tenantId:     'tenant-1',
  branchId:     'branch-1',
  role:         'CASHIER',
  name:         'Maria Santos',
  passwordHash: '',          // set per-test via bcrypt.hash
  isActive:     true,
  appAccess:    [],
};

describe('AuthService — validateUser()', () => {
  let svc:    AuthService;
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(async () => {
    prisma = makePrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService,    useValue: makeJwtMock() },
      ],
    }).compile();

    svc = module.get(AuthService);
  });

  // ─── Account lockout ──────────────────────────────────────────────────────

  describe('account lockout', () => {
    it(`throws ForbiddenException after ${MAX_FAILED_ATTEMPTS} failed attempts within ${LOCKOUT_MINUTES} min`, async () => {
      const hash = await bcrypt.hash('correct-password', 4);
      prisma.user.findFirst.mockResolvedValue({ ...MOCK_USER, passwordHash: hash });
      prisma.loginLog.count.mockResolvedValue(MAX_FAILED_ATTEMPTS);

      await expect(
        svc.validateUser('maria@example.com', 'correct-password'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('lockout message mentions attempt count and lockout duration', async () => {
      const hash = await bcrypt.hash('correct-password', 4);
      prisma.user.findFirst.mockResolvedValue({ ...MOCK_USER, passwordHash: hash });
      prisma.loginLog.count.mockResolvedValue(MAX_FAILED_ATTEMPTS);

      try {
        await svc.validateUser('maria@example.com', 'correct-password');
      } catch (e) {
        const msg = (e as ForbiddenException).message;
        expect(msg).toContain(String(MAX_FAILED_ATTEMPTS));
        expect(msg).toContain(String(LOCKOUT_MINUTES));
      }
    });

    it('does NOT lock out with 4 failed attempts (one below threshold)', async () => {
      const hash = await bcrypt.hash('correct-password', 4);
      prisma.user.findFirst.mockResolvedValue({ ...MOCK_USER, passwordHash: hash });
      prisma.loginLog.count.mockResolvedValue(MAX_FAILED_ATTEMPTS - 1);

      // Should NOT throw lockout — returns user if password matches
      const result = await svc.validateUser('maria@example.com', 'correct-password');
      expect(result).not.toBeNull();
    });

    it('is scoped to the recent time window — loginLog.count queries with gte: windowStart', async () => {
      const hash = await bcrypt.hash('pw', 4);
      prisma.user.findFirst.mockResolvedValue({ ...MOCK_USER, passwordHash: hash });
      prisma.loginLog.count.mockResolvedValue(0);

      await svc.validateUser('maria@example.com', 'pw');

      expect(prisma.loginLog.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            success: false,
            createdAt: expect.objectContaining({ gte: expect.any(Date) }),
          }),
        }),
      );
    });
  });

  // ─── Valid credentials ────────────────────────────────────────────────────

  describe('valid credentials', () => {
    it('returns the user when email + password are correct', async () => {
      const hash = await bcrypt.hash('correct-password', 4);
      prisma.user.findFirst.mockResolvedValue({ ...MOCK_USER, passwordHash: hash });
      prisma.loginLog.count.mockResolvedValue(0);

      const result = await svc.validateUser('maria@example.com', 'correct-password');
      expect(result).not.toBeNull();
      expect(result?.id).toBe('user-1');
    });

    it('does NOT create a loginLog entry on success', async () => {
      const hash = await bcrypt.hash('correct-password', 4);
      prisma.user.findFirst.mockResolvedValue({ ...MOCK_USER, passwordHash: hash });
      prisma.loginLog.count.mockResolvedValue(0);

      await svc.validateUser('maria@example.com', 'correct-password');
      expect(prisma.loginLog.create).not.toHaveBeenCalled();
    });
  });

  // ─── Invalid password ─────────────────────────────────────────────────────

  describe('invalid password', () => {
    it('returns null for incorrect password', async () => {
      const hash = await bcrypt.hash('correct-password', 4);
      prisma.user.findFirst.mockResolvedValue({ ...MOCK_USER, passwordHash: hash });
      prisma.loginLog.count.mockResolvedValue(0);

      const result = await svc.validateUser('maria@example.com', 'wrong-password');
      expect(result).toBeNull();
    });

    it('logs a failed loginLog entry when password is wrong', async () => {
      const hash = await bcrypt.hash('correct-password', 4);
      prisma.user.findFirst.mockResolvedValue({ ...MOCK_USER, passwordHash: hash });
      prisma.loginLog.count.mockResolvedValue(0);

      await svc.validateUser('maria@example.com', 'wrong-password');

      expect(prisma.loginLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId:  'user-1',
            email:   'maria@example.com',
            success: false,
          }),
        }),
      );
    });
  });

  // ─── User not found ───────────────────────────────────────────────────────

  describe('user not found', () => {
    it('returns null when no user matches the email', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      const result = await svc.validateUser('ghost@example.com', 'any-password');
      expect(result).toBeNull();
    });

    it('does not log a failed attempt for unknown email (no userId to attach)', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await svc.validateUser('ghost@example.com', 'any-password');
      expect(prisma.loginLog.create).not.toHaveBeenCalled();
    });
  });

  // ─── Tenant scope ─────────────────────────────────────────────────────────

  describe('tenant scoping (company code)', () => {
    it('returns null when company code does not match any tenant (no 404 — avoids enumeration)', async () => {
      prisma.tenant.findUnique.mockResolvedValue(null);

      const result = await svc.validateUser('maria@example.com', 'password', 'bad-slug');
      expect(result).toBeNull();
    });

    it('throws ForbiddenException when tenant is SUSPENDED', async () => {
      prisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-1',
        status: 'SUSPENDED',
      });

      await expect(
        svc.validateUser('maria@example.com', 'password', 'suspended-slug'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('suspended message mentions "suspended" or "contact support"', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1', status: 'SUSPENDED' });

      try {
        await svc.validateUser('maria@example.com', 'password', 'suspended-slug');
      } catch (e) {
        const msg = (e as ForbiddenException).message.toLowerCase();
        expect(msg.includes('suspend') || msg.includes('contact')).toBe(true);
      }
    });

    it('proceeds normally for an ACTIVE tenant', async () => {
      const hash = await bcrypt.hash('correct-password', 4);
      prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1', status: 'ACTIVE' });
      prisma.user.findFirst.mockResolvedValue({ ...MOCK_USER, passwordHash: hash });
      prisma.loginLog.count.mockResolvedValue(0);

      const result = await svc.validateUser('maria@example.com', 'correct-password', 'my-shop');
      expect(result).not.toBeNull();
    });
  });
});
