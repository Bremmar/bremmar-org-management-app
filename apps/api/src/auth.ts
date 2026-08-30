import type { HttpRequest } from '@azure/functions';

export interface ClientPrincipal {
  userId: string;
  userDetails: string;
  identityProvider: string;
  userRoles: string[];
  claims?: Array<{ typ: string; val: string }>;
}

export function getClientPrincipal(request: HttpRequest): ClientPrincipal | null {
  const encoded = request.headers.get('x-ms-client-principal');
  if (!encoded) return null;

  try {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const principal = JSON.parse(decoded) as Partial<ClientPrincipal>;
    if (!principal.userId || !principal.userDetails) return null;
    return {
      userId: principal.userId,
      userDetails: principal.userDetails,
      identityProvider: principal.identityProvider ?? 'aad',
      userRoles: principal.userRoles ?? [],
      claims: principal.claims,
    };
  } catch {
    return null;
  }
}
