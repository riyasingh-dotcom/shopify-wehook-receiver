'use client'

import { useCallback } from 'react'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? ''

// useAppBridge() from @shopify/app-bridge-react is a thin wrapper that returns
// window.shopify. We access it directly inside the callback so we can apply the
// id_token URL fallback without crashing at render time — window.shopify is only
// injected by Shopify admin after a completed OAuth install.
export function useAuthenticatedFetch() {
  return useCallback(
    async (path: string, options: RequestInit = {}): Promise<Response> => {
      let token: string

      if (window.shopify) {
        // Post-OAuth: App Bridge v4 manages session token refresh automatically
        token = await window.shopify.idToken()
      } else {
        // Pre-OAuth / dev: Shopify passes id_token as a URL param on every iframe load
        token = new URLSearchParams(window.location.search).get('id_token') ?? ''
        if (!token) {
          throw new Error(
            'Not in Shopify embedded context — open this app from the Shopify admin.',
          )
        }
      }

      return fetch(`${API_URL}${path}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers as Record<string, string> | undefined),
          Authorization: `Bearer ${token}`,
        },
      })
    },
    [],
  )
}
