import { BillingAudience, FeeType, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEFAULT_SETTINGS = {
  currency: 'INR',
  creditRateBps: 10000,
  creatorFeeBps: 500,
  brandFeeBps: 1000,
  feeType: FeeType.PERCENT,
  minTopUpPaise: 10000,
  maxTopUpPaise: 100000000,
  gstEnabled: true,
  gstRateBps: 1800,
  platformLegalName: 'UserGen',
  invoicePrefix: 'UG',
  invoiceNextNumber: 1,
};

function formulaCredits(amountPaise: number, feeBps: number, creditRateBps: number): number {
  const fee = Math.floor((amountPaise * feeBps) / 10000);
  const net = amountPaise - fee;
  return Math.floor((net * creditRateBps) / (100 * 10000));
}

const CREATOR_AMOUNTS = [
  { title: 'Starter', amountPaise: 50000, badge: null, sortOrder: 1 }, // ₹500
  { title: 'Creator', amountPaise: 100000, badge: 'Popular', sortOrder: 2 }, // ₹1000
  { title: 'Pro', amountPaise: 250000, badge: null, sortOrder: 3 }, // ₹2500
  { title: 'Studio', amountPaise: 500000, badge: 'Best value', sortOrder: 4 }, // ₹5000
];

const BRAND_AMOUNTS = [
  { title: 'Campaign Lite', amountPaise: 100000, badge: null, sortOrder: 1 }, // ₹1000
  { title: 'Campaign', amountPaise: 500000, badge: 'Popular', sortOrder: 2 }, // ₹5000
  { title: 'Growth', amountPaise: 1000000, badge: null, sortOrder: 3 }, // ₹10000
  { title: 'Scale', amountPaise: 2500000, badge: 'Best value', sortOrder: 4 }, // ₹25000
];

async function main() {
  const existing = await prisma.billingSettings.findFirst();
  if (!existing) {
    await prisma.billingSettings.create({ data: DEFAULT_SETTINGS });
    console.log('Seeded billing_settings');
  } else {
    console.log('billing_settings already present — skip');
  }

  const packageCount = await prisma.creditPackage.count();
  if (packageCount === 0) {
    for (const p of CREATOR_AMOUNTS) {
      await prisma.creditPackage.create({
        data: {
          audience: BillingAudience.CREATOR,
          title: p.title,
          description: `Top up ₹${p.amountPaise / 100}`,
          amountPaise: p.amountPaise,
          creditsToGrant: formulaCredits(p.amountPaise, DEFAULT_SETTINGS.creatorFeeBps, DEFAULT_SETTINGS.creditRateBps),
          sortOrder: p.sortOrder,
          badge: p.badge,
          isActive: true,
        },
      });
    }
    for (const p of BRAND_AMOUNTS) {
      await prisma.creditPackage.create({
        data: {
          audience: BillingAudience.BRAND,
          title: p.title,
          description: `Top up ₹${p.amountPaise / 100}`,
          amountPaise: p.amountPaise,
          creditsToGrant: formulaCredits(p.amountPaise, DEFAULT_SETTINGS.brandFeeBps, DEFAULT_SETTINGS.creditRateBps),
          sortOrder: p.sortOrder,
          badge: p.badge,
          isActive: true,
        },
      });
    }
    console.log('Seeded credit_packages for CREATOR and BRAND');
  } else {
    console.log('credit_packages already present — skip');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
