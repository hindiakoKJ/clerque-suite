import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { scopedTenantFor, tenantContext } from '../tenant-context';

/**
 * Starts the shop context for a request (common/tenant-context.ts).
 *
 * An interceptor, so it runs after the guards: the token has been checked and
 * req.user is the caller. The handler is subscribed inside the context, so
 * every await in it, and anything it starts, sees the same shop.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const tenantId = scopedTenantFor(context.switchToHttp().getRequest()?.user);
    if (!tenantId) return next.handle();
    return new Observable((subscriber) =>
      tenantContext.run({ tenantId }, () => next.handle().subscribe(subscriber)),
    );
  }
}
