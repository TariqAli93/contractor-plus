export interface ApiErrorPayload {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
  reqId?: string;
}

export const API_VERSION = 'v1';
