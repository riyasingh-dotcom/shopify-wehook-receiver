import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

type TokenResponse = {
  access_token: string
  scope: string
}

// Validates the HMAC Shopify appends to the callback URL.
// Docs: https://shopify.dev/docs/apps/auth/oauth/getting-started#verify-a-request
function validateHmac(params: URLSearchParams, secret: string): boolean {
  const receivedHmac = params.get('hmac')
  if (!receivedHmac) return false

  const message = Array.from(params.entries())
    .filter(([key]) => key !== 'hmac')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')

  const computed = crypto
    .createHmac('sha256', secret)
    .update(message)
    .digest('hex')

  // timingSafeEqual prevents timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(computed, 'hex'),
    Buffer.from(receivedHmac, 'hex'),
  )
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = request.nextUrl

  const code = searchParams.get('code')
  const shop = searchParams.get('shop')
  const state = searchParams.get('state')
  const host = searchParams.get('host') ?? ''

  // 1. Validate required params
  if (!code || !shop || !state) {
    return new NextResponse('Missing required OAuth parameters', { status: 400 })
  }

  // 2. CSRF — compare state with the nonce stored before the OAuth redirect
  const storedState = request.cookies.get('shopify_oauth_state')?.value
  if (!storedState || state !== storedState) {
    return new NextResponse('State mismatch — possible CSRF attack', { status: 403 })
  }

  // 3. HMAC — verify the callback was genuinely sent by Shopify
  const apiSecret = process.env.SHOPIFY_API_SECRET
  if (!apiSecret) {
    return new NextResponse('SHOPIFY_API_SECRET is not configured', { status: 500 })
  }
  if (!validateHmac(searchParams, apiSecret)) {
    return new NextResponse('Invalid HMAC signature', { status: 401 })
  }

  // 4. Exchange the one-time code for a permanent access token
  const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.NEXT_PUBLIC_SHOPIFY_API_KEY,
      client_secret: apiSecret,
      code,
    }),
  })

  if (!tokenRes.ok) {
    const body = await tokenRes.text()
    console.error('Token exchange failed:', tokenRes.status, body)
    return new NextResponse('Failed to exchange authorization code', { status: 502 })
  }

  const { access_token } = (await tokenRes.json()) as TokenResponse

  // 5. Redirect back into the Shopify admin with the embedded app params
  const appUrl = new URL('/', request.nextUrl.origin)
  appUrl.searchParams.set('shop', shop)
  appUrl.searchParams.set('host', host)

  const response = NextResponse.redirect(appUrl)

  // Store the access token in a secure HTTP-only cookie.
  // sameSite:'none' is required for embedded apps running inside an iframe.
  response.cookies.set('shopify_access_token', access_token, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  })

  // Clear the one-time OAuth state cookie
  response.cookies.delete('shopify_oauth_state')

  return response
}
