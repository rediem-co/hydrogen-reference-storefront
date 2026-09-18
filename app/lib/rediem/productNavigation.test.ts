import {afterEach, describe, expect, it, vi} from 'vitest';

import {createProductNavigation} from './productNavigation';

const VARIANT_NUMERIC_ID = 44123456789012;

function stubBrowserLocation(): ReturnType<typeof vi.fn> {
  const assignMock = vi.fn();
  vi.stubGlobal('window', {location: {assign: assignMock}});
  return assignMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('createProductNavigation', () => {
  describe('when the host storefront supplies its own router', () => {
    it('sends a shopper browsing products to the storefront catalogue route', () => {
      const navigate = vi.fn();
      const navigation = createProductNavigation({navigate});

      navigation.browseProducts();

      expect(navigate).toHaveBeenCalledWith('/collections/all');
    });

    it('sends a shopper viewing one variant to the route that resolves it to a product page', () => {
      const navigate = vi.fn();
      const navigation = createProductNavigation({navigate});

      navigation.viewProduct({variantId: VARIANT_NUMERIC_ID});

      expect(navigate).toHaveBeenCalledWith(`/variants/${VARIANT_NUMERIC_ID}`);
    });

    // A storefront that serves its catalogue or its variant resolver somewhere else stays
    // supported: the destinations are the host's to name, not this module's to assume.
    it('honours the destinations the host storefront configured instead of the defaults', () => {
      const navigate = vi.fn();
      const navigation = createProductNavigation({
        navigate,
        allProductsPath: '/shop',
        variantPathPrefix: '/go/variant/',
      });

      navigation.browseProducts();
      navigation.viewProduct({variantId: VARIANT_NUMERIC_ID});

      expect(navigate).toHaveBeenNthCalledWith(1, '/shop');
      expect(navigate).toHaveBeenNthCalledWith(2, `/go/variant/${VARIANT_NUMERIC_ID}`);
    });

    // Client-side navigation is the entire point of implementing these methods: a full
    // page load would tear the widget and the cart drawer down in the middle of a reward.
    it('never falls back to a full page load while the router is working', () => {
      const assignMock = stubBrowserLocation();
      const navigation = createProductNavigation({navigate: vi.fn()});

      navigation.browseProducts();
      navigation.viewProduct({variantId: VARIANT_NUMERIC_ID});

      expect(assignMock).not.toHaveBeenCalled();
    });
  });

  describe('when the host storefront supplies no router', () => {
    // A framework-agnostic host may have no client-side router to lend the adapter. A full
    // page load still takes the shopper to the same place, which beats a button that does nothing.
    it('takes the shopper to the catalogue with a full page load', () => {
      const assignMock = stubBrowserLocation();
      const navigation = createProductNavigation({});

      navigation.browseProducts();

      expect(assignMock).toHaveBeenCalledWith('/collections/all');
    });

    it('takes the shopper to the variant resolver with a full page load', () => {
      const assignMock = stubBrowserLocation();
      const navigation = createProductNavigation({});

      navigation.viewProduct({variantId: VARIANT_NUMERIC_ID});

      expect(assignMock).toHaveBeenCalledWith(`/variants/${VARIANT_NUMERIC_ID}`);
    });
  });

  describe('when the host storefront router fails', () => {
    // The widget fires these methods and forgets them: it waits for no acknowledgement and
    // reports no error. A throw that escaped here would leave the shopper pressing a dead
    // button with nothing to explain it, so the failure is logged and the page load takes over.
    it('falls back to a full page load when the router throws', () => {
      const assignMock = stubBrowserLocation();
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const navigation = createProductNavigation({
        navigate: () => {
          throw new Error('the router is not mounted yet');
        },
      });

      navigation.browseProducts();

      expect(assignMock).toHaveBeenCalledWith('/collections/all');
      expect(consoleError).toHaveBeenCalled();
    });

    it('does not let the router throw escape into the widget', () => {
      stubBrowserLocation();
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const navigation = createProductNavigation({
        navigate: () => {
          throw new Error('the router is not mounted yet');
        },
      });

      expect(() => navigation.viewProduct({variantId: VARIANT_NUMERIC_ID})).not.toThrow();
    });

    // React Router's navigate resolves a promise rather than finishing synchronously, so a
    // navigation that fails part way through fails after the method has already returned.
    it('falls back to a full page load when the router rejects its navigation', async () => {
      const assignMock = stubBrowserLocation();
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const navigation = createProductNavigation({
        navigate: async () => {
          throw new Error('the route loader failed');
        },
      });

      navigation.viewProduct({variantId: VARIANT_NUMERIC_ID});
      await vi.waitFor(() => expect(assignMock).toHaveBeenCalledWith(`/variants/${VARIANT_NUMERIC_ID}`));
    });

    it('leaves a successful navigation promise alone', async () => {
      const assignMock = stubBrowserLocation();
      const navigation = createProductNavigation({navigate: async () => undefined});

      navigation.browseProducts();
      await Promise.resolve();

      expect(assignMock).not.toHaveBeenCalled();
    });
  });

  describe('when the variant id cannot address a product', () => {
    // The loader reduces the variant gid to a number before calling, so this is a defect
    // rather than a shopper action: navigating to /variants/undefined would only swap the
    // dead button for the catch-all 404 page.
    it('navigates nowhere when the variant id is not a usable number', () => {
      const assignMock = stubBrowserLocation();
      const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const navigate = vi.fn();
      const navigation = createProductNavigation({navigate});

      navigation.viewProduct({variantId: Number.NaN});

      expect(navigate).not.toHaveBeenCalled();
      expect(assignMock).not.toHaveBeenCalled();
      expect(consoleWarn).toHaveBeenCalled();
    });

    it('navigates nowhere when the variant id is zero', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const navigate = vi.fn();
      const navigation = createProductNavigation({navigate});

      navigation.viewProduct({variantId: 0});

      expect(navigate).not.toHaveBeenCalled();
    });
  });
});
