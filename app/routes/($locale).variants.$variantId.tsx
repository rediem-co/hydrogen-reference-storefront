import {
  Link,
  isRouteErrorResponse,
  redirect,
  useRouteError,
  type LoaderFunctionArgs,
} from 'react-router';
import {getProductUrlForVariant, parseNumericVariantId} from '~/lib/variants';

/**
 * Resolves a numeric product variant id to the product page that sells it.
 *
 * Rediem's widget knows a reward product only by its variant id. Shopify's Online
 * Store answers `/variants/<id>` with a redirect to the product page, so that is
 * the shape both the rediem loader's own fallback and this storefront's adapter
 * (`viewProduct` in `app/lib/rediem/hydrogenAdapter.ts`) reach for. Hydrogen
 * serves nothing at that path by default — products are addressed by handle — so
 * without this route a shopper following a reward would land on the catch-all 404.
 *
 * The lookup runs here rather than in the adapter on purpose: it needs no
 * storefront access token in the browser, it is one round trip either way, and it
 * fixes the loader's fallback at the same time, so an adapter that implements
 * neither navigation method still takes the shopper somewhere real.
 *
 * A variant that no longer exists is answered with a 404 and the error state
 * below, which renders inside the page layout, so the shopper sees why nothing
 * opened and the rediem widget stays mounted beside it.
 */
export async function loader({context, params, request}: LoaderFunctionArgs) {
  const variantId = parseNumericVariantId(params.variantId);
  if (!variantId) {
    throw new Response('That product link is not a valid variant id.', {
      status: 400,
    });
  }

  const {node} = await context.storefront.query(VARIANT_PRODUCT_QUERY, {
    variables: {variantId: `gid://shopify/ProductVariant/${variantId}`},
  });

  const variant = node && 'product' in node ? node : null;
  const productUrl = getProductUrlForVariant({
    variant,
    pathname: new URL(request.url).pathname,
  });

  if (!productUrl) {
    console.error('[rediem] no product found for variant', {variantId});
    throw new Response('This product is no longer available.', {status: 404});
  }

  return redirect(productUrl);
}

// The loader either redirects or throws, so this renders only if React Router is
// asked for an element; it exists to keep the router from warning about its absence.
export default function VariantRedirect() {
  return null;
}

export function ErrorBoundary() {
  const error = useRouteError();
  const reason = isRouteErrorResponse(error)
    ? error.data
    : 'Something went wrong while looking that product up.';

  return (
    <div className="route-error">
      <h1>We could not open that product</h1>
      <p>{reason}</p>
      <Link to="/collections/all">Browse all products</Link>
    </div>
  );
}

const VARIANT_PRODUCT_QUERY = `#graphql
  query VariantProduct(
    $country: CountryCode
    $language: LanguageCode
    $variantId: ID!
  ) @inContext(country: $country, language: $language) {
    node(id: $variantId) {
      ... on ProductVariant {
        id
        selectedOptions {
          name
          value
        }
        product {
          handle
        }
      }
    }
  }
` as const;
