'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  CalloutCard,
  Card,
  Grid,
  Layout,
  Page,
  SkeletonBodyText,
  SkeletonDisplayText,
  SkeletonPage,
  Text,
  Toast,
} from '@shopify/polaris'
import { getIdToken } from '@/lib/authenticated-fetch'

// ── Types ─────────────────────────────────────────────────────────────────────

type PlanKey = 'free' | 'basic' | 'pro'

type SubscriptionStatus = {
  plan: PlanKey
  status: string
  trialEndsAt: string | null
  features: {
    webhookEventsLimit: number
    productChangesHistory: number
    reprocessFailedJobs: boolean
  }
}

// ── Plan metadata ──────────────────────────────────────────────────────────────

type PlanMeta = {
  key: PlanKey
  name: string
  price: string
  features: string[]
}

const PLANS: PlanMeta[] = [
  {
    key: 'free',
    name: 'Free',
    price: '$0 / month',
    features: [
      '100 webhook events / month',
      '7 days product history',
      'No failed job reprocessing',
    ],
  },
  {
    key: 'basic',
    name: 'Basic',
    price: '$9 / month',
    features: [
      '5,000 webhook events / month',
      '30 days product history',
      'Failed job reprocessing',
    ],
  },
  {
    key: 'pro',
    name: 'Pro',
    price: '$29 / month',
    features: [
      'Unlimited webhook events',
      '365 days product history',
      'Failed job reprocessing',
    ],
  },
]

// ── Helpers ────────────────────────────────────────────────────────────────────

function getShop(): string {
  return new URLSearchParams(window.location.search).get('shop') ?? ''
}

// ── Skeleton ───────────────────────────────────────────────────────────────────

function BillingSkeleton() {
  return (
    <SkeletonPage title="Billing &amp; Plans" fullWidth>
      <Layout>
        <Layout.Section>
          <Grid>
            {[0, 1, 2].map((i) => (
              <Grid.Cell key={i} columnSpan={{ xs: 6, sm: 6, md: 4, lg: 4, xl: 4 }}>
                <Card>
                  <BlockStack gap="400">
                    <SkeletonDisplayText size="small" />
                    <SkeletonBodyText lines={4} />
                    <SkeletonDisplayText size="small" maxWidth="8ch" />
                  </BlockStack>
                </Card>
              </Grid.Cell>
            ))}
          </Grid>
        </Layout.Section>
      </Layout>
    </SkeletonPage>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function BillingPage() {
  const [subscriptionStatus, setSubscriptionStatus] = useState<SubscriptionStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [upgrading, setUpgrading] = useState<PlanKey | null>(null)
  const [toast, setToast] = useState<{ message: string; error: boolean } | null>(null)

  useEffect(() => {
    const shop = getShop()
    if (!shop) {
      setLoading(false)
      return
    }

    fetch(`/api/billing/status?shop=${encodeURIComponent(shop)}`)
      .then((r) => r.json())
      .then((data) => setSubscriptionStatus(data as SubscriptionStatus))
      .catch(() => setToast({ message: 'Failed to load billing status', error: true }))
      .finally(() => setLoading(false))
  }, [])

  const handleUpgrade = useCallback(async (plan: 'basic' | 'pro') => {
    setUpgrading(plan)
    try {
      const shop = getShop()
      const sessionToken = await getIdToken()
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (sessionToken) headers['Authorization'] = `Bearer ${sessionToken}`

      const res = await fetch('/api/billing/subscribe', {
        method: 'POST',
        headers,
        body: JSON.stringify({ plan, shop }),
      })

      if (!res.ok) {
        const body = (await res.json()) as { error?: string }
        throw new Error(body.error ?? 'Upgrade failed')
      }

      const { confirmationUrl } = (await res.json()) as { confirmationUrl: string }
      window.top!.location.href = confirmationUrl
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : 'Upgrade failed',
        error: true,
      })
      setUpgrading(null)
    }
  }, [])

  if (loading) return <BillingSkeleton />

  const currentPlan = subscriptionStatus?.plan ?? 'free'
  const currentStatus = subscriptionStatus?.status ?? 'active'
  const isExpiredOrDeclined = currentStatus === 'expired' || currentStatus === 'declined'

  return (
    <Page
      title="Billing &amp; Plans"
      subtitle="Choose the plan that fits your store"
    >
      <Layout>
        {/* Callout when subscription has lapsed */}
        {isExpiredOrDeclined && (
          <Layout.Section>
            <CalloutCard
              title={
                currentStatus === 'expired'
                  ? 'Your subscription has expired'
                  : 'Your subscription was declined'
              }
              illustration="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              primaryAction={{
                content: 'Upgrade to Basic',
                onAction: () => void handleUpgrade('basic'),
              }}
              secondaryAction={{
                content: 'Upgrade to Pro',
                onAction: () => void handleUpgrade('pro'),
              }}
            >
              <p>
                {currentStatus === 'expired'
                  ? 'Your paid plan has expired. You have been moved back to the Free plan. Upgrade to restore access to premium features.'
                  : 'Your last billing attempt was declined. Please upgrade to restore access to premium features.'}
              </p>
            </CalloutCard>
          </Layout.Section>
        )}

        {/* Current plan info banner */}
        {!isExpiredOrDeclined && currentPlan !== 'free' && (
          <Layout.Section>
            <Banner tone="success" title={`You are on the ${PLANS.find((p) => p.key === currentPlan)?.name ?? ''} plan`}>
              <p>Your current plan is active. Upgrade anytime to unlock more features.</p>
            </Banner>
          </Layout.Section>
        )}

        {/* Plan cards */}
        <Layout.Section>
          <Grid>
            {PLANS.map((plan) => {
              const isCurrent = plan.key === currentPlan
              const isUpgradeable = plan.key !== 'free' && !isCurrent

              return (
                <Grid.Cell
                  key={plan.key}
                  columnSpan={{ xs: 6, sm: 6, md: 4, lg: 4, xl: 4 }}
                >
                  <Card>
                    <BlockStack gap="400">
                      {/* Header row */}
                      <BlockStack gap="200">
                        <Text as="h2" variant="headingLg">
                          {plan.name}
                        </Text>
                        <Text as="p" variant="headingMd" tone="subdued">
                          {plan.price}
                        </Text>
                        {isCurrent && <Badge tone="success">Current Plan</Badge>}
                      </BlockStack>

                      {/* Feature list */}
                      <BlockStack gap="200">
                        {plan.features.map((feature) => (
                          <Text key={feature} as="p" variant="bodyMd">
                            ✓ {feature}
                          </Text>
                        ))}
                      </BlockStack>

                      {/* Action */}
                      {plan.key === 'free' ? (
                        <Button disabled fullWidth>
                          {isCurrent ? 'Current Plan' : 'Free'}
                        </Button>
                      ) : (
                        <Button
                          variant={isCurrent ? undefined : 'primary'}
                          disabled={isCurrent || upgrading !== null}
                          loading={upgrading === plan.key}
                          fullWidth
                          onClick={() => {
                            if (isUpgradeable) void handleUpgrade(plan.key as 'basic' | 'pro')
                          }}
                        >
                          {isCurrent ? 'Current Plan' : `Upgrade to ${plan.name}`}
                        </Button>
                      )}
                    </BlockStack>
                  </Card>
                </Grid.Cell>
              )
            })}
          </Grid>
        </Layout.Section>
      </Layout>

      {toast && (
        <Toast
          content={toast.message}
          error={toast.error}
          onDismiss={() => setToast(null)}
          duration={toast.error ? 5000 : 4000}
        />
      )}
    </Page>
  )
}
