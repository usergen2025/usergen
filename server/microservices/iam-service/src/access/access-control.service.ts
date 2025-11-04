import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/database/database.service';

interface CheckPermissionDto {
  userId: string;
  resourceType?: string;
  resourceId?: string;
  permission: string;
  context?: Record<string, any>;
}

@Injectable()
export class AccessControlService {
  constructor(private prisma: PrismaService) {}

  /**
   * Check if a user has permission to perform an action
   */
  async checkPermission(dto: CheckPermissionDto): Promise<boolean> {
    const { userId, resourceType, resourceId, permission, context } = dto;

    try {
      // Log the access attempt
      await this.logAccess({
        userId,
        action: 'permission_check',
        resourceType,
        resourceId,
        permission,
        context,
      });

      // 1. Get user's roles for this resource
      const userRoles = await this.getUserRoles(userId, resourceType, resourceId);

      if (!userRoles || userRoles.length === 0) {
        // Log denial
        await this.logAccess({
          userId,
          action: 'access_denied',
          resourceType,
          resourceId,
          permission,
          result: false,
          reason: 'No roles assigned',
          context,
        });
        return false;
      }

      // 2. For each role, check if it has the required permission
      for (const role of userRoles) {
        const hasPermission = await this.roleHasPermission(role.roleId, permission);

        if (hasPermission) {
          // Check if explicitly denied in role permissions
          const rolePermission = await this.prisma.rolePermission.findFirst({
            where: {
              roleId: role.roleId,
              permission: {
                name: permission,
              },
            },
          });

          if (rolePermission && !rolePermission.granted) {
            // Log denial
            await this.logAccess({
              userId,
              action: 'access_denied',
              resourceType,
              resourceId,
              permission,
              result: false,
              reason: 'Permission explicitly denied',
              context,
            });
            return false;
          }

          // Check if wildcard permission (e.g., "*")
          if (permission === '*') {
            await this.logAccess({
              userId,
              action: 'access_granted',
              resourceType,
              resourceId,
              permission,
              result: true,
              context,
            });
            return true;
          }

          // Check policies (if any)
          const policyResult = await this.checkPolicies({
            userId,
            resourceType,
            resourceId,
            permission,
          });

          if (policyResult !== null) {
            await this.logAccess({
              userId,
              action: policyResult ? 'access_granted' : 'access_denied',
              resourceType,
              resourceId,
              permission,
              result: policyResult,
              context,
            });
            return policyResult;
          }

          // Permission granted
          await this.logAccess({
            userId,
            action: 'access_granted',
            resourceType,
            resourceId,
            permission,
            result: true,
            context,
          });
          return true;
        }
      }

      // No role has the required permission
      await this.logAccess({
        userId,
        action: 'access_denied',
        resourceType,
        resourceId,
        permission,
        result: false,
        reason: 'No role has the required permission',
        context,
      });
      return false;
    } catch (error) {
      console.error('Error checking permission:', error);
      return false;
    }
  }

  /**
   * Check multiple permissions at once
   */
  async checkPermissions(dto: CheckPermissionDto & { permissions: string[] }) {
    const results: Record<string, boolean> = {};

    for (const permission of dto.permissions) {
      results[permission] = await this.checkPermission({
        ...dto,
        permission,
      });
    }

    return results;
  }

  /**
   * Get all effective permissions for a user in a context
   */
  async getUserPermissions(userId: string, resourceType?: string, resourceId?: string): Promise<string[]> {
    const userRoles = await this.getUserRoles(userId, resourceType, resourceId);

    if (!userRoles || userRoles.length === 0) {
      return [];
    }

    const allPermissions = new Set<string>();

    for (const role of userRoles) {
      const rolePermissions = await this.prisma.rolePermission.findMany({
        where: {
          roleId: role.roleId,
          granted: true,
        },
        include: {
          permission: true,
        },
      });

      rolePermissions.forEach((rp) => {
        if (rp.granted) {
          allPermissions.add(rp.permission.name);
        }
      });
    }

    return Array.from(allPermissions);
  }

  /**
   * Private helper methods
   */

  private async getUserRoles(userId: string, resourceType?: string, resourceId?: string) {
    const where: any = {
      userId,
      isActive: true,
    };

    if (resourceType && resourceId) {
      where.entityType = resourceType;
      where.entityId = resourceId;
    } else {
      where.OR = [{ entityType: null }, { entityId: null }];
    }

    return this.prisma.userRole.findMany({
      where,
      include: {
        role: true,
      },
    });
  }

  private async roleHasPermission(roleId: string, permissionName: string): Promise<boolean> {
    // Check for wildcard permission first
    const wildcardCheck = await this.prisma.rolePermission.findFirst({
      where: {
        roleId,
        permission: {
          name: '*',
        },
        granted: true,
      },
    });

    if (wildcardCheck) {
      return true;
    }

    // Check specific permission
    const specificCheck = await this.prisma.rolePermission.findFirst({
      where: {
        roleId,
        permission: {
          name: permissionName,
        },
        granted: true,
      },
    });

    return !!specificCheck;
  }

  private async checkPolicies(dto: CheckPermissionDto): Promise<boolean | null> {
    const policies = await this.prisma.policy.findMany({
      where: {
        isActive: true,
        permissions: {
          has: dto.permission,
        },
        OR: [
          {
            entityType: dto.resourceType,
            entityId: dto.resourceId,
          },
          {
            entityType: null,
            entityId: null,
          },
        ],
      },
      orderBy: {
        priority: 'desc',
      },
    });

    if (policies.length === 0) {
      return null; // No policies apply, check role permissions
    }

    // Evaluate conditions (simplified for now)
    // In production, this would use a policy engine
    for (const policy of policies) {
      if (await this.evaluatePolicy(policy, dto)) {
        return true;
      }
    }

    return false;
  }

  private async evaluatePolicy(policy: any, dto: CheckPermissionDto): Promise<boolean> {
    // Simple policy evaluation
    if (!policy.conditions) {
      return true;
    }

    const conditions = policy.conditions as Record<string, any>;

    // Check user IDs condition
    if (conditions.userIds && Array.isArray(conditions.userIds)) {
      if (!conditions.userIds.includes(dto.userId)) {
        return false;
      }
    }

    // Check time range condition
    if (conditions.timeRange) {
      const now = new Date();
      const { start, end } = conditions.timeRange;

      if (start && new Date(start) > now) {
        return false;
      }
      if (end && new Date(end) < now) {
        return false;
      }
    }

    return true;
  }

  private async logAccess(data: {
    userId: string;
    action: string;
    resourceType?: string;
    resourceId?: string;
    permission?: string;
    result?: boolean;
    reason?: string;
    context?: Record<string, any>;
  }) {
    try {
      await this.prisma.accessLog.create({
        data: {
          userId: data.userId,
          action: data.action,
          resourceType: data.resourceType,
          resourceId: data.resourceId,
          permission: data.permission,
          result: data.result,
          reason: data.reason,
          context: data.context,
        },
      });
    } catch (error) {
      console.error('Failed to log access:', error);
    }
  }
}


