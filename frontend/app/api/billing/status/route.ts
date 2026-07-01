import { NextRequest, NextResponse } from 'next/server'

const SHOP_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/

export async function GET(request: NextRequest): Promise<NextResponse> {
  const shop = request.nextUrl.searchParams.get('shop')

  if (!shop || !SHOP_REGEX.test(shop)) {
    return NextResponse.json({ error: 'Invalid or missing shop domain' }, { status: 400 })
  }

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? ''

  try {
    const res = await fetch(`${apiUrl}/billing/status?shop=${encodeURIComponent(shop)}`)
    const data: unknown = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch billing status' }, { status: 502 })
  }
}
