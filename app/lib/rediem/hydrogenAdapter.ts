/**
 * Hydrogen adapter for the rediem loader.
 *
 * The loader, fetched from rediem rather than vendored (see loaderUrl.ts), drives the cart through
 * an injected adapter rather than Shopify's Online-Store AJAX URLs. This adapter
 * targets Hydrogen's REAL cart directly: no `/cart.js` shim, no AJAX-cart
 * emulation. Mutations go through the storefront's own `/cart` CartForm action
 * (the same path Hydrogen's own add-to-cart buttons use); reads come from the
 * cart the root loader already resolved. The one small translation that remains,
 * mapping the Storefront cart into the shape the loader reads, is isolated in
 * `cartShape.ts` and disappears when the loader shape is neutralized upstream.
 *
 * Contract consumed by the loader core:
 *   getSession(), signIn({create}), getCart(), goToCart(), applyDiscountCode(code),
 *   addLine({id, quantity, properties}), changeLine({id, quantity}), onCartChanged(handler)
 *
 * Plus the two navigation methods the loader feature-detects rather than requires:
 *   browseProducts(), viewProduct({variantId})
 */
import {CartForm} from '@shopify/hydrogen';
import {gidToNumericId, toLoaderCart, type LoaderSourceCart} from './cartShape';
import {createProductNavigation, type HostNavigate} from './productNavigation';

type CartChangedHandler = (response: Response) => void | Promise<void>;

const CART_LINE_GID_PREFIX = 'gid://shopify/CartLine/';

/**
 * The loader is inconsistent about which identifier it sends to changeLine:
 * removeItemFromCart sends the cart line key, while both single-quantity enforcement
 * paths send item.variant_id. The Online Store adapter never had to care, because
 * /cart/change.js accepts either. Hydrogen's LinesUpdate takes only a CartLine gid and
 * answers 200 while changing nothing when handed anything else, so resolve it here.
 */
function resolveCartLineId(identifier: string | number, cart: LoaderSourceCart | null): string | null {
  const candidate = String(identifier);
  if (candidate.startsWith(CART_LINE_GID_PREFIX)) return candidate;

  const variantId = Number(candidate);
  if (!Number.isFinite(variantId)) return null;

  const lines = cart?.lines?.nodes ?? [];
  const lineHoldingVariant = lines.find((line) => gidToNumericId(line?.merchandise?.id) === variantId);
  return lineHoldingVariant?.id ?? null;
}

function unresolvedCartLineResponse(identifier: string | number): Response {
  return failureResponse({
    status: 422,
    statusText: 'Cart line not found',
    message: 'Could not update your cart',
    description: `No cart line matches the identifier ${String(identifier)}.`,
  });
}

function failureResponse({
  status,
  statusText,
  message,
  description,
}: {
  status: number;
  statusText: string;
  message: string;
  description: string;
}): Response {
  return new Response(JSON.stringify({message, description}), {
    status,
    statusText,
    headers: {'Content-Type': 'application/json'},
  });
}

function readFailureFields(rawBody: string): {message?: string; description?: string} {
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const body = parsed as {message?: unknown; description?: unknown; errors?: unknown};
    const firstError = Array.isArray(body.errors) ? body.errors[0] : undefined;
    const errorMessage =
      typeof firstError === 'object' && firstError !== null
        ? (firstError as {message?: unknown}).message
        : firstError;
    return {
      message: typeof body.message === 'string' ? body.message : undefined,
      description:
        typeof body.description === 'string'
          ? body.description
          : typeof errorMessage === 'string'
            ? errorMessage
            : undefined,
    };
  } catch {
    return {};
  }
}

/**
 * On a failed add the loader reads result.message and result.description and shows the
 * pair to the shopper. Shopify's /cart/add.js returns exactly that shape; Hydrogen's
 * /cart route does not, so without this the shopper is shown "undefined: undefined".
 */
async function asLoaderReadableFailure(response: Response): Promise<Response> {
  if (response.ok) return response;

  const rawBody = await response.text();
  const {message, description} = readFailureFields(rawBody);
  return failureResponse({
    status: response.status,
    statusText: response.statusText || 'Cart update failed',
    message: message ?? response.statusText ?? 'Could not add this item to your cart',
    description: description ?? rawBody.trim() ?? 'Please try again.',
  });
}

export interface HydrogenAdapterDeps {
  /** The cart the root loader has resolved, or null before it resolves. */
  getCartData: () => LoaderSourceCart | null;
  /** Re-run React Router loaders so the cart UI (and getCartData) refresh. */
  revalidate: () => void;
  /** Reveal the cart to the shopper (opens the cart drawer/aside). */
  openCart: () => void;
  /** Navigate within this storefront through its own router, without a page reload. */
  navigate: HostNavigate;
}

/** Post a CartForm action to the storefront's real /cart route. */
async function submitCartAction(action: string, inputs: Record<string, unknown>): Promise<Response> {
  const body = new FormData();
  body.append(CartForm.INPUT_NAME, JSON.stringify({action, inputs}));
  return fetch('/cart', {method: 'POST', body});
}

