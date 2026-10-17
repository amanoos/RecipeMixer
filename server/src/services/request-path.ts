/** The path of a raw request URL, without the query string. */
export function rawPathOf(url: string): string {
  const query = url.indexOf('?');
  return query === -1 ? url : url.slice(0, query);
}

/**
 * Whether a request is addressed to the API. It looks at the decoded, lower-cased path with repeated
 * slashes collapsed, so "/API/x", "//api/x" and "/%61pi/x" all count. A path that cannot be decoded counts
 * too: when in doubt a request is treated as an API request, which means it needs a login.
 *
 * A request line normally holds just a path ("GET /api/x"), but HTTP also allows a full address
 * ("GET http://host/api/x"), which Node passes on untouched while the router still finds the route inside it.
 * Anything that does not start with "/" is therefore treated as an API request as well.
 */
export function isApiRequest(url: string): boolean {
  if (!url.startsWith('/')) return true;
  let path = rawPathOf(url);
  try {
    path = decodeURIComponent(path);
  } catch {
    return true;
  }
  path = path.toLowerCase().replace(/\/{2,}/g, '/');
  return path === '/api' || path.startsWith('/api/');
}
