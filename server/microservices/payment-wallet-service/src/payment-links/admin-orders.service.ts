import { Injectable } from '@nestjs/common';
import { PurchaseOrderStatus } from '@prisma/client';
import { DatabaseService } from '../common/database/database.service';

@Injectable()
export class AdminOrdersService {
  constructor(private readonly db: DatabaseService) {}

  async list(params: {
    status?: PurchaseOrderStatus;
    /** Comma-separated statuses, e.g. FULFILLED,PARTIALLY_REFUNDED */
    statuses?: string;
    userId?: string;
    audience?: string;
    /** Free-text search over order id, userId, invoice number */
    q?: string;
    take?: number;
    skip?: number;
  }) {
    const take = Math.min(params.take ?? 50, 200);
    const skip = params.skip ?? 0;
    const where: any = {};

    if (params.statuses) {
      const list = params.statuses
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean) as PurchaseOrderStatus[];
      if (list.length) where.status = { in: list };
    } else if (params.status) {
      where.status = params.status;
    }

    if (params.userId) where.userId = params.userId;
    if (params.audience === 'CREATOR' || params.audience === 'BRAND') {
      where.audience = params.audience;
    }

    if (params.q?.trim()) {
      const q = params.q.trim();
      where.OR = [
        { id: { contains: q, mode: 'insensitive' } },
        { userId: { contains: q, mode: 'insensitive' } },
        { invoices: { some: { invoiceNumber: { contains: q, mode: 'insensitive' } } } },
      ];
    }

    const [items, total] = await Promise.all([
      this.db.purchaseOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
        include: {
          invoices: true,
          paymentLinks: true,
          paymentAttempts: { orderBy: { createdAt: 'desc' }, take: 3 },
          package: true,
          refunds: true,
        },
      }),
      this.db.purchaseOrder.count({ where }),
    ]);

    return { items, total, take, skip };
  }

  async listInvoices(take = 50) {
    return this.db.invoice.findMany({
      orderBy: { issuedAt: 'desc' },
      take: Math.min(take, 200),
      include: { purchaseOrder: true },
    });
  }

  async exportOrdersCsv(params: { status?: PurchaseOrderStatus; audience?: string }) {
    const { items } = await this.list({
      status: params.status,
      audience: params.audience,
      take: 200,
      skip: 0,
    });

    const header = [
      'orderId',
      'userId',
      'audience',
      'source',
      'status',
      'baseAmountPaise',
      'feeAmountPaise',
      'gstAmountPaise',
      'totalChargePaise',
      'creditsToGrant',
      'invoiceNumber',
      'createdAt',
      'fulfilledAt',
    ];

    const rows = items.map((o) => [
      o.id,
      o.userId || '',
      o.audience,
      o.source,
      o.status,
      String(o.baseAmountPaise),
      String(o.feeAmountPaise),
      String(o.gstAmountPaise),
      String(o.totalChargePaise),
      String(o.creditsToGrant),
      o.invoices?.[0]?.invoiceNumber || '',
      o.createdAt.toISOString(),
      o.fulfilledAt?.toISOString() || '',
    ]);

    const escape = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
    return [header, ...rows].map((r) => r.map(escape).join(',')).join('\n');
  }
}
