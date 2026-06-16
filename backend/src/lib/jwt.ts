import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env.js';

const ISSUER = 'contractor-plus';

export interface AccessTokenPayload {
  sub: string;
  email: string | null;
  // Role name (system or custom). Kept small — permissions are loaded from DB.
  role: string;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  const options: SignOptions = {
    expiresIn: env.JWT_ACCESS_TTL as SignOptions['expiresIn'],
    issuer: ISSUER,
  };
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, options);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, { issuer: ISSUER });
  if (typeof decoded === 'string') {
    throw new Error('Unexpected JWT payload');
  }
  return decoded as AccessTokenPayload;
}

export function accessTokenTtlSeconds(): number {
  const ttl = env.JWT_ACCESS_TTL;
  const match = /^(\d+)([smhd])?$/.exec(ttl);
  if (!match) return 900;
  const value = Number(match[1]);
  const unit = match[2] ?? 's';
  const multiplier = unit === 's' ? 1 : unit === 'm' ? 60 : unit === 'h' ? 3600 : 86400;
  return value * multiplier;
}
