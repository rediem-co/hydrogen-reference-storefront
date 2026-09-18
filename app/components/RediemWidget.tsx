import {useEffect, useMemo, useRef} from 'react';
import {
  useLocation,
  useNavigate,
  useRevalidator,
  useRouteLoaderData,
} from 'react-router';
import {useAside} from '~/components/Aside';
import {createRediemCartAdapter} from '~/lib/rediem/cartAdapterSelection';
import type {LoaderSourceCart} from '~/lib/rediem/cartShape';
import type {RootLoader} from '~/root';

/**
 * Logged-in customer identity for the rediem widget. All fields optional except
 * the numeric `id`. Sourced from the Customer Account API in the root loader.
 * When absent, the widget renders in guest mode.
 */
export type RediemCustomer = {
  /** Numeric Shopify customer id (parsed from the GID), e.g. "123". */
  id: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  /** Comma-joined customer tags. */
  tags?: string | null;
};

type RediemWidgetProps = {
  /** The myshopify store domain, e.g. "andreas-headless.myshopify.com". */
  shopDomain: string;
  /**
   * Where the loader is fetched from, resolved by `resolveLoaderUrl` in the root loader. There is
   * deliberately no default here: the Content-Security-Policy is built from that same resolver, so
   * a default of our own could name an origin the policy does not allow. Undefined means the
   * storefront is not configured for rediem, and no loader is injected.
   */
  loaderSrc?: string;
  /** Logged-in customer, or null/undefined for guests. */
  customer?: RediemCustomer | null;
};

/**
 * Embeds the rediem Dash widget into the headless storefront. Renders the
 * `#rdmWidgetLoadDiv` mount node the loader looks for and injects the loader
 * script, then boots it in *manual-mount* mode (`data-rdm_manual="true"`) with a
 * cart adapter, so cart/discount/reward operations run against the Storefront
 * API and update the UI reactively (via React Router revalidation and the cart
 * drawer) instead of doing a full page reload.
 *
 * Which adapter is bound is chosen by `ACTIVE_REDIEM_CART_ADAPTER` in
 * `app/lib/rediem/cartAdapterSelection.ts`.
 *
 * Must be rendered inside `Aside.Provider` (i.e. within `PageLayout`) because the
 * adapter's `goToCart()` uses `useAside()` to open the cart drawer.
 *
 * The loader keys off `data-rdm_id` to decide guest vs. member; the rediem JWT is
 * NOT placed here — the loader fetches it (and the rest of the customer object)
 * from the same-origin `/auth/rediem/me` route, which the adapter's
 * getSession() points at (the merchant owns this path).
 */
