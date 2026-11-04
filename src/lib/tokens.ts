import jwt, { JwtPayload, SignOptions } from 'jsonwebtoken';
import crypto from 'crypto';
import { config } from './config';

// Access and refresh tokens use different secrets (enforced in config).
// If they were the same, a refresh token could be used as an access token.

export interface TokenPayload {
  sub: string;    // User ID
  tier: string;   // Billing tier, used for rate limits
  type: 'access' | 'refresh';
}

export function generateAccessToken(user: { id: string; tier: string }) {
  return jwt.sign(
    { sub: user.id, tier: user.tier, type: 'access' },
    config.JWT_ACCESS_SECRET,
    { expiresIn: config.JWT_ACCESS_EXPIRES_IN as SignOptions['expiresIn'] & {} }
  );
}

export function generateRefreshToken(user: { id: string; tier: string }) {
  return jwt.sign(
    { sub: user.id, tier: user.tier, type: 'refresh' },
    config.JWT_REFRESH_SECRET,
    {
      expiresIn: config.JWT_REFRESH_EXPIRES_IN as SignOptions['expiresIn'] & {},
      // Unique ID so two tokens issued in the same second don't collide
      jwtid: crypto.randomUUID(),
    }
  );
}

export function verifyAccessToken(token: string): TokenPayload {
  return jwt.verify(token, config.JWT_ACCESS_SECRET) as TokenPayload;
}

export function verifyRefreshToken(token: string): TokenPayload {
  return jwt.verify(token, config.JWT_REFRESH_SECRET) as TokenPayload;
}

// Store only a hash of refresh tokens, never the raw token
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Read the expiry the token was signed with, so the DB row matches the JWT
export function getTokenExpiry(token: string): Date {
  const { exp } = jwt.decode(token) as JwtPayload;
  return new Date((exp ?? 0) * 1000);
}
