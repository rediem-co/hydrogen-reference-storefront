/**
 * The two navigation intents the rediem widget posts, implemented once for every adapter.
 *
 * The widget knows where it wants the shopper to go ("show me everything I can spend points
 * on", "show me this reward product") but not how this storefront's routes are built, so it
 * posts the intent and the host decides how to satisfy it. The rediem loader feature-detects
 * `browseProducts` and `viewProduct`; when an adapter leaves them out it replaces the parent
 * page's location with the Online Store URLs `/collections/all` and `/variants/<id>`, which
 * reloads the storefront and tears the widget and the cart drawer down mid-flow.
 *
 * Both adapters in this folder share this implementation rather than each writing their own,
 * so which adapter `cartAdapterSelection.ts` binds changes how the navigation is performed,
 * never where the shopper ends up.
 *
 * Failure is handled here rather than reported upwards, because there is nowhere to report
 * it to: the loader calls these methods and forgets them — no return value is read, no
 * promise awaited, no timeout set. A method that threw or quietly did nothing would leave
 * the shopper pressing a button with no response and nothing in the page to explain it. So a
 * router that fails is logged and the destination is loaded the slow way instead: a full page
 * load costs the widget its state, which is still better than the shopper going nowhere.
 */

/** This storefront's catalogue route (app/routes/($locale).collections.all.tsx). */
export const ALL_PRODUCTS_PATH = '/collections/all';

/** Resolves a numeric variant id to its product page (app/routes/($locale).variants.$variantId.tsx). */
export const VARIANT_PATH_PREFIX = '/variants/';

/**
 * A client-side navigation performed by the host storefront's own router. React Router's
 * `useNavigate` resolves a promise rather than finishing synchronously, so the return value
 * is awaited when there is one: a navigation can fail after the call has already returned.
 */
export type HostNavigate = (path: string) => void | Promise<unknown>;

export interface ProductNavigationDependencies {
  /** Omit it and both methods fall back to a full page load, which any browser host can do. */
  navigate?: HostNavigate;
  /** Where "show me everything" goes. Defaults to this storefront's catalogue route. */
  allProductsPath?: string;
  /** Prefixed to a numeric variant id. Defaults to this storefront's variant resolver route. */
  variantPathPrefix?: string;
}

export interface ProductNavigation {
  browseProducts(): void;
  viewProduct(input: {variantId: string | number}): void;
}

function loadWholePage(path: string): void {
  if (typeof window === 'undefined') {
    console.error('[rediem] cannot navigate outside a browser', path);
    return;
  }
  window.location.assign(path);
}

function reportFailedNavigation(path: string, error: unknown): void {
  console.error(
    `[rediem] the storefront router could not navigate to ${path}; loading the page instead`,
    error,
  );
  loadWholePage(path);
}

async function settleNavigation(navigation: Promise<unknown>, path: string): Promise<void> {
  try {
    await navigation;
  } catch (error) {
    reportFailedNavigation(path, error);
  }
}

function isPromise(value: unknown): value is Promise<unknown> {
  return typeof value === 'object' && value !== null && typeof (value as Promise<unknown>).then === 'function';
}

function goTo(navigate: HostNavigate | undefined, path: string): void {
  if (!navigate) {
    loadWholePage(path);
    return;
  }

  try {
    const navigation = navigate(path);
    if (isPromise(navigation)) void settleNavigation(navigation, path);
  } catch (error) {
    reportFailedNavigation(path, error);
  }
}

/**
 * The path that resolves this variant to its product page, or null when the id cannot
 * address one.
 *
 * The loader reduces a variant gid to a positive integer before calling, so anything else
 * is a defect on the way in rather than something a shopper did. There is no useful place
 * to send them: `/variants/undefined` would only replace a button that does nothing with
 * the catch-all 404 page, so the caller logs the id and stays put.
 */
function productVariantPath(variantId: string | number, variantPathPrefix: string): string | null {
  const numericVariantId = Number(variantId);
  if (!Number.isInteger(numericVariantId) || numericVariantId <= 0) return null;
  return `${variantPathPrefix}${numericVariantId}`;
}

export function createProductNavigation({
  navigate,
  allProductsPath = ALL_PRODUCTS_PATH,
  variantPathPrefix = VARIANT_PATH_PREFIX,
}: ProductNavigationDependencies): ProductNavigation {
  return {
    browseProducts(): void {
      goTo(navigate, allProductsPath);
    },

    viewProduct({variantId}: {variantId: string | number}): void {
      const path = productVariantPath(variantId, variantPathPrefix);
      if (!path) {
        console.warn('[rediem] viewProduct was given no usable variant id', String(variantId));
        return;
      }
      goTo(navigate, path);
    },
  };
}
