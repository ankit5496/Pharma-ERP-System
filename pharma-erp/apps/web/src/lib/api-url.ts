/**
 * Pure helpers for normalising the API's address. Kept apart from env.ts
 * because env.ts validates at module load and throws when no API address is
 * configured — importing it from browser code would crash any page that does
 * so whenever NEXT_PUBLIC_API_URL is unset, which is exactly the merged
 * deployment (apps/server), where the browser reaches the API on its own
 * origin.
 */

/** Whether the value already starts with a scheme such as `https://`. */
export function hasScheme(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

/**
 * Prefixes a bare hostname with a scheme: http for loopback (a local API
 * serves plain http), https for everything else.
 */
export function withDefaultScheme(host: string): string {
  const isLoopback = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);

  return `${isLoopback ? 'http' : 'https'}://${host}`;
}

/**
 * Where the BROWSER reaches the API, with no trailing slash.
 *
 * NEXT_PUBLIC_API_URL when it is set (separate web and API services, local
 * dev); otherwise an empty string, so requests go to this page's own origin —
 * correct for the merged deployment, which serves the API from the same host.
 */
export function browserApiBase(): string {
  // A static property access, so Next inlines the value at build time.
  const raw = process.env.NEXT_PUBLIC_API_URL?.trim().replace(/\/+$/, '');

  if (!raw) return '';

  return hasScheme(raw) ? raw : withDefaultScheme(raw);
}
