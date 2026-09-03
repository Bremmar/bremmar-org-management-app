import type { HttpRequest } from '@azure/functions';

const GRAPH_SCOPE = 'https://graph.microsoft.com/.default';
const GRAPH_USERS_ENDPOINT = 'https://graph.microsoft.com/v1.0/users';
const IDENTITY_CACHE_TTL_MS = 5 * 60 * 1000;
const OBJECT_ID_CLAIM_TYPES = new Set([
  'oid',
  'http://schemas.microsoft.com/identity/claims/objectidentifier',
]);

export interface ClientPrincipalClaim {
  typ: string;
  val: string;
}

export interface ClientPrincipal {
  /**
   * The application identity key. For Entra users this is normalized to the
   * directory object ID before the principal is used by authorization code.
   */
  userId: string;
  userDetails: string;
  identityProvider: string;
  userRoles: string[];
  claims?: ClientPrincipalClaim[];
  /** Present only when a provider payload exposes the Entra object ID. */
  entraObjectId?: string;
}

interface PrincipalPayload {
  userId?: unknown;
  userDetails?: unknown;
  identityProvider?: unknown;
  userRoles?: unknown;
  claims?: unknown;
  oid?: unknown;
  objectId?: unknown;
}

interface FetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type AuthFetch = (url: string, init: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<FetchResponse>;

export interface IdentityResolutionOptions {
  fetch?: AuthFetch;
  now?: () => number;
  /** Used by tests and by callers that already obtained a delegated Graph token. */
  accessToken?: string;
}

export class IdentityResolutionError extends Error {
  readonly code = 'UNAVAILABLE' as const;

  constructor(message: string) {
    super(message);
    this.name = 'IdentityResolutionError';
  }
}

interface CachedIdentity {
  userId: string;
  expiresAt: number;
}

const identityCache = new Map<string, CachedIdentity>();

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isObjectId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function normalizeObjectId(value: string): string | null {
  const normalized = value.trim();
  return isObjectId(normalized) ? normalized.toLowerCase() : null;
}

function normalizedClaimType(value: string) {
  return value.trim().toLowerCase();
}

function claimsFrom(value: unknown): ClientPrincipalClaim[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const claims = value.flatMap((claim) => {
    if (!claim || typeof claim !== 'object') return [];
    const candidate = claim as { typ?: unknown; val?: unknown };
    const typ = nonEmptyString(candidate.typ);
    const val = nonEmptyString(candidate.val);
    return typ && val ? [{ typ, val }] : [];
  });
  return claims.length ? claims : undefined;
}

function objectIdFromPayload(payload: PrincipalPayload, claims?: ClientPrincipalClaim[]): string | undefined {
  const directCandidates = [payload.oid, payload.objectId];
  for (const candidate of directCandidates) {
    const objectId = typeof candidate === 'string' ? normalizeObjectId(candidate) : null;
    if (objectId) return objectId;
  }

  for (const claim of claims ?? []) {
    if (!OBJECT_ID_CLAIM_TYPES.has(normalizedClaimType(claim.typ))) continue;
    const objectId = normalizeObjectId(claim.val);
    if (objectId) return objectId;
  }
  return undefined;
}

function principalFromPayload(value: unknown): ClientPrincipal | null {
  if (!value || typeof value !== 'object') return null;
  const payload = value as PrincipalPayload;
  const userId = nonEmptyString(payload.userId);
  const userDetails = nonEmptyString(payload.userDetails);
  if (!userId || !userDetails) return null;
  const identityProvider = nonEmptyString(payload.identityProvider) ?? 'aad';
  const claims = claimsFrom(payload.claims);
  return {
    userId,
    userDetails,
    identityProvider,
    userRoles: Array.isArray(payload.userRoles) ? payload.userRoles.filter((role): role is string => typeof role === 'string') : [],
    claims,
    entraObjectId: objectIdFromPayload(payload, claims),
  };
}

function decodeClientPrincipal(encoded: string): ClientPrincipal | null {
  try {
    return principalFromPayload(JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')));
  } catch {
    return null;
  }
}

export function getClientPrincipal(request: HttpRequest): ClientPrincipal | null {
  const encoded = request.headers.get('x-ms-client-principal');
  if (!encoded) {
    // Local POC mode intentionally has one seeded app-owned identity. It is
    // opt-in and must never be enabled for a deployed production API.
    if (process.env.LOCAL_POC_MODE !== 'true') return null;
    const userId = process.env.LOCAL_POC_USER_ID ?? 'ava-khan';
    return { userId, userDetails: userId, identityProvider: 'local-poc', userRoles: ['authenticated'] };
  }

  return decodeClientPrincipal(encoded);
}

function isEntraProvider(identityProvider: string) {
  const provider = identityProvider.trim().toLowerCase();
  return provider === 'aad' || provider === 'azuread' || provider === 'azureactivedirectory' || provider === 'entra';
}

function configuredValue(...names: string[]) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

interface GraphCredentialConfig {
  mode: 'client-secret' | 'managed-identity';
  tenantId?: string;
  clientId?: string;
  clientSecret?: string;
  identityEndpoint?: string;
  identityHeader?: string;
  identityHeaderName: 'X-IDENTITY-HEADER' | 'secret';
}

function graphCredentialConfig(): GraphCredentialConfig | null {
  const tenantId = configuredValue('ENTRA_TENANT_ID', 'GRAPH_TENANT_ID', 'AZURE_TENANT_ID');
  const clientId = configuredValue('ENTRA_GRAPH_CLIENT_ID', 'GRAPH_CLIENT_ID', 'ENTRA_CLIENT_ID');
  const clientSecret = configuredValue('ENTRA_GRAPH_CLIENT_SECRET', 'GRAPH_CLIENT_SECRET', 'ENTRA_CLIENT_SECRET');
  const identityEndpoint = configuredValue('IDENTITY_ENDPOINT');
  const identityHeader = configuredValue('IDENTITY_HEADER');
  const legacyIdentityEndpoint = configuredValue('MSI_ENDPOINT');
  const legacyIdentityHeader = configuredValue('MSI_SECRET');

  if (clientId || clientSecret) {
    if (!tenantId || !clientId || !clientSecret) {
      throw new IdentityResolutionError('Entra identity lookup is incompletely configured. Set ENTRA_TENANT_ID, ENTRA_GRAPH_CLIENT_ID, and ENTRA_GRAPH_CLIENT_SECRET.');
    }
    return { mode: 'client-secret', tenantId, clientId, clientSecret, identityHeaderName: 'X-IDENTITY-HEADER' };
  }

  if (identityEndpoint && identityHeader) return { mode: 'managed-identity', identityEndpoint, identityHeader, identityHeaderName: 'X-IDENTITY-HEADER' };
  if (legacyIdentityEndpoint && legacyIdentityHeader) return { mode: 'managed-identity', identityEndpoint: legacyIdentityEndpoint, identityHeader: legacyIdentityHeader, identityHeaderName: 'secret' };
  if (tenantId) throw new IdentityResolutionError('Entra identity lookup is incompletely configured. Set ENTRA_GRAPH_CLIENT_ID and ENTRA_GRAPH_CLIENT_SECRET, or enable a managed identity.');
  return null;
}

function defaultFetch(url: string, init: { method?: string; headers?: Record<string, string>; body?: string }) {
  return globalThis.fetch(url, init);
}

async function jsonBody(response: FetchResponse): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => ({}));
  return body && typeof body === 'object' ? body as Record<string, unknown> : {};
}

