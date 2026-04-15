import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createLogger, format, transports, Logger } from 'winston';

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
        format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
          return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`;
        })
      ),
      transports: [
        new transports.Console({
          format: format.combine(
            format.colorize(),
            format.simple()
          ),
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
