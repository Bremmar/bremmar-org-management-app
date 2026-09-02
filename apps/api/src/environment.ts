import { createHmac, timingSafeEqual } from 'node:crypto';
import type { HttpRequest } from '@azure/functions';
import type { EnvironmentId } from './domain.js';

export const ENVIRONMENT_COOKIE_NAME = 'bremmar_environment';
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 12;
const LOCAL_COOKIE_SECRET = 'local-development-only-environment-cookie-secret';

export function isEnvironmentId(value: unknown): value is EnvironmentId {
  return value === 'live' || value === 'test';
}

export function getEnvironmentCookieSecret(): string | null {
  const configured = process.env.ENVIRONMENT_COOKIE_SECRET?.trim();
  if (configured) return configured;
  return process.env.LOCAL_POC_MODE === 'true' ? LOCAL_COOKIE_SECRET : null;
}

function signatureFor(environment: EnvironmentId, secret: string) {
  return createHmac('sha256', secret).update(environment).digest('base64url');
}

export function signEnvironmentCookie(environment: EnvironmentId, secret = getEnvironmentCookieSecret()): string {
  if (!secret) throw new Error('ENVIRONMENT_COOKIE_SECRET is not configured.');
  return `${environment}.${signatureFor(environment, secret)}`;
}

export function verifyEnvironmentCookie(value: string | null | undefined, secret = getEnvironmentCookieSecret()): EnvironmentId | null {
  if (!value || !secret) return null;
  const [environment, signature, ...extra] = value.split('.');
  if (!isEnvironmentId(environment) || !signature || extra.length > 0) return null;
  const expected = signatureFor(environment, secret);
  const supplied = Buffer.from(signature, 'base64url');
  const expectedBytes = Buffer.from(expected, 'base64url');
  if (supplied.length !== expectedBytes.length || !timingSafeEqual(supplied, expectedBytes)) return null;
  return environment;
}

export function readEnvironmentCookie(request: HttpRequest, secret = getEnvironmentCookieSecret()): EnvironmentId {
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) return 'live';
  const cookie = cookieHeader.split(';').map((item) => item.trim()).find((item) => item.startsWith(`${ENVIRONMENT_COOKIE_NAME}=`));
  const value = cookie?.slice(ENVIRONMENT_COOKIE_NAME.length + 1);
  return verifyEnvironmentCookie(value, secret) ?? 'live';
}

export function setEnvironmentCookie(environment: EnvironmentId, secret = getEnvironmentCookieSecret()): string {
  return `${ENVIRONMENT_COOKIE_NAME}=${signEnvironmentCookie(environment, secret)}; Max-Age=${COOKIE_MAX_AGE_SECONDS}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

export function clearEnvironmentCookie(): string {
  return `${ENVIRONMENT_COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`;
}
