import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export async function GET(): Promise<NextResponse> {
  const cookieStore = await cookies()
  const hasToken = Boolean(cookieStore.get('shopify_access_token')?.value)
  return NextResponse.json(
    { authenticated: hasToken },
    { status: hasToken ? 200 : 401 },
  )
}
