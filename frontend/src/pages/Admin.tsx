import { useEffect, useState } from 'react'
import { adminApi } from '../api/admin'
import type {
  AccountStatus,
  AdminAlertItem,
  AdminCheckItem,
  AdminOverview,
  AdminSubscriptionItem,
  AdminUserItem,
  AdminWebsiteItem,
} from '../types'

type Notice = {
  tone: 'success' | 'error'
  message: string
}

type UserEditorState = {
  id: number
  email: string
  first_name: string
  last_name: string
  company_name: string
  account_status: AccountStatus
  is_admin: boolean
  is_email_verified: boolean
  current_plan_id: AdminUserItem['current_plan_id']
  stripe_customer_id: string
  stripe_subscription_id: string
  stripe_subscription_status: string
  stripe_current_period_end: string
}

type WebsiteEditorState = {
  id: number
  user_id: string
  name: string
  url: string
  check_interval: string
  is_paused: boolean
}

type SubscriptionEditorState = {
  user_id: string
  current_plan_id: AdminSubscriptionItem['current_plan_id']
  stripe_customer_id: string
  stripe_subscription_id: string
  stripe_subscription_status: string
  stripe_current_period_end: string
  isNew: boolean
}

type CheckEditorState = {
  id: number | null
  website_id: string
  status_code: string
  response_time: string
  ttfb: string
  ssl_days_left: string
  keyword_ok: '' | 'true' | 'false'
  checked_at: string
  isNew: boolean
}

type AlertEditorState = {
  id: number | null
  website_id: string
  type: string
  message: string
  sent_at: string
  isNew: boolean
}

const editablePlanOptions: Array<{ value: AdminUserItem['current_plan_id']; label: string }> = [
  { value: 'free', label: 'Free' },
  { value: 'pro', label: 'Pro' },
  { value: 'agency', label: 'Agency' },
]

const editableSubscriptionStatusOptions = [
  '',
  'trialing',
  'active',
  'past_due',
  'unpaid',
  'canceled',
  'incomplete',
  'incomplete_expired',
  'paused',
]

const accountStatusOptions: Array<{ value: AccountStatus; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'disabled', label: 'Disabled' },
]

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return (
    (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail
    ?? fallback
  )
}

function formatDateTime(value: string | null) {
  if (!value) {
    return '—'
  }

  return new Date(value).toLocaleString()
}

function formatDateTimeLocalInput(value: string | null) {
  if (!value) {
    return ''
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }

  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function toIsoOrNull(value: string) {
  if (!value) {
    return null
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return null
  }

  return date.toISOString()
}

function parseOptionalInteger(value: string, label: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    return undefined
  }

  const parsed = Number(trimmed)
  if (!Number.isInteger(parsed)) {
    throw new Error(`${label} must be a whole number.`)
  }

  return parsed
}

function parseOptionalNumber(value: string, label: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    return undefined
  }

  const parsed = Number(trimmed)
  if (Number.isNaN(parsed)) {
    throw new Error(`${label} must be a number.`)
  }

  return parsed
}

function planLabel(planId: AdminUserItem['current_plan_id']) {
  if (planId === 'agency') {
    return 'Agency'
  }

  if (planId === 'pro') {
    return 'Pro'
  }

  return 'Free'
}

function subscriptionStatusLabel(status: string | null) {
  if (!status) {
    return 'no subscription'
  }

  return status.split('_').join(' ')
}

function accountStatusLabel(status: AccountStatus) {
  if (status === 'suspended') {
    return 'suspended'
  }

  if (status === 'disabled') {
    return 'disabled'
  }

  return 'active'
}

function planBadgeClass(planId: AdminUserItem['current_plan_id']) {
  if (planId === 'agency') {
    return 'bg-fuchsia-100 text-fuchsia-700'
  }

  if (planId === 'pro') {
    return 'bg-indigo-100 text-indigo-700'
  }

  return 'bg-slate-100 text-slate-700'
}

function subscriptionStatusClass(status: string | null) {
  if (!status) {
    return 'bg-slate-100 text-slate-700'
  }

  if (status === 'active' || status === 'trialing') {
    return 'bg-emerald-100 text-emerald-700'
  }

  if (status === 'past_due' || status === 'unpaid') {
    return 'bg-amber-100 text-amber-800'
  }

  return 'bg-rose-100 text-rose-700'
}

function accountStatusClass(status: AccountStatus) {
  if (status === 'suspended') {
    return 'bg-amber-100 text-amber-800'
  }

  if (status === 'disabled') {
    return 'bg-rose-100 text-rose-700'
  }

  return 'bg-emerald-100 text-emerald-700'
}

function keywordOkLabel(value: boolean | null) {
  if (value === true) {
    return 'keyword ok'
  }

  if (value === false) {
    return 'keyword missing'
  }

  return 'not checked'
}

function keywordOkClass(value: boolean | null) {
  if (value === true) {
    return 'bg-emerald-100 text-emerald-700'
  }

  if (value === false) {
    return 'bg-rose-100 text-rose-700'
  }

  return 'bg-slate-100 text-slate-700'
}

function createUserEditor(user: AdminUserItem): UserEditorState {
  return {
    id: user.id,
    email: user.email,
    first_name: user.first_name,
    last_name: user.last_name,
    company_name: user.company_name ?? '',
    account_status: user.account_status,
    is_admin: user.is_admin,
    is_email_verified: user.is_email_verified,
    current_plan_id: user.current_plan_id,
    stripe_customer_id: user.stripe_customer_id ?? '',
    stripe_subscription_id: user.stripe_subscription_id ?? '',
    stripe_subscription_status: user.stripe_subscription_status ?? '',
    stripe_current_period_end: formatDateTimeLocalInput(user.stripe_current_period_end),
  }
}

