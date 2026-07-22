import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { BillingAudience, FeeType } from '@prisma/client';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard';
import { Roles } from '../common/auth/roles.decorator';
import { RolesGuard } from '../common/auth/roles.guard';
import { BillingSettingsService } from './billing-settings.service';
import { CreditPackagesService } from './credit-packages.service';

@Controller('admin/billing')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'OWNER')
export class AdminBillingController {
  constructor(
    private readonly settings: BillingSettingsService,
    private readonly packages: CreditPackagesService,
  ) {}

  @Get('settings')
  async getSettings() {
    return this.settings.get();
  }

  @Put('settings')
  async updateSettings(@Body() body: Record<string, any>) {
    return this.settings.update(body);
  }

  @Get('packages')
  async listPackages(@Query('audience') audience?: string) {
    const parsed =
      audience?.toUpperCase() === 'CREATOR' || audience?.toUpperCase() === 'BRAND'
        ? (audience.toUpperCase() as BillingAudience)
        : undefined;
    return this.packages.listAll(parsed);
  }

  @Post('packages')
  async createPackage(
    @Body()
    body: {
      audience: BillingAudience;
      title: string;
      description?: string;
      amountPaise: number;
      creditsToGrant?: number;
      sortOrder?: number;
      isActive?: boolean;
      badge?: string;
      updatedBy?: string;
    },
  ) {
    return this.packages.create(body);
  }

  @Put('packages/:id')
  async updatePackage(@Param('id') id: string, @Body() body: Record<string, any>) {
    return this.packages.update(id, body);
  }

  @Delete('packages/:id')
  async deactivatePackage(@Param('id') id: string, @Body() body?: { updatedBy?: string }) {
    return this.packages.deactivate(id, body?.updatedBy);
  }

  @Get('users/:userId/override')
  async getOverride(@Param('userId') userId: string) {
    return this.settings.getUserOverride(userId);
  }

  @Put('users/:userId/override')
  async upsertOverride(
    @Param('userId') userId: string,
    @Body()
    body: {
      feeBps?: number | null;
      feeType?: FeeType | null;
      feeFixedPaise?: number | null;
      taxExempt?: boolean;
      notes?: string | null;
      updatedBy?: string;
    },
  ) {
    return this.settings.upsertUserOverride({ userId, ...body });
  }

  @Delete('users/:userId/override')
  async deleteOverride(@Param('userId') userId: string) {
    return this.settings.deleteUserOverride(userId);
  }
}
