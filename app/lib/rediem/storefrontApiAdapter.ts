/**
 * Framework-agnostic rediem cart adapter, built directly on the Shopify
 * Storefront API.
 *
 * This is what a prebuilt adapter shipped by rediem would look like: it imports
 * nothing from Hydrogen, React Router or any other framework, and talks to
 * `https://<store domain>/api/<version>/graphql.json` with the public Storefront
 * API access token. It runs in any browser storefront (Hydrogen, Next.js, Nuxt,
 * a hand-rolled single-page app) as long as the host supplies the small
 * `StorefrontApiAdapterConfig` below.
 *
 * The one thing it cannot own is cart identity. Every storefront framework keeps
 * the shopper's cart id somewhere of its own choosing (a cookie, a server
 * session, a client store), and a cart the adapter invented on its own would be
 * a second cart the storefront never displays. So `readCartId` and `writeCartId`
 * are required: the host stays the owner of the cart, the adapter owns every
 * Storefront API call made against it.
 */
import type {
  RediemAddLineInput,
  RediemCart,
  RediemCartAdapter,
  RediemCartChangedHandler,
  RediemChangeLineInput,
  RediemSignInOptions,
} from './cartAdapter';
import {gidToNumericId, toLoaderCart, type LoaderSourceCart} from './cartShape';
import {createProductNavigation, type HostNavigate} from './productNavigation';

const DEFAULT_STOREFRONT_API_VERSION = '2026-04';
const DEFAULT_SESSION_ENDPOINT = '/auth/rediem/me';
const DEFAULT_LOGIN_PATH = '/account/login';
const DEFAULT_CART_PATH = '/cart';

export interface StorefrontApiAdapterConfig {
  /** The store's Shopify domain, for example `example.myshopify.com`. */
  storeDomain: string;
  /** The public Storefront API access token. Safe to expose to the browser. */
  publicAccessToken: string;
  storefrontApiVersion?: string;
  /** The merchant-owned route that runs the rediem session exchange server-side. */
  sessionEndpoint?: string;
  loginPath?: string;
  /** Used only when the loader asks to sign in with `create: true`. */
  registerPath?: string;
  /** Where `goToCart` navigates when the host provides no `openCart`. */
  cartPath?: string;
  /** Buyer country, applied when the adapter has to create the cart itself. */
  countryCode?: string;
  /** The cart id the storefront is currently displaying, or null when it has none. */
  readCartId: () => string | null;
  /** Hand a newly created cart back to the storefront so it adopts it. */
  writeCartId: (cartId: string) => void;
  /** Called after every mutation so the host can refresh its own cart UI. */
  onCartRefreshed?: (cart: LoaderSourceCart | null) => void;
  /** Reveal the cart to the shopper, for example by opening a cart drawer. */
  openCart?: () => void;
  /**
   * Navigate within the storefront through its own router, without a page reload. Optional
   * for the same reason `openCart` is: a host that has no client-side router to lend still
   * gets working navigation, by full page load.
   */
  navigate?: HostNavigate;
  /** Where "show me everything I can spend points on" goes. Defaults to `/collections/all`. */
  allProductsPath?: string;
  /** Prefixed to a numeric variant id to address one product. Defaults to `/variants/`. */
  variantPathPrefix?: string;
}

interface StorefrontUserError {
  field?: string[] | null;
  message: string;
}

interface CartMutationPayload {
  cart?: LoaderSourceCart | null;
  userErrors?: StorefrontUserError[] | null;
}

interface CartLineInput {
  merchandiseId: string;
  quantity: number;
  attributes: Array<{key: string; value: string}>;
}

const CART_FIELDS_FRAGMENT = `
  fragment RediemCartFields on Cart {
    id
    discountCodes {
      code
      applicable
    }
    lines(first: 250) {
      nodes {
        id
        quantity
        attributes {
          key
          value
        }
        cost {
          totalAmount {
            amount
          }
        }
        merchandise {
          ... on ProductVariant {
            id
          }
        }
      }
    }
  }
`;

