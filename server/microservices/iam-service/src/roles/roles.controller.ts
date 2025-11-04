import { Controller, Get, Post, Put, Delete, Body, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { RolesService } from './roles.service';
import { CreateRoleDto, UpdateRoleDto, AddPermissionToRoleDto } from './dto/roles.dto';

@ApiTags('Roles')
@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new role' })
  async create(@Body() dto: CreateRoleDto) {
    return this.rolesService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all roles' })
  async findAll() {
    return this.rolesService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get role by ID' })
  async findById(@Param('id') id: string) {
    return this.rolesService.findById(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update role' })
  async update(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.rolesService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete role' })
  async delete(@Param('id') id: string) {
    return this.rolesService.delete(id);
  }

  @Get(':id/permissions')
  @ApiOperation({ summary: 'Get permissions for a role' })
  async getPermissions(@Param('id') id: string) {
    return this.rolesService.getRolePermissions(id);
  }

  @Post(':id/permissions')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add permission to role' })
  async addPermission(@Param('id') id: string, @Body() dto: AddPermissionToRoleDto) {
    return this.rolesService.addPermissionToRole(id, dto);
  }

  @Delete(':roleId/permissions/:permissionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove permission from role' })
  async removePermission(@Param('roleId') roleId: string, @Param('permissionId') permissionId: string) {
    return this.rolesService.removePermissionFromRole(roleId, permissionId);
  }
}


