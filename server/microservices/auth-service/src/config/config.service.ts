import { Injectable } from '@nestjs/common';
import { ConfigService as NestConfigService } from '@nestjs/config';

@Injectable()
export class AppConfigService {
  constructor(private configService: NestConfigService) {}

  get<T = any>(propertyPath: string, defaultValue?: T): T {
    return this.configService.get<T>(propertyPath, defaultValue);
  }

  getNumber(propertyPath: string, defaultValue?: number): number {
    return this.configService.get<number>(propertyPath, defaultValue);
  }

  getBoolean(propertyPath: string, defaultValue?: boolean): boolean {
    return this.configService.get<boolean>(propertyPath, defaultValue);
  }

  getString(propertyPath: string, defaultValue?: string): string {
    return this.configService.get<string>(propertyPath, defaultValue);
  }
}
