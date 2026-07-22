import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard';
import { InvoiceService } from './invoice.service';

@Controller('billing/invoices')
export class InvoiceController {
  constructor(private readonly invoices: InvoiceService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async list(@Req() req: any, @Query('userId') userId?: string) {
    const effective = userId || req.user?.id;
    if (req.user?.role !== 'ADMIN' && req.user?.role !== 'OWNER' && req.user?.id !== effective) {
      throw new ForbiddenException('userId does not match authenticated user');
    }
    return this.invoices.listForUser(effective);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async get(@Req() req: any, @Param('id') id: string) {
    const invoice = await this.invoices.getById(id);
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (
      req.user?.role !== 'ADMIN' &&
      req.user?.role !== 'OWNER' &&
      invoice.userId &&
      invoice.userId !== req.user?.id
    ) {
      throw new ForbiddenException('Invoice does not belong to user');
    }
    return invoice;
  }
}
