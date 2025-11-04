import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../common/database/database.service';
import { CreateRoleDto, UpdateRoleDto, AddPermissionToRoleDto } from './dto/roles.dto';

@Injectable()
export class RolesService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateRoleDto) {
    const existing = await this.prisma.role.findUnique({
      where: { name: data.name },
    });

    if (existing) {
      throw new BadRequestException(`Role with name ${data.name} already exists`);
    }

    return this.prisma.role.create({
      data: {
        name: data.name,
        displayName: data.displayName,
        description: data.description,
        context: data.context,
        isSystem: data.isSystem || false,
      },
    });
  }

  async findAll() {
    return this.prisma.role.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  async findById(id: string) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: {
        rolePermissions: {
          include: { permission: true },
        },
      },
    });

    if (!role) {
      throw new NotFoundException(`Role with ID ${id} not found`);
    }

    return role;
  }

  async findByName(name: string) {
    return this.prisma.role.findUnique({
      where: { name },
    });
  }

  async update(id: string, data: UpdateRoleDto) {
    await this.findById(id);

    return this.prisma.role.update({
      where: { id },
      data,
    });
  }

  async delete(id: string) {
    const role = await this.findById(id);

    if (role.isSystem) {
      throw new BadRequestException('Cannot delete system roles');
    }

    return this.prisma.role.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async addPermissionToRole(roleId: string, data: AddPermissionToRoleDto) {
    await this.findById(roleId);

    const permission = await this.prisma.permission.findUnique({
      where: { id: data.permissionId },
    });

    if (!permission) {
      throw new NotFoundException(`Permission with ID ${data.permissionId} not found`);
    }

    return this.prisma.rolePermission.create({
      data: {
        roleId,
        permissionId: data.permissionId,
        granted: data.granted !== undefined ? data.granted : true,
      },
    });
  }

  async removePermissionFromRole(roleId: string, permissionId: string) {
    await this.prisma.rolePermission.deleteMany({
      where: {
        roleId,
        permissionId,
      },
    });
  }

  async getRolePermissions(roleId: string) {
    const rolePermissions = await this.prisma.rolePermission.findMany({
      where: { roleId },
      include: {
        permission: true,
      },
    });

    return rolePermissions;
  }
}


