export const PLANS = {
  free: {
    name: 'Free',
    price: 0,
    features: {
      webhookEventsLimit: 100,
      productChangesHistory: 7,
      reprocessFailedJobs: false,
    },
  },
  basic: {
    name: 'Basic',
    price: 9,
    features: {
      webhookEventsLimit: 5000,
      productChangesHistory: 30,
      reprocessFailedJobs: true,
    },
  },
  pro: {
    name: 'Pro',
    price: 29,
    features: {
      webhookEventsLimit: -1,
      productChangesHistory: 365,
      reprocessFailedJobs: true,
    },
  },
} as const;

export type Plan = keyof typeof PLANS;
export type PlanFeatures = (typeof PLANS)[Plan]['features'];

export const PLAN_ORDER: Record<Plan, number> = {
  free: 0,
  basic: 1,
  pro: 2,
};
