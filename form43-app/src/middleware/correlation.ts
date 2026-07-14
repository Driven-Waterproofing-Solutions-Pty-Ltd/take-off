import type { MiddlewareHandler } from 'hono';
import type { AppType } from '../shared/types';

export const correlation: MiddlewareHandler<AppType> = async (c, next) => {
  const incoming = c.req.header('x-correlation-id');
  const id = incoming || crypto.randomUUID();
  c.set('correlationId', id);
  await next();
  c.res.headers.set('x-correlation-id', id);
};
