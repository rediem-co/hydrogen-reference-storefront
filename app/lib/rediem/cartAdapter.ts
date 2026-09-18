/**
 * The contract the rediem loader consumes.
 *
 * The loader is handed one adapter object at boot, via
 * `window.rediem.mount({adapter})`. The eight cart and identity methods are
 * mandatory: the loader never feature-detects them, so a missing one throws at the
 * first call site. The two navigation methods below are optional — the loader does
 * feature-detect those, and falls back to the Online Store URLs `/collections/all`
 * and `/variants/<id>` when an adapter leaves them out.
 *
 * Both adapter implementations in this folder satisfy this interface, which is
 * what lets `cartAdapterSelection.ts` swap one for the other.
 */

/** One cart line in the shape the loader reads (the Online Store `/cart.js` shape). */
export interface RediemCartLine {
  /** The opaque line key the loader echoes back to `changeLine` when removing a line. */
  id: string;
  variant_id: number;
  quantity: number;
  properties: Record<string, string>;
  /** Line total in minor units. */
  final_line_price: number;
  /** Never null: the loader dereferences `.length` on it without a guard. */
  discounts: Array<{title: string}>;
}

export interface RediemCart {
  items: RediemCartLine[];
}

export interface RediemAddLineInput {
  /** A numeric product variant id, or its string form. */
  id: string | number;
  quantity: number;
  properties?: Record<string, string>;
}

export interface RediemChangeLineInput {
  /**
   * Either a cart line key handed out by `getCart`, or a numeric variant id.
   * The loader passes a line key when removing a line and a variant id from its
   * per-cart-limit enforcement paths, so an adapter must accept both.
   */
  id: string | number;
  quantity: number;
}

export interface RediemSignInOptions {
  create?: boolean;
}

export interface RediemViewProductInput {
  /** A numeric product variant id. The loader reduces the variant gid before calling. */
  variantId: number;
}

/**
 * Invoked after every cart mutation. The loader calls `response.clone().json()`
 * on the argument, so it must be a real `Response` carrying the full cart.
 */
export type RediemCartChangedHandler = (response: Response) => void | Promise<void>;

export interface RediemCartAdapter {
  /** Must resolve to a `Response`; the loader reads `.status`, `.ok` and `.text()`. */
  getSession(): Promise<Response>;
  signIn(options?: RediemSignInOptions): void;
  getCart(): Promise<RediemCart>;
  goToCart(): void;
  /** The loader reads `.ok` to decide whether to stop retrying the code. */
  applyDiscountCode(code: string): Promise<Response>;
  /** On a non-ok result the loader reads `.json()` and expects `{message, description}`. */
  addLine(input: RediemAddLineInput): Promise<Response>;
  changeLine(input: RediemChangeLineInput): Promise<Response>;
  onCartChanged(handler: RediemCartChangedHandler): void;
  /** Show the shopper everything available to buy. Optional; the loader falls back to `/collections/all`. */
  browseProducts?(): void;
  /** Show the shopper one product variant. Optional; the loader falls back to `/variants/<id>`. */
  viewProduct?(input: RediemViewProductInput): void;
}
