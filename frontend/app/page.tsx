'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Card,
  EmptyState,
  Grid,
  IndexTable,
  InlineStack,
  Layout,
  Page,
  SkeletonBodyText,
  SkeletonDisplayText,
  SkeletonPage,
  SkeletonTabs,
  Spinner,
  Tabs,
  Text,
} from '@shopify/polaris';
import { useAuthenticatedFetch } from '@/lib/authenticated-fetch';

// ── Types ──────────────────────────────────────────────────────────────────────

type LineItem = { title: string; quantity: number; price: string };

type OrderPayload = {
  order_number: number;
  total_price: string;
  currency: string;
  financial_status: string;
  customer?: { email?: string; first_name?: string; last_name?: string } | null;
  line_items: LineItem[];
};

type ProductChangePayload = {
  productTitle: string;
  field: string;
  oldValue: string | null;
  newValue: string;
  productId: string;
};

type WebhookEvent = {
  id: string;
  topic: string;
  shopDomain: string;
  payload: Record<string, unknown>;
  status: string;
  createdAt: string;
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(iso));
}

function relativeTime(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return formatDate(iso);
}

function isOrder(
  p: Record<string, unknown>,
): p is Record<string, unknown> & OrderPayload {
  return typeof p.order_number === 'number' && Array.isArray(p.line_items);
}

function isProductChange(
  p: Record<string, unknown>,
): p is Record<string, unknown> & ProductChangePayload {
  return typeof p.field === 'string' && 'newValue' in p;
}

function customerName(p: OrderPayload): string {
  if (!p.customer) return 'Guest';
  const name = [p.customer.first_name, p.customer.last_name]
    .filter(Boolean)
    .join(' ');
  return name || p.customer.email || 'Guest';
}

function itemSummary(items: LineItem[]): string {
  if (items.length === 0) return '—';
  const first = `${items[0].title} ×${items[0].quantity}`;
  return items.length > 1 ? `${first} +${items.length - 1} more` : first;
}

function paymentBadge(status: string) {
  const tone =
    status === 'paid'
      ? 'success'
      : status === 'refunded'
        ? 'info' // informational, not actionable
        : status === 'voided'
          ? 'critical'
          : 'attention'; // pending
  return <Badge tone={tone}>{status}</Badge>;
}

function fieldBadge(field: string) {
  const tone =
    field === 'status'
      ? 'warning'
      : field === 'price'
        ? 'info'
        : field === 'title'
          ? 'success'
          : 'attention';
  return <Badge tone={tone}>{field}</Badge>;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  helpText,
}: {
  label: string;
  value: string;
  helpText: string;
}) {
  return (
    <Card>
      <BlockStack gap="100">
        <Text as="p" variant="bodySm" tone="subdued">
          {label}
        </Text>
        <Text as="p" variant="headingXl">
          {value}
        </Text>
        <Text as="p" variant="bodySm" tone="subdued">
          {helpText}
        </Text>
      </BlockStack>
    </Card>
  );
}

const SKELETON_COL_WIDTHS = [
  '6ch',
  '10ch',
  '24ch',
  '10ch',
  '9ch',
  '10ch',
] as const;

function Loadingskeleton() {
  return (
    <SkeletonPage title="Activity Feed" fullWidth primaryAction>
      <Layout>
        {/* 3-column KPI stat cards: label / big value / help text */}
        <Layout.Section>
          <Grid>
            {[0, 1, 2].map((i) => (
              <Grid.Cell
                key={i}
                columnSpan={{ xs: 6, sm: 2, md: 4, lg: 4, xl: 4 }}
              >
                <Card>
                  <BlockStack gap="200">
                    <SkeletonBodyText lines={1} />
                    <SkeletonDisplayText size="large" />
                    <SkeletonBodyText lines={1} />
                  </BlockStack>
                </Card>
              </Grid.Cell>
            ))}
          </Grid>
        </Layout.Section>

        {/* Activity card: header + tabs + column headers + data rows */}
        <Layout.Section>
          <Card padding="0">
            {/* "Recent Activity" title (left) + Live badge (right) */}
            <Box paddingBlock="400" paddingInline="400">
              <InlineStack align="space-between" blockAlign="center">
                <SkeletonDisplayText size="small" maxWidth="14ch" />
                <SkeletonDisplayText size="small" maxWidth="4ch" />
              </InlineStack>
            </Box>

            {/* Orders / Product Audit Log tabs */}
            <SkeletonTabs count={2} fitted />

            {/* Column header row — widths match Order/Customer/Items/Total/Payment/Received */}
            <Box
              paddingBlock="300"
              paddingInline="400"
              background="bg-surface-secondary"
            >
              <InlineStack gap="400" wrap={false}>
                {SKELETON_COL_WIDTHS.map((w, i) => (
                  <SkeletonDisplayText key={i} size="small" maxWidth={w} />
                ))}
              </InlineStack>
            </Box>

            {/* Data rows — same 6-cell layout as the IndexTable rows */}
            <BlockStack>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <Box
                  key={i}
                  paddingBlock="400"
                  paddingInline="400"
                  borderBlockStartWidth="025"
                  borderColor="border"
                >
                  <InlineStack gap="400" wrap={false}>
                    {SKELETON_COL_WIDTHS.map((w, j) => (
                      <SkeletonDisplayText key={j} size="small" maxWidth={w} />
                    ))}
                  </InlineStack>
                </Box>
              ))}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </SkeletonPage>
  );
}

