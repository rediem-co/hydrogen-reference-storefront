# rediem headless reference storefront

A working Shopify Hydrogen storefront with the rediem loyalty widget integrated, kept as reference code you read and copy from rather than a package you install or a template you fork blindly.

It exists because the rediem widget needs one piece of code only you can write: an adapter that tells rediem how to read and change your cart, and how to send a shopper to your login page. The framework owns your cart's identity and your routes, so there is always a binding step. This repository shows that step done twice, against two different cart transports, so you can see which parts are rediem's contract and which are yours.

## Where to start

Read [`docs/rediem-headless-integration.md`](docs/rediem-headless-integration.md) first. It is the integration reference: the adapter contract and its eight methods, mounting, identity and session exchange, CSP requirements, and a step-by-step guide. This README covers running this repository and the handful of settings worth getting right at the start.

The pieces worth reading, in order:

| file | what it is |
|---|---|
| `app/components/RediemWidget.tsx` | Mounts the loader and hands it an adapter. The integration's entry point. |
| `app/lib/rediem/cartAdapterSelection.ts` | Chooses between the two adapters, and the authority on which one runs. |
| `app/lib/rediem/storefrontApiAdapter.ts` | Cart operations through the Shopify Storefront API. |
| `app/lib/rediem/hydrogenAdapter.ts` | The same contract through Hydrogen's own cart route. |
| `app/lib/rediem/productNavigation.ts` | Shared between both adapters, so navigation behaves the same whichever one runs. |
| `app/lib/rediem/loaderUrl.ts` | Resolves which loader build to fetch. Also feeds the CSP. |
| `app/entry.server.tsx` | Builds the Content-Security-Policy from the same values. |

## What is ours and what is stock Hydrogen

This repository started from Shopify's Hydrogen skeleton template, so most of it has nothing to do with rediem. Of 108 tracked files, 16 are named for rediem and 10 more touch it. The rest is scaffolding you will replace with your own storefront.

**The rediem integration, all under one directory plus three entry points:**

| Path | What it is |
|---|---|
| `app/lib/rediem/` | The adapters, the shared contract, the loader URL resolver, and their tests. The bulk of the integration. |
| `app/components/RediemWidget.tsx` | Mounts the loader and hands it an adapter. |
| `app/routes/auth.rediem.me.tsx` | The identity route your server implements. The path is yours to choose; this is just where we put it. |
| `docs/rediem-headless-integration.md` | The contract in prose. |

**Files where rediem is one concern among others**, so read the rediem parts and leave the rest: `app/root.tsx` and `app/entry.server.tsx` (loader URL and the Content Security Policy derived from it), `app/components/PageLayout.tsx`, `app/components/CartSummary.tsx`, `app/routes/($locale).account_.logout.tsx`, `app/routes/($locale).variants.$variantId.tsx` and `app/lib/variants.ts`.

**Everything else is the Hydrogen skeleton.** Routes, components, GraphQL fragments and styles that ship with `npm create @shopify/hydrogen`. If a file is not in the two lists above, it is not ours and carries no rediem behaviour.

## Two adapters, and you only need one

`ACTIVE_REDIEM_CART_ADAPTER` in `app/lib/rediem/cartAdapterSelection.ts` decides which adapter runs. It is currently `'storefrontApi'`.

Both implement the same contract and both navigate through the same shared module, so the shopper experience does not depend on the choice. Only the cart transport differs:

- **`storefrontApiAdapter.ts`** talks to the Shopify Storefront API directly with a public token.
- **`hydrogenAdapter.ts`** posts to Hydrogen's own `/cart` route and needs no token in the browser.

**Keep whichever matches how your cart already works and delete the other.** Two implementations exist here so you can see which parts are rediem's contract and which are yours; they are not a pattern to copy.

