import { client } from './client'
import type {
  ActionResponse,
  BillingPlanId,
  BillingRedirectSession,
  BillingSummary,
  TelegramConnectSession,
  UserSettings,
} from '../types'

export const settingsApi = {
  me: () => client.get<UserSettings>('/api/settings/me').then((response) => response.data),

  getBillingSummary: () =>
    client
      .get<BillingSummary>('/api/settings/billing')
      .then((response) => response.data),

  startBillingCheckout: (planId: BillingPlanId) =>
    client
      .post<BillingRedirectSession>('/api/settings/billing/checkout', { plan_id: planId })
      .then((response) => response.data),

  openBillingPortal: () =>
    client
      .post<BillingRedirectSession>('/api/settings/billing/portal')
      .then((response) => response.data),

  startTelegramConnect: () =>
    client
      .post<TelegramConnectSession>('/api/settings/telegram/connect')
      .then((response) => response.data),

  getTelegramConnectStatus: (token: string) =>
    client
      .get<TelegramConnectSession>(`/api/settings/telegram/connect/${token}`)
      .then((response) => response.data),

  sendTelegramTest: () =>
    client
      .post<ActionResponse>('/api/settings/telegram/test')
      .then((response) => response.data),
}