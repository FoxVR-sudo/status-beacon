import { client } from './client'
import type { Alert, Check, KeywordSuggestionResult, PerformanceBudgets, Website } from '../types'

type WebsitePayload = {
  name: string
  url: string
  check_interval: number
  keyword?: string
  basic_auth_username?: string | null
  basic_auth_password?: string | null
  check_noscript?: boolean
  performance_budgets?: PerformanceBudgets
  tags?: string[]
  is_paused?: boolean
}

type WebsiteUpdatePayload = {
  name?: string
  url?: string
  check_interval?: number
  keyword?: string
  basic_auth_username?: string | null
  basic_auth_password?: string | null
  check_noscript?: boolean
  performance_budgets?: PerformanceBudgets
  tags?: string[]
  is_paused?: boolean
}

export const websitesApi = {
  list: () => client.get<Website[]>('/api/websites/').then((r) => r.data),

  create: (data: WebsitePayload) =>
    client.post<Website>('/api/websites/', data).then((r) => r.data),

  suggestKeywords: (url: string, data?: { basic_auth_username?: string; basic_auth_password?: string }) =>
    client.post<KeywordSuggestionResult>('/api/websites/suggest-keywords', { url, ...data }).then((r) => r.data),

  update: (id: number, data: WebsiteUpdatePayload) =>
    client.patch<Website>(`/api/websites/${id}`, data).then((r) => r.data),

  delete: (id: number) => client.delete(`/api/websites/${id}`),

  getChecks: (id: number) =>
    client.get<Check[]>(`/api/websites/${id}/checks`).then((r) => r.data),

  approveTlsBaseline: (id: number) =>
    client.post<Website>(`/api/websites/${id}/tls-baseline/approve`).then((r) => r.data),

  triggerCheck: (id: number) =>
    client.post(`/api/websites/${id}/check`).then((r) => r.data),
}

export const alertsApi = {
  list: () => client.get<Alert[]>('/api/alerts/').then((r) => r.data),
}
