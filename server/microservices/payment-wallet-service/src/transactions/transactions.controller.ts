import { Controller, Get, Post, Body, Query, Param } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { TransactionType, EntityType } from '@prisma/client';

@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Post('deduct')
  async deductCredits(@Body() deductDto: any) {
    return await this.transactionsService.deductCredits(deductDto);
  }

  @Post('add')
  async addCredits(@Body() addDto: any) {
    return await this.transactionsService.addCredits(addDto);
  }

  @Get('balance')
  async checkBalance(@Query('userId') userId: string, @Query('workspaceId') workspaceId?: string) {
    const balance = await this.transactionsService.checkBalance(userId, workspaceId);
    return { success: true, data: balance };
  }

  @Get('history')
  async getTransactionHistory(
    @Query('userId') userId: string,
    @Query('workspaceId') workspaceId?: string,
    @Query('limit') limit?: string,
  ) {
    const transactions = await this.transactionsService.getTransactionHistory(
      userId,
      workspaceId,
      limit ? parseInt(limit) : 50,
    );
    return { success: true, data: transactions };
  }

  @Get('ledger/:entityType/:entityId')
  async getCreditLedger(
    @Param('entityType') entityType: EntityType,
    @Param('entityId') entityId: string,
    @Query('limit') limit?: string,
  ) {
    const ledger = await this.transactionsService.getCreditLedger(
      entityType,
      entityId,
      limit ? parseInt(limit) : 100,
    );
    return { success: true, data: ledger };
  }
}


