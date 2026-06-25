import type { Metadata } from 'next'
import { ShopifyProviders } from './providers'

export const metadata: Metadata = {
  title: 'Shopify Webhook Dashboard',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <ShopifyProviders>{children}</ShopifyProviders>
      </body>
    </html>
  )
}
