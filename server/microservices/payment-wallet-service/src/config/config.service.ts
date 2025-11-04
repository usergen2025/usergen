import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ConfigService {
  constructor(private configService: ConfigService) {}

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
