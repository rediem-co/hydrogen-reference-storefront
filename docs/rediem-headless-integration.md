# Integrating the rediem widget into a headless storefront

This document is grounded in the reference integration shipped in this repository; every claim points at a real file you can read.

## 1. Architecture overview

The rediem widget is delivered as three cooperating pieces:

1. **The loader** — a vanilla-JS IIFE that runs in the host page, published by rediem and served from the CDN channel you embed. It injects the launch button and an `<iframe>`, brokers `postMessage` traffic between the page and the widget, fetches the merchant's store settings and the shopper's identity, and applies a few cart rules itself (required-paid-product enforcement, per-cart limits, discount application).

2. **An adapter** — a small object the loader calls for every cart/navigation/discount operation. The loader ships with a built-in default adapter (`onlineStoreAdapter`) that targets a Shopify Liquid Online Store. A headless host supplies its **own** adapter via `window.rediem.mount({ adapter })`. The adapter is the entire seam between "what the widget wants done to the cart" and "how this particular storefront does it."

3. **The widget itself** — a separate web app loaded into the `<iframe>` (a different origin). It renders the loyalty UI and communicates with the loader by `postMessage`, sending intents like `rediem:cart:applyDiscount` or `rediem:cart:redeemProductReward`.

```
  Host page (your storefront)
  ┌───────────────────────────────────────────────┐
  │  loader (rediem-dash.js)   ── postMessage ──▶  │
  │     │  calls                          ┌────────┴───────┐
  │     ▼                                 │  widget iframe  │
  │  adapter (yours or default)           │  (rediem app)   │
  │     │  cart / discount / identity     └────────┬───────┘
  │     ▼                          ◀── postMessage ─┘
  │  your commerce backend (Storefront API, etc.)  │
  └───────────────────────────────────────────────┘
```

**Online Store default vs. custom adapter.** On a Liquid store the merchant injects only the loader script (by installing the rediem application); it auto-boots and uses `onlineStoreAdapter`, which drives the cart through Shopify's AJAX Cart API (`/cart.js`, `/cart/add.js`, `/cart/change.js`, `/discount/<code>`) and navigates with full page reloads. In a headless storefront those endpoints do not exist and full reloads defeat the point of an SPA, so you opt out of auto-boot and pass a custom adapter that talks to your commerce backend and updates the UI in place.

### Where the default adapter lives (important)

There is **no separate source file** for the default adapter. It is an **object literal named `onlineStoreAdapter` defined inside the loader itself**. The loader selects it as a fallback on a single line:

```js
const adapter = (mountOptions && mountOptions.adapter) || onlineStoreAdapter;
```

So when you call `window.rediem.mount({ adapter: yourAdapter })`, your object fully replaces `onlineStoreAdapter`; when you mount with no adapter (or the theme auto-boots), the built-in one is used. The reference you copy is the **Hydrogen adapter** (`app/lib/rediem/hydrogenAdapter.ts`); `onlineStoreAdapter` is just rediem's internal fallback for Liquid themes. Either way your adapter must expose the same method names and honor the same input/output shapes.

## 2. The adapter contract

**Who writes the adapter.** You do. rediem provides reference implementations you copy into your project and adapt, rather than a package you install, because the framework owns your cart's identity and your login route and there is always a binding step. This repository has two: `app/lib/rediem/storefrontApiAdapter.ts` talks to the Shopify Storefront API directly, and `app/lib/rediem/hydrogenAdapter.ts` posts to Hydrogen's own cart route. Copy whichever matches how your cart already works. A storefront with a non-Shopify cart implements the contract below itself.

