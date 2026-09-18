import {redirect} from 'react-router';
import type {Route} from './+types/account_.logout';

// if we don't implement this, /account/logout will get caught by account.$.tsx to do login
export async function loader() {
  return redirect('/');
}

/**
 * Before ending the customer session, strip rediem **reward** artifacts from the
 * cart so a member's reward can't carry over to a guest session. The Hydrogen
 * cart is anonymous and survives logout by design, so we clean it explicitly:
 *
 *   1. Remove cart lines that carry a `_rediem_*` attribute (gift-card / free-
 *      product rewards added by the widget's add-to-cart flows).
 *   2. Clear the cart's discount codes — order-discount rewards
 *      (`rdm_apply_discount`) leave only a discount code, no line.
 *
 * Ordinary (non-reward) line items are left untouched. The cart id is unchanged
 * by these mutations, so the existing cart cookie still resolves on the next
 * load — no header merging needed; we just persist the removals server-side
 * before handing off to `customerAccount.logout()`.
 *
 * Assumption: in this reference storefront all cart discount codes originate
 * from rediem redemptions, so clearing them all is correct. For a multi-tenant
 * production storefront, tag rediem-applied codes (e.g. a `_rediem_codes` cart
 * attribute set when the code is applied) and remove only those, leaving
 * shopper-entered codes intact.
 */
async function clearRediemRewards(cart: Route.ActionArgs['context']['cart']) {
  try {
    const current = await cart.get();
    console.log(
      '[rediem][logout] cart.get →',
      JSON.stringify({
        cartId: current?.id ?? null,
        lineCount: current?.lines?.nodes?.length ?? 0,
        lines: (current?.lines?.nodes ?? []).map((l: any) => ({
          id: l.id,
          variant: l.merchandise?.id,
          attrs: l.attributes,
        })),
        discountCodes: current?.discountCodes ?? [],
      }),
    );
    if (!current) return;

    const rewardLineIds = (current.lines?.nodes ?? [])
      .filter((line) =>
        (line.attributes ?? []).some((attr) =>
          attr?.key?.startsWith('_rediem_'),
        ),
      )
      .map((line) => line.id);

    console.log('[rediem][logout] reward line ids to remove →', rewardLineIds);

    if (rewardLineIds.length) {
      const r = await cart.removeLines(rewardLineIds);
      console.log(
        '[rediem][logout] removeLines result lineCount →',
        r?.cart?.lines?.nodes?.length ?? '?',
        'errors:',
        JSON.stringify(r?.errors ?? []),
      );
    }

    const hasDiscounts = (current.discountCodes ?? []).some(
      (code) => code?.code,
    );
    if (hasDiscounts) {
      const r = await cart.updateDiscountCodes([]);
      console.log(
        '[rediem][logout] updateDiscountCodes([]) result codes →',
        JSON.stringify(r?.cart?.discountCodes ?? []),
        'errors:',
        JSON.stringify(r?.errors ?? []),
      );
    }
  } catch (error) {
    // Never block logout on cart cleanup.
    console.error('[rediem] reward cleanup on logout failed', error);
  }
}

export async function action({context}: Route.ActionArgs) {
  await clearRediemRewards(context.cart);
  return context.customerAccount.logout();
}
