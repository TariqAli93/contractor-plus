import { pino } from 'pino';
import { env } from '../config/env.js';

const isDev = env.NODE_ENV === 'development';

export const logger = pino({
  level: isDev ? 'info' : 'warn',
  transport: isDev
    ? {
        target: 'pino-pretty',
        options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
      }
    : undefined,
  base: { service: 'contractor-plus-api' },
});

export type Logger = typeof logger;
