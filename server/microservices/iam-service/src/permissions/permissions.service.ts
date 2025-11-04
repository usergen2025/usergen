import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/database/database.service';
import { CreatePermissionDto, UpdatePermissionDto } from './dto/permissions.dto';

@Injectable()
export class PermissionsService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreatePermissionDto) {
    return this.prisma.permission.create({
      data: {
        name: data.name,
        resource: data.resource,
        action: data.action,
        description: data.description,
      },
    });
  }

  async findAll() {
    return this.prisma.permission.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  async findById(id: string) {
    const permission = await this.prisma.permission.findUnique({
      where: { id },
    });

    if (!permission) {
      throw new NotFoundException(`Permission with ID ${id} not found`);
    }

    return permission;
  }

  async findByName(name: string) {
    return this.prisma.permission.findUnique({
      where: { name },
    });
  }

  async findByResourceAndAction(resource: string, action: string) {
    return this.prisma.permission.findFirst({
      where: { resource, action, isActive: true },
    });
  }

  async update(id: string, data: UpdatePermissionDto) {
    await this.findById(id);

    return this.prisma.permission.update({
      where: { id },
      data,
    });
  }

  async delete(id: string) {
    await this.findById(id);

    return this.prisma.permission.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async findPermissionsByRole(roleId: string) {
    const rolePermissions = await this.prisma.rolePermission.findMany({
      where: {
        roleId,
        granted: true,
      },
      include: {
        permission: true,
      },
    });

    return rolePermissions.map((rp) => rp.permission);
  }
}