async function authFetch(fetchImpl: AuthFetch, url: string, init: Parameters<AuthFetch>[1], failureMessage: string) {
  try {
    return await fetchImpl(url, init);
  } catch {
    throw new IdentityResolutionError(failureMessage);
  }
}

async function appAccessToken(config: GraphCredentialConfig, fetchImpl: AuthFetch): Promise<string> {
  if (config.mode === 'client-secret') {
    const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId!)}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
      client_id: config.clientId!,
      client_secret: config.clientSecret!,
      scope: GRAPH_SCOPE,
      grant_type: 'client_credentials',
    });
    const response = await authFetch(fetchImpl, tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() }, 'Microsoft Graph authentication is unavailable.');
    const payload = await jsonBody(response);
    const accessToken = nonEmptyString(payload.access_token);
    if (!response.ok || !accessToken) throw new IdentityResolutionError(`Microsoft Graph authentication failed (status ${response.status}).`);
    return accessToken;
  }

  const endpoint = new URL(config.identityEndpoint!);
  endpoint.searchParams.set('resource', 'https://graph.microsoft.com');
  endpoint.searchParams.set('api-version', '2019-08-01');
  const userAssignedClientId = configuredValue('AZURE_CLIENT_ID');
  if (userAssignedClientId) endpoint.searchParams.set('client_id', userAssignedClientId);
  const response = await authFetch(fetchImpl, endpoint.toString(), { method: 'GET', headers: { [config.identityHeaderName]: config.identityHeader! } }, 'Managed identity authentication for Microsoft Graph is unavailable.');
  const payload = await jsonBody(response);
  const accessToken = nonEmptyString(payload.access_token);
  if (!response.ok || !accessToken) throw new IdentityResolutionError(`Managed identity authentication for Microsoft Graph failed (status ${response.status}).`);
  return accessToken;
}

