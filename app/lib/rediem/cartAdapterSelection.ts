/**
 * Chooses which cart adapter the rediem widget binds at boot.
 *
 * Two implementations of the same contract live side by side so they can be
 * compared against a real storefront:
 *
 *   'hydrogen': `hydrogenAdapter.ts`. Framework-specific reference code. It
 *   posts Hydrogen `CartForm` actions to this storefront's own `/cart` route and
 *   reads the cart the root loader already resolved. A merchant on another
 *   framework has to rewrite it.
 *
 *   'storefrontApi': `storefrontApiAdapter.ts`. Framework-agnostic. It calls the
 *   Shopify Storefront API directly and imports nothing from Hydrogen. This is
 *   the shape a prebuilt adapter shipped by rediem would take.
 *
 * Both implement the optional navigation methods (`browseProducts`, `viewProduct`)
 * from the same shared code in `productNavigation.ts`, so the shopper lands in the
 * same place whichever one is selected here. The Storefront API adapter takes the
 * host's router as an optional dependency, exactly as it takes `openCart`: given one
 * it navigates client-side, and without one it loads the page. Only the Hydrogen
 * adapter requires a router, because everything else it does already assumes one.
 */
import {createHydrogenAdapter} from './hydrogenAdapter';
import {createStorefrontApiAdapter} from './storefrontApiAdapter';
import type {RediemCartAdapter} from './cartAdapter';
import type {HostNavigate} from './productNavigation';
import type {LoaderSourceCart} from './cartShape';

export type RediemCartAdapterChoice = 'hydrogen' | 'storefrontApi';

/**
 * DEVELOPER TOGGLE. Flip this between 'hydrogen' and 'storefrontApi' to swap
 * which adapter the widget runs against, then reload the storefront. Nothing
 * else needs to change.
 */
export const ACTIVE_REDIEM_CART_ADAPTER: RediemCartAdapterChoice = 'storefrontApi';

export interface RediemCartAdapterDependencies {
  /** The cart this storefront currently displays, or null before it resolves. */
  getCartData: () => LoaderSourceCart | null;
  /** Refresh the storefront's own cart UI after a widget-driven mutation. */
  revalidate: () => void;
  /** Reveal the cart to the shopper. */
  openCart: () => void;
  /** Navigate within this storefront through its own router, without a page reload. */
  navigate: HostNavigate;
  /** The Shopify domain the Storefront API is called on. */
  storeDomain: string;
  /** The public Storefront API access token. */
  publicStorefrontApiToken: string;
}

const HYDROGEN_CART_COOKIE_NAME = 'cart';

/**
 * Hydrogen keeps the cart id in a `cart` cookie holding only the id's last path
 * segment, and sets it without `httpOnly`, so the browser can read and write it.
 * A storefront that keeps its cart id out of reach of browser JavaScript would
 * expose a route for these two instead.
 */
function readCartIdCookie(): string | null {
  const match = document.cookie
    .split('; ')
    .find((entry) => entry.startsWith(`${HYDROGEN_CART_COOKIE_NAME}=`));
  if (!match) return null;
  const value = decodeURIComponent(match.slice(HYDROGEN_CART_COOKIE_NAME.length + 1));
  return value ? `gid://shopify/Cart/${value}` : null;
}

function adoptCartId(cartId: string, revalidate: () => void): void {
  const cookieValue = cartId.split('/').pop() ?? '';
  if (!cookieValue) return;
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  const encoded = encodeURIComponent(cookieValue);
  document.cookie = `${HYDROGEN_CART_COOKIE_NAME}=${encoded}; path=/; SameSite=Lax${secure}`;
  revalidate();
}

/**
 * Which adapter actually runs, given the configured choice and the credentials available to it.
 *
 * The Storefront API adapter authenticates every call with the public Storefront API token. An
 * empty token is not a degraded mode: Shopify rejects each request, so the shopper clicks a
 * reward and nothing happens, with no error anywhere in the page. Rather than build an adapter
 * that cannot work, report the missing token and run the Hydrogen adapter, which posts to this
 * storefront's own `/cart` route and needs no token. The widget keeps working, and the storefront
 * is never taken down for a shopper over a configuration mistake.
 */
export function resolveCartAdapterChoice({
  configuredChoice,
  publicStorefrontApiToken,
}: {
  configuredChoice: RediemCartAdapterChoice;
  publicStorefrontApiToken: string;
}): RediemCartAdapterChoice {
  if (configuredChoice !== 'storefrontApi') return configuredChoice;
  if (publicStorefrontApiToken.trim()) return configuredChoice;

  console.error(
    '[rediem] the public Storefront API token is empty, so every Storefront API cart call would ' +
      'fail authentication; check PUBLIC_STOREFRONT_API_TOKEN. Falling back to the Hydrogen cart adapter',
  );
  return 'hydrogen';
}

export function createRediemCartAdapter(
  dependencies: RediemCartAdapterDependencies,
): RediemCartAdapter {
  const {getCartData, revalidate, openCart, navigate, storeDomain, publicStorefrontApiToken} =
    dependencies;
  const choice = resolveCartAdapterChoice({
    configuredChoice: ACTIVE_REDIEM_CART_ADAPTER,
    publicStorefrontApiToken,
  });

  if (choice === 'hydrogen') {
    return createHydrogenAdapter({getCartData, revalidate, openCart, navigate});
  }

  return createStorefrontApiAdapter({
    storeDomain,
    publicAccessToken: publicStorefrontApiToken,
    // The root loader resolves no cart while it is empty, but the cookie still
    // names one, so fall back to it rather than creating a second cart.
    readCartId: () => getCartData()?.id ?? readCartIdCookie(),
    writeCartId: (cartId) => adoptCartId(cartId, revalidate),
    onCartRefreshed: () => revalidate(),
    openCart,
    navigate,
  });
}
