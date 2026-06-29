'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Banner,
  BlockStack,
  Card,
  Layout,
  Page,
  SkeletonBodyText,
  SkeletonDisplayText,
  SkeletonPage,
} from '@shopify/polaris';
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';
import { SearchBar } from '../components/SearchBar';
import {
  ProductChangeTable,
  type ProductChange,
} from '../components/ProductChangeTable';

// ── Skeleton ───────────────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <SkeletonPage title="Product Change History" fullWidth>
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <SkeletonDisplayText size="small" maxWidth="20ch" />
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <SkeletonBodyText key={i} lines={1} />
              ))}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </SkeletonPage>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function ProductChangesPage() {
  const [changes, setChanges] = useState<ProductChange[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const loadChanges = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/products/changes`);
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = (await res.json()) as ProductChange[];
      data.sort(
        (a, b) =>
          new Date(b.changedAt).getTime() - new Date(a.changedAt).getTime(),
      );
      setChanges(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load changes');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadChanges();
  }, [loadChanges]);

  const filteredChanges = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return changes;
    return changes.filter((c) => c.productTitle.toLowerCase().includes(q));
  }, [changes, filter]);

  if (loading) return <LoadingSkeleton />;

  return (
    <Page
      fullWidth
      title="Product Change History"
      subtitle="Field-level audit log of every product update"
      secondaryActions={[
        { content: 'Refresh', onAction: () => void loadChanges() },
      ]}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <SearchBar
                value={filter}
                onChange={setFilter}
                placeholder="Search products..."
              />

              {error ? (
                <Banner tone="critical" title="Failed to load changes">
                  <p>{error}</p>
                </Banner>
              ) : (
                <ProductChangeTable
                  changes={filteredChanges}
                  isFiltered={filter.trim().length > 0}
                />
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