Your adapter is a plain object with **eight** required methods, plus **two optional** navigation ones the loader feature-detects (`browseProducts`, `viewProduct`). The loader calls them; you implement them. Both reference adapters in this repository implement it. (rediem also has a built-in default, `onlineStoreAdapter`, for Liquid Online Stores; that one is internal — you don't copy it, though it honors the same contract if you want to compare.)

### What the loader does with your cart

You return a cart; the loader works out everything it needs from it — which lines are rewards, whether a paid item is present, which discount codes are applied, and so on. You never build, see, or implement that derived state; your only job is to return an accurate cart.

Two things to preserve in the cart you return: keep value types exact (`variant_id` stays a **number**), and persist whatever `properties` rediem puts on a line via `addLine` and return them again from `getCart` — that is how rediem recognizes its own reward lines. (Shopify's Storefront API calls line properties **attributes**.)

### Methods

| Method | Signature | What it must do |
| --- | --- | --- |
| `getSession()` | `() => Promise<Response>` | Fetch the shopper's rediem session (identity). Returns a fetch-`Response` whose body is the `{ data }` the loader reads (rediem token + customer object). Online-Store: `fetch('/apps/next-proxy')`; a headless adapter points it at a route the merchant owns (this storefront: `fetch('/auth/rediem/me')`). See §4. |
| `signIn({create})` | `(options?) => void` | Start the shopper's sign-in flow. The widget's Sign In / Join Now buttons post an intent; the loader calls this. Online-Store: navigate to `/account/login` (or `/account/register` when `create`). Headless: redirect to your login route with a return path — this storefront uses `/account/login?return_to=<current>`, which Shopify's Customer Account API honors so the shopper lands back on the same page. `create: true` hints "new account" (the Customer Account API merges sign in and sign up). No return value. |
| `getCart()` | `() => Promise<RediemCart>` | Return the current cart as a **RediemCart** — an object with an `items` array; each item has `id`, `variant_id` (number), `quantity`, `properties`, `final_line_price` (integer cents), `discounts:[{title}]`. That is the full set the loader reads; it works out everything it needs from this. Online-Store: `fetch('/cart.js')`. |
| `goToCart()` | `() => void` | Take the shopper to their cart. Online-Store: `window.location.href = '/cart'`. Headless: open the cart drawer and revalidate — **do not** hard-navigate. |
| `applyDiscountCode(code)` | `(code) => Promise<Response>` | Apply a discount code to the cart. Online-Store: `fetch('/discount/<code>')`. |
| `addLine({id, quantity, properties})` | `=> Promise<Response>` | Add a line. `id` is a **numeric variant id**; `properties` is a flat string map you MUST persist as line attributes and return again from `getCart` (rediem's own reward markers ride here — you don't need to interpret them). **Must return a fetch-`Response`-like object** — the loader reads `response.ok` and, on failure, `await response.json()` for `{message, description}`. |
| `changeLine({id, quantity})` | `=> Promise<Response>` | Change/remove a line; `id` is the **line key** from `getCart()` (not the variant id); `quantity: 0` means remove. Same `Response`-like return contract. |
| `browseProducts()` | `() => void` | **Optional.** Show the shopper everything available to buy. Online-Store: `/collections/all`. Headless: navigate to your own catalogue route through your router — this storefront navigates to `/collections/all`, which it happens to serve too. When you omit this method the loader falls back to a `window.location.replace('/collections/all')`, which reloads the page and tears the widget down mid-flow. |
| `viewProduct({variantId})` | `({variantId}) => void` | **Optional.** Show the shopper one product variant. `variantId` is a **number** (the loader has already reduced the variant gid for you). Online-Store: `/variants/<id>`, which Shopify redirects to the product page. Headless: you have to resolve the variant id to a product yourself, because Hydrogen and most headless routers address products by handle — this storefront navigates to its own `/variants/<id>` route, which looks the variant up through the Storefront API and redirects to `/products/<handle>?<Option>=<Value>`. When you omit this method the loader falls back to `window.location.replace('/variants/<id>')`, which is a 404 on a storefront that does not serve that path. |
| `onCartChanged(handler)` | `(handler) => void` | Register the callback rediem invokes after each cart change. Whenever the cart mutates, call `handler(response)` with a fetch-`Response`-like object such that `response.clone().json()` yields a **RediemCart-shaped** object. Online-Store implements this by monkey-patching `window.fetch` and watching the cart endpoints; a headless adapter simply calls the handler itself after each mutation. |

**The storefront owns its routes.** The widget used to build an absolute Shopify URL out of the store domain and replace the parent page's location with it. On an Online Store that is harmless, because the parent page *is* the theme; on a headless storefront it throws the shopper onto the `.myshopify.com` domain, which usually looks nothing like the storefront and is often password protected. `browseProducts` and `viewProduct` exist so the storefront decides where those two intents lead. The loader's fallbacks are Online Store URL shapes (`/collections/all`, `/variants/<id>`), so check that your storefront actually serves them before relying on them — this one serves both, the second only because `app/routes/($locale).variants.$variantId.tsx` was added for exactly that. Both adapters in this repository implement the two methods, from one shared module (`app/lib/rediem/productNavigation.ts`), so the shopper lands in the same place whichever adapter `app/lib/rediem/cartAdapterSelection.ts` binds and the reloading fallbacks are never reached here. The framework-agnostic adapter takes the host's router as an optional dependency: a storefront that has none still navigates, by full page load.

**The `Response`-like contract matters.** `addLine`/`changeLine` return values are treated as `fetch` responses by the loader: `.ok`, `.json()`, and (for the cart-changed handler) `.clone().json()`. If your transport is not literally `fetch`, wrap the result so those methods exist and behave. In this storefront the adapter returns real `fetch` responses because the transport is same-origin resource routes (see §6).

**Add vs. change response shapes.** Shopify's real `/cart/add.js` returns the *single added line* (no `.items`), while `/cart/change.js` returns the *whole cart*. The loader relies on that distinction: after an add, the facts the loader derives have no `lineItems` and cart-wide enforcement no-ops; after a change, enforcement runs over the full cart. Your emulation/transport should preserve this (this storefront does — see `app/routes/cart.add[.]js.tsx` vs `app/routes/cart.change[.]js.tsx`).

### The `rediem:cart:*` postMessage intents

The widget sends these to the loader; the loader turns them into adapter calls. You do not handle these directly, but knowing them explains what the adapter is driving:

- `rediem:cart:redeemProductReward` → `addLine` + coupon mint + `goToCart`
- `rediem:cart:redeemFreeProduct` → multi-`addLine` + coupon + `goToCart`
- `rediem:cart:redeemSubscriptionReward` → multi-`addLine` (subscription) + coupon + `goToCart`
- `rediem:cart:addExclusive` → `addLine` + `goToCart`
- `rediem:cart:applyDiscount` → `applyDiscountCode` + `goToCart`

(These names were standardized on the `rediem:cart:*` prefix across the loader, the widget send-sites, and the characterization tests.)

**The loader reports success, and closes the widget.** After any of the five cart actions above completes, the loader posts `rediem:cart:actionSucceeded` back to the widget and then closes it. You implement nothing for either. The success message is what clears a reward card's in-progress state, and closing matters on a storefront whose cart is a drawer, where nothing navigates away and the widget would otherwise sit on top of the cart the shopper just changed.

If your storefront is designed for the widget and the drawer to sit side by side, reopen it with `window.rediem.open()`. That and `window.rediem.close()` are the host-facing controls, and they are also how you trigger the widget from your own navigation, a points banner or a deep link.

Navigation intents follow the same pattern under a `rediem:storefront:*` prefix:

- `rediem:storefront:browseProducts` → `browseProducts()`, or `window.location.replace('/collections/all')` when the adapter has no such method
- `rediem:storefront:viewProduct` → `viewProduct({variantId})`, or `window.location.replace('/variants/<id>')` when the adapter has no such method

## 3. Mounting

1. Render the mount node the loader looks for, `#rdmWidgetLoadDiv`, and set **`data-rdm_manual="true"`** on it to opt out of auto-boot. Also set `data-rdm_domain` to the store's primary domain as recorded in rediem, not the myshopify domain, and, for a logged-in shopper, `data-rdm_id` to the numeric customer id (its presence is how the loader decides guest vs. member).
2. Load the loader script from rediem's CDN channel (see §6).
3. Once `window.rediem.mount` exists, call `window.rediem.mount({ adapter })` with your adapter.

`mount()` is **idempotent** — it boots exactly once per page load and ignores subsequent calls, so polling for `window.rediem.mount` and calling it is safe. Because the script may be `defer`red and not yet executed when your component mounts, poll briefly until `window.rediem.mount` is defined. See `app/components/RediemWidget.tsx` for the reference (a `useMemo` adapter kept stable via refs, plus a `setTimeout` boot loop).

**SPA route changes.** The loader evaluates the merchant's `hideOn`/`showOn` visibility rules against the URL, and on a full-reload store it only needs to do this once. In an SPA the URL changes without a reload, so the loader exposes `window.rediem.refreshVisibility()`. Call it on every client-side navigation. In this storefront that is a `useEffect` keyed on `location.pathname` (`RediemWidget.tsx`). `refreshVisibility` toggles the `hide-rediem-btn` body class both ways against the live path.

## 4. Identity

The loader obtains the shopper's rediem token (and the rest of the customer object) through the adapter's `getSession()`, which fetches a **same-origin** route your storefront owns. You choose the path (this storefront uses `GET /auth/rediem/me`); the loader never dictates it. A headless storefront has no Shopify App Proxy, so you provide that route yourself. It must, **server-side**:

1. Confirm the shopper is logged in (here: Shopify Customer Account API).
2. Obtain their Customer Account access token.
3. POST that token, together with your storefront's origin (`storefrontOrigin`, the bare scheme and host of the page the shopper is on), to rediem's session exchange (`POST /api/headless/sessions` on rediem's storepanel host), presenting the store's **rediem credential** as a `Bearer` token. Shopify's Customer Account API only honours the token when the verifying request carries an Origin from your storefront client's registered JavaScript origins, which is why rediem needs it. The credential is what identifies the store; nothing in the body is trusted for that. Rediem independently re-verifies the shopper's token against Shopify's Customer Account API (it never trusts a client-supplied customer id), then mints and returns the rediem JWT in a `{ data }` envelope.
4. Return that `{ data }` verbatim to the loader, with `Cache-Control: no-store`.

Reference: `app/routes/auth.rediem.me.tsx` does the exchange, and the adapter's `getSession()` points at it. On rediem's side the exchange verifies the credential against its hashed record, calls the Customer Account API, then enrolls or loads the customer the same way the Online Store auth path does.

**The access token and the credential never reach the browser.** The token is read server-side from the customer session; the credential lives in server env (`REDIEM_CREDENTIAL`) and is sent server-to-server in the `Authorization: Bearer` header. Rediem stores only a hash of it. A refused exchange (401 with a `code` such as `REVOKED`, `RETIRED`, or `INVALID_CUSTOMER_TOKEN`) is logged by the route and answered with an empty 204, so the widget renders in guest mode; check the storefront's server logs if members stop seeing their balance.

**Credential rotation.** A store may hold two active credentials at once, so rotation is: rediem issues a new one, you deploy it, then rediem retires the old one. Nothing expires on a timer, so there is no deadline to work to and no window where neither credential is valid. A retired credential answers 401 with `RETIRED`.

### Logout and identity change

Signing out (or switching accounts) must not let one shopper's rewards carry into the next session. Responsibility here is **split**, because the reward artifacts live in two places with two different owners — and at time of writing one half is implemented and the other is a **known gap**.

A logout needs to clean up three things:

1. Reward **lines** in the cart — cart lines carrying `_rediem_*` attributes, added by reward redemptions.
2. Rediem **discount codes** applied to the cart — order-discount rewards leave a code, not a line.
3. The loader's **client-side state** in `sessionStorage` — the rediem JWT (`user_<domain>`) plus the reward-in-progress keys (`discount_code`, `cartFlags`, `freeProducts`, `freeProductsSubscription`, `previousCartItemIds`).

**Merchant's responsibility — only they can do it.** Only the storefront can mutate its own cart, so the merchant must strip the reward lines and discount codes on logout, before ending the session. Reference: `app/routes/($locale).account_.logout.tsx` → `clearRediemRewards()` removes lines whose attributes start with `_rediem_` and clears the cart's discount codes, then calls `customerAccount.logout()`. (This storefront intentionally leaves ordinary, non-reward items; whether the *general* cart empties on logout is a merchant policy choice, not a rediem concern.)

**Rediem's responsibility — the loader owns its own state.** The merchant must not reach into the loader's `sessionStorage` keys; the loader owns them. **Current state:** on the next boot after logout (no `data-rdm_id`) the loader clears the JWT (`user_<domain>`). A stored `discount_code` is a one-shot hand-off that survives the redirect to the cart and is cleared as soon as it has been applied, so a code the shopper removed by hand is no longer re-applied on the next page load. The reward-in-progress keys (`cartFlags`, `freeProducts`, `freeProductsSubscription`, `previousCartItemIds`) are cleared as their flows complete rather than on logout; a shopper who logs out mid-redemption can leave one behind for the next session on the same browser. **Known gap**, tracked on rediem's side.

**Planned shape.** Logout should be an explicit signal, not something the loader infers from a missing `data-rdm_id` at the next boot. The design is a lifecycle hook the host calls on logout (for example `window.rediem.signOut()`) that wipes all loader state in one place — the same host→loader pattern as `refreshVisibility()` (§3). Until it ships, the contract is: the merchant clears the cart server-side, and the loader clears its own client state on the next boot as described above.

**Server-side backstop.** Minting reward discount codes as customer-bound or single-use bounds the blast radius even if a cleanup step is missed, so cart-clearing is not the only line of defense. This is a rediem-side hardening, independent of the above.

## 5. CSP requirements

The widget is an iframe from a different origin and the loader makes cross-origin calls, so your Content-Security-Policy must allow them. Reference: `app/entry.server.tsx`, which builds every entry below from the `REDIEM_*` environment variables so the same code deploys against rediem's sandbox or production.

- **script-src**: the origin the loader is served from. Both this entry and the script tag read `resolveLoaderUrl` in `app/lib/rediem/loaderUrl.ts`, which returns `REDIEM_LOADER_URL` when set and otherwise selects the loader build matching the environment named by `REDIEM_API_URL`. Deriving it from one place is deliberate: if the policy and the script tag ever named different origins, the browser would block the loader with nothing in the page to explain why.
- **frame-src / child-src**: the widget iframe origin (`REDIEM_WIDGET_URL`) plus `'self'`. These directives have no defaults, so list `'self'` explicitly.
- **connect-src**: the rediem API origin (`REDIEM_API_URL`), the rediem app backend the loader talks to (the origin of `REDIEM_EXCHANGE_URL`), and the asset origin the loader fetches the store-settings JSON from (`REDIEM_ASSET_URL`).
- **style-src**: the loader carries the widget's page-level stylesheet inside itself and injects it as an inline `<style>` element, the same way Stripe.js, the PayPal SDK and Google Maps ship theirs, so no stylesheet host needs allowing. Your policy must permit inline styles for that element to apply: either `'unsafe-inline'` in `style-src` (Hydrogen's default, and what this storefront sets) or a nonce or hash scheme that you extend to the loader's element. A policy that forbids inline styles with no allowance will silently drop the widget's styling. The loader also `@import`s a Google Fonts stylesheet, so allow `https://fonts.googleapis.com`.
- **font-src**: `https://fonts.gstatic.com` for the Google Fonts files, plus `'self'` and `data:`.
- **img-src**: the launch-button icon and API-served imagery (`REDIEM_ASSET_URL`, the rediem API origin, `cdn.shopify.com`, `data:`).

## 6. Step-by-step integration guide

Using this storefront as the worked example:

1. **Embed the loader.** rediem gives you one loader URL per environment (sandbox for your staging site, production for launch). Set it as `REDIEM_LOADER_URL`; the mount component (§3) renders the script tag from it. Leave it unset and the build is derived from the environment `REDIEM_API_URL` names, so a sandbox storefront cannot end up running the production loader. Do not copy the file into your repository: the URL is how fixes reach your shoppers without a redeploy on your side.
2. **Write your adapter.** Implement the eight methods in §2 against your commerce backend. Make sure `addLine`/`changeLine` return `Response`-like objects and that `onCartChanged` feeds a RediemCart-shaped `response`. See `app/lib/rediem/hydrogenAdapter.ts`.
3. **Bind the adapter to your cart.** The Hydrogen adapter posts `CartForm` actions to the storefront's own `/cart` route for every mutation (lines add, update, remove, discount codes) and reads the cart back from the root loader's data, so the widget mutates the same cart your storefront renders. `app/lib/rediem/cartShape.ts` maps Hydrogen's cart to the shape the loader reads. On another framework the same two things are needed: a way to submit cart mutations to your existing cart layer, and a way to read the current cart and refresh your UI afterwards.
4. **Wire identity.** Add the same-origin identity route your adapter's `getSession()` points at (this storefront: `/auth/rediem/me`) that does the server-side token exchange. See §4 and `app/routes/auth.rediem.me.tsx`.
5. **Render the mount component.** Create a component like `app/components/RediemWidget.tsx`: render `#rdmWidgetLoadDiv` with `data-rdm_manual="true"`, `data-rdm_domain`, and (when logged in) `data-rdm_id`; create the loader `<script defer>` **in an effect rather than in your returned markup**, so it runs after hydration and cannot race it; poll for `window.rediem.mount` and call it with your adapter; call `refreshVisibility()` on route change.
6. **Render it in the right place.** The adapter's `goToCart()` opens the cart drawer, so the component must render inside whatever provider owns the drawer. Here that is `Aside.Provider`, so `RediemWidget` renders inside `PageLayout` (`app/components/PageLayout.tsx`), and the logged-in customer is loaded in `app/root.tsx` and threaded down as `rediemCustomer`.
7. **Set the CSP.** Add the script/frame/connect/style/font/img entries from §5 (`app/entry.server.tsx`), and make sure `style-src` permits the loader's inline stylesheet.
8. **Configure env.** Storefront: `REDIEM_EXCHANGE_URL`, `REDIEM_CREDENTIAL`, `REDIEM_WIDGET_URL`, `REDIEM_API_URL` and `REDIEM_ASSET_URL` (origins the Content Security Policy in `app/entry.server.tsx` allows for the widget iframe, its API calls, and the settings and imagery the loader fetches), and optionally `REDIEM_LOADER_URL` (the loader URL rediem gives you for the environment; without it the loader build is derived from `REDIEM_API_URL`, and with neither set no loader is injected at all and the widget does not appear). The credential is issued by rediem per store and per environment (a sandbox credential only works against the sandbox exchange); ask rediem for one.

## Appendix A. The React-based integration pattern

Section 6 step 6 says the mount component "must render inside whatever provider owns the drawer." This section explains *why*, using React as the concrete example. The underlying mechanism is **scoped dependency injection** — React calls it *context*; other frameworks spell it `provide`/`inject` (Vue), hierarchical DI (Angular), or `setContext`/`getContext` (Svelte). The idea is universal: a component high in the tree publishes a value, and any component nested beneath it reads that value directly instead of receiving it through props at every intermediate level. Crucially, the value is visible only to **descendants** of the publisher — not to siblings or ancestors.

In this storefront the cart drawer's open/close state is published by `Aside.Provider` and consumed by the rediem adapter through `useAside()`. The reference is `app/components/Aside.tsx`, which has four parts that chain together:

**1. The context object (the "pipe").**
```tsx
const AsideContext = createContext<AsideContextValue | null>(null);
```
`createContext` makes a context object with a built-in write-end, `AsideContext.Provider`. The `null` is the fallback value returned to a consumer that has no provider above it.

**2. `Aside.Provider` — the writer (holds state, writes it into the pipe).**
```tsx
Aside.Provider = function AsideProvider({children}) {
  const [type, setType] = useState<AsideType>('closed'); // which drawer is open
  return (
    <AsideContext.Provider value={{ type, open: setType, close: () => setType('closed') }}>
      {children}
    </AsideContext.Provider>
  );
};
```
This is the component rendered in `PageLayout`. It owns the state and broadcasts a value object — the current `type` plus the controls (`open` is the state setter; `close` resets to `'closed'`) — to everything rendered as `children`. It is a **live** channel: when the state changes, every consumer re-renders.

**3. `useAside` — the reader (a guarded `useContext`).**
```tsx
export function useAside() {
  const aside = useContext(AsideContext);
  if (!aside) throw new Error('useAside must be used within an AsideProvider');
  return aside;
}
```
`useContext(AsideContext)` walks up the tree to the nearest `AsideContext.Provider` and returns its current `value`. If there is none, it gets the `null` fallback — hence the thrown error. So `useAside()` is just `useContext` with a friendlier failure message.

**4. Consumers.** Any descendant calls `useAside()` to read `{ type, open, close }`: the `Header` cart button calls `open('cart')`, `CartAside` reads `type` to decide whether to show itself, and — the point for us — the rediem adapter calls `open('cart')` in `goToCart()`. All three share one source of truth because they are all descendants of the same provider.

**Two things named "Provider."** `Aside.Provider` is the custom component you place in the tree (it owns the state); `AsideContext.Provider` is React's built-in write-end that it renders internally. `Aside.Provider` is just the friendlier public name. (Hanging `.Provider` off the `Aside` function is a JS convenience — functions are objects, so the component and its provider stay namespaced together.)

**End to end — opening the cart from the widget:**
1. `PageLayout` renders `<Aside.Provider>`; state starts at `type = 'closed'`, published to all children (`Header`, `CartAside`, `RediemWidget`, …).
2. The adapter calls `useAside().open('cart')` inside `goToCart()`. `open` is `setType`, so the state becomes `'cart'`.
3. The state change re-renders `Aside.Provider`, which now publishes `{ type: 'cart', … }`.
4. Every consumer that read the context re-renders; `CartAside`'s `<Aside type="cart">` sees the active type match and expands.

**Why this dictates placement.** `RediemWidget` calls `useAside()` (and `useRevalidator()`, `useLocation()`) to build its adapter, so it must be a **descendant** of the providers that supply those — `Aside.Provider` for the drawer, the router for the rest. That is the concrete reason it renders inside `PageLayout` (§6 step 6) rather than as a sibling of it: a sibling sits outside the provider's subtree, so `useAside()` would hit the `null` fallback and throw ("must be used within an AsideProvider").

**The general rule (any framework).** Mount the widget's integration component inside whichever host contexts its adapter consumes, read those capabilities via the framework's inject mechanism, wrap them into the adapter, and hand the adapter to the loader. React's context is one spelling of that rule; Vue `provide`/`inject`, Angular hierarchical DI, and Svelte `setContext`/`getContext` are others.
