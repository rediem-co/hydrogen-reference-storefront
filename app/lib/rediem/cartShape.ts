/**
 * Storefront API cart -> the minimal cart shape the rediem loader reads.
 *
 * ISOLATED ON PURPOSE. This is the one remaining piece of shape translation
 * after the AJAX shim was removed. It exists only because the loader still reads
 * an Online-Store-flavored cart shape (variant_id, final_line_price in cents,
 * properties, per-line discounts). When the loader's cart shape is neutralized
 * upstream (the "CartFacts" decision in ripple), this whole file goes away and
 * the adapter can pass the Storefront cart through untranslated. Keeping it in
 * one small module makes that deletion a one-file change.
 *
 * The loader reads only the fields below; everything else on the Storefront cart
 * is ignored, so we map the minimum rather than emulating the full AJAX cart.
 */

/** `gid://shopify/ProductVariant/123` -> 123 (the numeric id the loader reads). */
export function gidToNumericId(gid?: string | null): number {
  if (!gid) return 0;
  const tail = gid.split('/').pop() ?? '';
  const numeric = parseInt(tail.split('?')[0], 10);
  return Number.isFinite(numeric) ? numeric : 0;
}

/** Storefront MoneyV2 decimal string -> integer cents. */
function toCents(amount?: string | null): number {
  const value = amount ? parseFloat(amount) : 0;
  return Math.round((Number.isFinite(value) ? value : 0) * 100);
}

/** Storefront line `attributes:[{key,value}]` -> the loader's `properties` object. */
function attributesToProperties(
  attributes?: Array<{key: string; value?: string | null}> | null,
): Record<string, string> {
  const properties: Record<string, string> = {};
  for (const attribute of attributes ?? []) {
    if (attribute?.key) properties[attribute.key] = attribute.value ?? '';
  }
  return properties;
}

/**
 * Cart-level applicable discount codes, surfaced as the per-line `discounts`
 * array the loader reads (`item.discounts[].title`). The loader's only two uses
 * are "is this code already applied?" and "find the active coupon title", both
 * of which the cart-level codes answer. This is not a true per-line allocation;
 * it goes away with this file when the loader shape is neutralized.
 */
function cartDiscountTitles(cart: LoaderSourceCart): Array<{title: string}> {
  return (cart?.discountCodes ?? [])
    .filter((discount) => discount?.applicable && discount.code)
    .map((discount) => ({title: discount.code as string}));
}

/** The subset of the Storefront cart this mapper reads. */
export interface LoaderSourceCart {
  id?: string | null;
  discountCodes?: Array<{code?: string | null; applicable?: boolean | null}> | null;
  lines?: {
    nodes?: Array<{
      id?: string | null;
      quantity?: number | null;
      attributes?: Array<{key: string; value?: string | null}> | null;
      cost?: {totalAmount?: {amount?: string | null} | null} | null;
      merchandise?: {id?: string | null} | null;
    }> | null;
  } | null;
}

/** One Storefront cart line -> one loader line item. */
export function toLoaderLine(line: NonNullable<NonNullable<LoaderSourceCart['lines']>['nodes']>[number], cart: LoaderSourceCart) {
  return {
    // The Storefront CartLine gid is the opaque line key the loader echoes back
    // to changeLine (which feeds it to cart.updateLines / cart.removeLines).
    id: line?.id ?? '',
    variant_id: gidToNumericId(line?.merchandise?.id),
    quantity: line?.quantity ?? 0,
    properties: attributesToProperties(line?.attributes),
    final_line_price: toCents(line?.cost?.totalAmount?.amount),
    discounts: cartDiscountTitles(cart),
  };
}

/** A Storefront cart -> the `{ items }` object the loader's getCart returns. */
export function toLoaderCart(cart?: LoaderSourceCart | null) {
  const nodes = cart?.lines?.nodes ?? [];
  return {items: nodes.map((line) => toLoaderLine(line, cart ?? {}))};
}
