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
    // Pin the signing algorithm explicitly instead of relying on the library
    // default, so the issued and accepted algorithms stay in lockstep.
    algorithm: 'HS256',
    expiresIn: env.JWT_ACCESS_TTL as SignOptions['expiresIn'],
    issuer: ISSUER,
  };
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, options);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  // Pin the accepted algorithm to HS256. Without an explicit allow-list,
  // jsonwebtoken honours whatever `alg` the token header claims — opening the
  // algorithm-confusion class of attacks (a forged `alg:"none"` token, or an
  // `alg:"RS256"` token verified against our HMAC secret treated as a public key).
  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, {
    algorithms: ['HS256'],
    issuer: ISSUER,
  });
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
