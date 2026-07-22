/**
 * One-off: attach Razorpay invoices to local Invoice rows missing providerInvoiceId.
 * Usage: npx ts-node scripts/backfill-razorpay-invoices.ts
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { InvoiceService } from '../src/invoices/invoice.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const invoices = app.get(InvoiceService);
  const result = await invoices.backfillMissingProviderInvoices(50);
  console.log(JSON.stringify(result, null, 2));
  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
