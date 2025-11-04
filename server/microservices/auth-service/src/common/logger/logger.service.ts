import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createLogger, format, transports } from 'winston';
import { Logger } from 'winston';
import { LoggerHelper } from '@shared/utils';

@Injectable()
export class LoggerService {
  private readonly logger: Logger;

  constructor(private configService: ConfigService) {
    this.logger = createLogger({
      level: this.configService.get('LOG_LEVEL', 'info'),
      format: format.combine(
        format.timestamp(),
        format.errors({ stack: true }),
        format.json(),
        format.printf(({ timestamp, level, message, ...meta }: any) => {
          return LoggerHelper.formatLogMessage(String(level), String(message), meta);
        })
      ),
      transports: [
        // Console transport
        new transports.Console({
          format: format.combine(
            format.colorize(),
            format.simple()
          ),
        }),
        
        // File transports
        new transports.File({
          filename: `logs/${this.configService.get('SERVICE_NAME', 'auth-service')}-error.log`,
          level: 'error',
        }),
        new transports.File({
          filename: `logs/${this.configService.get('SERVICE_NAME', 'auth-service')}-combined.log`,
        }),
      ],
    });
  }

  log(message: string, context?: string) {
    this.logger.info(message, { context });
  }

  error(message: string, trace?: string, context?: string) {
    this.logger.error(message, { trace, context });
  }

  warn(message: string, context?: string) {
    this.logger.warn(message, { context });
  }

  debug(message: string, context?: string) {
    this.logger.debug(message, { context });
  }

  verbose(message: string, context?: string) {
    this.logger.verbose(message, { context });
  }
}
