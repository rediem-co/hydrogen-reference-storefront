import {ServerRouter} from 'react-router';
import {isbot} from 'isbot';
import {renderToReadableStream} from 'react-dom/server';
import {
  createContentSecurityPolicy,
  type HydrogenRouterContextProvider,
} from '@shopify/hydrogen';
import type {EntryContext} from 'react-router';
import {resolveLoaderUrl} from '~/lib/rediem/loaderUrl';

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  reactRouterContext: EntryContext,
  context: HydrogenRouterContextProvider,
) {
  // The rediem hosts differ per rediem environment (sandbox vs production), so the
  // policy is built from the same env vars the integration reads instead of literals.
  // Resolved through the same helper the script tag uses, so the policy can never allow a
  // different origin from the one actually requested.
  const rediemLoader = originOf(resolveLoaderUrl(context.env));
  const rediemWidget = originOf(context.env.REDIEM_WIDGET_URL);
  const rediemApi = originOf(context.env.REDIEM_API_URL);
  const rediemExchange = originOf(context.env.REDIEM_EXCHANGE_URL);
  const rediemAssets = originOf(context.env.REDIEM_ASSET_URL);

  const {nonce, header, NonceProvider} = createContentSecurityPolicy({
    // The loader script itself.
    scriptSrc: ["'self'", 'https://cdn.shopify.com', ...defined(rediemLoader)],
    // Widget API calls, the app backend behind the loader, and the store-settings JSON on the asset origin.
    connectSrc: [
      "'self'",
      ...defined(rediemApi, rediemExchange, rediemLoader, rediemAssets),
    ],
    // The widget renders in an iframe served from the rediem widget app.
    // frame-src/child-src have no defaults, so include 'self' explicitly.
    frameSrc: ["'self'", ...defined(rediemWidget)],
    childSrc: ["'self'", ...defined(rediemWidget)],
    // Google Fonts (loader `@import`) + rediem widget side-panel stylesheet.
    styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    // font-src has no default: include 'self' + the Google Fonts file host.
    fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
    // Launch-button icon + any API-served imagery.
    imgSrc: [
      "'self'",
      'data:',
      'https://cdn.shopify.com',
      ...defined(rediemLoader, rediemApi, rediemAssets),
    ],
    shop: {
      checkoutDomain: context.env.PUBLIC_CHECKOUT_DOMAIN,
      storeDomain: context.env.PUBLIC_STORE_DOMAIN,
    },
  });

  const body = await renderToReadableStream(
    <NonceProvider>
      <ServerRouter
        context={reactRouterContext}
        url={request.url}
        nonce={nonce}
      />
    </NonceProvider>,
    {
      nonce,
      signal: request.signal,
      onError(error) {
        console.error(error);
        responseStatusCode = 500;
      },
    },
  );

  if (isbot(request.headers.get('user-agent'))) {
    await body.allReady;
  }

  responseHeaders.set('Content-Type', 'text/html');
  responseHeaders.set('Content-Security-Policy', header);

  return new Response(body, {
    headers: responseHeaders,
    status: responseStatusCode,
  });
}

function originOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

function defined(...values: Array<string | undefined>): string[] {
  return values.filter((value): value is string => Boolean(value));
}