/** Wrap loader-shaped cart data as the JSON Response the rule engine reads. */
function loaderCartResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {'Content-Type': 'application/json'},
  });
}

export function createHydrogenAdapter({
  getCartData,
  revalidate,
  openCart,
  navigate,
}: HydrogenAdapterDeps) {
  let cartChangedHandler: CartChangedHandler | null = null;

  async function notifyCartChanged(response: Response): Promise<void> {
    if (!cartChangedHandler) return;
    try {
      await cartChangedHandler(response);
    } catch (error) {
      console.error('[rediem] cart-changed handler failed', error);
    }
  }

  const adapter = {
    // Read from the cart the root loader already resolved, mapped to the shape
    // the loader reads. No round-trip: Hydrogen keeps this current for us.
    async getCart() {
      return toLoaderCart(getCartData());
    },

    // Identity: our own same-origin route runs the server-side token exchange
    // with rediem (see app/routes/auth.rediem.me.tsx). The loader reaches it
    // through the adapter, never a hardcoded URL.
    async getSession(): Promise<Response> {
      return fetch('/auth/rediem/me', {
        method: 'GET',
        headers: {'Content-Type': 'application/json'},
      });
    },

    // Sign in: send the shopper to our Customer Account API login route with a
    // return path so Shopify's OAuth brings them back to this page. `create` is
    // ignored: the Customer Account API uses one screen for sign-in and sign-up.
    signIn(): void {
      const returnTo = window.location.pathname + window.location.search;
      window.location.href = `/account/login?return_to=${encodeURIComponent(returnTo)}`;
    },

    goToCart(): void {
      openCart();
      revalidate();
    },

    // "Show me everything I can spend points on" and "show me this reward product".
    // Both go through React Router, so the storefront's own catalogue and product
    // pages answer them with the widget and the cart drawer left standing. The
    // Hydrogen half of that is `navigate`; the destinations, the variant id guard
    // and the fallback when the router fails are shared with the Storefront API
    // adapter in productNavigation.ts so the two cannot drift apart.
    //
    // Hydrogen cannot route on a variant id — products are addressed by handle — so
    // /variants/<id> resolves it server-side and redirects, which React Router
    // follows client-side.
    ...createProductNavigation({navigate}),

    // cartDiscountCodesUpdate replaces the cart's whole code list rather than appending,
    // so sending the reward code alone silently drops any code the shopper typed in.
    async applyDiscountCode(code: string): Promise<Response> {
      const appliedCodes = (getCartData()?.discountCodes ?? [])
        .map((discount) => discount?.code)
        .filter((discountCode): discountCode is string => Boolean(discountCode));
      const discountCodes = appliedCodes.includes(code) ? appliedCodes : [...appliedCodes, code];

      const response = await submitCartAction(CartForm.ACTIONS.DiscountCodesUpdate, {discountCodes});
      revalidate();
      return response;
    },

    async addLine({
      id,
      quantity,
      properties,
    }: {
      id: string | number;
      quantity: number;
      properties?: Record<string, string>;
    }): Promise<Response> {
      const attributes = Object.entries(properties ?? {}).map(([key, value]) => ({key, value}));
      const rawResponse = await submitCartAction(CartForm.ACTIONS.LinesAdd, {
        lines: [{merchandiseId: `gid://shopify/ProductVariant/${id}`, quantity, attributes}],
      });
      const response = await asLoaderReadableFailure(rawResponse);
      revalidate();
      // The loader's rule engine skips enforcement when the add response has no
      // `.items` (matching Shopify's /cart/add.js, which returns just the line),
      // so hand it a marker object rather than the whole cart here.
      await notifyCartChanged(loaderCartResponse({id: String(id)}));
      return response;
    },

    async changeLine({
      id,
      quantity,
    }: {
      id: string | number;
      quantity: number;
    }): Promise<Response> {
      const cartLineId = resolveCartLineId(id, getCartData());
      if (!cartLineId) {
        // The two enforcement call sites ignore this return value, so without a warning
        // here a failed quantity enforcement would leave no trace anywhere.
        console.warn('[rediem] no cart line matches the identifier sent to changeLine', String(id));
        return unresolvedCartLineResponse(id);
      }

      const response =
        quantity <= 0
          ? await submitCartAction(CartForm.ACTIONS.LinesRemove, {lineIds: [cartLineId]})
          : await submitCartAction(CartForm.ACTIONS.LinesUpdate, {
              lines: [{id: cartLineId, quantity}],
            });
      revalidate();
      // A change returns the whole cart (Shopify's /cart/change.js does too), so
      // the loader re-runs its reward-line enforcement against the fresh cart.
      await notifyCartChanged(loaderCartResponse(toLoaderCart(getCartData())));
      return response;
    },

    onCartChanged(handler: CartChangedHandler): void {
      cartChangedHandler = handler;
    },
  };

  return adapter;
}

export type HydrogenAdapter = ReturnType<typeof createHydrogenAdapter>;
