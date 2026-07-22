import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { BillingAudience } from '@prisma/client';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard';
import { QuoteInputMode } from '../billing/pricing.types';
import { CheckoutService } from './checkout.service';

@Controller('billing/checkout')
@UseGuards(JwtAuthGuard)
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  private assertUserAccess(req: any, userId: string) {
    const role = req?.user?.role;
    if (role === 'ADMIN' || role === 'OWNER') return;
    if (!userId || req?.user?.id !== userId) {
      throw new ForbiddenException('userId does not match authenticated user');
    }
  }

  @Post('orders')
  async createOrder(
    @Req() req: any,
    @Body()
    body: {
      userId: string;
      audience: BillingAudience;
      packageId?: string;
      inputMode?: QuoteInputMode;
      amountPaise?: number;
      creditsDesired?: number;
      discountCode?: string;
      customerEmail?: string;
      customerName?: string;
    },
  ) {
    this.assertUserAccess(req, body.userId);
    return this.checkout.createCheckoutOrder({
      ...body,
      customerEmail: body.customerEmail || req.user?.email,
      customerName: body.customerName,
    });
  }

  @Post('verify')
  async verify(
    @Req() req: any,
    @Body()
    body: {
      userId: string;
      purchaseOrderId: string;
      razorpayOrderId: string;
      razorpayPaymentId: string;
      razorpaySignature: string;
    },
  ) {
    this.assertUserAccess(req, body.userId);
    return this.checkout.verifyAndFulfill(body);
  }

  @Get('orders/:id')
  async getOrder(@Req() req: any, @Param('id') id: string, @Query('userId') userId?: string) {
    if (userId) this.assertUserAccess(req, userId);
    return this.checkout.getOrder(id, userId || req.user.id);
  }

  @Get('orders')
  async listOrders(@Req() req: any, @Query('userId') userId: string) {
    const effectiveUserId = userId || req.user.id;
    this.assertUserAccess(req, effectiveUserId);
    return this.checkout.listUserOrders(effectiveUserId);
  }

  @Post('orders/:id/remind')
  async remindIncomplete(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { userId: string },
  ) {
    this.assertUserAccess(req, body.userId);
    return this.checkout.sendIncompleteReminder(id, body.userId);
  }
}
