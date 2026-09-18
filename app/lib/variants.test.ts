import {describe, expect, it} from 'vitest';
import {getProductUrlForVariant, parseNumericVariantId} from './variants';

describe('parseNumericVariantId', () => {
  it('accepts the numeric id the rediem loader puts in the path', () => {
    expect(parseNumericVariantId('43695710404630')).toBe(43695710404630);
  });

  it('accepts a full product variant gid by taking its last segment', () => {
    expect(
      parseNumericVariantId('gid://shopify/ProductVariant/43695710404630'),
    ).toBe(43695710404630);
  });

  it('rejects an id that is not a number, so the route can answer 400 instead of querying Shopify', () => {
    expect(parseNumericVariantId('not-a-variant')).toBeNull();
  });

  it('rejects an id with a decimal point rather than silently truncating it', () => {
    expect(parseNumericVariantId('123.456')).toBeNull();
  });

  it('rejects zero, which is what an empty widget field reduces to', () => {
    expect(parseNumericVariantId('0')).toBeNull();
  });

  it('rejects a missing id', () => {
    expect(parseNumericVariantId(undefined)).toBeNull();
  });
});

describe('getProductUrlForVariant', () => {
  const variantOnAOneOptionProduct = {
    selectedOptions: [{name: 'Size', value: 'Medium'}],
    product: {handle: 'slides'},
  };

  it('points at the product page with the option values that preselect this variant', () => {
    const productUrl = getProductUrlForVariant({
      variant: variantOnAOneOptionProduct,
      pathname: '/variants/43695710404630',
    });

    expect(productUrl).toBe('/products/slides?Size=Medium');
  });

  it('carries every option of a multi-option variant so the right one is selected', () => {
    const productUrl = getProductUrlForVariant({
      variant: {
        selectedOptions: [
          {name: 'Color', value: 'Black'},
          {name: 'Size', value: 'Large'},
        ],
        product: {handle: 'hoodie'},
      },
      pathname: '/variants/1234567890',
    });

    expect(productUrl).toBe('/products/hoodie?Color=Black&Size=Large');
  });

  it('keeps the shopper in the locale they were browsing in', () => {
    const productUrl = getProductUrlForVariant({
      variant: variantOnAOneOptionProduct,
      pathname: '/en-ca/variants/43695710404630',
    });

    expect(productUrl).toBe('/en-ca/products/slides?Size=Medium');
  });

  it('gives a product with no option values a plain product URL', () => {
    const productUrl = getProductUrlForVariant({
      variant: {selectedOptions: [], product: {handle: 'gift-card'}},
      pathname: '/variants/99',
    });

    expect(productUrl).toBe('/products/gift-card');
  });

  // The Storefront API answers null for a variant that has been deleted, and the
  // route turns this null into a 404 the shopper can see rather than a broken URL.
  it('returns null when the Storefront API found no variant for the id', () => {
    expect(
      getProductUrlForVariant({variant: null, pathname: '/variants/1'}),
    ).toBeNull();
  });

  it('returns null when the variant resolved but its product has no handle', () => {
    const productUrl = getProductUrlForVariant({
      variant: {selectedOptions: [], product: {handle: null}},
      pathname: '/variants/1',
    });

    expect(productUrl).toBeNull();
  });
});
