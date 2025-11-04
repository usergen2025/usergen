import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
const basicAuth = require('basic-auth');

@Injectable()
export class SwaggerAuthGuard implements CanActivate {
  constructor(private configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    // Get credentials from environment or use defaults
    const swaggerUser = this.configService.get<string>('SWAGGER_USER', 'admin');
    const swaggerPassword = this.configService.get<string>('SWAGGER_PASSWORD', 'admin123');

    // Check if request has basic auth
    const user = basicAuth(request);

    if (!user || user.name !== swaggerUser || user.pass !== swaggerPassword) {
      response.setHeader('WWW-Authenticate', 'Basic realm="Swagger Documentation"');
      response.status(401).json({
        statusCode: 401,
        message: 'Swagger access requires authentication',
        error: 'Unauthorized'
      });
      return false;
    }

    return true;
  }
}
