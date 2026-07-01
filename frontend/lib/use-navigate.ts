'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';

// App Bridge v4 syncs the Shopify Admin URL automatically via postMessage.
// We preserve ?embedded=1 so the target page's useEffect guards still fire.
export function useNavigate(): (path: string) => void {
  const router = useRouter();
  return useCallback(
    (path: string) => {
      const search =
        typeof window !== 'undefined' ? window.location.search : '';
      const dest = search ? `${path}${search}` : path;
      router.push(dest);
    },
    [router],
  );
}
