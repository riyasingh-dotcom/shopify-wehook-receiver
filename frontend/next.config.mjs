/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ['*.ngrok-free.dev', '*.ngrok-free.app', '*.ngrok.io', '*.trycloudflare.com'],
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            // Allow Shopify Admin to embed this app in an iframe
            key: 'Content-Security-Policy',
            value: "frame-ancestors https://*.myshopify.com https://admin.shopify.com",
          },
        ],
      },
    ]
  },
}

export default nextConfig
