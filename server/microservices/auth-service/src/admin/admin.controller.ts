import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { CreateAdminDto, UpdateUserRoleDto, UpdateUserCreditsDto, ListUsersQueryDto } from './dto/admin.dto';
import { JwtAuthGuard } from '../auth/guards';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('Admin')
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('JWT-auth')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('stats')
  @Roles('ADMIN', 'OWNER')
  @ApiOperation({ summary: 'Get dashboard statistics' })
  @ApiResponse({ status: 200, description: 'Dashboard statistics' })
  async getDashboardStats() {
    const stats = await this.adminService.getDashboardStats();
    return { success: true, data: stats };
  }

  @Get('users')
  @Roles('ADMIN', 'OWNER')
  @ApiOperation({ summary: 'Get all users (paginated)' })
  @ApiResponse({ status: 200, description: 'List of users' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'role', required: false, type: String })
  @ApiQuery({ name: 'userId', required: false, type: String })
  async getUsers(@Query() query: ListUsersQueryDto) {
    const result = await this.adminService.getUsers(query);
    return { success: true, data: result };
  }

  @Get('users/batch')
  @Roles('ADMIN', 'OWNER')
  @ApiOperation({ summary: 'Get multiple users by id (comma-separated, max 100)' })
  @ApiQuery({ name: 'ids', required: true, type: String })
  async getUsersBatch(@Query('ids') ids: string) {
    const idList = ids
      ? ids
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    const users = await this.adminService.getUsersByIds(idList);
    return { success: true, data: users };
  }

  @Get('users/:userId')
  @Roles('ADMIN', 'OWNER')
  @ApiOperation({ summary: 'Get user by ID' })
  @ApiResponse({ status: 200, description: 'User details' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async getUserById(@Param('userId') userId: string) {
    const user = await this.adminService.getUserById(userId);
    return { success: true, data: user };
  }

  @Put('users/:userId/role')
  @Roles('ADMIN', 'OWNER')
  @ApiOperation({ summary: 'Update user role' })
  @ApiResponse({ status: 200, description: 'Role updated successfully' })
  async updateUserRole(
    @Param('userId') userId: string,
    @Body() dto: UpdateUserRoleDto,
    @Req() req: any,
  ) {
    const user = await this.adminService.updateUserRole(userId, dto, req.user.id);
    return { success: true, data: user };
  }

  @Put('users/:userId/credits')
  @Roles('ADMIN', 'OWNER')
  @ApiOperation({ summary: 'Update user credits' })
  @ApiResponse({ status: 200, description: 'Credits updated successfully' })
  async updateUserCredits(
    @Param('userId') userId: string,
    @Body() dto: UpdateUserCreditsDto,
  ) {
    const user = await this.adminService.updateUserCredits(userId, dto);
    return { success: true, data: user };
  }

  @Post('users')
  @Roles('OWNER')
  @ApiOperation({ summary: 'Create admin user (OWNER only)' })
  @ApiResponse({ status: 201, description: 'Admin created successfully' })
  async createAdmin(@Body() dto: CreateAdminDto, @Req() req: any) {
    const admin = await this.adminService.createAdmin(dto, req.user.id);
    return { success: true, data: admin };
  }

  @Delete('users/:userId')
  @Roles('ADMIN', 'OWNER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate user' })
  @ApiResponse({ status: 200, description: 'User deactivated successfully' })
  async deactivateUser(@Param('userId') userId: string, @Req() req: any) {
    const user = await this.adminService.deactivateUser(userId, req.user.id);
    return { success: true, data: user };
  }

  @Put('users/:userId/reactivate')
  @Roles('ADMIN', 'OWNER')
  @ApiOperation({ summary: 'Reactivate user' })
  @ApiResponse({ status: 200, description: 'User reactivated successfully' })
  async reactivateUser(@Param('userId') userId: string) {
    const user = await this.adminService.reactivateUser(userId);
    return { success: true, data: user };
  }

  @Get('admins')
  @Roles('OWNER')
  @ApiOperation({ summary: 'Get all admin users (OWNER only)' })
  @ApiResponse({ status: 200, description: 'List of admin users' })
  async getAdminUsers() {
    const admins = await this.adminService.getAdminUsers();
    return { success: true, data: admins };
  }
}