function createWebsiteEditor(website: AdminWebsiteItem): WebsiteEditorState {
  return {
    id: website.id,
    user_id: String(website.user_id),
    name: website.name,
    url: website.url,
    check_interval: String(website.check_interval),
    is_paused: website.is_paused,
  }
}

function createSubscriptionEditor(subscription: AdminSubscriptionItem): SubscriptionEditorState {
  return {
    user_id: String(subscription.user_id),
    current_plan_id: subscription.current_plan_id,
    stripe_customer_id: subscription.stripe_customer_id ?? '',
    stripe_subscription_id: subscription.stripe_subscription_id ?? '',
    stripe_subscription_status: subscription.stripe_subscription_status ?? '',
    stripe_current_period_end: formatDateTimeLocalInput(subscription.stripe_current_period_end),
    isNew: false,
  }
}

function createEmptySubscriptionEditor(): SubscriptionEditorState {
  return {
    user_id: '',
    current_plan_id: 'free',
    stripe_customer_id: '',
    stripe_subscription_id: '',
    stripe_subscription_status: '',
    stripe_current_period_end: '',
    isNew: true,
  }
}

function createCheckEditor(check: AdminCheckItem): CheckEditorState {
  return {
    id: check.id,
    website_id: String(check.website_id),
    status_code: check.status_code == null ? '' : String(check.status_code),
    response_time: check.response_time == null ? '' : String(check.response_time),
    ttfb: check.ttfb == null ? '' : String(check.ttfb),
    ssl_days_left: check.ssl_days_left == null ? '' : String(check.ssl_days_left),
    keyword_ok: check.keyword_ok == null ? '' : String(check.keyword_ok) as 'true' | 'false',
    checked_at: formatDateTimeLocalInput(check.checked_at),
    isNew: false,
  }
}

function createEmptyCheckEditor(): CheckEditorState {
  return {
    id: null,
    website_id: '',
    status_code: '',
    response_time: '',
    ttfb: '',
    ssl_days_left: '',
    keyword_ok: '',
    checked_at: '',
    isNew: true,
  }
}

function createAlertEditor(alert: AdminAlertItem): AlertEditorState {
  return {
    id: alert.id,
    website_id: String(alert.website_id),
    type: alert.type,
    message: alert.message,
    sent_at: formatDateTimeLocalInput(alert.sent_at),
    isNew: false,
  }
}

function createEmptyAlertEditor(): AlertEditorState {
  return {
    id: null,
    website_id: '',
    type: '',
    message: '',
    sent_at: '',
    isNew: true,
  }
}