// ── Constants ──────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'orders', content: 'Orders', panelID: 'orders-panel' },
  { id: 'products', content: 'Product Audit Log', panelID: 'products-panel' },
];

type Heading = { title: string };
type HeadingList = [Heading, ...Heading[]];

const ORDER_HEADINGS: HeadingList = [
  { title: 'Order' },
  { title: 'Customer' },
  { title: 'Items' },
  { title: 'Total' },
  { title: 'Payment' },
  { title: 'Received' },
];

const PRODUCT_HEADINGS: HeadingList = [
  { title: 'Product' },
  { title: 'Field changed' },
  { title: 'Before' },
  { title: 'After' },
  { title: 'Changed at' },
];

const POLL_INTERVAL_MS = 30_000;

// ── Page ───────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const authenticatedFetch = useAuthenticatedFetch();
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [failedCount, setFailedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [tab, setTab] = useState(0);

  const loadEvents = useCallback(
    async (silent = false) => {
      if (silent) setSyncing(true);
      else setLoading(true);
      setError(null);
      try {
        const [eventsRes, failedRes] = await Promise.all([
          authenticatedFetch('/webhooks/events'),
          authenticatedFetch('/webhooks/failed-count'),
        ]);
        if (!eventsRes.ok)
          throw new Error(`Server returned ${eventsRes.status}`);
        const data = (await eventsRes.json()) as WebhookEvent[];
        setEvents(data);
        if (failedRes.ok) {
          const { count } = (await failedRes.json()) as { count: number };
          setFailedCount(count);
        }
        setLastUpdated(new Date());
      } catch (err) {
        if (!silent)
          setError(
            err instanceof Error ? err.message : 'Failed to load events',
          );
      } finally {
        if (silent) setSyncing(false);
        else setLoading(false);
      }
    },
    [authenticatedFetch],
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('embedded') !== '1') return;

    void loadEvents(false);

    const timer = setInterval(() => void loadEvents(true), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [loadEvents]);

  // ── Derived data ─────────────────────────────────────────────────────────────

  const orders = events.filter((e) => e.topic === 'orders/create');
  const productChanges = events.filter((e) => e.topic === 'products/update');

  const latestEvent =
    events.length > 0
      ? events.reduce((a, b) =>
          new Date(a.createdAt) > new Date(b.createdAt) ? a : b,
        )
      : null;

  const orderEvents = orders.filter((e) => isOrder(e.payload));
  const productEvents = productChanges.filter((e) =>
    isProductChange(e.payload),
  );

  // ── Render ───────────────────────────────────────────────────────────────────

  if (loading) return <Loadingskeleton />;

  return (
    <Page
      fullWidth
      title="Activity Feed"
      subtitle="Orders and product changes from your store"
      secondaryActions={[
        {
          content: 'Refresh',
          loading,
          onAction: () => void loadEvents(false),
        },
      ]}
    >
      <Layout>
        {/* Failed jobs banner */}
        {failedCount > 0 && (
          <Layout.Section>
            <Banner
              tone="critical"
              title={`${failedCount} job${failedCount === 1 ? '' : 's'} failed processing`}
            >
              <p>
                Check your Dead Letter Queue to review and retry failed webhook
                jobs.
              </p>
            </Banner>
          </Layout.Section>
        )}

        {/* KPI row */}
        <Layout.Section>
          <Grid>
            <Grid.Cell columnSpan={{ xs: 6, sm: 2, md: 4, lg: 4, xl: 4 }}>
              <StatCard
                label="Orders received"
                value={String(orders.length)}
                helpText="all time"
              />
            </Grid.Cell>
            <Grid.Cell columnSpan={{ xs: 6, sm: 2, md: 4, lg: 4, xl: 4 }}>
              <StatCard
                label="Product changes"
                value={String(productChanges.length)}
                helpText="all time"
              />
            </Grid.Cell>
            <Grid.Cell columnSpan={{ xs: 6, sm: 2, md: 4, lg: 4, xl: 4 }}>
              <StatCard
                label="Last activity"
                value={latestEvent ? relativeTime(latestEvent.createdAt) : '—'}
                helpText={
                  latestEvent
                    ? formatDate(latestEvent.createdAt)
                    : 'No events yet'
                }
              />
            </Grid.Cell>
          </Grid>
        </Layout.Section>

        {/* Activity table */}
        <Layout.Section>
          <Card padding="0">
            {/* Card header with live indicator */}
            <Box paddingBlock="400" paddingInline="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  Recent Activity
                </Text>
                {syncing ? (
                  <InlineStack gap="200" blockAlign="center">
                    <Spinner size="small" accessibilityLabel="Refreshing" />
                    <Text as="span" variant="bodySm" tone="subdued">
                      Refreshing
                    </Text>
                  </InlineStack>
                ) : lastUpdated ? (
                  <Badge tone="success">Live</Badge>
                ) : (
                  <Badge tone="attention">Connecting</Badge>
                )}
              </InlineStack>
            </Box>

            {/* Error banner */}
            {error && (
              <Box paddingInline="400" paddingBlockEnd="400">
                <Banner tone="critical" title="Could not load events">
                  <p>{error}</p>
                </Banner>
              </Box>
            )}

            <Tabs tabs={TABS} selected={tab} onSelect={setTab} fitted>
              {tab === 0 ? (
                orderEvents.length > 0 ? (
                  <IndexTable
                    resourceName={{ singular: 'order', plural: 'orders' }}
                    itemCount={orderEvents.length}
                    headings={ORDER_HEADINGS}
                    selectable={false}
                  >
                    {orderEvents.map((e, index) => {
                      const p = e.payload as unknown as OrderPayload;
                      return (
                        <IndexTable.Row id={e.id} key={e.id} position={index}>
                          <IndexTable.Cell>
                            <Text as="span" fontWeight="semibold">
                              #{p.order_number}
                            </Text>
                          </IndexTable.Cell>
                          <IndexTable.Cell>{customerName(p)}</IndexTable.Cell>
                          <IndexTable.Cell>
                            <Text as="span" tone="subdued">
                              {itemSummary(p.line_items)}
                            </Text>
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            {p.total_price} {p.currency}
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            {paymentBadge(p.financial_status)}
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            <Text as="span" tone="subdued">
                              {formatDate(e.createdAt)}
                            </Text>
                          </IndexTable.Cell>
                        </IndexTable.Row>
                      );
                    })}
                  </IndexTable>
                ) : (
                  <EmptyState
                    heading="No orders received yet"
                    image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                  >
                    <p>
                      Order events will appear here once your store sends order
                      webhooks.
                    </p>
                  </EmptyState>
                )
              ) : productEvents.length > 0 ? (
                <IndexTable
                  resourceName={{
                    singular: 'change',
                    plural: 'changes',
                  }}
                  itemCount={productEvents.length}
                  headings={PRODUCT_HEADINGS}
                  selectable={false}
                >
                  {productEvents.map((e, index) => {
                    const p = e.payload as unknown as ProductChangePayload;
                    return (
                      <IndexTable.Row id={e.id} key={e.id} position={index}>
                        <IndexTable.Cell>
                          <Text as="span" fontWeight="semibold">
                            {p.productTitle}
                          </Text>
                        </IndexTable.Cell>
                        <IndexTable.Cell>{fieldBadge(p.field)}</IndexTable.Cell>
                        <IndexTable.Cell>
                          <Text as="span" tone="subdued">
                            {p.oldValue ?? '—'}
                          </Text>
                        </IndexTable.Cell>
                        <IndexTable.Cell>{p.newValue}</IndexTable.Cell>
                        <IndexTable.Cell>
                          <Text as="span" tone="subdued">
                            {formatDate(e.createdAt)}
                          </Text>
                        </IndexTable.Cell>
                      </IndexTable.Row>
                    );
                  })}
                </IndexTable>
              ) : (
                <EmptyState
                  heading="No product changes recorded"
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                  <p>
                    Product update events will appear here when products in your
                    store are modified.
                  </p>
                </EmptyState>
              )}
            </Tabs>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