function graphFilterValue(value: string) {
  // OData string literals escape a single quote by doubling it. The URL
  // encoder is applied by URLSearchParams after this step.
  return value.replace(/'/g, "''");
}

async function graphUserObjectId(userDetails: string, accessToken: string, fetchImpl: AuthFetch): Promise<string | undefined> {
  const details = userDetails.trim();
  if (!details || details.length > 320 || /[\u0000-\u001f\u007f]/.test(details)) return undefined;
  const filterValue = graphFilterValue(details);
  const url = new URL(GRAPH_USERS_ENDPOINT);
  url.searchParams.set('$select', 'id,mail,userPrincipalName');
  url.searchParams.set('$filter', `userPrincipalName eq '${filterValue}' or mail eq '${filterValue}'`);
  url.searchParams.set('$top', '2');
  const response = await authFetch(fetchImpl, url.toString(), { method: 'GET', headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` } }, 'Microsoft Graph is unavailable.');
  const payload = await jsonBody(response);
  if (!response.ok) throw new IdentityResolutionError(`Microsoft Graph user lookup failed (status ${response.status}).`);
  const values = Array.isArray(payload.value) ? payload.value : [];
  const matchingIds = [...new Set(values.flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const id = nonEmptyString((value as { id?: unknown }).id);
    const objectId = id ? normalizeObjectId(id) : null;
    return objectId ? [objectId] : [];
  }))];
  if (matchingIds.length > 1) throw new IdentityResolutionError('Microsoft Graph returned more than one Entra user for the signed-in identity.');
  return matchingIds[0];
}

function identityCacheKey(principal: ClientPrincipal) {
  return `${principal.identityProvider.toLowerCase()}|${principal.userId}|${principal.userDetails.toLowerCase()}`;
}

/** Clear the process-local resolver cache. Primarily useful for tests and credential rotation. */
export function clearIdentityResolutionCache() {
  identityCache.clear();
}

/**
 * Resolve a directory user's Entra object ID from their sign-in address.
 *
 * This is deliberately separate from principal resolution because an OrgAdmin
 * may be creating a profile for another directory user. The caller must use
 * application Graph credentials (rather than trusting a browser-supplied ID)
 * when it needs to link a new profile.
 */
export async function lookupEntraObjectId(userDetails: string, options: IdentityResolutionOptions = {}): Promise<string | undefined> {
  const details = nonEmptyString(userDetails);
  if (!details) return undefined;
  const fetchImpl = options.fetch ?? defaultFetch;
  const accessToken = options.accessToken;
  const config = accessToken ? null : graphCredentialConfig();
  if (!accessToken && !config) {
    throw new IdentityResolutionError('Entra directory lookup is not configured. Configure Graph credentials.');
  }
  return graphUserObjectId(details, accessToken ?? await appAccessToken(config!, fetchImpl), fetchImpl);
}

export async function resolveClientPrincipalIdentity(principal: ClientPrincipal, options: IdentityResolutionOptions = {}): Promise<ClientPrincipal> {
  if (!isEntraProvider(principal.identityProvider)) return principal;
  const directObjectId = principal.entraObjectId ?? normalizeObjectId(principal.userDetails);
  if (directObjectId) return { ...principal, userId: directObjectId, entraObjectId: directObjectId };

  const now = options.now ?? Date.now;
  const cacheKey = identityCacheKey(principal);
  const cached = identityCache.get(cacheKey);
  if (cached && cached.expiresAt > now()) return { ...principal, userId: cached.userId, entraObjectId: cached.userId };

  const fetchImpl = options.fetch ?? defaultFetch;
  const accessToken = options.accessToken;
  const objectId = await lookupEntraObjectId(principal.userDetails, { ...options, fetch: fetchImpl, accessToken });
  // An unknown directory user is intentionally left unresolved. The caller
  // will return the normal local-profile-not-found response, while Graph and
  // credential failures remain explicit availability errors.
  if (!objectId) return principal;
  identityCache.set(cacheKey, { userId: objectId, expiresAt: now() + IDENTITY_CACHE_TTL_MS });
  return { ...principal, userId: objectId, entraObjectId: objectId };
}

export async function resolveClientPrincipal(request: HttpRequest, options: IdentityResolutionOptions = {}): Promise<ClientPrincipal | null> {
  const principal = getClientPrincipal(request);
  if (!principal) return null;
  const accessToken = options.accessToken ?? request.headers.get('x-ms-token-aad-access-token') ?? undefined;
  return resolveClientPrincipalIdentity(principal, { ...options, accessToken });
}
