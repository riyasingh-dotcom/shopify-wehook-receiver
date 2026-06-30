import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

const SCOPES = 'read_orders,read_products'

export async function GET(request: NextRequest): Promise<NextResponse> {
  const shop = request.nextUrl.searchParams.get('shop')

  if (!shop || !shop.endsWith('.myshopify.com')) {
    return new NextResponse('Missing or invalid shop parameter', { status: 400 })
  }

  // Generate a random nonce to prevent CSRF attacks
  const state = crypto.randomBytes(16).toString('hex')

  // Use forwarded headers so the URI is the public domain, not Railway's internal hostname
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? request.nextUrl.host
  const proto = request.headers.get('x-forwarded-proto')?.split(',')[0].trim() ?? 'https'
  const redirectUri = `${proto}://${host}/api/auth/callback`

  const authUrl = new URL(`https://${shop}/admin/oauth/authorize`)
  authUrl.searchParams.set('client_id', process.env.NEXT_PUBLIC_SHOPIFY_API_KEY!)
  authUrl.searchParams.set('scope', SCOPES)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('state', state)

  const response = NextResponse.redirect(authUrl.toString())

  // Persist nonce in a short-lived cookie — verified in the callback
  response.cookies.set('shopify_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 300, // 5 minutes — just long enough to complete the OAuth round-trip
  })

  return response
}
