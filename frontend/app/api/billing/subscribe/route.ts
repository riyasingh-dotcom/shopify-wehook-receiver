import { NextRequest, NextResponse } from 'next/server'

const VALID_PLAN = new Set(['basic', 'pro'])
const SHOP_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/

type SubscribeResponse = { confirmationUrl: string }

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

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? ''

  // Pass the session token to the NestJS backend — it uses the Shopify SDK
  // to exchange it for an online access token (avoids Cloudflare blocking raw fetches).
  const res = await fetch(`${apiUrl}/billing/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shopDomain: shop, plan, sessionToken }),
  })

  if (!res.ok) {
    const text = await res.text()
    return NextResponse.json({ error: text }, { status: res.status })
  }

  const data = (await res.json()) as SubscribeResponse
  return NextResponse.json(data)
}
