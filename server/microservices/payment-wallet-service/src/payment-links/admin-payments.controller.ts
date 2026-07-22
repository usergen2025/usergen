import { Body, Controller, Get, Header, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { BillingAudience, PurchaseOrderStatus } from '@prisma/client';
import { Response } from 'express';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard';
import { Roles } from '../common/auth/roles.decorator';
import { RolesGuard } from '../common/auth/roles.guard';
import { AdminOrdersService } from './admin-orders.service';
import { PaymentLinksService } from './payment-links.service';

@Controller('admin/billing')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'OWNER')
export class AdminPaymentsController {
  constructor(
    private readonly paymentLinks: PaymentLinksService,
    private readonly adminOrders: AdminOrdersService,
  ) {}

  @Get('orders')
  async listOrders(
    @Query('status') status?: PurchaseOrderStatus,
    @Query('statuses') statuses?: string,
    @Query('userId') userId?: string,
    @Query('audience') audience?: string,
    @Query('q') q?: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    return this.adminOrders.list({
      status,
      statuses,
      userId,
      audience,
      q,
      take: take ? Number(take) : undefined,
      skip: skip ? Number(skip) : undefined,
    });
  }

  @Get('orders/export.csv')
  @Header('Content-Type', 'text/csv')
  async exportOrdersCsv(
    @Query('status') status?: PurchaseOrderStatus,
    @Query('audience') audience?: string,
    @Res() res?: Response,
  ) {
    const csv = await this.adminOrders.exportOrdersCsv({ status, audience });
    res!.setHeader('Content-Disposition', 'attachment; filename="billing-orders.csv"');
    res!.send(csv);
  }

  @Get('invoices')
  async listInvoices(@Query('take') take?: string) {
    return this.adminOrders.listInvoices(take ? Number(take) : 50);
  }

  @Get('payment-links')
  async listPaymentLinks(@Query('take') take?: string) {
    return this.paymentLinks.list(take ? Number(take) : 50);
  }

  @Post('payment-links')
  async createPaymentLink(
    @Body()
    body: {
      userId: string;
      audience: BillingAudience;
      adminUserId: string;
      packageId?: string;
      amountPaise?: number;
      creditsDesired?: number;
      customerEmail?: string;
      customerName?: string;
      customerPhone?: string;
      description?: string;
      notifyEmail?: boolean;
      expireInHours?: number;
      feeBpsOverride?: number;
    },
  ) {
    return this.paymentLinks.createForExistingUser(body);
  }

  @Post('payment-links/:id/notify')
  async notifyPaymentLink(
    @Param('id') id: string,
    @Body() body?: { medium?: 'email' | 'sms' },
  ) {
    return this.paymentLinks.notify(id, body?.medium || 'email');
  }

  @Post('payment-links/:id/cancel')
  async cancelPaymentLink(@Param('id') id: string) {
    return this.paymentLinks.cancel(id);
  }
}