function normalizeOptionalText(value: string) {
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

export default function Admin() {
  const [overview, setOverview] = useState<AdminOverview | null>(null)
  const [users, setUsers] = useState<AdminUserItem[]>([])
  const [websites, setWebsites] = useState<AdminWebsiteItem[]>([])
  const [subscriptions, setSubscriptions] = useState<AdminSubscriptionItem[]>([])
  const [checks, setChecks] = useState<AdminCheckItem[]>([])
  const [alerts, setAlerts] = useState<AdminAlertItem[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState<Notice | null>(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [showChecks, setShowChecks] = useState(false)
  const [userEditor, setUserEditor] = useState<UserEditorState | null>(null)
  const [websiteEditor, setWebsiteEditor] = useState<WebsiteEditorState | null>(null)
  const [subscriptionEditor, setSubscriptionEditor] = useState<SubscriptionEditorState | null>(null)
  const [checkEditor, setCheckEditor] = useState<CheckEditorState | null>(null)
  const [alertEditor, setAlertEditor] = useState<AlertEditorState | null>(null)
  const [savingUser, setSavingUser] = useState(false)
  const [savingWebsite, setSavingWebsite] = useState(false)
  const [savingSubscription, setSavingSubscription] = useState(false)
  const [savingCheck, setSavingCheck] = useState(false)
  const [savingAlert, setSavingAlert] = useState(false)

  function clearEditors() {
    setUserEditor(null)
    setWebsiteEditor(null)
    setSubscriptionEditor(null)
    setCheckEditor(null)
    setAlertEditor(null)
  }

  async function load() {
    setLoading(true)
    setError('')
    try {
      const [overviewData, usersData, websitesData, subscriptionsData, checksData, alertsData] = await Promise.all([
        adminApi.overview(),
        adminApi.users(250),
        adminApi.websites(150),
        adminApi.subscriptions(150),
        adminApi.checks(150),
        adminApi.alerts(150),
      ])
      setOverview(overviewData)
      setUsers(usersData)
      setWebsites(websitesData)
      setSubscriptions(subscriptionsData)
      setChecks(checksData)
      setAlerts(alertsData)
    } catch (loadError: unknown) {
      setError(getErrorMessage(loadError, 'Admin panel is unavailable for this account.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  function startUserEdit(user: AdminUserItem) {
    clearEditors()
    setUserEditor(createUserEditor(user))
    setNotice(null)
  }

  function startWebsiteEdit(website: AdminWebsiteItem) {
    clearEditors()
    setWebsiteEditor(createWebsiteEditor(website))
    setNotice(null)
  }

  function startSubscriptionEdit(subscription: AdminSubscriptionItem) {
    clearEditors()
    setSubscriptionEditor(createSubscriptionEditor(subscription))
    setNotice(null)
  }

  function startSubscriptionCreate() {
    clearEditors()
    setSubscriptionEditor(createEmptySubscriptionEditor())
    setNotice(null)
  }

  function startCheckEdit(check: AdminCheckItem) {
    clearEditors()
    setShowChecks(true)
    setCheckEditor(createCheckEditor(check))
    setNotice(null)
  }

  function startCheckCreate() {
    clearEditors()
    setShowChecks(true)
    setCheckEditor(createEmptyCheckEditor())
    setNotice(null)
  }

  function startAlertEdit(alert: AdminAlertItem) {
    clearEditors()
    setAlertEditor(createAlertEditor(alert))
    setNotice(null)
  }

  function startAlertCreate() {
    clearEditors()
    setAlertEditor(createEmptyAlertEditor())
    setNotice(null)
  }

  async function handleSaveUser() {
    if (!userEditor) {
      return
    }

    if (!userEditor.email.trim()) {
      setNotice({ tone: 'error', message: 'Email is required.' })
      return
    }

    setSavingUser(true)
    setNotice(null)

    try {
      await adminApi.updateUser(userEditor.id, {
        email: userEditor.email.trim(),
        first_name: userEditor.first_name.trim(),
        last_name: userEditor.last_name.trim(),
        company_name: normalizeOptionalText(userEditor.company_name),
        account_status: userEditor.account_status,
        is_admin: userEditor.is_admin,
        is_email_verified: userEditor.is_email_verified,
        current_plan_id: userEditor.current_plan_id,
        stripe_customer_id: normalizeOptionalText(userEditor.stripe_customer_id),
        stripe_subscription_id: normalizeOptionalText(userEditor.stripe_subscription_id),
        stripe_subscription_status: normalizeOptionalText(userEditor.stripe_subscription_status),
        stripe_current_period_end: toIsoOrNull(userEditor.stripe_current_period_end),
      })

      setNotice({ tone: 'success', message: 'User record saved.' })
      clearEditors()
      await load()
    } catch (saveError: unknown) {
      setNotice({ tone: 'error', message: getErrorMessage(saveError, 'User update failed.') })
    } finally {
      setSavingUser(false)
    }
  }

  async function handleSaveWebsite() {
    if (!websiteEditor) {
      return
    }

    if (!websiteEditor.name.trim() || !websiteEditor.url.trim()) {
      setNotice({ tone: 'error', message: 'Website name and URL are required.' })
      return
    }

    const userId = Number(websiteEditor.user_id)
    const checkInterval = Number(websiteEditor.check_interval)
    if (!Number.isInteger(userId) || userId <= 0) {
      setNotice({ tone: 'error', message: 'User id must be a positive number.' })
      return
    }

    if (!Number.isInteger(checkInterval) || checkInterval <= 0) {
      setNotice({ tone: 'error', message: 'Check interval must be a positive number.' })
      return
    }

    setSavingWebsite(true)
    setNotice(null)

    try {
      await adminApi.updateWebsite(websiteEditor.id, {
        user_id: userId,
        name: websiteEditor.name.trim(),
        url: websiteEditor.url.trim(),
        check_interval: checkInterval,
        is_paused: websiteEditor.is_paused,
      })

      setNotice({ tone: 'success', message: 'Website record saved.' })
      clearEditors()
      await load()
    } catch (saveError: unknown) {
      setNotice({ tone: 'error', message: getErrorMessage(saveError, 'Website update failed.') })
    } finally {
      setSavingWebsite(false)
    }
  }

  async function handleSaveSubscription() {
    if (!subscriptionEditor) {
      return
    }

    const userId = Number(subscriptionEditor.user_id)
    if (!Number.isInteger(userId) || userId <= 0) {
      setNotice({ tone: 'error', message: 'User id must be a positive number.' })
      return
    }

    setSavingSubscription(true)
    setNotice(null)

    try {
      const payload = {
        user_id: userId,
        current_plan_id: subscriptionEditor.current_plan_id,
        stripe_customer_id: normalizeOptionalText(subscriptionEditor.stripe_customer_id),
        stripe_subscription_id: normalizeOptionalText(subscriptionEditor.stripe_subscription_id),
        stripe_subscription_status: normalizeOptionalText(subscriptionEditor.stripe_subscription_status),
        stripe_current_period_end: toIsoOrNull(subscriptionEditor.stripe_current_period_end),
      }

      if (subscriptionEditor.isNew) {
        await adminApi.createSubscription(payload)
      } else {
        await adminApi.updateSubscription(userId, payload)
      }

      setNotice({ tone: 'success', message: subscriptionEditor.isNew ? 'Subscription record created.' : 'Subscription record saved.' })
      clearEditors()
      await load()
    } catch (saveError: unknown) {
      setNotice({ tone: 'error', message: getErrorMessage(saveError, 'Subscription update failed.') })
    } finally {
      setSavingSubscription(false)
    }
  }

  async function handleSaveCheck() {
    if (!checkEditor) {
      return
    }

    const websiteId = Number(checkEditor.website_id)
    if (!Number.isInteger(websiteId) || websiteId <= 0) {
      setNotice({ tone: 'error', message: 'Website id must be a positive number.' })
      return
    }

    setSavingCheck(true)
    setNotice(null)

    try {
      const payload = {
        website_id: websiteId,
        ...(parseOptionalInteger(checkEditor.status_code, 'Status code') !== undefined ? { status_code: parseOptionalInteger(checkEditor.status_code, 'Status code') } : {}),
        ...(parseOptionalNumber(checkEditor.response_time, 'Response time') !== undefined ? { response_time: parseOptionalNumber(checkEditor.response_time, 'Response time') } : {}),
        ...(parseOptionalNumber(checkEditor.ttfb, 'TTFB') !== undefined ? { ttfb: parseOptionalNumber(checkEditor.ttfb, 'TTFB') } : {}),
        ...(parseOptionalInteger(checkEditor.ssl_days_left, 'SSL days left') !== undefined ? { ssl_days_left: parseOptionalInteger(checkEditor.ssl_days_left, 'SSL days left') } : {}),
        ...(checkEditor.keyword_ok ? { keyword_ok: checkEditor.keyword_ok === 'true' } : {}),
        ...(toIsoOrNull(checkEditor.checked_at) ? { checked_at: toIsoOrNull(checkEditor.checked_at) ?? undefined } : {}),
      }

      if (checkEditor.isNew) {
        await adminApi.createCheck(payload)
      } else if (checkEditor.id != null) {
        await adminApi.updateCheck(checkEditor.id, payload)
      }

      setNotice({ tone: 'success', message: checkEditor.isNew ? 'Check created.' : 'Check saved.' })
      clearEditors()
      await load()
    } catch (saveError: unknown) {
      setNotice({ tone: 'error', message: getErrorMessage(saveError, 'Check update failed.') })
    } finally {
      setSavingCheck(false)
    }
  }

  async function handleSaveAlert() {
    if (!alertEditor) {
      return
    }

    const websiteId = Number(alertEditor.website_id)
    if (!Number.isInteger(websiteId) || websiteId <= 0) {
      setNotice({ tone: 'error', message: 'Website id must be a positive number.' })
      return
    }

    if (!alertEditor.type.trim() || !alertEditor.message.trim()) {
      setNotice({ tone: 'error', message: 'Alert type and message are required.' })
      return
    }

    setSavingAlert(true)
    setNotice(null)

    try {
      const payload = {
        website_id: websiteId,
        type: alertEditor.type.trim(),
        message: alertEditor.message.trim(),
        ...(toIsoOrNull(alertEditor.sent_at) ? { sent_at: toIsoOrNull(alertEditor.sent_at) ?? undefined } : {}),
      }

      if (alertEditor.isNew) {
        await adminApi.createAlert(payload)
      } else if (alertEditor.id != null) {
        await adminApi.updateAlert(alertEditor.id, payload)
      }

      setNotice({ tone: 'success', message: alertEditor.isNew ? 'Alert created.' : 'Alert saved.' })
      clearEditors()
      await load()
    } catch (saveError: unknown) {
      setNotice({ tone: 'error', message: getErrorMessage(saveError, 'Alert update failed.') })
    } finally {
      setSavingAlert(false)
    }
  }

  async function handleDeleteUser(userId: number) {
    if (!window.confirm('Delete this user and all related websites/checks?')) {
      return
    }

    try {
      await adminApi.deleteUser(userId)
      if (userEditor?.id === userId) {
        clearEditors()
      }
      setNotice({ tone: 'success', message: 'User deleted.' })
      await load()
    } catch (deleteError: unknown) {
      setNotice({ tone: 'error', message: getErrorMessage(deleteError, 'User deletion failed.') })
    }
  }

  async function handleDeleteWebsite(websiteId: number) {
    if (!window.confirm('Delete this website and all related checks/alerts?')) {
      return
    }

    try {
      await adminApi.deleteWebsite(websiteId)
      if (websiteEditor?.id === websiteId) {
        clearEditors()
      }
      setNotice({ tone: 'success', message: 'Website deleted.' })
      await load()
    } catch (deleteError: unknown) {
      setNotice({ tone: 'error', message: getErrorMessage(deleteError, 'Website deletion failed.') })
    }
  }

  async function handleDeleteSubscription(userId: number) {
    if (!window.confirm('Delete this subscription record and clear Stripe fields for the account?')) {
      return
    }

    try {
      await adminApi.deleteSubscription(userId)
      if (subscriptionEditor && Number(subscriptionEditor.user_id) === userId) {
        clearEditors()
      }
      setNotice({ tone: 'success', message: 'Subscription deleted.' })
      await load()
    } catch (deleteError: unknown) {
      setNotice({ tone: 'error', message: getErrorMessage(deleteError, 'Subscription deletion failed.') })
    }
  }

  async function handleDeleteCheck(checkId: number) {
    if (!window.confirm('Delete this check record?')) {
      return
    }

    try {
      await adminApi.deleteCheck(checkId)
      if (checkEditor?.id === checkId) {
        clearEditors()
      }
      setNotice({ tone: 'success', message: 'Check deleted.' })
      await load()
    } catch (deleteError: unknown) {
      setNotice({ tone: 'error', message: getErrorMessage(deleteError, 'Check deletion failed.') })
    }
  }

  async function handleDeleteAlert(alertId: number) {
    if (!window.confirm('Delete this alert record?')) {
      return
    }

    try {
      await adminApi.deleteAlert(alertId)
      if (alertEditor?.id === alertId) {
        clearEditors()
      }
      setNotice({ tone: 'success', message: 'Alert deleted.' })
      await load()
    } catch (deleteError: unknown) {
      setNotice({ tone: 'error', message: getErrorMessage(deleteError, 'Alert deletion failed.') })
    }
  }

  const normalizedSearch = search.trim().toLowerCase()
  const filteredUsers = users.filter((user) => {
    if (!normalizedSearch) {
      return true
    }

    return [
      user.email,
      user.first_name,
      user.last_name,
      user.company_name ?? '',
      user.account_status,
      user.current_plan_id,
      user.stripe_subscription_status ?? '',
      user.stripe_customer_id ?? '',
      user.stripe_subscription_id ?? '',
    ]
      .join(' ')
      .toLowerCase()
      .includes(normalizedSearch)
  })

  const filteredSubscriptions = subscriptions.filter((subscription) => {
    if (!normalizedSearch) {
      return true
    }

    return [
      subscription.email,
      subscription.user_id,
      subscription.account_status,
      subscription.current_plan_id,
      subscription.stripe_customer_id ?? '',
      subscription.stripe_subscription_id ?? '',
      subscription.stripe_subscription_status ?? '',
    ]
      .join(' ')
      .toLowerCase()
      .includes(normalizedSearch)
  })

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h1 className="text-2xl font-bold text-slate-900">Admin Panel</h1>
        <p className="mt-1 text-sm text-slate-500">Full account control with account status management plus dedicated subscriptions, checks, alerts, and website editors.</p>
      </section>

      {error ? (
        <section className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </section>
      ) : null}

      {notice ? (
        <section className={`rounded-2xl px-4 py-3 text-sm ${notice.tone === 'success' ? 'border border-emerald-200 bg-emerald-50 text-emerald-700' : 'border border-rose-200 bg-rose-50 text-rose-700'}`}>
          {notice.message}
        </section>
      ) : null}

      {overview ? (
        <section className="grid gap-3 md:grid-cols-6">
          <div className="rounded-xl border border-slate-200 bg-white p-4"><div className="text-xs text-slate-500">Users</div><div className="text-xl font-bold text-slate-900">{overview.users}</div></div>
          <div className="rounded-xl border border-slate-200 bg-white p-4"><div className="text-xs text-slate-500">Admins</div><div className="text-xl font-bold text-slate-900">{overview.admins}</div></div>
          <div className="rounded-xl border border-slate-200 bg-white p-4"><div className="text-xs text-slate-500">Active subscriptions</div><div className="text-xl font-bold text-slate-900">{overview.active_subscriptions}</div></div>
          <div className="rounded-xl border border-slate-200 bg-white p-4"><div className="text-xs text-slate-500">Websites</div><div className="text-xl font-bold text-slate-900">{overview.websites}</div></div>
          <div className="rounded-xl border border-slate-200 bg-white p-4"><div className="text-xs text-slate-500">Checks</div><div className="text-xl font-bold text-slate-900">{overview.checks}</div></div>
          <div className="rounded-xl border border-slate-200 bg-white p-4"><div className="text-xs text-slate-500">Alerts</div><div className="text-xl font-bold text-slate-900">{overview.alerts}</div></div>
        </section>
      ) : null}

      {userEditor ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Edit User</h2>
              <p className="mt-1 text-sm text-slate-500">Manage identity, verification, access level, account status, and billing state for user #{userEditor.id}.</p>
            </div>
            <button onClick={() => clearEditors()} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">Close editor</button>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <label className="space-y-1 text-sm text-slate-600"><span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Email</span><input value={userEditor.email} onChange={(event) => setUserEditor({ ...userEditor, email: event.target.value })} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900" /></label>
            <label className="space-y-1 text-sm text-slate-600"><span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">First name</span><input value={userEditor.first_name} onChange={(event) => setUserEditor({ ...userEditor, first_name: event.target.value })} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900" /></label>
            <label className="space-y-1 text-sm text-slate-600"><span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Last name</span><input value={userEditor.last_name} onChange={(event) => setUserEditor({ ...userEditor, last_name: event.target.value })} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900" /></label>
            <label className="space-y-1 text-sm text-slate-600"><span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Company</span><input value={userEditor.company_name} onChange={(event) => setUserEditor({ ...userEditor, company_name: event.target.value })} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900" /></label>
            <label className="space-y-1 text-sm text-slate-600"><span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Account status</span><select value={userEditor.account_status} onChange={(event) => setUserEditor({ ...userEditor, account_status: event.target.value as AccountStatus })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900">{accountStatusOptions.map((option) => (<option key={option.value} value={option.value}>{option.label}</option>))}</select></label>
            <label className="space-y-1 text-sm text-slate-600"><span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Subscription plan</span><select value={userEditor.current_plan_id} onChange={(event) => setUserEditor({ ...userEditor, current_plan_id: event.target.value as AdminUserItem['current_plan_id'] })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900">{editablePlanOptions.map((option) => (<option key={option.value} value={option.value}>{option.label}</option>))}</select></label>
            <label className="space-y-1 text-sm text-slate-600"><span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Subscription status</span><select value={userEditor.stripe_subscription_status} onChange={(event) => setUserEditor({ ...userEditor, stripe_subscription_status: event.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900">{editableSubscriptionStatusOptions.map((status) => (<option key={status || 'none'} value={status}>{status ? subscriptionStatusLabel(status) : 'no subscription'}</option>))}</select></label>
            <label className="space-y-1 text-sm text-slate-600"><span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Stripe customer id</span><input value={userEditor.stripe_customer_id} onChange={(event) => setUserEditor({ ...userEditor, stripe_customer_id: event.target.value })} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-mono text-slate-900" /></label>
            <label className="space-y-1 text-sm text-slate-600"><span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Stripe subscription id</span><input value={userEditor.stripe_subscription_id} onChange={(event) => setUserEditor({ ...userEditor, stripe_subscription_id: event.target.value })} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-mono text-slate-900" /></label>
            <label className="space-y-1 text-sm text-slate-600"><span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Current period end</span><input type="datetime-local" value={userEditor.stripe_current_period_end} onChange={(event) => setUserEditor({ ...userEditor, stripe_current_period_end: event.target.value })} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900" /></label>
          </div>
          <div className="mt-4 flex flex-wrap gap-4">
            <label className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"><input type="checkbox" checked={userEditor.is_admin} onChange={(event) => setUserEditor({ ...userEditor, is_admin: event.target.checked })} />Admin access</label>
            <label className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"><input type="checkbox" checked={userEditor.is_email_verified} onChange={(event) => setUserEditor({ ...userEditor, is_email_verified: event.target.checked })} />Email verified</label>
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <button onClick={() => void handleSaveUser()} disabled={savingUser} className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60">{savingUser ? 'Saving...' : 'Save user'}</button>
            <button onClick={() => clearEditors()} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700">Cancel</button>
            <button onClick={() => void handleDeleteUser(userEditor.id)} className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-700">Delete account</button>
          </div>
        </section>
      ) : null}

      {websiteEditor ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold text-slate-900">Edit Website</h2><p className="mt-1 text-sm text-slate-500">Change ownership, URL, interval, and pause state for website #{websiteEditor.id}.</p></div><button onClick={() => clearEditors()} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">Close editor</button></div>
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <label className="space-y-1 text-sm text-slate-600"><span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">User id</span><input type="number" min={1} value={websiteEditor.user_id} onChange={(event) => setWebsiteEditor({ ...websiteEditor, user_id: event.target.value })} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900" /></label>
            <label className="space-y-1 text-sm text-slate-600"><span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Name</span><input value={websiteEditor.name} onChange={(event) => setWebsiteEditor({ ...websiteEditor, name: event.target.value })} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900" /></label>
            <label className="space-y-1 text-sm text-slate-600 xl:col-span-2"><span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">URL</span><input value={websiteEditor.url} onChange={(event) => setWebsiteEditor({ ...websiteEditor, url: event.target.value })} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900" /></label>
            <label className="space-y-1 text-sm text-slate-600"><span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Check interval (minutes)</span><input type="number" min={1} value={websiteEditor.check_interval} onChange={(event) => setWebsiteEditor({ ...websiteEditor, check_interval: event.target.value })} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900" /></label>
            <label className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 xl:self-end"><input type="checkbox" checked={websiteEditor.is_paused} onChange={(event) => setWebsiteEditor({ ...websiteEditor, is_paused: event.target.checked })} />Website paused</label>
          </div>
          <div className="mt-5 flex flex-wrap gap-3"><button onClick={() => void handleSaveWebsite()} disabled={savingWebsite} className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60">{savingWebsite ? 'Saving...' : 'Save website'}</button><button onClick={() => clearEditors()} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700">Cancel</button></div>
        </section>
      ) : null}

      {subscriptionEditor ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold text-slate-900">{subscriptionEditor.isNew ? 'Create Subscription' : 'Edit Subscription'}</h2><p className="mt-1 text-sm text-slate-500">Manage subscription records separately from the user list, including manual plan/status overrides.</p></div><button onClick={() => clearEditors()} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">Close editor</button></div>
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <label className="space-y-1 text-sm text-slate-600"><span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">User id</span><input type="number" min={1} value={subscriptionEditor.user_id} onChange={(event) => setSubscriptionEditor({ ...subscriptionEditor, user_id: event.target.value })} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900" /></label>
            <label className="space-y-1 text-sm text-slate-600"><span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Subscription plan</span><select value={subscriptionEditor.current_plan_id} onChange={(event) => setSubscriptionEditor({ ...subscriptionEditor, current_plan_id: event.target.value as AdminSubscriptionItem['current_plan_id'] })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900">{editablePlanOptions.map((option) => (<option key={option.value} value={option.value}>{option.label}</option>))}</select></label>
            <label className="space-y-1 text-sm text-slate-600"><span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Subscription status</span><select value={subscriptionEditor.stripe_subscription_status} onChange={(event) => setSubscriptionEditor({ ...subscriptionEditor, stripe_subscription_status: event.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900">{editableSubscriptionStatusOptions.map((status) => (<option key={status || 'none'} value={status}>{status ? subscriptionStatusLabel(status) : 'no subscription'}</option>))}</select></label>
            <label className="space-y-1 text-sm text-slate-600"><span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Stripe customer id</span><input value={subscriptionEditor.stripe_customer_id} onChange={(event) => setSubscriptionEditor({ ...subscriptionEditor, stripe_customer_id: event.target.value })} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-mono text-slate-900" /></label>
            <label className="space-y-1 text-sm text-slate-600"><span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Stripe subscription id</span><input value={subscriptionEditor.stripe_subscription_id} onChange={(event) => setSubscriptionEditor({ ...subscriptionEditor, stripe_subscription_id: event.target.value })} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-mono text-slate-900" /></label>
            <label className="space-y-1 text-sm text-slate-600"><span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Current period end</span><input type="datetime-local" value={subscriptionEditor.stripe_current_period_end} onChange={(event) => setSubscriptionEditor({ ...subscriptionEditor, stripe_current_period_end: event.target.value })} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900" /></label>
          </div>
          <div className="mt-5 flex flex-wrap gap-3"><button onClick={() => void handleSaveSubscription()} disabled={savingSubscription} className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60">{savingSubscription ? 'Saving...' : subscriptionEditor.isNew ? 'Create subscription' : 'Save subscription'}</button><button onClick={() => clearEditors()} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700">Cancel</button>{!subscriptionEditor.isNew ? <button onClick={() => void handleDeleteSubscription(Number(subscriptionEditor.user_id))} className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-700">Delete subscription</button> : null}</div>
        </section>
      ) : null}

      {checkEditor ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold text-slate-900">{checkEditor.isNew ? 'Create Check' : 'Edit Check'}</h2><p className="mt-1 text-sm text-slate-500">Manage raw check records directly when you need to correct or seed historical monitoring entries.</p></div><button onClick={() => clearEditors()} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">Close editor</button></div>
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <label className="space-y-1 text-sm text-slate-600"><span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Website id</span><input type="number" min={1} value={checkEditor.website_id} onChange={(event) => setCheckEditor({ ...checkEditor, website_id: event.target.value })} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900" /></label>
            <label className="space-y-1 text-sm text-slate-600"><span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Status code</span><input type="number" value={checkEditor.status_code} onChange={(event) => setCheckEditor({ ...checkEditor, status_code: event.target.value })} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900" /></label>
            <label className="space-y-1 text-sm text-slate-600"><span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Response time</span><input type="number" step="0.01" value={checkEditor.response_time} onChange={(event) => setCheckEditor({ ...checkEditor, response_time: event.target.value })} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900" /></label>
            <label className="space-y-1 text-sm text-slate-600"><span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">TTFB</span><input type="number" step="0.01" value={checkEditor.ttfb} onChange={(event) => setCheckEditor({ ...checkEditor, ttfb: event.target.value })} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900" /></label>
            <label className="space-y-1 text-sm text-slate-600"><span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">SSL days left</span><input type="number" value={checkEditor.ssl_days_left} onChange={(event) => setCheckEditor({ ...checkEditor, ssl_days_left: event.target.value })} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900" /></label>
            <label className="space-y-1 text-sm text-slate-600"><span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Keyword state</span><select value={checkEditor.keyword_ok} onChange={(event) => setCheckEditor({ ...checkEditor, keyword_ok: event.target.value as CheckEditorState['keyword_ok'] })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"><option value="">Not checked</option><option value="true">Keyword ok</option><option value="false">Keyword missing</option></select></label>
            <label className="space-y-1 text-sm text-slate-600 xl:col-span-2"><span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Checked at</span><input type="datetime-local" value={checkEditor.checked_at} onChange={(event) => setCheckEditor({ ...checkEditor, checked_at: event.target.value })} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900" /></label>
          </div>
          <div className="mt-5 flex flex-wrap gap-3"><button onClick={() => void handleSaveCheck()} disabled={savingCheck} className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60">{savingCheck ? 'Saving...' : checkEditor.isNew ? 'Create check' : 'Save check'}</button><button onClick={() => clearEditors()} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700">Cancel</button>{!checkEditor.isNew && checkEditor.id != null ? <button onClick={() => void handleDeleteCheck(checkEditor.id as number)} className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-700">Delete check</button> : null}</div>
        </section>
      ) : null}

      {alertEditor ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold text-slate-900">{alertEditor.isNew ? 'Create Alert' : 'Edit Alert'}</h2><p className="mt-1 text-sm text-slate-500">Manage alert history directly for cleanup, corrections, or manual entries.</p></div><button onClick={() => clearEditors()} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">Close editor</button></div>
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <label className="space-y-1 text-sm text-slate-600"><span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Website id</span><input type="number" min={1} value={alertEditor.website_id} onChange={(event) => setAlertEditor({ ...alertEditor, website_id: event.target.value })} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900" /></label>
            <label className="space-y-1 text-sm text-slate-600"><span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Alert type</span><input value={alertEditor.type} onChange={(event) => setAlertEditor({ ...alertEditor, type: event.target.value })} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900" /></label>
            <label className="space-y-1 text-sm text-slate-600"><span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Sent at</span><input type="datetime-local" value={alertEditor.sent_at} onChange={(event) => setAlertEditor({ ...alertEditor, sent_at: event.target.value })} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900" /></label>
            <label className="space-y-1 text-sm text-slate-600 md:col-span-2 xl:col-span-3"><span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Message</span><textarea value={alertEditor.message} onChange={(event) => setAlertEditor({ ...alertEditor, message: event.target.value })} rows={4} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900" /></label>
          </div>
          <div className="mt-5 flex flex-wrap gap-3"><button onClick={() => void handleSaveAlert()} disabled={savingAlert} className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60">{savingAlert ? 'Saving...' : alertEditor.isNew ? 'Create alert' : 'Save alert'}</button><button onClick={() => clearEditors()} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700">Cancel</button>{!alertEditor.isNew && alertEditor.id != null ? <button onClick={() => void handleDeleteAlert(alertEditor.id as number)} className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-700">Delete alert</button> : null}</div>
        </section>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-lg font-semibold text-slate-900">Search</h2><p className="mt-1 text-sm text-slate-500">Find users or subscriptions by email, account status, plan, Stripe ids, or subscription status.</p></div>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search users and subscriptions" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-400 md:w-80" />
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-semibold text-slate-900">Users</h2><p className="mt-1 text-sm text-slate-500">Account records with direct access control, billing control, and delete actions.</p></div><div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{filteredUsers.length} visible</div></div>
        {loading ? <div className="mt-3 text-sm text-slate-500">Loading...</div> : null}
        <div className="mt-3 space-y-2">{filteredUsers.map((user) => (<div key={user.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2"><div className="space-y-1"><div className="text-sm font-semibold text-slate-900">{user.email}</div><div className="text-xs text-slate-500">{user.first_name} {user.last_name}{user.company_name ? ` • ${user.company_name}` : ''}</div><div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500"><span>{user.websites_count} websites</span><span>•</span><span>created {formatDateTime(user.created_at)}</span><span>•</span><span>plan {planLabel(user.current_plan_id)}</span></div></div><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${accountStatusClass(user.account_status)}`}>{accountStatusLabel(user.account_status)}</span><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${user.is_email_verified ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'}`}>{user.is_email_verified ? 'verified' : 'unverified'}</span>{user.is_admin ? <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-700">admin</span> : null}<span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${planBadgeClass(user.current_plan_id)}`}>{planLabel(user.current_plan_id)}</span><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${subscriptionStatusClass(user.stripe_subscription_status)}`}>{subscriptionStatusLabel(user.stripe_subscription_status)}</span><button onClick={() => startUserEdit(user)} className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700">Edit</button><button onClick={() => void handleDeleteUser(user.id)} className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700">Delete account</button></div></div>))}</div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-semibold text-slate-900">Subscriptions</h2><p className="mt-1 text-sm text-slate-500">Separate billing records table with create, edit, and delete controls.</p></div><div className="flex items-center gap-3"><div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{filteredSubscriptions.length} accounts</div><button onClick={startSubscriptionCreate} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">New subscription</button></div></div>
        {loading ? <div className="mt-3 text-sm text-slate-500">Loading...</div> : null}
        {!loading && filteredSubscriptions.length === 0 ? <div className="mt-3 rounded-xl border border-dashed border-slate-200 px-4 py-6 text-sm text-slate-500">No subscription records match the current filter.</div> : null}
        <div className="mt-3 space-y-3">{filteredSubscriptions.map((subscription) => (<div key={subscription.user_id} className="rounded-xl border border-slate-200 px-4 py-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-sm font-semibold text-slate-900">{subscription.email}</div><div className="mt-1 text-xs text-slate-500">user #{subscription.user_id} • created {formatDateTime(subscription.created_at)}</div></div><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${accountStatusClass(subscription.account_status)}`}>{accountStatusLabel(subscription.account_status)}</span><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${planBadgeClass(subscription.current_plan_id)}`}>{planLabel(subscription.current_plan_id)}</span><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${subscriptionStatusClass(subscription.stripe_subscription_status)}`}>{subscriptionStatusLabel(subscription.stripe_subscription_status)}</span><button onClick={() => startSubscriptionEdit(subscription)} className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700">Edit</button><button onClick={() => void handleDeleteSubscription(subscription.user_id)} className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700">Delete subscription</button></div></div><div className="mt-3 grid gap-2 text-xs text-slate-600 md:grid-cols-2 xl:grid-cols-3"><div><span className="font-semibold text-slate-700">Renewal:</span> {formatDateTime(subscription.stripe_current_period_end)}</div><div><span className="font-semibold text-slate-700">Customer id:</span> <span className="font-mono text-[11px]">{subscription.stripe_customer_id ?? '—'}</span></div><div><span className="font-semibold text-slate-700">Subscription id:</span> <span className="font-mono text-[11px]">{subscription.stripe_subscription_id ?? '—'}</span></div></div></div>))}</div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-semibold text-slate-900">Websites</h2><p className="mt-1 text-sm text-slate-500">Reassign ownership, pause/resume, or delete monitors from the same screen.</p></div><div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{websites.length} total</div></div>
        <div className="mt-3 space-y-2">{websites.map((website) => (<div key={website.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2"><div><div className="text-sm font-semibold text-slate-900">{website.name}</div><div className="text-xs text-slate-500">{website.url} • user #{website.user_id} • {website.check_interval}m • created {formatDateTime(website.created_at)}</div></div><div className="flex flex-wrap items-center gap-2">{website.is_paused ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">paused</span> : <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">active</span>}<button onClick={() => startWebsiteEdit(website)} className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700">Edit</button><button onClick={() => void handleDeleteWebsite(website.id)} className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700">Delete</button></div></div>))}</div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-semibold text-slate-900">Checks</h2>{showChecks ? <p className="mt-1 text-sm text-slate-500">Direct CRUD over raw monitoring checks for cleanup, correction, or manual seeding.</p> : null}</div><div className="flex items-center gap-3"><div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{checks.length} total</div><button onClick={() => setShowChecks((current) => !current)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">{showChecks ? 'Hide checks' : 'Show checks'}</button>{showChecks ? <button onClick={startCheckCreate} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">New check</button> : null}</div></div>
        {showChecks ? <div className="mt-3 space-y-2">{checks.map((check) => (<div key={check.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2"><div><div className="text-sm font-semibold text-slate-900">{check.website_name ?? `Website #${check.website_id}`}</div><div className="text-xs text-slate-500">user #{check.user_id ?? '—'} • status {check.status_code ?? '—'} • response {check.response_time ?? '—'} • checked {formatDateTime(check.checked_at)}</div></div><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${keywordOkClass(check.keyword_ok)}`}>{keywordOkLabel(check.keyword_ok)}</span><button onClick={() => startCheckEdit(check)} className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700">Edit</button><button onClick={() => void handleDeleteCheck(check.id)} className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700">Delete</button></div></div>))}</div> : null}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-semibold text-slate-900">Alerts</h2><p className="mt-1 text-sm text-slate-500">Separate alert records table with create, edit, and delete controls.</p></div><button onClick={startAlertCreate} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">New alert</button></div>
        <div className="mt-3 space-y-2">{alerts.map((alert) => (<div key={alert.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2"><div><div className="text-sm font-semibold text-slate-900">{alert.type}</div><div className="text-xs text-slate-500">{alert.website_name ?? `Website #${alert.website_id}`} • user #{alert.user_id ?? '—'} • sent {formatDateTime(alert.sent_at)}</div><div className="mt-1 text-xs text-slate-600">{alert.message}</div></div><div className="flex flex-wrap items-center gap-2"><button onClick={() => startAlertEdit(alert)} className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700">Edit</button><button onClick={() => void handleDeleteAlert(alert.id)} className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700">Delete</button></div></div>))}</div>
      </section>
    </div>
  )
}
