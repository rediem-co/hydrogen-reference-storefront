/// <reference types="vite/client" />
/// <reference types="react-router" />
/// <reference types="@shopify/oxygen-workers-types" />
/// <reference types="@shopify/hydrogen/react-router-types" />

// Enhance TypeScript's built-in typings.
import '@total-typescript/ts-reset';

declare global {
  // Server-only env vars for the rediem widget integration.
  // These are read in loaders/server code via `context.env.*` and must NOT
  // be prefixed `PUBLIC_` — REDIEM_CREDENTIAL in particular must stay server-side.
  interface Env {
    /** Origin of the rediem widget iframe, e.g. https://widget.rediemsandbox.dev. Used for the CSP. */
    REDIEM_WIDGET_URL: string;
    /** Origin of the rediem customer-facing API, e.g. https://api.rediemsandbox.dev. Used for the CSP. */
    REDIEM_API_URL: string;
    /** Full URL of the rediem session exchange, e.g. https://storepanel.<rediem host>/api/headless/sessions */
    REDIEM_EXCHANGE_URL: string;
    /** This store's rediem credential (rdm_<environment>_<keyId>_<secret>), issued by rediem. Server-only. */
    REDIEM_CREDENTIAL: string;
    /** Overrides the loader URL to embed, e.g. a pre-release channel. Derived from REDIEM_API_URL when unset. */
    REDIEM_LOADER_URL?: string;
    /** Origin the loader fetches store settings and imagery from, e.g. https://ripplrewards.nyc3.digitaloceanspaces.com. Used for the CSP. */
    REDIEM_ASSET_URL: string;
  }
}
