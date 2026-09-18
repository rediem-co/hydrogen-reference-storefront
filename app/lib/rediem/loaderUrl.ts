/**
 * Where the rediem loader is fetched from.
 *
 * This is single-sourced on purpose. The Content-Security-Policy in entry.server.tsx derives
 * its script-src and connect-src origins from this value, and the script tag in
 * RediemWidget.tsx uses it as the src. If those two ever disagreed, the browser would block
 * the loader with nothing in the page to explain why, so both read the same resolver.
 *
 * Do not vendor the loader into this repository. A copied loader is frozen at the version you
 * copied, so every fix rediem publishes stops reaching your shoppers.
 */

/**
 * The loader is built once per rediem environment with that environment's API URLs substituted
 * in at build time, so the build has to match the environment the rest of this storefront is
 * configured against. A production loader on a sandbox storefront talks to the production API
 * while the session exchange and the credential stay on sandbox: everything looks configured and
 * nothing errors visibly, which is why the build is derived here rather than defaulted.
 *
 * Both URLs move to https://cdn.rediem.io/headless/v1/... once the CDN channel publish is live:
 * that host is the durable public contract, while this one is a provider-owned host that should
 * not be hard-coded in a merchant's storefront for long.
 */
export const REDIEM_PRODUCTION_LOADER_URL =
  'https://ripplrewards.nyc3.digitaloceanspaces.com/static/prod/rediem-dash.js';

export const REDIEM_SANDBOX_LOADER_URL =
  'https://ripplrewards.nyc3.digitaloceanspaces.com/static/sandbox/rediem-dash.js';

const SANDBOX_HOSTNAME_MARKER = 'sandbox';

export interface LoaderUrlEnvironment {
  REDIEM_LOADER_URL?: string;
  REDIEM_API_URL?: string;
}

/**
 * The loader URL this storefront should use.
 *
 * An explicitly configured REDIEM_LOADER_URL always wins: it is how a storefront points at a
 * pre-release channel or a CDN URL rediem has not made the default yet, and the deployed
 * storefront relies on it today. A blank or whitespace-only value is treated as unset, because an
 * empty environment variable is a configuration mistake rather than a request for no loader.
 *
 * With no loader URL configured, the build is derived from REDIEM_API_URL, which this storefront
 * must already set correctly for the widget, the session exchange and the credential to work at
 * all. Only the hostname decides: a path segment saying "sandbox" on a production host names no
 * environment.
 *
 * With neither configured, this deliberately resolves to no loader and reports the missing
 * configuration, rather than assuming production. Assuming production is exactly the silent
 * cross-environment mismatch this resolver exists to prevent, and it is the failure that hides
 * best: the widget boots, talks to the wrong API, and the page looks fine. Resolving to nothing
 * is immediately visible (no widget at all) and leaves a loud line in the server log, while a
 * thrown error would take the whole storefront down for a loyalty misconfiguration. Callers must
 * handle undefined: entry.server.tsx then adds no rediem origin to the policy, and
 * RediemWidget.tsx renders no script tag, so the two still agree.
 */
export function resolveLoaderUrl(env: LoaderUrlEnvironment | undefined): string | undefined {
  const configuredLoaderUrl = env?.REDIEM_LOADER_URL?.trim();
  if (configuredLoaderUrl) return configuredLoaderUrl;

  const configuredApiUrl = env?.REDIEM_API_URL?.trim();
  if (!configuredApiUrl) {
    console.error(
      '[rediem] neither REDIEM_LOADER_URL nor REDIEM_API_URL is set, so no loader can be resolved ' +
        'without guessing an environment; the widget will not load',
    );
    return undefined;
  }

  const apiHostname = hostnameOf(configuredApiUrl);
  if (!apiHostname) {
    console.error(
      '[rediem] REDIEM_API_URL is not a usable absolute URL, so it names no environment and no ' +
        'loader build can be selected from it; the widget will not load',
    );
    return undefined;
  }

  return apiHostname.includes(SANDBOX_HOSTNAME_MARKER)
    ? REDIEM_SANDBOX_LOADER_URL
    : REDIEM_PRODUCTION_LOADER_URL;
}

function hostnameOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}
