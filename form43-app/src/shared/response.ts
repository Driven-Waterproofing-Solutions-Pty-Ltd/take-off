export interface SuccessEnvelope<T> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
}

export interface ErrorEnvelope {
  success: false;
  error: string;
  correlationId?: string;
}

export function ok<T>(data: T, meta?: Record<string, unknown>): SuccessEnvelope<T> {
  return meta ? { success: true, data, meta } : { success: true, data };
}

export function err(error: string, correlationId?: string): ErrorEnvelope {
  return correlationId ? { success: false, error, correlationId } : { success: false, error };
}