const CART_QUERY = `${CART_FIELDS_FRAGMENT}
  query RediemCart($cartId: ID!) {
    cart(id: $cartId) {
      ...RediemCartFields
    }
  }
`;

const CART_CREATE_MUTATION = `${CART_FIELDS_FRAGMENT}
  mutation RediemCartCreate($input: CartInput!) {
    cartCreate(input: $input) {
      cart {
        ...RediemCartFields
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const CART_LINES_ADD_MUTATION = `${CART_FIELDS_FRAGMENT}
  mutation RediemCartLinesAdd($cartId: ID!, $lines: [CartLineInput!]!) {
    cartLinesAdd(cartId: $cartId, lines: $lines) {
      cart {
        ...RediemCartFields
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const CART_LINES_UPDATE_MUTATION = `${CART_FIELDS_FRAGMENT}
  mutation RediemCartLinesUpdate($cartId: ID!, $lines: [CartLineUpdateInput!]!) {
    cartLinesUpdate(cartId: $cartId, lines: $lines) {
      cart {
        ...RediemCartFields
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const CART_LINES_REMOVE_MUTATION = `${CART_FIELDS_FRAGMENT}
  mutation RediemCartLinesRemove($cartId: ID!, $lineIds: [ID!]!) {
    cartLinesRemove(cartId: $cartId, lineIds: $lineIds) {
      cart {
        ...RediemCartFields
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const CART_DISCOUNT_CODES_UPDATE_MUTATION = `${CART_FIELDS_FRAGMENT}
  mutation RediemCartDiscountCodesUpdate($cartId: ID!, $discountCodes: [String!]!) {
    cartDiscountCodesUpdate(cartId: $cartId, discountCodes: $discountCodes) {
      cart {
        ...RediemCartFields
      }
      userErrors {
        field
        message
      }
    }
  }
`;

function storefrontEndpoint(config: StorefrontApiAdapterConfig): string {
  const version = config.storefrontApiVersion ?? DEFAULT_STOREFRONT_API_VERSION;
  return `https://${config.storeDomain}/api/${version}/graphql.json`;
}

function readGraphqlErrorMessage(errors: unknown): string {
  if (!Array.isArray(errors) || errors.length === 0) return 'Storefront API request failed';
  const first: unknown = errors[0];
  if (typeof first === 'object' && first !== null && 'message' in first) {
    const {message} = first as {message?: unknown};
    if (typeof message === 'string') return message;
  }
  return 'Storefront API request failed';
}

function unwrapGraphqlData<TData>(payload: unknown): TData {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('Storefront API returned a non-object response');
  }
  const envelope = payload as {data?: unknown; errors?: unknown};
  if (envelope.errors) {
    throw new Error(readGraphqlErrorMessage(envelope.errors));
  }
  if (envelope.data === undefined || envelope.data === null) {
    throw new Error('Storefront API returned no data');
  }
  return envelope.data as TData;
}

async function requestStorefrontApi<TData>(
  config: StorefrontApiAdapterConfig,
  query: string,
  variables: Record<string, unknown>,
): Promise<TData> {
  const response = await fetch(storefrontEndpoint(config), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Storefront-Access-Token': config.publicAccessToken,
    },
    body: JSON.stringify({query, variables}),
  });
  if (!response.ok) {
    throw new Error(`Storefront API responded ${response.status}`);
  }
  const payload: unknown = await response.json();
  return unwrapGraphqlData<TData>(payload);
}

function takeMutatedCart(payload: CartMutationPayload | undefined, operation: string): LoaderSourceCart {
  const userErrors = payload?.userErrors ?? [];
  if (userErrors.length > 0) {
    throw new Error(`${operation}: ${userErrors.map((userError) => userError.message).join('; ')}`);
  }
  if (!payload?.cart) {
    throw new Error(`${operation}: the Storefront API returned no cart`);
  }
  return payload.cart;
}

function toLineInputs(input: RediemAddLineInput): CartLineInput[] {
  const attributes = Object.entries(input.properties ?? {}).map(([key, value]) => ({key, value}));
  return [
    {
      merchandiseId: `gid://shopify/ProductVariant/${input.id}`,
      quantity: input.quantity,
      attributes,
    },
  ];
}

/**
 * The loader passes a cart line key when removing a line, and a numeric variant
 * id from its per-cart-limit enforcement paths. Resolve either to line keys.
 */
function resolveCartLineIds(cart: LoaderSourceCart | null, id: string | number): string[] {
  const requested = String(id);
  if (requested.startsWith('gid://')) return [requested];
  const requestedVariantId = Number(requested);
  const nodes = cart?.lines?.nodes ?? [];
  return nodes
    .filter((node) => gidToNumericId(node?.merchandise?.id) === requestedVariantId)
    .map((node) => node?.id ?? '')
    .filter((lineId) => lineId.length > 0);
}

/**
 * The Storefront API replaces the whole discount code list, while the loader
 * only ever asks for one code to be added, so merge rather than overwrite.
 */
function mergeDiscountCodes(cart: LoaderSourceCart | null, code: string): string[] {
  const existing = (cart?.discountCodes ?? [])
    .filter((discount) => discount?.applicable && discount.code)
    .map((discount) => discount.code as string);
  return existing.includes(code) ? existing : [...existing, code];
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {'Content-Type': 'application/json'},
  });
}

/** The loader reads `message` and `description` off a failed cart mutation. */
function cartErrorResponse(error: unknown): Response {
  const description = error instanceof Error ? error.message : 'Unknown Storefront API error';
  return new Response(JSON.stringify({message: 'Cart update failed', description}), {
    status: 422,
    statusText: 'Cart update failed',
    headers: {'Content-Type': 'application/json'},
  });
}

interface CartSession {
  latest: () => LoaderSourceCart | null;
  load: () => Promise<LoaderSourceCart | null>;
  create: (lines: CartLineInput[], discountCodes: string[]) => Promise<LoaderSourceCart>;
  mutate: (mutation: string, variables: Record<string, unknown>, operation: string) => Promise<LoaderSourceCart>;
}

/** Holds the cart the adapter last saw and performs every Storefront API call against it. */
function createCartSession(config: StorefrontApiAdapterConfig): CartSession {
  let latestCart: LoaderSourceCart | null = null;

  async function load(): Promise<LoaderSourceCart | null> {
    const cartId = config.readCartId();
    if (!cartId) {
      latestCart = null;
      return null;
    }
    const data = await requestStorefrontApi<{cart: LoaderSourceCart | null}>(config, CART_QUERY, {cartId});
    latestCart = data.cart;
    return latestCart;
  }

  async function mutate(
    mutation: string,
    variables: Record<string, unknown>,
    operation: string,
  ): Promise<LoaderSourceCart> {
    const data = await requestStorefrontApi<Record<string, CartMutationPayload>>(config, mutation, variables);
    latestCart = takeMutatedCart(data[operation], operation);
    config.onCartRefreshed?.(latestCart);
    return latestCart;
  }

  async function create(lines: CartLineInput[], discountCodes: string[]): Promise<LoaderSourceCart> {
    const buyerIdentity = config.countryCode ? {buyerIdentity: {countryCode: config.countryCode}} : {};
    const cart = await mutate(CART_CREATE_MUTATION, {input: {lines, discountCodes, ...buyerIdentity}}, 'cartCreate');
    if (cart.id) config.writeCartId(cart.id);
    return cart;
  }

  return {latest: () => latestCart, load, create, mutate};
}

export function createStorefrontApiAdapter(config: StorefrontApiAdapterConfig): RediemCartAdapter {
  const session = createCartSession(config);
  let cartChangedHandler: RediemCartChangedHandler | null = null;

  async function notifyCartChanged(payload: unknown): Promise<void> {
    if (!cartChangedHandler) return;
    try {
      await cartChangedHandler(jsonResponse(payload));
    } catch (error) {
      console.error('[rediem] cart-changed handler failed', error);
    }
  }

  return {
    async getSession(): Promise<Response> {
      return fetch(config.sessionEndpoint ?? DEFAULT_SESSION_ENDPOINT, {
        method: 'GET',
        headers: {'Content-Type': 'application/json'},
      });
    },

    signIn(options?: RediemSignInOptions): void {
      const loginPath = config.loginPath ?? DEFAULT_LOGIN_PATH;
      const destination = options?.create ? (config.registerPath ?? loginPath) : loginPath;
      const returnTo = window.location.pathname + window.location.search;
      window.location.href = `${destination}?return_to=${encodeURIComponent(returnTo)}`;
    },

    async getCart(): Promise<RediemCart> {
      return toLoaderCart(await session.load());
    },

    goToCart(): void {
      if (config.openCart) {
        config.openCart();
        config.onCartRefreshed?.(session.latest());
        return;
      }
      window.location.assign(config.cartPath ?? DEFAULT_CART_PATH);
    },

    async applyDiscountCode(code: string): Promise<Response> {
      try {
        const cartId = config.readCartId();
        if (!cartId) {
          await session.create([], [code]);
        } else {
          const discountCodes = mergeDiscountCodes(await session.load(), code);
          const variables = {cartId, discountCodes};
          await session.mutate(CART_DISCOUNT_CODES_UPDATE_MUTATION, variables, 'cartDiscountCodesUpdate');
        }
        return jsonResponse(toLoaderCart(session.latest()));
      } catch (error) {
        return cartErrorResponse(error);
      }
    },

    async addLine(input: RediemAddLineInput): Promise<Response> {
      try {
        const lines = toLineInputs(input);
        const cartId = config.readCartId();
        if (!cartId) {
          await session.create(lines, []);
        } else {
          await session.mutate(CART_LINES_ADD_MUTATION, {cartId, lines}, 'cartLinesAdd');
        }
        // Mirrors Shopify's `/cart/add.js`, which returns only the added line.
        // The loader skips reward enforcement when the payload has no `items`.
        await notifyCartChanged({id: String(input.id)});
        return jsonResponse(toLoaderCart(session.latest()));
      } catch (error) {
        return cartErrorResponse(error);
      }
    },

    async changeLine(input: RediemChangeLineInput): Promise<Response> {
      try {
        const cartId = config.readCartId();
        if (!cartId) throw new Error('changeLine: the storefront has no cart');
        const lineIds = resolveCartLineIds(session.latest() ?? (await session.load()), input.id);
        if (lineIds.length === 0) throw new Error(`changeLine: no cart line matches ${input.id}`);
        if (input.quantity <= 0) {
          await session.mutate(CART_LINES_REMOVE_MUTATION, {cartId, lineIds}, 'cartLinesRemove');
        } else {
          const lines = lineIds.map((lineId) => ({id: lineId, quantity: input.quantity}));
          await session.mutate(CART_LINES_UPDATE_MUTATION, {cartId, lines}, 'cartLinesUpdate');
        }
        // A change returns the whole cart, as `/cart/change.js` does, so the
        // loader re-runs its reward-line enforcement against the fresh cart.
        await notifyCartChanged(toLoaderCart(session.latest()));
        return jsonResponse(toLoaderCart(session.latest()));
      } catch (error) {
        return cartErrorResponse(error);
      }
    },

    onCartChanged(handler: RediemCartChangedHandler): void {
      cartChangedHandler = handler;
    },

    // The widget posts these two intents and the storefront decides how to satisfy them.
    // They are shared with the Hydrogen adapter (productNavigation.ts) so the shopper lands
    // in the same place whichever adapter cartAdapterSelection.ts binds, and they reach no
    // Storefront API: the destination is a route this storefront serves, not a Shopify URL.
    ...createProductNavigation({
      navigate: config.navigate,
      allProductsPath: config.allProductsPath,
      variantPathPrefix: config.variantPathPrefix,
    }),
  };
}

export type StorefrontApiAdapter = ReturnType<typeof createStorefrontApiAdapter>;