export function RediemWidget({
  shopDomain,
  loaderSrc,
  customer,
}: RediemWidgetProps) {
  const revalidator = useRevalidator();
  const {open} = useAside();
  const location = useLocation();
  const navigate = useNavigate();

  // Refs so the adapter (created once) always calls the latest hook values
  // without being recreated (which would re-mount the loader).
  const revalidateRef = useRef(revalidator.revalidate);
  revalidateRef.current = revalidator.revalidate;
  const openRef = useRef(open);
  openRef.current = open;
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  // The root loader resolves the cart (a promise); keep the latest resolved cart
  // in a ref so the adapter can read it synchronously. The promise identity
  // changes on every revalidation, so re-resolving on that keeps the ref fresh
  // after a widget-driven mutation.
  const rootData = useRouteLoaderData<RootLoader>('root');
  const cartPromise = rootData?.cart;
  const cartRef = useRef<LoaderSourceCart | null>(null);
  useEffect(() => {
    let cancelled = false;
    Promise.resolve(cartPromise).then((resolved) => {
      if (!cancelled)
        cartRef.current = (resolved as LoaderSourceCart | null) ?? null;
    });
    return () => {
      cancelled = true;
    };
  }, [cartPromise]);

  // Which implementation this resolves to is decided by ACTIVE_REDIEM_CART_ADAPTER
  // in app/lib/rediem/cartAdapterSelection.ts.
  // An absent token is a configuration mistake, not a mode: createRediemCartAdapter reports it
  // and falls back to the adapter that needs no token, rather than building one whose every call
  // fails authentication with nothing visible in the page.
  const publicStorefrontApiToken = rootData?.consent?.storefrontAccessToken ?? '';
  const adapter = useMemo(
    () =>
      createRediemCartAdapter({
        getCartData: () => cartRef.current,
        revalidate: () => revalidateRef.current(),
        openCart: () => openRef.current('cart'),
        // Client-side navigation: a reward that sends the shopper to a product must
        // not reload the page, which would tear down the widget mid-flow. React Router
        // resolves the navigation asynchronously, so hand the promise back rather than
        // dropping it — the adapter falls back to a page load if it rejects.
        navigate: (path: string) => navigateRef.current(path),
        storeDomain: shopDomain,
        publicStorefrontApiToken,
      }),
    [shopDomain, publicStorefrontApiToken],
  );

  // Boot the loader with our adapter once its mount API is available. The loader
  // script is `defer`, so it may not have run yet when this effect first fires;
  // poll briefly until `window.rediem.mount` exists. mount() is idempotent.
  useEffect(() => {
    let cancelled = false;
    const boot = () => {
      if (cancelled) return;
      const rediem = (
        window as unknown as {rediem?: {mount?: (options: unknown) => void}}
      ).rediem;
      if (rediem?.mount) {
        rediem.mount({adapter});
        return;
      }
      window.setTimeout(boot, 50);
    };
    boot();
    return () => {
      cancelled = true;
    };
  }, [adapter]);

  // Load the loader AFTER hydration, never as server-rendered JSX.
  //
  // The loader injects its stylesheet into document.head synchronously when it runs. A
  // <script> in the returned markup is server-rendered, so with `defer` it executes around
  // the same time React hydrates: React then finds a <head> it did not render, fails
  // hydration (error #418) and reconciles the DOM back to its own tree, taking the
  // stylesheet with it. The widget renders unstyled and fills the screen. Whoever wins that
  // race decides, which is why the symptom is intermittent and a hard reload appears to
  // "fix" it.
  //
  // Creating the element in an effect runs it strictly after hydration, so there is no race.
  // Any SSR framework has this hazard, not just React Router.
  useEffect(() => {
    if (!loaderSrc) return;
    if (document.querySelector(`script[data-rediem-loader="${loaderSrc}"]`)) return;

    const script = document.createElement('script');
    script.src = loaderSrc;
    script.defer = true;
    script.setAttribute('data-rediem-loader', loaderSrc);
    document.body.appendChild(script);
  }, [loaderSrc]);

  // Re-evaluate hideOn/showOn on SPA navigation. The loader captures the path
  // only at boot; on client-side nav it must be told to re-check its visibility.
  // Safe no-op before the loader has booted (optional chaining).
  useEffect(() => {
    const rediem = (
      window as unknown as {rediem?: {refreshVisibility?: () => void}}
    ).rediem;
    rediem?.refreshVisibility?.();
  }, [location.pathname]);

  return (
    <>
      <div
        id="rdmWidgetLoadDiv"
        data-rdm_domain={shopDomain}
        // Opt out of the loader's auto-boot; we mount() explicitly with the
        // selected cart adapter in the effect above.
        data-rdm_manual="true"
        {...(customer?.id ? {'data-rdm_id': customer.id} : {})}
        {...(customer?.email ? {'data-rdm_email': customer.email} : {})}
        {...(customer?.firstName
          ? {'data-rdm_firstName': customer.firstName}
          : {})}
        {...(customer?.lastName
          ? {'data-rdm_lastName': customer.lastName}
          : {})}
        {...(customer?.phone ? {'data-rdm_phone': customer.phone} : {})}
        {...(customer?.tags ? {'data-rdm_tags': customer.tags} : {})}
      />
    </>
  );
}
