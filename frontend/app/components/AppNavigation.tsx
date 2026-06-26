// Server component — no 'use client'. NavMenu is the string 'ui-nav-menu';
// it uses no hooks or browser APIs. Rendering server-side means React never
// hydrates this element, so App Bridge can upgrade <ui-nav-menu> once without
// React reconciliation overwriting the custom element state.
import { NavMenu } from '@shopify/app-bridge-react';

export function AppNavigation() {
  return (
    <NavMenu>
      <a href="/" rel="home">
        Dashboard
      </a>
      <a href="/products">Product Changes</a>
    </NavMenu>
  );
}
