'use client'

import { useCallback } from 'react'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? ''

// App Bridge v4 injects window.shopify asynchronously after the iframe loads.
// Poll up to 2 s before giving up — fast enough to not delay dev, long enough
// for Admin to inject the global on a cold iframe load.
export async function getIdToken(): Promise<string | undefined> {
  // 1. Already available — fastest path (SPA navigation inside Admin)
  if (window.shopify) {
    await window.shopify.ready
    return window.shopify.idToken()
  }

  // 2. Not available yet — wait up to 2 s (initial iframe load by Admin)
  const token = await new Promise<string | undefined>((resolve) => {
    let elapsed = 0
    const id = setInterval(async () => {
      if (window.shopify) {
        clearInterval(id)
        await window.shopify.ready
        resolve(await window.shopify.idToken())
        return
      }
      elapsed += 50
      if (elapsed >= 2000) {
        clearInterval(id)
        resolve(undefined)
      }
    }, 50)
  })

  if (token) return token

  // 3. Fall back to id_token URL param (Shopify passes it on every Admin load)
  return new URLSearchParams(window.location.search).get('id_token') ?? undefined
}

export function useAuthenticatedFetch() {
  return useCallback(
    async (path: string, options: RequestInit = {}): Promise<Response> => {
      const token = await getIdToken()

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(options.headers as Record<string, string> | undefined),
      }

      if (token) {
        headers['Authorization'] = `Bearer ${token}`
      }

      return fetch(`${API_URL}${path}`, { ...options, headers })
    },
    [],
  )
}
