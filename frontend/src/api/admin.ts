import { client } from './client'
import type {
  ActionResponse,
  AdminAlertItem,
  AdminAlertUpsertPayload,
  AdminCheckItem,
  AdminCheckUpsertPayload,
  AdminOverview,
  AdminSubscriptionItem,
  AdminSubscriptionUpsertPayload,
  AdminUserItem,
  AdminUserUpdatePayload,
  AdminWebsiteItem,
  AdminWebsiteUpdatePayload,
} from '../types'

export const adminApi = {
  overview: () => client.get<AdminOverview>('/api/admin/overview').then((response) => response.data),

  users: (limit = 50) =>
    client.get<AdminUserItem[]>(`/api/admin/users?limit=${limit}`).then((response) => response.data),

  updateUser: (userId: number, payload: AdminUserUpdatePayload) =>
    client.patch<AdminUserItem>(`/api/admin/users/${userId}`, payload).then((response) => response.data),

  subscriptions: (limit = 100) =>
    client.get<AdminSubscriptionItem[]>(`/api/admin/subscriptions?limit=${limit}`).then((response) => response.data),

  createSubscription: (payload: AdminSubscriptionUpsertPayload) =>
    client.post<AdminSubscriptionItem>('/api/admin/subscriptions', payload).then((response) => response.data),

  updateSubscription: (userId: number, payload: AdminSubscriptionUpsertPayload) =>
    client.patch<AdminSubscriptionItem>(`/api/admin/subscriptions/${userId}`, payload).then((response) => response.data),

  deleteSubscription: (userId: number) =>
    client.delete<ActionResponse>(`/api/admin/subscriptions/${userId}`).then((response) => response.data),

  websites: (limit = 100) =>
    client.get<AdminWebsiteItem[]>(`/api/admin/websites?limit=${limit}`).then((response) => response.data),

  updateWebsite: (websiteId: number, payload: AdminWebsiteUpdatePayload) =>
    client.patch<AdminWebsiteItem>(`/api/admin/websites/${websiteId}`, payload).then((response) => response.data),

  checks: (limit = 100) =>
    client.get<AdminCheckItem[]>(`/api/admin/checks?limit=${limit}`).then((response) => response.data),

  createCheck: (payload: AdminCheckUpsertPayload) =>
    client.post<AdminCheckItem>('/api/admin/checks', payload).then((response) => response.data),

  updateCheck: (checkId: number, payload: AdminCheckUpsertPayload) =>
    client.patch<AdminCheckItem>(`/api/admin/checks/${checkId}`, payload).then((response) => response.data),

  deleteCheck: (checkId: number) =>
    client.delete<ActionResponse>(`/api/admin/checks/${checkId}`).then((response) => response.data),

  alerts: (limit = 100) =>
    client.get<AdminAlertItem[]>(`/api/admin/alerts?limit=${limit}`).then((response) => response.data),

  createAlert: (payload: AdminAlertUpsertPayload) =>
    client.post<AdminAlertItem>('/api/admin/alerts', payload).then((response) => response.data),

  updateAlert: (alertId: number, payload: AdminAlertUpsertPayload) =>
    client.patch<AdminAlertItem>(`/api/admin/alerts/${alertId}`, payload).then((response) => response.data),

  deleteAlert: (alertId: number) =>
    client.delete<ActionResponse>(`/api/admin/alerts/${alertId}`).then((response) => response.data),

  deleteUser: (userId: number) =>
    client.delete<ActionResponse>(`/api/admin/users/${userId}`).then((response) => response.data),

  deleteWebsite: (websiteId: number) =>
    client.delete<ActionResponse>(`/api/admin/websites/${websiteId}`).then((response) => response.data),
}
