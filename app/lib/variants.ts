import {useLocation} from 'react-router';
import type {SelectedOption} from '@shopify/hydrogen/storefront-api-types';
import {useMemo} from 'react';

export function useVariantUrl(
  handle: string,
  selectedOptions?: SelectedOption[],
) {
  const {pathname} = useLocation();

  return useMemo(() => {
    return getVariantUrl({
      handle,
      pathname,
      searchParams: new URLSearchParams(),
      selectedOptions,
    });
  }, [handle, selectedOptions, pathname]);
}

export function getVariantUrl({
  handle,
  pathname,
  searchParams,
  selectedOptions,
}: {
  handle: string;
  pathname: string;
  searchParams: URLSearchParams;
  selectedOptions?: SelectedOption[];
}) {
  const match = /(\/[a-zA-Z]{2}-[a-zA-Z]{2}\/)/g.exec(pathname);
  const isLocalePathname = match && match.length > 0;

  const path = isLocalePathname
    ? `${match![0]}products/${handle}`
    : `/products/${handle}`;

  selectedOptions?.forEach((option) => {
    searchParams.set(option.name, option.value);
  });

  const searchString = searchParams.toString();

  return path + (searchString ? '?' + searchParams.toString() : '');
}

/** The fields a variant lookup has to return for a product URL to be built from it. */
export interface VariantProductLocation {
  selectedOptions?: SelectedOption[] | null;
  product?: {handle?: string | null} | null;
}

/**
 * `'123'`, or a `gid://shopify/ProductVariant/123`, to `123`; anything else to null.
 *
 * The rediem widget identifies a reward product by its numeric variant id, so the
 * storefront has to accept one off the URL without trusting what it is handed.
 */
export function parseNumericVariantId(
  rawVariantId?: string | null,
): number | null {
  const lastSegment = (rawVariantId ?? '').split('/').pop() ?? '';
  if (!/^\d+$/.test(lastSegment)) return null;

  const variantId = Number(lastSegment);
  return variantId > 0 ? variantId : null;
}

/**
 * The product page URL that shows this variant preselected, or null when the
 * Storefront API returned no product for the id (a deleted or unknown variant).
 *
 * Hydrogen addresses products by handle and picks the variant from the option
 * values in the query string, so a variant id on its own points at nothing: it
 * has to become `/products/<handle>?<Option>=<Value>` first.
 */
export function getProductUrlForVariant({
  variant,
  pathname,
}: {
  variant: VariantProductLocation | null;
  pathname: string;
}): string | null {
  const handle = variant?.product?.handle;
  if (!handle) return null;

  return getVariantUrl({
    handle,
    pathname,
    searchParams: new URLSearchParams(),
    selectedOptions: variant.selectedOptions ?? undefined,
  });
}
