import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Define all permissions
const permissions = [
  // User management
  { name: 'users:read', resource: 'users', action: 'read', description: 'View user information' },
  { name: 'users:write', resource: 'users', action: 'write', description: 'Create and update users' },
  { name: 'users:delete', resource: 'users', action: 'delete', description: 'Delete users' },
  { name: 'users:credits', resource: 'users', action: 'credits', description: 'Adjust user credits' },
  { name: 'users:suspend', resource: 'users', action: 'suspend', description: 'Suspend/activate users' },

  // Generation management
  { name: 'generations:read', resource: 'generations', action: 'read', description: 'View all generations' },
  { name: 'generations:delete', resource: 'generations', action: 'delete', description: 'Delete generations' },
  { name: 'generations:export', resource: 'generations', action: 'export', description: 'Export generation data' },

  // Pricing management
  { name: 'pricing:read', resource: 'pricing', action: 'read', description: 'View pricing configuration' },
  { name: 'pricing:write', resource: 'pricing', action: 'write', description: 'Update pricing' },

  // Billing management
  { name: 'billing:read', resource: 'billing', action: 'read', description: 'View billing information' },
  { name: 'billing:write', resource: 'billing', action: 'write', description: 'Process refunds and adjustments' },
  { name: 'billing:export', resource: 'billing', action: 'export', description: 'Export billing data' },

  // IAM management
  { name: 'iam:read', resource: 'iam', action: 'read', description: 'View roles and permissions' },
  { name: 'iam:write', resource: 'iam', action: 'write', description: 'Manage roles and permissions' },
  { name: 'iam:assign', resource: 'iam', action: 'assign', description: 'Assign roles to users' },

  // Audit logs
  { name: 'audit:read', resource: 'audit', action: 'read', description: 'View audit logs' },
  { name: 'audit:export', resource: 'audit', action: 'export', description: 'Export audit logs' },

  // Settings management
  { name: 'settings:read', resource: 'settings', action: 'read', description: 'View system settings' },
  { name: 'settings:write', resource: 'settings', action: 'write', description: 'Modify system settings' },

  // Video management (for users)
  { name: 'video:generate', resource: 'video', action: 'generate', description: 'Generate videos' },
  { name: 'video:read', resource: 'video', action: 'read', description: 'View own videos' },
  { name: 'video:delete', resource: 'video', action: 'delete', description: 'Delete own videos' },
  { name: 'video:export', resource: 'video', action: 'export', description: 'Export videos' },

  // Avatar management
  { name: 'avatar:create', resource: 'avatar', action: 'create', description: 'Create custom avatars' },
  { name: 'avatar:read', resource: 'avatar', action: 'read', description: 'View avatars' },
  { name: 'avatar:delete', resource: 'avatar', action: 'delete', description: 'Delete avatars' },
];

/**
 * Role matrix (product policy — extend IAM checks in services when enforcing beyond JWT UserRole):
 * - admin.owner: all admin permissions including IAM assign and user delete.
 * - admin.admin: operations without IAM mutation, user delete, or generation delete; can manage users/pricing otherwise.
 * - admin.support / admin.viewer: read-heavy; adjust credits only where listed.
 * JWT role (ADMIN | OWNER) on auth-service remains the coarse gate for /admin; fine-grained UI/API checks should
 * resolve IAM roles → permission names (e.g. generations:read) for feature flags.
 */
// Define admin roles with their permissions
const roles = [
  {
    name: 'admin.owner',
    displayName: 'Owner',
    description: 'Full system access with ability to manage other admins',
    context: 'admin',
    permissions: [
      'users:read', 'users:write', 'users:delete', 'users:credits', 'users:suspend',
      'generations:read', 'generations:delete', 'generations:export',
      'pricing:read', 'pricing:write',
      'billing:read', 'billing:write', 'billing:export',
      'iam:read', 'iam:write', 'iam:assign',
      'audit:read', 'audit:export',
      'settings:read', 'settings:write',
    ],
  },
  {
    name: 'admin.admin',
    displayName: 'Admin',
    description: 'Day-to-day administration without IAM management',
    context: 'admin',
    permissions: [
      'users:read', 'users:write', 'users:credits', 'users:suspend',
      'generations:read', 'generations:export',
      'pricing:read', 'pricing:write',
      'billing:read', 'billing:export',
      'iam:read',
      'audit:read',
      'settings:read',
    ],
  },
  {
    name: 'admin.support',
    displayName: 'Support',
    description: 'Customer support access - read-only with user assistance capabilities',
    context: 'admin',
    permissions: [
      'users:read', 'users:credits',
      'generations:read',
      'billing:read',
      'audit:read',
    ],
  },
  {
    name: 'admin.billing',
    displayName: 'Billing',
    description: 'Finance team access - billing and pricing management',
    context: 'admin',
    permissions: [
      'users:read',
      'generations:read',
      'pricing:read', 'pricing:write',
      'billing:read', 'billing:write', 'billing:export',
    ],
  },
  {
    name: 'admin.viewer',
    displayName: 'Viewer',
    description: 'Read-only access for auditors and observers',
    context: 'admin',
    permissions: [
      'users:read',
      'generations:read',
      'pricing:read',
      'billing:read',
      'audit:read',
      'settings:read',
    ],
  },
  // User-facing roles (for completeness)
  {
    name: 'user.default',
    displayName: 'User',
    description: 'Standard user permissions',
    context: 'user',
    permissions: [
      'video:generate', 'video:read', 'video:delete', 'video:export',
      'avatar:read',
    ],
  },
  {
    name: 'user.avatar_creator',
    displayName: 'Avatar Creator',
    description: 'User with avatar creation capabilities',
    context: 'user',
    permissions: [
      'video:generate', 'video:read', 'video:delete', 'video:export',
      'avatar:create', 'avatar:read', 'avatar:delete',
    ],
  },
  {
    name: 'user.brand',
    displayName: 'Brand',
    description: 'Brand account with additional features',
    context: 'user',
    permissions: [
      'video:generate', 'video:read', 'video:delete', 'video:export',
      'avatar:create', 'avatar:read', 'avatar:delete',
    ],
  },
];

async function main() {
  console.log('🌱 Seeding IAM database...');

  // Create permissions
  console.log('Creating permissions...');
  for (const perm of permissions) {
    await prisma.permission.upsert({
      where: { name: perm.name },
      update: {
        resource: perm.resource,
        action: perm.action,
        description: perm.description,
      },
      create: perm,
    });
    console.log(`  ✓ Permission: ${perm.name}`);
  }

  // Create roles and assign permissions
  console.log('Creating roles and assigning permissions...');
  for (const roleData of roles) {
    const { permissions: permNames, ...roleInfo } = roleData;

    // Upsert role
    const role = await prisma.role.upsert({
      where: { name: roleInfo.name },
      update: {
        displayName: roleInfo.displayName,
        description: roleInfo.description,
        context: roleInfo.context,
      },
      create: roleInfo,
    });
    console.log(`  ✓ Role: ${role.displayName}`);

    // Get permission IDs
    const perms = await prisma.permission.findMany({
      where: { name: { in: permNames } },
    });

    // Create role-permission mappings
    for (const perm of perms) {
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: role.id,
            permissionId: perm.id,
          },
        },
        update: {},
        create: {
          roleId: role.id,
          permissionId: perm.id,
          granted: true,
        },
      });
    }
    console.log(`    → Assigned ${perms.length} permissions`);
  }

  console.log('✅ IAM seeding complete!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
