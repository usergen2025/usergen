import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ResponseHelper } from '../../../shared/utils';

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      map(data => {
        // If data is already formatted with success property, return as is
        if (data && typeof data === 'object' && 'success' in data) {
          return data;
        }
        
        // Otherwise, wrap in success response
        return ResponseHelper.success(data);
      }),
    );
  }
}
