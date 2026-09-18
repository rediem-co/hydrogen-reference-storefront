import type {Route} from './+types/auth.rediem.me';

/**
 * The merchant-owned identity endpoint. Its path is ours to choose; the rediem
 * loader reaches it through the adapter's `getSession()`, so rediem never
 * dictates the URL. Server-side, it:
 *   1. confirms the shopper is logged in (Customer Account API),
 *   2. gets their Customer Account API access token,
 *   3. POSTs it to rediem's session exchange, presenting this store's rediem
 *      credential as a Bearer token. Rediem resolves the store from the
 *      credential, verifies the shopper's token with Shopify, and mints the
 *      rediem session,
 *   4. returns the exchange's `{ data }` verbatim, which is what the loader reads.
 *
 * The access token and the credential never reach the browser; only the
 * resulting rediem JSON does. A refused exchange (revoked or retired credential,
 * expired shopper token) is logged here with rediem's reason code and answered
 * with an empty 204, so the widget falls back to guest mode instead of erroring.
 *
 * Every empty answer carries an `X-Rediem-Session` header naming why, so the
 * outcome can be read from the browser's Network tab without server logs. The
 * values never include a token or credential.
 */
function guest(reason: string): Response {
  return new Response(null, {
    status: 204,
    headers: {'X-Rediem-Session': reason, 'Cache-Control': 'no-store'},
  });
}

export async function loader({request, context}: Route.LoaderArgs) {
  const {customerAccount, env} = context;
  // Shopify's Customer Account API only honours the forwarded token when the request
  // carries an Origin from this storefront's registered JavaScript origins, so rediem
  // needs to know where the shopper is.
  const storefrontOrigin = new URL(request.url).origin;

  try {
    if (!(await customerAccount.isLoggedIn())) {
      return guest('not-logged-in');
    }

    const accessToken = await customerAccount.getAccessToken();
    if (!accessToken) {
      return guest('no-access-token');
    }

    const res = await fetch(env.REDIEM_EXCHANGE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.REDIEM_CREDENTIAL}`,
        // Oxygen's fetch sends no User-Agent, and rediem's edge refuses requests without one.
        // Naming the storefront also makes its calls recognisable in rediem's logs.
        'User-Agent': 'rediem-headless-storefront',
      },
      body: JSON.stringify({accessToken, storefrontOrigin}),
    });

    if (!res.ok) {
      const refusal = (await res.json().catch(() => null)) as {
        code?: string;
      } | null;
      const code = refusal?.code ?? 'UNKNOWN';
      console.error('[rediem] session exchange refused', {
        status: res.status,
        code,
      });
      return guest(`refused:${code}`);
    }

    // Pass a successful exchange through unchanged (it's the `{ data }` the loader
    // reads; a 204 means Shopify has no profile for this shopper). Never cache: it's
    // per-customer and carries a token.
    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('[rediem] /auth/rediem/me exchange failed', error);
    return guest('error');
  }
}
