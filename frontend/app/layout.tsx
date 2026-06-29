import type { Metadata } from 'next';
import { ShopifyProviders } from './providers';
import { AppNavigation } from './components/AppNavigation';
import { AppNavTabs } from './components/AppNavTabs';

export const metadata: Metadata = {
  title: 'Shopify Webhook Dashboard',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const apiKey = process.env.NEXT_PUBLIC_SHOPIFY_API_KEY ?? ''

  return (
    <html lang="en">
      <head>
        {/* App Bridge v4: Client ID (not secret) required here.
            NEXT_PUBLIC_SHOPIFY_API_KEY must be the 32-char hex Client ID
            from Partners Dashboard → API credentials, NOT the shpss_ secret. */}
        <meta name="shopify-api-key" content={apiKey} />
        {/* Synchronous, no async/defer — App Bridge validates at startup that it
            was not loaded async. next/script beforeInteractive adds async in App
            Router, so we use a plain script tag here instead. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js" />
      </head>
      <body>
        {/* ui-nav-menu is read by App Bridge and rendered in the Shopify Admin
            sidebar — it produces no visible output inside the iframe itself.
            Do NOT apply display:none; it prevents child discovery on upgrade. */}
        <AppNavigation />
        <ShopifyProviders>
          <AppNavTabs />
          {children}
        </ShopifyProviders>
      </body>
    </html>
  )
}
