import { Controller, Headers, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { WebhooksService } from './webhooks.service';

@Controller('webhooks/payments')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Post('razorpay')
  async razorpay(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const rawBody = req.rawBody || (Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {})));
    return this.webhooks.handleRazorpay(rawBody, headers);
  }
}
