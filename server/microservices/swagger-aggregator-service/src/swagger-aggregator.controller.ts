import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { SwaggerAggregatorService } from './swagger-aggregator.service';

@Controller()
export class SwaggerAggregatorController {
  constructor(private readonly swaggerAggregatorService: SwaggerAggregatorService) {}

  @Get('api/docs-json')
  async getSwaggerJson(@Res() res: Response) {
    const spec = await this.swaggerAggregatorService.getAggregatedSwagger();
    res.json(spec);
  }

  @Get('api/status')
  async getServiceStatus(@Res() res: Response) {
    const status = await this.swaggerAggregatorService.getServiceStatus();
    res.json(status);
  }

  @Get('health')
  async getHealth(@Res() res: Response) {
    res.json({
      status: 'ok',
      service: 'swagger-aggregator-service',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  }
}

