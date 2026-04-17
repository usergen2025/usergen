import { Controller, Get, Put, Post, Patch, Body, Param, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { PricingService } from './pricing.service';

@ApiTags('Pricing')
@Controller('pricing')
export class PricingController {
  constructor(private readonly pricingService: PricingService) {}

  @Get()
  @ApiOperation({ summary: 'Get all active pricing configurations' })
  @ApiResponse({ status: 200, description: 'Returns all active pricing configurations' })
  async getAllPricing() {
    const pricing = await this.pricingService.getAllPricing();
    return { success: true, data: pricing };
  }

  @Get('admin/all')
  @ApiOperation({ summary: 'Get all pricing rows (admin — includes inactive)' })
  @ApiResponse({ status: 200, description: 'Returns all pricing configurations' })
  async getAllPricingForAdmin() {
    const pricing = await this.pricingService.getAllPricingForAdmin();
    return { success: true, data: pricing };
  }

  @Patch(':operationType/activation')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Enable or disable a pricing line (admin)' })
  async updateActivation(
    @Param('operationType') operationType: string,
    @Body() body: { isActive: boolean; adminUserId: string },
  ) {
    const pricing = await this.pricingService.updatePricingActive(
      operationType,
      body.isActive,
      body.adminUserId,
    );
    return { success: true, data: pricing };
  }

  @Get(':operationType')
  @ApiOperation({ summary: 'Get pricing for a specific operation type' })
  @ApiResponse({ status: 200, description: 'Returns pricing for the operation type' })
  @ApiResponse({ status: 404, description: 'Pricing not found' })
  async getPricingByType(@Param('operationType') operationType: string) {
    const pricing = await this.pricingService.getPricingByType(operationType);
    return { success: true, data: pricing };
  }

  @Get(':operationType/cost')
  @ApiOperation({ summary: 'Get credit cost for a specific operation type' })
  @ApiResponse({ status: 200, description: 'Returns the credit cost' })
  async getCreditCost(@Param('operationType') operationType: string) {
    const cost = await this.pricingService.getCreditCost(operationType);
    return { success: true, data: { operationType, creditCost: cost } };
  }

  @Put(':operationType')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update pricing for an operation type (admin only)' })
  @ApiResponse({ status: 200, description: 'Pricing updated successfully' })
  @ApiResponse({ status: 404, description: 'Pricing not found' })
  async updatePricing(
    @Param('operationType') operationType: string,
    @Body() body: { creditCost: number; adminUserId: string; reason?: string }
  ) {
    const pricing = await this.pricingService.updatePricing(
      operationType,
      body.creditCost,
      body.adminUserId,
      body.reason
    );
    return { success: true, data: pricing };
  }

  @Get(':operationType/history')
  @ApiOperation({ summary: 'Get pricing change history for an operation type' })
  @ApiResponse({ status: 200, description: 'Returns pricing history' })
  async getPricingHistory(
    @Param('operationType') operationType: string,
    @Query('limit') limit?: string
  ) {
    const history = await this.pricingService.getPricingHistory(
      operationType,
      limit ? parseInt(limit) : 50
    );
    return { success: true, data: history };
  }

  @Post('record-cost')
  @ApiOperation({ summary: 'Record generation cost without deducting credits' })
  @ApiResponse({ status: 201, description: 'Cost recorded successfully' })
  async recordCost(
    @Body() body: {
      projectId: string;
      userId: string;
      sceneNumber?: number;
      operationType: string;
      operationName: string;
      metadata?: Record<string, any>;
    }
  ) {
    const snapshot = await this.pricingService.recordGenerationCost(body);
    if (!snapshot) {
      return { success: true, data: null, skipped: true };
    }
    return { success: true, data: snapshot };
  }
}
