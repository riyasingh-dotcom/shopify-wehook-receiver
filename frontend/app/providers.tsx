'use client'

import { AppProvider as PolarisProvider, Frame } from '@shopify/polaris'
import enTranslations from '@shopify/polaris/locales/en.json'
import '@shopify/polaris/build/esm/styles.css'
import { ErrorBoundary } from './components/ErrorBoundary'

export function ShopifyProviders({ children }: { children: React.ReactNode }) {
  return (
    <PolarisProvider i18n={enTranslations}>
      <Frame>
        <ErrorBoundary>{children}</ErrorBoundary>
      </Frame>
    </PolarisProvider>
  )
}
