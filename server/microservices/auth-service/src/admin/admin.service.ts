import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DatabaseService } from '../common/database/database.service';
import { CreateAdminDto, UpdateUserRoleDto, UpdateUserCreditsDto, ListUsersQueryDto, UserRole } from './dto/admin.dto';
import * as bcrypt from 'bcryptjs';
import axios from 'axios';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(private databaseService: DatabaseService) {}

  /** Read live credits from payment-wallet; null if the service is unreachable. */
  private async getPaymentWalletBalance(userId: string): Promise<number | null> {
    const baseUrl = (process.env.PAYMENT_SERVICE_URL || 'http://localhost:9005/api').replace(/\/$/, '');
    try {
      const res = await axios.get<{ success?: boolean; data?: { credits?: number } }>(
        `${baseUrl}/transactions/balance`,
        { params: { userId }, timeout: 8000 },
      );
      if (typeof res.data?.data?.credits === 'number' && !Number.isNaN(res.data.data.credits)) {
        return res.data.data.credits;
      }
      return 0;
    } catch (err) {
      this.logger.warn(
        `Could not load payment wallet balance for user ${userId}. Admin list may fall back to profile credits.`,
      );
      return null;
    }
  }

  async getUsers(query: ListUsersQueryDto) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (query.userId) {
      where.id = query.userId;
    }

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    if (query.role) {
      where.role = query.role;
    }

    const [userRows, total] = await Promise.all([
      this.databaseService.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          credits: true,
          isActive: true,
          isEmailVerified: true,
          createdAt: true,
          lastLoginAt: true,
          profilePicture: true,
        },
      }),
      this.databaseService.user.count({ where }),
    ]);

    const walletByUserId: Record<string, number | null> = {};
    await Promise.all(
      userRows.map(async (u) => {
        walletByUserId[u.id] = await this.getPaymentWalletBalance(u.id);
      }),
    );

    const users = userRows.map((u) => {
      const wallet = walletByUserId[u.id];
      return {
        ...u,
        profileCredits: u.credits,
        // Canonical display comes from payment-wallet ledger.
        credits: wallet ?? 0,
        walletCredits: wallet,
      };
    });

    return {
      users,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getUserById(userId: string) {
    const user = await this.databaseService.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        mobile: true,
        role: true,
        credits: true,
        isActive: true,
        isEmailVerified: true,
        isMobileVerified: true,
        createdAt: true,
        updatedAt: true,
        lastLoginAt: true,
        profilePicture: true,
        brandName: true,
        brandDescription: true,
        brandLogo: true,
        brandWebsite: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const wallet = await this.getPaymentWalletBalance(userId);
    return {
      ...user,
      profileCredits: user.credits,
      credits: wallet ?? 0,
      walletCredits: wallet,
    };
  }

  /** Up to 100 ids; returns id, email, name for admin UI (e.g. generation list). */
  async getUsersByIds(ids: string[]) {
    const unique = [...new Set(ids.filter(Boolean))].slice(0, 100);
    if (unique.length === 0) {
      return [];
    }
    return this.databaseService.user.findMany({
      where: { id: { in: unique } },
      select: {
        id: true,
        email: true,
        name: true,
      },
    });
  }

  async updateUserRole(userId: string, dto: UpdateUserRoleDto, adminId: string) {
    const user = await this.databaseService.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const admin = await this.databaseService.user.findUnique({
      where: { id: adminId },
    });

    if (!admin) {
      throw new ForbiddenException('Admin not found');
    }

    if (dto.role === 'OWNER' && admin.role !== 'OWNER') {
      throw new ForbiddenException('Only owners can assign the OWNER role');
    }

    if (user.role === 'OWNER' && admin.role !== 'OWNER') {
      throw new ForbiddenException('Only owners can modify other owners');
    }

    return this.databaseService.user.update({
      where: { id: userId },
      data: { role: dto.role as any },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
      },
    });
  }

  async updateUserCredits(userId: string, dto: UpdateUserCreditsDto) {
    const user = await this.databaseService.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // "Add to existing" must be relative to the live wallet balance, not a stale profile field.
    const currentWallet = await this.getPaymentWalletBalance(userId);
    if (dto.addToExisting && currentWallet === null) {
      throw new ServiceUnavailableException('Wallet service unavailable. Please retry credit update.');
    }
    const newCredits = dto.addToExisting ? (currentWallet ?? 0) + dto.credits : dto.credits;

    const previousCredits = user.credits;

    const updated = await this.databaseService.user.update({
      where: { id: userId },
      data: { credits: newCredits },
      select: {
        id: true,
        email: true,
        name: true,
        credits: true,
      },
    });

    try {
      await this.syncPaymentWalletCredits(userId, newCredits);
    } catch (err) {
      await this.databaseService.user.update({
        where: { id: userId },
        data: { credits: previousCredits },
      });
      throw err;
    }

    return updated;
  }

  /** Align payment-wallet userCredits with auth `users.credits` (source of truth for admin updates). */
  private async syncPaymentWalletCredits(userId: string, targetCredits: number) {
    const baseUrl = (process.env.PAYMENT_SERVICE_URL || 'http://localhost:9005/api').replace(/\/$/, '');

    try {
      const balanceRes = await axios.get<{ success?: boolean; data?: { credits?: number } }>(
        `${baseUrl}/transactions/balance`,
        { params: { userId } },
      );

      const walletCredits =
        typeof balanceRes.data?.data?.credits === 'number' ? balanceRes.data.data.credits : 0;

      const delta = targetCredits - walletCredits;
      if (delta === 0) {
        return;
      }

      if (delta > 0) {
        await axios.post(`${baseUrl}/transactions/add`, {
          userId,
          amount: delta,
          type: 'EARNED',
          description: 'Admin credit adjustment (sync with auth)',
        });
        return;
      }

      await axios.post(`${baseUrl}/transactions/deduct`, {
        userId,
        amount: Math.abs(delta),
        activityName: 'Admin credit adjustment (sync with auth)',
      });
    } catch (err: any) {
      const status = err?.response?.status;
      const msg =
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        err?.message ||
        'Payment wallet unavailable';

      if (!err?.response) {
        throw new ServiceUnavailableException(
          `Could not reach payment service at ${baseUrl}. Set PAYMENT_SERVICE_URL and ensure the service is running.`,
        );
      }

      if (status === 400) {
        throw new BadRequestException(msg);
      }

      throw new ServiceUnavailableException(msg);
    }
  }

  async createAdmin(dto: CreateAdminDto, creatorId: string) {
    const creator = await this.databaseService.user.findUnique({
      where: { id: creatorId },
    });

    if (!creator || creator.role !== 'OWNER') {
      throw new ForbiddenException('Only owners can create admin users');
    }

    const existingUser = await this.databaseService.user.findUnique({
      where: { email: dto.email },
    });

    if (existingUser) {
      throw new BadRequestException('User with this email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    return this.databaseService.user.create({
      data: {
        email: dto.email,
        name: dto.name,
        passwordHash,
        role: dto.role as any,
        credits: 10000,
        isEmailVerified: true,
        isActive: true,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        credits: true,
        createdAt: true,
      },
    });
  }

  async deactivateUser(userId: string, adminId: string) {
    const user = await this.databaseService.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (userId === adminId) {
      throw new BadRequestException('Cannot deactivate yourself');
    }

    const admin = await this.databaseService.user.findUnique({
      where: { id: adminId },
    });

    if (user.role === 'OWNER' && admin?.role !== 'OWNER') {
      throw new ForbiddenException('Only owners can deactivate other owners');
    }

    const ownerCount = await this.databaseService.user.count({
      where: { role: 'OWNER', isActive: true },
    });

    if (user.role === 'OWNER' && ownerCount <= 1) {
      throw new BadRequestException('Cannot deactivate the last owner');
    }

    return this.databaseService.user.update({
      where: { id: userId },
      data: { isActive: false },
      select: {
        id: true,
        email: true,
        name: true,
        isActive: true,
      },
    });
  }

  async reactivateUser(userId: string) {
    const user = await this.databaseService.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return this.databaseService.user.update({
      where: { id: userId },
      data: { isActive: true },
      select: {
        id: true,
        email: true,
        name: true,
        isActive: true,
      },
    });
  }

  async getDashboardStats() {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [
      totalUsers,
      activeUsersToday,
      totalAdmins,
      usersByRole,
      newUsersToday,
    ] = await Promise.all([
      this.databaseService.user.count(),
      this.databaseService.user.count({
        where: {
          lastLoginAt: {
            gte: startOfDay,
          },
        },
      }),
      this.databaseService.user.count({
        where: {
          role: { in: ['ADMIN', 'OWNER'] },
        },
      }),
      this.databaseService.user.groupBy({
        by: ['role'],
        _count: true,
      }),
      this.databaseService.user.count({
        where: {
          createdAt: {
            gte: startOfDay,
          },
        },
      }),
    ]);

    return {
      totalUsers,
      activeUsersToday,
      totalAdmins,
      newUsersToday,
      usersByRole: usersByRole.reduce((acc, item) => {
        acc[item.role] = item._count;
        return acc;
      }, {} as Record<string, number>),
    };
  }

  async getAdminUsers() {
    return this.databaseService.user.findMany({
      where: {
        role: { in: ['ADMIN', 'OWNER'] },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        createdAt: true,
        lastLoginAt: true,
      },
    });
  }
}
