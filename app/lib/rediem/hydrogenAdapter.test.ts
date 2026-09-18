import {beforeEach, describe, expect, it, vi} from 'vitest';
import {createHydrogenAdapter} from './hydrogenAdapter';
import type {LoaderSourceCart} from './cartShape';

const CART_LINE_GID = 'gid://shopify/CartLine/line-holding-the-gift';
const VARIANT_GID = 'gid://shopify/ProductVariant/44556677';
const VARIANT_NUMERIC_ID = 44556677;

function buildCartWithOneLine(): LoaderSourceCart {
  return {
    id: 'gid://shopify/Cart/a-shoppers-cart',
    discountCodes: [{code: 'SHOPPER_TYPED_THIS', applicable: true}],
    lines: {
      nodes: [
        {
          id: CART_LINE_GID,
          quantity: 2,
          attributes: [{key: '_rediem_gift_card', value: 'true'}],
          cost: {totalAmount: {amount: '25.00'}},
          merchandise: {id: VARIANT_GID},
        },
      ],
    },
  };
}

function readSubmittedCartAction(fetchMock: ReturnType<typeof vi.fn>, callIndex = 0) {
  const requestBody = fetchMock.mock.calls[callIndex][1].body as FormData;
  const serializedAction = requestBody.get('cartFormInput') as string;
  return JSON.parse(serializedAction) as {action: string; inputs: Record<string, unknown>};
}

