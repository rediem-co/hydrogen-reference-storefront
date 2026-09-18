import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveCartAdapterChoice } from './cartAdapterSelection';

const A_USABLE_STOREFRONT_API_TOKEN = 'a-public-storefront-token';

afterEach(() => {
  vi.restoreAllMocks();
});

function silenceConsoleError() {
  return vi.spyOn(console, 'error').mockImplementation(() => {});
}

describe('resolveCartAdapterChoice', () => {
  it('keeps the Storefront API adapter when the storefront supplies a public access token', () => {
    expect(
      resolveCartAdapterChoice({
        configuredChoice: 'storefrontApi',
        publicStorefrontApiToken: A_USABLE_STOREFRONT_API_TOKEN,
      }),
    ).toBe('storefrontApi');
  });

  // Without a token every Storefront API call fails authentication, and the shopper sees a widget
  // that simply does nothing, so fall back to the adapter that needs no token.
  it('falls back to the Hydrogen adapter when the Storefront API token is missing', () => {
    silenceConsoleError();

    expect(
      resolveCartAdapterChoice({ configuredChoice: 'storefrontApi', publicStorefrontApiToken: '' }),
    ).toBe('hydrogen');
  });

  it('falls back to the Hydrogen adapter when the Storefront API token is only whitespace', () => {
    silenceConsoleError();

    expect(
      resolveCartAdapterChoice({ configuredChoice: 'storefrontApi', publicStorefrontApiToken: '   ' }),
    ).toBe('hydrogen');
  });

  it('reports the missing Storefront API token rather than failing every cart call in silence', () => {
    const consoleError = silenceConsoleError();

    resolveCartAdapterChoice({ configuredChoice: 'storefrontApi', publicStorefrontApiToken: '' });

    expect(consoleError).toHaveBeenCalledTimes(1);
  });

  it('keeps the Hydrogen adapter when it is the configured choice and no token is supplied', () => {
    const consoleError = silenceConsoleError();

    expect(resolveCartAdapterChoice({ configuredChoice: 'hydrogen', publicStorefrontApiToken: '' })).toBe(
      'hydrogen',
    );
    expect(consoleError).not.toHaveBeenCalled();
  });
});
