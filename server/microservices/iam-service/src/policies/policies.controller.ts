import { Controller, Get, Post, Put, Delete, Body, Param, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { PoliciesService } from './policies.service';
import { CreatePolicyDto, UpdatePolicyDto } from './dto/policies.dto';

@ApiTags('Policies')
@Controller('policies')
export class PoliciesController {
  constructor(private readonly policiesService: PoliciesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new policy' })
  async create(@Body() dto: CreatePolicyDto) {
    return this.policiesService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List policies' })
  async findAll(
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
  ) {
    return this.policiesService.findAll(entityType, entityId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get policy by ID' })
  async findById(@Param('id') id: string) {
    return this.policiesService.findById(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update policy' })
  async update(@Param('id') id: string, @Body() dto: UpdatePolicyDto) {
    return this.policiesService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete policy' })
  async delete(@Param('id') id: string) {
    return this.policiesService.delete(id);
  }
}


