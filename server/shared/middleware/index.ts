// Shared middleware for all microservices
import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { LoggerHelper } from '../utils';

@Injectable()
export class RequestLoggingMiddleware implements NestMiddleware {
  private readonly logger = new Logger(RequestLoggingMiddleware.name);

  use(req: Request, res: Response, next: NextFunction) {
    const start = Date.now();
    const { method, url, ip } = req;
    const userAgent = req.get('User-Agent') || '';

    res.on('finish', () => {
      const duration = Date.now() - start;
      const { statusCode } = res;
      
      this.logger.log(
        LoggerHelper.formatLogMessage(
          'info',
          `${method} ${url} ${statusCode} ${duration}ms`,
          {
            ip,
            userAgent,
            duration,
            statusCode
          }
        )
      );
    });

    next();
  }
}

@Injectable()
export class ErrorHandlingMiddleware implements NestMiddleware {
  private readonly logger = new Logger(ErrorHandlingMiddleware.name);

  use(req: Request, res: Response, next: NextFunction) {
    const originalSend = res.send;
    
    res.send = function(data) {
      if (res.statusCode >= 400) {
        const errorInfo = {
          method: req.method,
          url: req.url,
          statusCode: res.statusCode,
          ip: req.ip,
          userAgent: req.get('User-Agent'),
          body: LoggerHelper.sanitizeLogData(req.body),
          query: req.query,
          params: req.params
        };
        
        console.error('Request Error:', errorInfo);
      }
      
      return originalSend.call(this, data);
    };

    next();
  }
}

@Injectable()
export class SecurityHeadersMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    // Security headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    
    // Remove server information
    res.removeHeader('X-Powered-By');
    
    next();
  }
}

@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  private readonly requests = new Map<string, { count: number; resetTime: number }>();
  private readonly limit = parseInt(process.env.RATE_LIMIT_LIMIT || '100');
  private readonly windowMs = parseInt(process.env.RATE_LIMIT_TTL || '60') * 1000;

  use(req: Request, res: Response, next: NextFunction) {
    const key = req.ip || 'unknown';
    const now = Date.now();
    
    // Clean expired entries
    for (const [k, v] of this.requests.entries()) {
      if (now > v.resetTime) {
        this.requests.delete(k);
      }
    }
    
    const current = this.requests.get(key);
    
    if (!current) {
      this.requests.set(key, { count: 1, resetTime: now + this.windowMs });
      return next();
    }
    
    if (now > current.resetTime) {
      this.requests.set(key, { count: 1, resetTime: now + this.windowMs });
      return next();
    }
    
    if (current.count >= this.limit) {
      return res.status(429).json({
        success: false,
        error: 'Too Many Requests',
        message: 'Rate limit exceeded. Please try again later.',
        retryAfter: Math.ceil((current.resetTime - now) / 1000)
      });
    }
    
    current.count++;
    next();
  }
}

@Injectable()
export class HealthCheckMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    if (req.path === '/health' || req.path === '/healthz') {
      return res.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        version: process.env.npm_package_version || '1.0.0'
      });
    }
    
    next();
  }
}

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const requestId = req.headers['x-request-id'] as string || 
                     req.headers['x-correlation-id'] as string || 
                     `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    req.headers['x-request-id'] = requestId;
    res.setHeader('X-Request-ID', requestId);
    
    next();
  }
}

@Injectable()
export class CORSMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const allowedOrigins = process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3200'];
    const origin = req.headers.origin;
    
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
    
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-ID');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Max-Age', '86400');
    
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }
    
    next();
  }
}

@Injectable()
export class CompressionMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const originalSend = res.send;
    
    res.send = function(data) {
      const contentType = res.getHeader('Content-Type') as string;
      
      if (contentType && (
        contentType.includes('application/json') ||
        contentType.includes('text/') ||
        contentType.includes('application/javascript')
      )) {
        res.setHeader('Content-Encoding', 'gzip');
      }
      
      return originalSend.call(this, data);
    };
    
    next();
  }
}

@Injectable()
export class RequestSizeMiddleware implements NestMiddleware {
  private readonly maxSize = parseInt(process.env.MAX_FILE_SIZE || '52428800'); // 50MB default

  use(req: Request, res: Response, next: NextFunction) {
    const contentLength = parseInt(req.headers['content-length'] || '0');
    
    if (contentLength > this.maxSize) {
      return res.status(413).json({
        success: false,
        error: 'Payload Too Large',
        message: `Request size exceeds maximum allowed size of ${this.maxSize} bytes`
      });
    }
    
    next();
  }
}

@Injectable()
export class ServiceDiscoveryMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    // Add service information to response headers
    res.setHeader('X-Service-Name', process.env.SERVICE_NAME || 'unknown');
    res.setHeader('X-Service-Version', process.env.SERVICE_VERSION || '1.0.0');
    res.setHeader('X-Service-Environment', process.env.NODE_ENV || 'development');
    
    next();
  }
}
