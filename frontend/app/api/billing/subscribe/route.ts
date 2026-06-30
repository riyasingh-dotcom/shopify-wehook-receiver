import { NextRequest, NextResponse } from 'next/server'

const VALID_PLAN = new Set(['basic', 'pro'])
const SHOP_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/

type TokenExchangeResponse = {
  access_token: string
  expires_in: number
  token_type: string
}

type SubscribeResponse = { confirmationUrl: string }

async function exchangeSessionToken(shop: string, sessionToken: string): Promise<string> {
  const clientId = process.env.NEXT_PUBLIC_SHOPIFY_API_KEY
  const clientSecret = process.env.SHOPIFY_API_SECRET

  if (!clientId || !clientSecret) {
    throw new Error('Shopify API credentials not configured')
  }

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    client_id: clientId,
    client_secret: clientSecret,
    subject_token: sessionToken,
    subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
  })

  const res = await fetch(`https://${shop}/admin/oauth/access_tokens/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Token exchange failed (${res.status}): ${text}`)
  }

  const { access_token } = (await res.json()) as TokenExchangeResponse
  return access_token
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get('authorization')
  const sessionToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null

  if (!sessionToken) {
    return NextResponse.json({ error: 'Not authenticated — no session token provided' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const b = body as Record<string, unknown>
  const plan = b['plan']
  const shop = b['shop']

  if (typeof plan !== 'string' || !VALID_PLAN.has(plan)) {
    return NextResponse.json({ error: 'plan must be "basic" or "pro"' }, { status: 400 })
  }
  if (typeof shop !== 'string' || !SHOP_REGEX.test(shop)) {
    return NextResponse.json({ error: 'Invalid shop domain' }, { status: 400 })
  }

  let accessToken: string
  try {
    accessToken = await exchangeSessionToken(shop, sessionToken)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('Token exchange error:', msg)
    return NextResponse.json({ error: msg }, { status: 401 })
  }

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? ''

  const res = await fetch(`${apiUrl}/billing/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shopDomain: shop, plan, accessToken }),
  })

  if (!res.ok) {
    const text = await res.text()
    return NextResponse.json({ error: text }, { status: res.status })
  }

  const data = (await res.json()) as SubscribeResponse
  return NextResponse.json(data)
}
