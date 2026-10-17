import { describe, expect, it } from 'vitest';
import { isApiRequest, rawPathOf } from '../src/services/request-path.js';

describe('rawPathOf', () => {
  it('drops the query string and nothing else', () => {
    expect(rawPathOf('/api/recipes?q=a&b=/api/health')).toBe('/api/recipes');
    expect(rawPathOf('/api/recipes')).toBe('/api/recipes');
    expect(rawPathOf('/')).toBe('/');
    expect(rawPathOf('/a%2Fb;x=1?y')).toBe('/a%2Fb;x=1');
  });
});

describe('isApiRequest', () => {
  it.each(['/api', '/api/', '/api/recipes', '/api/recipes?x=1', '/api/health', '/api/session/x'])('counts %s as the API', (url) => {
    expect(isApiRequest(url)).toBe(true);
  });

  it.each(['/API/recipes', '/Api', '//api/recipes', '/api//recipes', '///api', '/%61pi/recipes', '/%41PI/recipes', '/api%2Frecipes', '/api%2frecipes'])(
    'counts the disguised %s as the API',
    (url) => {
      expect(isApiRequest(url)).toBe(true);
    },
  );

  it.each(['/%', '/api/%zz', '/%E0%A4%A', '/recipes/%'])('treats the undecodable %s as the API, so it needs a login', (url) => {
    expect(isApiRequest(url)).toBe(true);
  });

  it.each(['/', '/recipes/12', '/match', '/assets/index-1a2b3c.js', '/favicon.svg', '/apiary', '/apis', '/api-docs', '/x/api/recipes'])(
    'does not count the web page or file %s',
    (url) => {
      expect(isApiRequest(url)).toBe(false);
    },
  );

  it.each([
    'http://x/api/recipes',
    'https://x/api/recipes',
    'HTTP://x/api/recipes',
    'http://x:80/api/recipes',
    'http://x/',
    'ftp://x/api',
    'api/recipes',
    '*',
    '',
  ])('treats the request target %j, which is not a plain path, as the API', (url) => {
    expect(isApiRequest(url)).toBe(true);
  });

  it('ignores a query string that mentions the API', () => {
    expect(isApiRequest('/recipes?next=/api/recipes')).toBe(false);
  });
});
