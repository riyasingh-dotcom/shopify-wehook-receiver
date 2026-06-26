'use client';

import { Tabs } from '@shopify/polaris';
import { usePathname } from 'next/navigation';
import { useCallback } from 'react';
import { useNavigate } from '@/lib/use-navigate';

const TABS = [
  { id: 'dashboard', content: 'Dashboard' },
  { id: 'products', content: 'Product Change History' },
];

const PATHS = ['/', '/products'] as const;

export function AppNavTabs() {
  const pathname = usePathname();
  const navigate = useNavigate();

  const idx = (PATHS as readonly string[]).indexOf(pathname);
  const selected = idx === -1 ? 0 : idx;

  const handleSelect = useCallback(
    (index: number) => navigate(PATHS[index]),
    [navigate],
  );

  return <Tabs tabs={TABS} selected={selected} onSelect={handleSelect} />;
}
