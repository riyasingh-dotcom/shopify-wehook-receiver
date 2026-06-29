import { type NextRequest, NextResponse } from 'next/server'

const BACKEND = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000'

// Proxy Shopify webhook deliveries to the NestJS backend.
// NestJS needs the raw bytes for HMAC verification, so we forward the body
// as an ArrayBuffer without any re-parsing.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.arrayBuffer()

  const headers: Record<string, string> = {}
  for (const key of [
    'content-type',
    'x-shopify-hmac-sha256',
    'x-shopify-topic',
    'x-shopify-shop-domain',
    'x-shopify-webhook-id',
    'x-shopify-api-version',
  ]) {
    const value = req.headers.get(key)
    if (value) headers[key] = value
  }

  const res = await fetch(`${BACKEND}/webhooks/shopify`, {
    method: 'POST',
    headers,
    body,
  })

  return new NextResponse(null, { status: res.status })
}
