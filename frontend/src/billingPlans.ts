import type { BillingPlanId } from './types'

export type BillingPlanDefinition = {
  id: BillingPlanId
  name: string
  price: string
  cadence: string
  summary: string
  description: string
  features: string[]
  ctaLabel: string
  featured?: boolean
}

export const billingPlans: BillingPlanDefinition[] = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    cadence: '/month',
    summary: 'For one production property and baseline alerting.',
    description: 'Baseline monitoring for one production property or a staging environment.',
    features: ['1 monitor', '30 min checks', 'Email alerts', 'Rendered keyword checks'],
    ctaLabel: 'Start free',
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$10',
    cadence: '/month',
    summary: 'For faster incident loops and richer runtime signal.',
    description: 'For faster alert loops and runtime visibility across a growing site portfolio.',
    features: ['25 monitors', '5 min checks', 'Telegram alerts', 'Performance + network evidence'],
    ctaLabel: 'Choose Pro',
    featured: true,
  },
  {
    id: 'agency',
    name: 'Agency',
    price: '$50',
    cadence: '/month',
    summary: 'For multi-site teams managing client-facing monitoring workflows.',
    description: 'For teams managing multiple properties with client-facing monitoring workflows.',
    features: ['Unlimited monitors', 'Client-ready reporting', 'CSV exports', 'Priority support'],
    ctaLabel: 'Choose Agency',
  },
]