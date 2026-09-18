import { afterEach, describe, it, expect, vi } from 'vitest';

import { REDIEM_PRODUCTION_LOADER_URL, REDIEM_SANDBOX_LOADER_URL, resolveLoaderUrl } from './loaderUrl';

const PRODUCTION_API_URL = 'https://api.rediem.io';
const SANDBOX_API_URL = 'https://api.rediemsandbox.dev';

afterEach(() => {
  vi.restoreAllMocks();
});

function silenceConsoleError() {
  return vi.spyOn(console, 'error').mockImplementation(() => {});
}

describe('resolveLoaderUrl', () => {
  it('uses the configured loader URL when the storefront sets one', () => {
    expect(
      resolveLoaderUrl({
        REDIEM_LOADER_URL: 'https://cdn.rediemsandbox.dev/headless/v1/rediem.js',
        REDIEM_API_URL: SANDBOX_API_URL,
      }),
    ).toBe('https://cdn.rediemsandbox.dev/headless/v1/rediem.js');
  });

  it('lets the configured loader URL win over the build the API URL would have selected', () => {
    expect(
      resolveLoaderUrl({
        REDIEM_LOADER_URL: 'https://cdn.rediem.io/headless/v1/rediem.js',
        REDIEM_API_URL: SANDBOX_API_URL,
      }),
    ).toBe('https://cdn.rediem.io/headless/v1/rediem.js');
  });

  it('trims surrounding whitespace, which is easy to introduce in a deployment variable', () => {
    expect(
      resolveLoaderUrl({
        REDIEM_LOADER_URL: '  https://cdn.rediem.io/headless/v1/rediem.js  ',
        REDIEM_API_URL: PRODUCTION_API_URL,
      }),
    ).toBe('https://cdn.rediem.io/headless/v1/rediem.js');
  });

  it('selects the sandbox loader build when the storefront talks to the sandbox API', () => {
    expect(resolveLoaderUrl({ REDIEM_API_URL: SANDBOX_API_URL })).toBe(REDIEM_SANDBOX_LOADER_URL);
  });

  it('selects the production loader build when the storefront talks to the production API', () => {
    expect(resolveLoaderUrl({ REDIEM_API_URL: PRODUCTION_API_URL })).toBe(REDIEM_PRODUCTION_LOADER_URL);
  });

  it('recognizes the sandbox API whatever case the hostname is written in', () => {
    expect(resolveLoaderUrl({ REDIEM_API_URL: 'https://API.RediemSandbox.dev' })).toBe(REDIEM_SANDBOX_LOADER_URL);
  });

  it('ignores a sandbox-looking path on a production API host, since only the host names the environment', () => {
    expect(resolveLoaderUrl({ REDIEM_API_URL: 'https://api.rediem.io/sandbox' })).toBe(REDIEM_PRODUCTION_LOADER_URL);
  });

  // A blank REDIEM_LOADER_URL is a deployment mistake rather than a request for no loader, so the
  // API URL still decides which build to use.
  it('treats a blank configured loader URL as unset and derives the build from the API URL', () => {
    expect(resolveLoaderUrl({ REDIEM_LOADER_URL: '   ', REDIEM_API_URL: SANDBOX_API_URL })).toBe(
      REDIEM_SANDBOX_LOADER_URL,
    );
  });

  // Guessing production here is what the whole change exists to prevent: a sandbox storefront
  // would load a production loader and nothing on the page would say so.
  it('resolves to no loader at all when neither the loader URL nor the API URL is configured', () => {
    silenceConsoleError();

    expect(resolveLoaderUrl({})).toBeUndefined();
  });

  it('reports the missing configuration rather than resolving a loader silently', () => {
    const consoleError = silenceConsoleError();

    expect(resolveLoaderUrl({})).toBeUndefined();
    expect(consoleError).toHaveBeenCalledTimes(1);
  });

  it('resolves to no loader when the environment object itself is absent', () => {
    silenceConsoleError();

    expect(resolveLoaderUrl(undefined)).toBeUndefined();
  });

  it('resolves to no loader when the API URL is blank', () => {
    silenceConsoleError();

    expect(resolveLoaderUrl({ REDIEM_API_URL: '   ' })).toBeUndefined();
  });

  // An unparseable API URL names no environment, so deriving a build from it would be a guess.
  it('resolves to no loader when the API URL is not a usable URL', () => {
    silenceConsoleError();

    expect(resolveLoaderUrl({ REDIEM_API_URL: 'api.rediemsandbox.dev' })).toBeUndefined();
  });

  it('resolves both builds to absolute https URLs, so the Content-Security-Policy can derive an origin', () => {
    const sandboxLoaderUrl = resolveLoaderUrl({ REDIEM_API_URL: SANDBOX_API_URL });
    const productionLoaderUrl = resolveLoaderUrl({ REDIEM_API_URL: PRODUCTION_API_URL });

    expect(new URL(String(sandboxLoaderUrl)).protocol).toBe('https:');
    expect(new URL(String(productionLoaderUrl)).protocol).toBe('https:');
  });

  it('resolves the two builds to different URLs, so an environment mismatch is visible', () => {
    expect(REDIEM_SANDBOX_LOADER_URL).not.toBe(REDIEM_PRODUCTION_LOADER_URL);
  });
});
