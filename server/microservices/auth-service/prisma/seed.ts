import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding auth database with admin users...');

  const passwordHash = await bcrypt.hash('Usergen1234!', 10);

  // Create Owner
  const owner = await prisma.user.upsert({
    where: { email: 'owner@usergen.ai' },
    update: { 
      role: UserRole.OWNER,
      passwordHash, // Update password in case it changed
    },
    create: {
      email: 'owner@usergen.ai',
      name: 'Owner',
      passwordHash,
      role: UserRole.OWNER,
      credits: 100000,
      isEmailVerified: true,
      isActive: true,
    },
  });
  console.log(`✓ Owner user created/updated: ${owner.email} (role: ${owner.role})`);

  // Create Admin
  const admin = await prisma.user.upsert({
    where: { email: 'admin@usergen.ai' },
    update: { 
      role: UserRole.ADMIN,
      passwordHash, // Update password in case it changed
    },
    create: {
      email: 'admin@usergen.ai',
      name: 'Admin',
      passwordHash,
      role: UserRole.ADMIN,
      credits: 10000,
      isEmailVerified: true,
      isActive: true,
    },
  });
  console.log(`✓ Admin user created/updated: ${admin.email} (role: ${admin.role})`);

  console.log('✅ Auth database seeding complete!');
  console.log('\nDefault credentials:');
  console.log('  Owner: owner@usergen.ai / Usergen1234!');
  console.log('  Admin: admin@usergen.ai / Usergen1234!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
