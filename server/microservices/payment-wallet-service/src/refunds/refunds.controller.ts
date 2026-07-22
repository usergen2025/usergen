import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard';
import { Roles } from '../common/auth/roles.decorator';
import { RolesGuard } from '../common/auth/roles.guard';
import { InvoiceService } from '../invoices/invoice.service';
import { ReconciliationService } from './reconciliation.service';
import { RefundsService } from './refunds.service';

@Controller('admin/billing')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'OWNER')
export class RefundsController {
  constructor(
    private readonly refunds: RefundsService,
    private readonly reconciliation: ReconciliationService,
    private readonly invoices: InvoiceService,
  ) {}

  @Get('refunds')
  async list(@Query('take') take?: string) {
    return this.refunds.list(take ? Number(take) : 50);
  }

  @Post('refunds')
  async create(
    @Body()
    body: {
      purchaseOrderId: string;
      adminUserId: string;
      amountPaise?: number;
      reason?: string;
    },
  ) {
    return this.refunds.createAdminRefund(body);
  }

  @Get('reconciliation')
  async reconcile(@Query('take') take?: string) {
    return this.reconciliation.run({ take: take ? Number(take) : 50 });
  }

  @Post('invoices/backfill')
  async backfillInvoices(@Query('take') take?: string) {
    return this.invoices.backfillMissingProviderInvoices(take ? Number(take) : 50);
  }

  /** Cancel mistaken post-Checkout Razorpay invoices (disables Proceed to Pay). */
  @Post('invoices/cancel-provider')
  async cancelProviderInvoices(@Query('take') take?: string) {
    return this.invoices.cancelIssuedProviderInvoices(take ? Number(take) : 50);
  }
}
