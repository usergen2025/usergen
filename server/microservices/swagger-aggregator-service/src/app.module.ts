import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SwaggerAggregatorController } from './swagger-aggregator.controller';
import { SwaggerAggregatorService } from './swagger-aggregator.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        'microservices/swagger-aggregator-service/.env',
        '.env',
      ],
      expandVariables: true,
    }),
  ],
  controllers: [SwaggerAggregatorController],
  providers: [
    SwaggerAggregatorService,
    {
      provide: 'SwaggerAggregatorService',
      useExisting: SwaggerAggregatorService,
    },
  ],
  exports: [SwaggerAggregatorService],
})
export class AppModule {}

