// Minimal Customer Account API query used to identify the logged-in customer for
// the rediem widget. `id` is a GID (gid://shopify/Customer/<numeric>) — the numeric
// part becomes `data-rdm_id`. Fields here are all available on the Customer Account
// API (note `emailAddress`/`phoneNumber` are nested objects).
export const REDIEM_CUSTOMER_QUERY = `#graphql
  query RediemCustomer {
    customer {
      id
      firstName
      lastName
      emailAddress {
        emailAddress
      }
      phoneNumber {
        phoneNumber
      }
      tags
    }
  }
` as const;
