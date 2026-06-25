'use client'

import { AppProvider as PolarisProvider } from '@shopify/polaris'
import enTranslations from '@shopify/polaris/locales/en.json'
import '@shopify/polaris/build/esm/styles.css'

// App Bridge v4 has no AppProvider — window.shopify is injected automatically
// by Shopify admin when the app loads in the iframe. useAppBridge() reads it.
export function ShopifyProviders({ children }: { children: React.ReactNode }) {
  return (
    <PolarisProvider i18n={enTranslations}>{children}</PolarisProvider>
  )
}