describe('createHydrogenAdapter', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let navigateMock: ReturnType<typeof vi.fn>;
  let cart: LoaderSourceCart;

  beforeEach(() => {
    cart = buildCartWithOneLine();
    fetchMock = vi.fn(async () => new Response('{}', {status: 200}));
    navigateMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  function createAdapterUnderTest() {
    return createHydrogenAdapter({
      getCartData: () => cart,
      revalidate: vi.fn(),
      openCart: vi.fn(),
      navigate: navigateMock,
    });
  }

  describe('changeLine resolves whichever identifier the loader hands it', () => {
    // The loader is inconsistent by design: removeItemFromCart passes the cart line
    // key, while the two single-quantity enforcement paths pass item.variant_id.
    // The Online Store adapter survives this because /cart/change.js accepts both.
    it('treats a cart line gid as the line to update, passing it through unchanged', async () => {
      const adapter = createAdapterUnderTest();

      await adapter.changeLine({id: CART_LINE_GID, quantity: 1});

      const submitted = readSubmittedCartAction(fetchMock);
      expect(submitted.inputs.lines).toEqual([{id: CART_LINE_GID, quantity: 1}]);
    });

    it('resolves a numeric variant id to the cart line holding that variant', async () => {
      const adapter = createAdapterUnderTest();

      await adapter.changeLine({id: VARIANT_NUMERIC_ID, quantity: 1});

      const submitted = readSubmittedCartAction(fetchMock);
      expect(submitted.inputs.lines).toEqual([{id: CART_LINE_GID, quantity: 1}]);
    });

    it('removes the line holding the variant when a numeric variant id is sent with quantity zero', async () => {
      const adapter = createAdapterUnderTest();

      await adapter.changeLine({id: VARIANT_NUMERIC_ID, quantity: 0});

      const submitted = readSubmittedCartAction(fetchMock);
      expect(submitted.inputs.lineIds).toEqual([CART_LINE_GID]);
    });

    it('reports a failed response rather than silently succeeding when the variant is not in the cart', async () => {
      const adapter = createAdapterUnderTest();

      const response = await adapter.changeLine({id: 99999999, quantity: 1});

      expect(response.ok).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('applyDiscountCode preserves codes the shopper already applied', () => {
    // Shopify's cartDiscountCodesUpdate replaces the whole list rather than
    // appending, so sending only the reward code silently drops the shopper's own.
    it('sends the existing applicable codes alongside the new one', async () => {
      const adapter = createAdapterUnderTest();

      await adapter.applyDiscountCode('REDIEM_REWARD_CODE');

      const submitted = readSubmittedCartAction(fetchMock);
      expect(submitted.inputs.discountCodes).toEqual(['SHOPPER_TYPED_THIS', 'REDIEM_REWARD_CODE']);
    });

    it('does not send the same code twice when it is already applied to the cart', async () => {
      const adapter = createAdapterUnderTest();

      await adapter.applyDiscountCode('SHOPPER_TYPED_THIS');

      const submitted = readSubmittedCartAction(fetchMock);
      expect(submitted.inputs.discountCodes).toEqual(['SHOPPER_TYPED_THIS']);
    });

    it('sends only the new code when the cart has no discount codes yet', async () => {
      cart.discountCodes = [];
      const adapter = createAdapterUnderTest();

      await adapter.applyDiscountCode('REDIEM_REWARD_CODE');

      const submitted = readSubmittedCartAction(fetchMock);
      expect(submitted.inputs.discountCodes).toEqual(['REDIEM_REWARD_CODE']);
    });

    // Deciding which codes deserve to survive is a behavior change of its own. This fix
    // only stops codes being lost, so a code Shopify has marked inapplicable is carried
    // forward untouched rather than quietly pruned.
    it('carries forward a code Shopify has marked inapplicable rather than pruning it', async () => {
      cart.discountCodes = [{code: 'EXPIRED_CODE', applicable: false}];
      const adapter = createAdapterUnderTest();

      await adapter.applyDiscountCode('REDIEM_REWARD_CODE');

      const submitted = readSubmittedCartAction(fetchMock);
      expect(submitted.inputs.discountCodes).toEqual(['EXPIRED_CODE', 'REDIEM_REWARD_CODE']);
    });
  });

  describe('failure responses carry the message and description the loader reads', () => {
    // On a failed add the loader does response.json() and builds its error from
    // result.message and result.description. Anything else surfaces to the shopper
    // as the string "undefined: undefined".
    it('gives addLine failures a message and a description', async () => {
      fetchMock.mockResolvedValue(new Response('Sold out', {status: 422, statusText: 'Unprocessable Entity'}));
      const adapter = createAdapterUnderTest();

      const response = await adapter.addLine({id: VARIANT_NUMERIC_ID, quantity: 1});
      const failureBody = (await response.json()) as {message: string; description: string};

      expect(response.ok).toBe(false);
      expect(typeof failureBody.message).toBe('string');
      expect(failureBody.message.length).toBeGreaterThan(0);
      expect(typeof failureBody.description).toBe('string');
      expect(failureBody.description.length).toBeGreaterThan(0);
    });

    it('leaves a successful addLine response untouched', async () => {
      const adapter = createAdapterUnderTest();

      const response = await adapter.addLine({id: VARIANT_NUMERIC_ID, quantity: 1});

      expect(response.ok).toBe(true);
    });

    it('gives changeLine failures a statusText the loader can log', async () => {
      fetchMock.mockResolvedValue(new Response('Nope', {status: 500, statusText: 'Internal Server Error'}));
      const adapter = createAdapterUnderTest();

      const response = await adapter.changeLine({id: CART_LINE_GID, quantity: 0});

      expect(response.ok).toBe(false);
      expect(response.statusText).toBe('Internal Server Error');
    });
  });

  describe('navigation stays inside this storefront and inside its router', () => {
    // The widget used to replace the parent page's location with an absolute Shopify
    // URL, which on a headless storefront drops the shopper onto the myshopify.com
    // domain. These two methods exist so the storefront decides where the shopper goes.
    it('sends a shopper browsing products to this storefront catalogue route', () => {
      const adapter = createAdapterUnderTest();

      adapter.browseProducts();

      expect(navigateMock).toHaveBeenCalledWith('/collections/all');
    });

    it('sends a shopper viewing one variant to the route that resolves it to a product page', () => {
      const adapter = createAdapterUnderTest();

      adapter.viewProduct({variantId: VARIANT_NUMERIC_ID});

      expect(navigateMock).toHaveBeenCalledWith(`/variants/${VARIANT_NUMERIC_ID}`);
    });

    // The loader reduces the variant gid to a number before calling, but an adapter that
    // navigated to /variants/undefined would send the shopper to the catch-all 404 page.
    it('navigates nowhere when the variant id is not a usable number', () => {
      const adapter = createAdapterUnderTest();

      adapter.viewProduct({variantId: Number.NaN});

      expect(navigateMock).not.toHaveBeenCalled();
    });

    it('navigates nowhere when the variant id is zero', () => {
      const adapter = createAdapterUnderTest();

      adapter.viewProduct({variantId: 0});

      expect(navigateMock).not.toHaveBeenCalled();
    });

    // Every other adapter method reaches the network; these two must not, or the
    // shopper would pay for a page fetch the router is about to make anyway.
    it('navigates through the router rather than fetching or reloading the page', () => {
      const adapter = createAdapterUnderTest();

      adapter.browseProducts();
      adapter.viewProduct({variantId: VARIANT_NUMERIC_ID});

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('the cart-changed handler receives a real Response', () => {
    // The loader calls response.clone().json() on whatever it is handed. A plain
    // object throws, the throw is swallowed, and the reward rule engine goes quiet.
    it('hands the handler something that can be cloned and read as json', async () => {
      const adapter = createAdapterUnderTest();
      const cartChangedHandler = vi.fn(async (response: Response) => {
        await response.clone().json();
      });
      adapter.onCartChanged(cartChangedHandler);

      await adapter.addLine({id: VARIANT_NUMERIC_ID, quantity: 1});

      expect(cartChangedHandler).toHaveBeenCalledTimes(1);
      const handedToHandler = cartChangedHandler.mock.calls[0][0];
      expect(handedToHandler).toBeInstanceOf(Response);
    });
  });
});