One thing to know before you delete: the selection is not unconditional. `resolveCartAdapterChoice` falls back to the Hydrogen adapter when the Storefront API token is absent, rather than building an adapter whose every call fails authentication. So a missing token silently changes which adapter runs, which is worth knowing when behaviour differs between environments.

## Running it

Requires Node 18 or higher.

```bash
npm ci --legacy-peer-deps
cp .env.example .env    # then fill in the rediem values, see below
npm run dev
```

The `--legacy-peer-deps` flag is needed because Hydrogen pins a React Router version that npm's peer resolution rejects. A plain `npm ci` fails.

```bash
npm run build        # production build
npm test             # vitest
npm run typecheck    # react-router typegen, then tsc
```

**`npm run typecheck` reports about 40 errors on a clean checkout.** They come from route typegen and are there before you touch anything, so compare counts before and after rather than expecting zero. Use the script rather than `tsc` directly; it generates route types first.

## Configuration

Every rediem value is set through environment variables; see `.env.example` for the full list with comments. The short version:

- **`REDIEM_API_URL`** is the only one you must set. Everything else is derived from it, including which loader build is fetched, so the loader can never talk to a different rediem environment than the rest of your storefront.
- **`REDIEM_CREDENTIAL`** is genuinely secret. It authenticates your server to the session exchange. It must never reach the browser and never be committed.
- On Oxygen these are runtime values read from the deployed environment, not baked in at build time, so a local `.env` change does not affect a deployed storefront. Push them with `shopify hydrogen env push --env <handle>` or set them in the Shopify admin.

**Do not copy the loader into this repository.** A vendored loader is frozen at the version you copied, so every fix rediem publishes stops reaching your shoppers. Fetching it from the channel URL is the whole point of the CDN: the URL is stable and the file behind it updates.

## Three things to set correctly

The integration itself is small. These three are worth doing deliberately rather than discovering, and each takes a minute.

**Load the loader in an effect, not as a `<script>` tag in your markup.** `RediemWidget.tsx` shows the shape. The loader adds its stylesheet to the page as soon as it runs, so letting it run before your framework has finished hydrating means the two can disagree about the DOM. Creating the element in an effect runs it after hydration and the question does not arise. This applies to any framework that server-renders and hydrates.

**Set `data-rdm_domain` to your store's primary domain**, the one rediem has on record, and use the same value in every environment. It names the store inside rediem rather than the site the shopper is on, so it does not change between your laptop, your preview builds and production. You can confirm you have the right value in one call:

```sh
curl -s -o /dev/null -w "%{http_code}\n" \
  https://ripplrewards.nyc3.digitaloceanspaces.com/live/store/YOUR-DOMAIN/store_setting.json
```

A `200` means rediem has your store filed under that exact string, which is the same fetch the loader makes.

**Register your JavaScript origins on your Customer Account API client**, including local development and any preview environments. Shopify checks the origin when it verifies a shopper's token, so each environment you develop from needs to be on that list.

## Content Security Policy

`app/entry.server.tsx` builds the policy from the same environment variables that resolve the loader URL, so there is one place to change and the script tag can never name an origin the policy blocks. If you replace the CSP, the widget iframe origin, the rediem API, the asset host and the loader origin all need allowing; the integration doc lists them.

## Hydrogen

This started from Shopify's Hydrogen skeleton template and keeps its structure: Remix, Hydrogen, Oxygen, Vite, the Shopify CLI, ESLint, Prettier, the GraphQL generator and TypeScript.

For Hydrogen itself, see [the Hydrogen docs](https://shopify.dev/custom-storefronts/hydrogen) and [the Remix docs](https://remix.run/docs/en/v1). Setting up the Customer Account API for local development needs a public domain; follow steps 1 and 2 of [Shopify's guide](https://shopify.dev/docs/custom-storefronts/building-with-the-customer-account-api/hydrogen#step-1-set-up-a-public-domain-for-local-development).

## Getting help

Ask rather than starting from scratch, particularly on the adapter. It is the one piece you have to write and the one where we can save you the most time.
