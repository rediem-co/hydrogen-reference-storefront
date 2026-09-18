import {beforeEach, describe, expect, it, vi} from 'vitest';

import {createStorefrontApiAdapter} from './storefrontApiAdapter';

const CART_ID = 'gid://shopify/Cart/a-shoppers-cart';

/**
 * These operations are only ever validated by Shopify at request time, so a malformed variable
 * declaration fails the entire mutation before it runs and the shopper sees nothing happen.
 * That is exactly what took Apply to Checkout down on the sandbox storefront: the discount
 * mutation declared `$discountCodes: [String!]` while the argument is `[String!]!`, and
 * Shopify rejected it with a nullability mismatch.
 */
function createAdapterUnderTest(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetchMock);

  return createStorefrontApiAdapter({
    storeDomain: 'example.myshopify.com',
    publicAccessToken: 'a-public-storefront-token',
    readCartId: () => CART_ID,
    writeCartId: vi.fn(),
  });
}

function readSentOperation(fetchMock: ReturnType<typeof vi.fn>, callIndex = 0): string {
  const requestBody = fetchMock.mock.calls[callIndex][1].body as string;
  return (JSON.parse(requestBody) as {query: string}).query;
}

function listVariableDeclarations(operation: string): string[] {
  return operation.match(/\$[a-zA-Z]+:\s*\[[^\]]+\][!]?/g) ?? [];
}

describe('the Storefront API operations this adapter sends', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response(JSON.stringify({data: {}}), {status: 200}));
  });

  // Applying a code reads the cart first so existing codes survive, so the mutation is not
  // necessarily the first request sent.
  it('declares the discount code list as non-null, which Shopify requires', async () => {
    const adapter = createAdapterUnderTest(fetchMock);

    await adapter.applyDiscountCode('REDIEM_REWARD_CODE');

    const discountMutation = fetchMock.mock.calls
      .map((_call, callIndex) => readSentOperation(fetchMock, callIndex))
      .find((operation) => operation.includes('cartDiscountCodesUpdate'));

    expect(discountMutation).toBeDefined();
    expect(discountMutation).toContain('$discountCodes: [String!]!');
  });

  // The discount mutation was the only one of five declaring a nullable list. Asserting the
  // rule rather than the single case stops the next operation reintroducing it.
  it('declares every list variable as non-null across each cart mutation it sends', async () => {
    const adapter = createAdapterUnderTest(fetchMock);

    await adapter.applyDiscountCode('REDIEM_REWARD_CODE');
    await adapter.addLine({id: '44556677', quantity: 1});
    await adapter.changeLine({id: 'gid://shopify/CartLine/line-1', quantity: 2});
    await adapter.changeLine({id: 'gid://shopify/CartLine/line-1', quantity: 0});

    const everyListVariable = fetchMock.mock.calls.flatMap((_call, callIndex) =>
      listVariableDeclarations(readSentOperation(fetchMock, callIndex)),
    );

    expect(everyListVariable.length).toBeGreaterThan(0);
    const nullableListVariables = everyListVariable.filter((declaration) => !declaration.endsWith(']!'));
    expect(nullableListVariables).toEqual([]);
  });

  it('sends the storefront access token so Shopify does not reject the request unauthenticated', async () => {
    const adapter = createAdapterUnderTest(fetchMock);

    await adapter.applyDiscountCode('REDIEM_REWARD_CODE');

    const requestInit = fetchMock.mock.calls[0][1] as {headers: Record<string, string>};
    expect(requestInit.headers['X-Shopify-Storefront-Access-Token']).toBe('a-public-storefront-token');
  });
});

describe('the navigation this adapter performs for the widget', () => {
  const VARIANT_NUMERIC_ID = 44123456789012;

  function createAdapterWithRouter(navigate: (path: string) => void | Promise<unknown>) {
    return createStorefrontApiAdapter({
      storeDomain: 'example.myshopify.com',
      publicAccessToken: 'a-public-storefront-token',
      readCartId: () => CART_ID,
      writeCartId: vi.fn(),
      navigate,
    });
  }

  // The loader only calls these when the adapter declares them. While this adapter left them
  // out the loader replaced the parent page's location instead, reloading the storefront and
  // tearing the widget down, even though this is the adapter the storefront actually runs.
  it('declares both navigation methods so the loader stops falling back to a page reload', () => {
    const adapter = createAdapterWithRouter(vi.fn());

    expect(typeof adapter.browseProducts).toBe('function');
    expect(typeof adapter.viewProduct).toBe('function');
  });

  it('sends a shopper browsing products to the storefront catalogue route', () => {
    const navigate = vi.fn();
    const adapter = createAdapterWithRouter(navigate);

    adapter.browseProducts?.();

    expect(navigate).toHaveBeenCalledWith('/collections/all');
  });

  it('sends a shopper viewing one variant to the route that resolves it to a product page', () => {
    const navigate = vi.fn();
    const adapter = createAdapterWithRouter(navigate);

    adapter.viewProduct?.({variantId: VARIANT_NUMERIC_ID});

    expect(navigate).toHaveBeenCalledWith(`/variants/${VARIANT_NUMERIC_ID}`);
  });

  // Every other method on this adapter reaches the Storefront API. These two must not: the
  // destination is a route this storefront serves, and a lookup here would cost the shopper
  // a round trip before a navigation that is about to make its own.
  it('navigates without calling the Storefront API', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const adapter = createAdapterWithRouter(vi.fn());

    adapter.browseProducts?.();
    adapter.viewProduct?.({variantId: VARIANT_NUMERIC_ID});

    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  // The Hydrogen adapter requires a router; this one is framework-agnostic and takes it as an
  // option, the same way it takes openCart. A host without one still has to reach the product.
  it('falls back to a full page load for a host that supplies no router', () => {
    const assignMock = vi.fn();
    vi.stubGlobal('window', {location: {assign: assignMock}});
    const adapter = createStorefrontApiAdapter({
      storeDomain: 'example.myshopify.com',
      publicAccessToken: 'a-public-storefront-token',
      readCartId: () => CART_ID,
      writeCartId: vi.fn(),
    });

    adapter.browseProducts?.();

    expect(assignMock).toHaveBeenCalledWith('/collections/all');
    vi.unstubAllGlobals();
  });
});
