import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { alertsApi, websitesApi } from '../api/websites'
import SparklineChart from '../components/SparklineChart'
import StatusBadge from '../components/StatusBadge'
import StatusDonut from '../components/StatusDonut'
import {
  clonePerformanceBudgets,
  hasCustomPerformanceBudgets,
  performanceMetricOrder,
  splitKeywordPhrases,
} from '../monitorConfig'
import type { Alert, Check, Website } from '../types'

const statusFilterOptions = [
  { value: 'all', label: 'All monitors' },
  { value: 'healthy', label: 'Healthy' },
  { value: 'issues', label: 'Needs attention' },
] as const

const activityFilterOptions = [
  { value: 'all', label: 'All activity' },
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
] as const

const sortOptions = [
  { value: 'recent', label: 'Latest checks first' },
  { value: 'slowest', label: 'Slowest first' },
  { value: 'ssl-risk', label: 'SSL risk first' },
  { value: 'name', label: 'Name A-Z' },
] as const

const DASHBOARD_FILTER_STATE_KEY = 'status-beacon.dashboard.filter-state'
const DASHBOARD_SAVED_FILTERS_KEY = 'status-beacon.dashboard.saved-filters'
const headerReportOrder = [
  'content-type',
  'cache-control',
  'content-security-policy',
  'strict-transport-security',
  'x-content-type-options',
  'x-frame-options',
  'referrer-policy',
  'permissions-policy',
  'x-robots-tag',
  'server-timing',
]

const seoIssuesShownInCells = new Set([
  'Missing page title',
  'Title is shorter than 20 characters',
  'Title is longer than 60 characters',
  'Missing meta description',
  'Meta description is shorter than 50 characters',
  'Meta description is longer than 160 characters',
  'Missing canonical URL',
  'Missing viewport meta tag',
  'Viewport meta tag is missing width=device-width',
  'Viewport meta tag is missing initial-scale',
  'Missing charset declaration',
  'Charset is not UTF-8',
  'Missing html lang attribute',
  'Missing H1 heading',
  'Page is marked noindex',
  'Page is marked noindex despite having a canonical URL',
  'Missing Open Graph title',
  'Missing Open Graph description',
  'Missing Open Graph image',
  'Missing Twitter card meta tag',
  'Twitter card is missing a title',
  'Twitter card is missing a description',
  'Twitter large image card is missing an image',
  'No structured data (JSON-LD) found',
])

type StatusFilter = (typeof statusFilterOptions)[number]['value']
type ActivityFilter = (typeof activityFilterOptions)[number]['value']
type SortMode = (typeof sortOptions)[number]['value']
type ActionNotice = { tone: 'success' | 'error'; message: string }
type DashboardFilterState = {
  searchTerm: string
  statusFilter: StatusFilter
  activityFilter: ActivityFilter
  sortMode: SortMode
  tagFilter: string
}
type SavedFilterPreset = DashboardFilterState & { id: string; name: string }
type PrioritySeverity = 'critical' | 'high' | 'medium' | 'low'
type IncidentLifecycle = 'open' | 'review' | 'resolved'
type PriorityMonitor = {
  websiteId: number
  websiteName: string
  severity: PrioritySeverity
  score: number
  headline: string
  detail: string
  nextStep: string
  signalCount: number
  statusLine: string
  lastCheckedAt: string | null
}

const defaultDashboardFilterState: DashboardFilterState = {
  searchTerm: '',
  statusFilter: 'all',
  activityFilter: 'all',
  sortMode: 'recent',
  tagFilter: 'all',
}

function formatLastCheck(value: string | null) {
  if (!value) {
    return 'Never'
  }

  return new Date(value).toLocaleString()
}

function formatLastCheckCompact(value: string | null) {
  if (!value) {
    return 'Never'
  }

  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatResponseTime(value: number | null) {
  if (value === null) {
    return 'N/A'
  }

  return `${value.toFixed(3)}s`
}

function formatTtfb(value: number | null) {
  if (value === null) {
    return 'N/A'
  }

  return `${Math.max(1, Math.round(value * 1000))} ms`
}

function formatSslStatus(value: number | null) {
  if (value === null) {
    return 'N/A'
  }

  if (value < 0) {
    return 'SSL error'
  }

  return `${value} days`
}

function formatAuditDateTime(value: string | null | undefined) {
  if (!value) {
    return 'Unavailable'
  }

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString()
}

function formatHexFingerprint(value: string | null | undefined) {
  if (!value) {
    return 'Unavailable'
  }

  const normalized = value.replace(/[^a-f0-9]/gi, '').toUpperCase()
  if (!normalized || normalized.length % 2 !== 0) {
    return value
  }

  return normalized.match(/.{1,2}/g)?.join(':') ?? value
}

function getTlsStatusMeta(tlsReport: Check['tls_report'] | null) {
  if (!tlsReport) {
    return { label: 'Pending', className: 'bg-slate-200 text-slate-600' }
  }

  if (tlsReport.valid === false) {
    return { label: 'Handshake failed', className: 'bg-rose-100 text-rose-700' }
  }

  if (tlsReport.changed_public_key) {
    return { label: 'Key changed', className: 'bg-rose-100 text-rose-700' }
  }

  if (tlsReport.changed_certificate) {
    return { label: 'Cert changed', className: 'bg-amber-100 text-amber-800' }
  }

  if (!tlsReport.baseline_available) {
    return { label: 'Learning baseline', className: 'bg-slate-200 text-slate-600' }
  }

  return { label: 'Identity stable', className: 'bg-emerald-100 text-emerald-700' }
}

function isHealthyStatus(statusCode: number | null) {
  return statusCode !== null && statusCode >= 200 && statusCode < 400
}

function isSslAtRisk(daysLeft: number | null) {
  return daysLeft !== null && daysLeft >= 0 && daysLeft <= 30
}

function average(values: number[]) {
  if (values.length === 0) {
    return null
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function normalizeAlertType(value: string) {
  switch (value) {
    case 'http_error':
      return 'HTTP error'
    case 'ssl_expiry':
      return 'SSL expiry'
    case 'tls_public_key_change':
      return 'TLS identity change'
    case 'hsts_missing':
      return 'HSTS missing'
    case 'keyword_missing':
      return 'Missing monitored text'
    case 'noscript_missing':
      return 'No-JS content gap'
    case 'rendered_change':
      return 'Rendered content change'
    default:
      return value.replace(/_/g, ' ')
  }
}

function trimTrailingSentencePunctuation(value: string) {
  return value.trim().replace(/[.!\s]+$/, '')
}

function extractAlertDetail(message: string) {
  const separatorIndex = message.indexOf(':')
  if (separatorIndex === -1) {
    return null
  }

  const detail = trimTrailingSentencePunctuation(message.slice(separatorIndex + 1))
  return detail.length > 0 ? detail : null
}

function isSeoIssueCoveredByCell(issue: string) {
  return seoIssuesShownInCells.has(issue) || /^\d+ images? missing alt text$/i.test(issue)
}

function formatAlertMessage(alert: Alert, websiteName: string) {
  const websiteLabel = websiteName || `Website #${alert.website_id}`

  switch (alert.type) {
    case 'timeout':
      return `${websiteLabel} did not respond before the monitor timeout window. The origin may be stalled, overloaded, or blocking requests before a full response is returned.`
    case 'error':
      return `${websiteLabel} could not be reached by the monitor at all. This usually points to DNS, TLS, firewall, or origin connectivity trouble.`
    case 'http_error': {
      const statusCode = alert.message.match(/HTTP\s+(\d{3})/i)?.[1]
      return statusCode
        ? `${websiteLabel} responded with HTTP ${statusCode}. The endpoint is reachable, but it returned an error response instead of a healthy page.`
        : `${websiteLabel} returned a non-healthy HTTP response. The endpoint is reachable, but it is not serving a normal success page.`
    }
    case 'ssl_expiry': {
      const daysLeft = alert.message.match(/expires in (\d+) day/i)?.[1]
      const threshold = alert.message.match(/threshold:\s*(\d+) day/i)?.[1]
      if (daysLeft && threshold) {
        return `${websiteLabel} SSL certificate expires in ${daysLeft} day(s) and has crossed the ${threshold}-day warning threshold. Renew it before browsers start showing certificate warnings.`
      }

      return `${websiteLabel} SSL certificate is approaching expiry. Renew it before browsers start showing certificate warnings.`
    }
    case 'tls_public_key_change':
      return `${websiteLabel} is presenting a different TLS public key than the previous trusted check. If you did not rotate certificates or change CDN/edge TLS, investigate possible interception or unexpected certificate replacement.`
    case 'hsts_missing':
      return `${websiteLabel} serves HTTPS without a Strict-Transport-Security header. Without HSTS, first-visit downgrade and some network interception scenarios are easier.`
    case 'keyword_missing': {
      const detail = extractAlertDetail(alert.message)
      return detail
        ? `${websiteLabel} loaded, but the required rendered text ${detail} was not found on the page. This usually means the content changed or the monitored phrase needs updating.`
        : `${websiteLabel} loaded, but the required rendered text was not found on the page. This usually means the content changed or the monitored phrase needs updating.`
    }
    case 'noscript_missing': {
      const detail = extractAlertDetail(alert.message)
      return detail
        ? `${websiteLabel} only shows the required text after JavaScript runs. With JavaScript disabled, ${detail} is missing, so bots and fallback clients may see incomplete content.`
        : `${websiteLabel} only shows the required text after JavaScript runs. With JavaScript disabled, the fallback content is incomplete.`
    }
    case 'rendered_change': {
      const detail = extractAlertDetail(alert.message)
      return detail
        ? `${websiteLabel} now renders differently from the stored baseline. ${detail}. Review whether this UI or content change was expected before accepting a new baseline.`
        : `${websiteLabel} now renders differently from the stored baseline. Review whether this UI or content change was expected before accepting a new baseline.`
    }
    default:
      return alert.message
  }
}

function formatHeaderName(value: string) {
  return value
    .split('-')
    .map((part) => (part.length <= 3 ? part.toUpperCase() : `${part.charAt(0).toUpperCase()}${part.slice(1)}`))
    .join('-')
}

function getAuditValueClass(value: string | null | undefined, presentClass: string, missingClass = 'font-semibold text-amber-700') {
  return value && value.trim().length > 0 ? presentClass : missingClass
}

function getRecommendedLengthStatus(length: number | null | undefined, min: number, max: number) {
  if (length === null || length === undefined) {
    return { label: 'Length unavailable', className: 'text-slate-400' }
  }

  if (length < min) {
    return { label: `${length} chars · short`, className: 'text-amber-700' }
  }

  if (length > max) {
    return { label: `${length} chars · long`, className: 'text-amber-700' }
  }

  return { label: `${length} chars · in range`, className: 'text-emerald-700' }
}

function getSeverityRank(severity: PrioritySeverity) {
  switch (severity) {
    case 'critical':
      return 4
    case 'high':
      return 3
    case 'medium':
      return 2
    default:
      return 1
  }
}

function getSeverityLabel(severity: PrioritySeverity) {
  switch (severity) {
    case 'critical':
      return 'Critical'
    case 'high':
      return 'High'
    case 'medium':
      return 'Medium'
    default:
      return 'Low'
  }
}

function getSeverityClasses(severity: PrioritySeverity) {
  switch (severity) {
    case 'critical':
      return 'border-rose-200 bg-rose-50 text-rose-700'
    case 'high':
      return 'border-amber-200 bg-amber-50 text-amber-800'
    case 'medium':
      return 'border-sky-200 bg-sky-50 text-sky-700'
    default:
      return 'border-slate-200 bg-slate-50 text-slate-600'
  }
}

function getLifecycleLabel(lifecycle: IncidentLifecycle) {
  switch (lifecycle) {
    case 'open':
      return 'Open'
    case 'resolved':
      return 'Resolved'
    default:
      return 'Needs review'
  }
}

function getLifecycleClasses(lifecycle: IncidentLifecycle) {
  switch (lifecycle) {
    case 'open':
      return 'border-rose-200 bg-rose-50 text-rose-700'
    case 'resolved':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700'
    default:
      return 'border-amber-200 bg-amber-50 text-amber-800'
  }
}

function getStatusState(statusCode: number | null) {
  if (statusCode === null) {
    return 'unknown'
  }

  if (statusCode === 0) {
    return 'timeout'
  }

  if (statusCode === -1) {
    return 'error'
  }

  if (statusCode >= 400) {
    return 'http_error'
  }

  return 'healthy'
}

function resolveAlertLifecycle(
  alert: Alert,
  website: Website | undefined,
  latestCheck: Check | null,
  latestRenderedChangeAlertId: number | null,
): IncidentLifecycle {
  const currentStatus = getStatusState(latestCheck?.status_code ?? website?.last_status_code ?? null)

  switch (alert.type) {
    case 'timeout':
      return currentStatus === 'timeout' ? 'open' : currentStatus === 'unknown' ? 'review' : 'resolved'
    case 'error':
      return currentStatus === 'error' ? 'open' : currentStatus === 'unknown' ? 'review' : 'resolved'
    case 'http_error':
      return currentStatus === 'http_error' ? 'open' : currentStatus === 'unknown' ? 'review' : 'resolved'
    case 'ssl_expiry': {
      const daysLeft = website?.last_ssl_days_left ?? latestCheck?.ssl_days_left ?? null
      if (daysLeft === null) {
        return 'review'
      }

      return daysLeft < 0 || daysLeft <= 30 ? 'open' : 'resolved'
    }
    case 'tls_public_key_change':
      return latestCheck?.tls_report?.changed_public_key === true
        ? 'open'
        : latestCheck?.tls_report?.changed_public_key === false
          ? 'resolved'
          : 'review'
    case 'hsts_missing': {
      const isMissing = latestCheck?.header_report?.issues.includes('Missing strict-transport-security header')
      return isMissing === true ? 'open' : isMissing === false ? 'resolved' : 'review'
    }
    case 'keyword_missing':
      return latestCheck?.keyword_ok === false ? 'open' : latestCheck?.keyword_ok === true ? 'resolved' : 'review'
    case 'noscript_missing':
      return latestCheck?.noscript_report?.keyword_ok === false
        ? 'open'
        : latestCheck?.noscript_report?.keyword_ok === true
          ? 'resolved'
          : 'review'
    case 'rendered_change':
      if (latestCheck?.screenshot_report?.changed === false) {
        return 'resolved'
      }

      return latestRenderedChangeAlertId === alert.id ? 'review' : 'resolved'
    default:
      return 'review'
  }
}

function getAlertSeverity(alert: Alert): PrioritySeverity {
  switch (alert.type) {
    case 'timeout':
    case 'error':
      return 'critical'
    case 'http_error': {
      const statusCode = Number(alert.message.match(/HTTP\s+(\d{3})/i)?.[1] ?? 0)
      return statusCode >= 500 ? 'critical' : 'high'
    }
    case 'ssl_expiry':
    case 'tls_public_key_change':
    case 'keyword_missing':
      return 'high'
    case 'hsts_missing':
      return 'medium'
    case 'noscript_missing':
    case 'rendered_change':
      return 'medium'
    default:
      return 'low'
  }
}

function buildMonitorPriority(
  website: Website,
  latestCheck: Check | null,
  openAlerts: number,
  reviewAlerts: number,
): PriorityMonitor | null {
  if (website.is_paused) {
    return null
  }

  let severity: PrioritySeverity = 'low'
  let score = 0
  let signalCount = 0
  let selectedPoints = -1
  let headline = ''
  let detail = ''
  let nextStep = ''

  const applySignal = (
    nextSeverity: PrioritySeverity,
    points: number,
    nextHeadline: string,
    nextDetail: string,
    nextStepText: string,
  ) => {
    signalCount += 1
    score += points

    if (getSeverityRank(nextSeverity) > getSeverityRank(severity) || (nextSeverity === severity && points > selectedPoints)) {
      severity = nextSeverity
      selectedPoints = points
      headline = nextHeadline
      detail = nextDetail
      nextStep = nextStepText
    }
  }

  if (!latestCheck) {
    applySignal(
      'medium',
      36,
      'Waiting for the first successful check',
      'This monitor has not captured a full result yet.',
      'Run a manual check to establish the first baseline.',
    )
  }

  const statusCode = latestCheck?.status_code ?? null
  if (statusCode === -1) {
    applySignal('critical', 120, 'Origin is unreachable', 'Latest check could not connect to the origin at all.', 'Check DNS, TLS, firewall and upstream reachability.')
  } else if (statusCode === 0) {
    applySignal('critical', 112, 'Monitor timed out', 'Latest check never completed inside the timeout window.', 'Inspect origin latency, saturation or blocking rules.')
  } else if (typeof statusCode === 'number' && statusCode >= 500) {
    applySignal('high', 96, `HTTP ${statusCode} is live`, 'The endpoint responds, but it is serving a server error.', 'Review the failing route or backend logs.')
  } else if (typeof statusCode === 'number' && statusCode >= 400) {
    applySignal('high', 84, `HTTP ${statusCode} needs attention`, 'The endpoint is reachable, but it is returning a non-success response.', 'Validate routing, auth flow or expected response codes.')
  }

  if (website.last_ssl_days_left !== null && website.last_ssl_days_left < 0) {
    applySignal('high', 82, 'SSL handshake is failing', 'The certificate could not be validated from the latest check.', 'Inspect the certificate chain and host configuration.')
  } else if (website.last_ssl_days_left !== null && website.last_ssl_days_left <= 7) {
    applySignal('high', 78, 'SSL expiry is close', `Certificate expires in ${website.last_ssl_days_left} day(s).`, 'Renew or replace the certificate immediately.')
  } else if (website.last_ssl_days_left !== null && website.last_ssl_days_left <= 30) {
    applySignal('medium', 56, 'SSL is in warning window', `Certificate expires in ${website.last_ssl_days_left} day(s).`, 'Schedule renewal before browsers start showing warnings.')
  }

  if (latestCheck?.tls_report?.changed_public_key) {
    applySignal('high', 90, 'TLS identity changed', 'The observed TLS public key no longer matches the previous trusted check.', 'Verify planned certificate rotation or investigate possible interception immediately.')
  }

  if (latestCheck?.keyword_ok === false) {
    applySignal('high', 74, 'Rendered text monitor failed', 'The page loaded, but the required visible phrases were not found.', 'Confirm the content change or update the monitored phrases.')
  }

  if (latestCheck?.noscript_report?.applicable && latestCheck.noscript_report.keyword_ok === false) {
    applySignal('medium', 58, 'No-JS fallback is incomplete', 'Required phrases disappear when JavaScript is disabled.', 'Add stronger fallback content or relax the no-JS requirement.')
  }

  if (latestCheck?.screenshot_report?.applicable && latestCheck.screenshot_report.changed) {
    applySignal('medium', 52, 'Visual baseline changed', 'The latest screenshot differs from the previously stored baseline.', 'Review the screenshot evidence and confirm whether the UI change is expected.')
  }

  const seoIssues = latestCheck?.seo_report?.issues.length ?? 0
  if (seoIssues >= 5) {
    applySignal('medium', 46, 'SEO audit shows multiple gaps', `${seoIssues} SEO checks need follow-up on this page.`, 'Prioritize canonical, social meta and indexability gaps once the route is stable.')
  } else if (seoIssues > 0) {
    applySignal('low', 24, 'SEO audit has follow-up items', `${seoIssues} SEO checks still need cleanup.`, 'Clean up the remaining metadata issues after critical checks are stable.')
  }

  const headerIssues = latestCheck?.header_report?.issues.length ?? 0
  if (website.url.startsWith('https://') && latestCheck?.header_report?.issues.includes('Missing strict-transport-security header')) {
    applySignal('medium', 44, 'HSTS is missing on HTTPS', 'The site serves HTTPS but does not send Strict-Transport-Security.', 'Add HSTS at the edge or origin to reduce downgrade and interception risk.')
  }

  if (headerIssues >= 3) {
    applySignal('low', 20, 'Security headers are incomplete', `${headerIssues} important response headers are missing.`, 'Add or tune response security headers at the edge or origin.')
  }

  const performanceIssues = latestCheck?.performance_report?.issues.length ?? 0
  if (performanceIssues >= 2) {
    applySignal('low', 18, 'Performance budgets are slipping', `${performanceIssues} performance metrics are outside budget.`, 'Review page weight, blocking scripts and render cost.')
  }

  const networkIssues = latestCheck?.network_report?.issues.length ?? 0
  if (networkIssues >= 1) {
    applySignal('low', 15, 'Waterfall shows request problems', latestCheck?.network_report?.issues[0] ?? 'Request failures or slow requests were captured during render.', 'Inspect failed and slow requests in the waterfall panel.')
  }

  if (signalCount === 0 && openAlerts > 0) {
    applySignal('medium', 44, 'An incident is still open', 'The latest alert condition still appears active for this monitor.', 'Inspect the latest incident and clear the underlying cause.')
  }

  if (signalCount === 0 && reviewAlerts > 0) {
    applySignal('medium', 40, 'A recent change still needs review', 'A rendered or visual change alert is still waiting for human review.', 'Review the latest change evidence in this monitor.')
  }

  if (signalCount === 0) {
    return null
  }

  score += openAlerts * 6 + reviewAlerts * 3

  return {
    websiteId: website.id,
    websiteName: website.name,
    severity,
    score,
    headline,
    detail,
    nextStep,
    signalCount,
    statusLine:
      openAlerts > 0
        ? `${openAlerts} open incident${openAlerts === 1 ? '' : 's'}`
        : reviewAlerts > 0
          ? `${reviewAlerts} review item${reviewAlerts === 1 ? '' : 's'}`
          : 'No unresolved alert backlog',
    lastCheckedAt: website.last_checked_at,
  }
}

function formatPerformanceMetricValue(metricKey: string, value: number | null | undefined) {
  if (value === null || value === undefined) {
    return 'Not captured'
  }

  if (metricKey === 'cumulative_layout_shift') {
    return value.toFixed(3)
  }

  if (metricKey.endsWith('_kb')) {
    return `${value.toFixed(1)} KB`
  }

  return `${Math.round(value)} ms`
}

function formatRequestDuration(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return 'n/a'
  }

  return `${Math.round(value)} ms`
}

function formatTransferSize(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return 'n/a'
  }

  return `${value.toFixed(1)} KB`
}

function formatNetworkRequestLabel(value: string | null | undefined) {
  if (!value) {
    return 'Unknown request'
  }

  try {
    const parsed = new URL(value)
    const path = parsed.pathname === '/' ? '' : parsed.pathname
    const querySuffix = parsed.search ? '?…' : ''
    const label = `${parsed.hostname}${path}${querySuffix}`
    return label.length > 52 ? `${label.slice(0, 49)}...` : label
  } catch {
    return value.length > 52 ? `${value.slice(0, 49)}...` : value
  }
}

function escapeCsvValue(value: string) {
  const normalized = value.replace(/\r?\n/g, ' ')
  if (/[",]/.test(normalized)) {
    return `"${normalized.replace(/"/g, '""')}"`
  }

  return normalized
}

function fallbackCopyText(value: string) {
  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'absolute'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)
  textarea.select()
  textarea.setSelectionRange(0, textarea.value.length)
  const copied = document.execCommand('copy')
  document.body.removeChild(textarea)
  return copied
}

function buildWebsiteTrend(checks: Check[]) {
  return checks
    .slice(0, 8)
    .reverse()
    .map((check) => {
      if (check.response_time !== null) {
        return Math.max(check.response_time, 0.04)
      }

      return isHealthyStatus(check.status_code) ? 0.08 : 0.02
    })
}

function readDashboardFilterState(): DashboardFilterState {
  if (typeof window === 'undefined') {
    return defaultDashboardFilterState
  }

  try {
    const raw = window.localStorage.getItem(DASHBOARD_FILTER_STATE_KEY)
    if (!raw) {
      return defaultDashboardFilterState
    }

    const parsed = JSON.parse(raw) as Partial<DashboardFilterState>
    const statusFilter: StatusFilter = statusFilterOptions.some((item) => item.value === parsed.statusFilter)
      ? (parsed.statusFilter as StatusFilter)
      : defaultDashboardFilterState.statusFilter
    const activityFilter: ActivityFilter = activityFilterOptions.some((item) => item.value === parsed.activityFilter)
      ? (parsed.activityFilter as ActivityFilter)
      : defaultDashboardFilterState.activityFilter
    const sortMode: SortMode = sortOptions.some((item) => item.value === parsed.sortMode)
      ? (parsed.sortMode as SortMode)
      : defaultDashboardFilterState.sortMode

    return {
      searchTerm: typeof parsed.searchTerm === 'string' ? parsed.searchTerm : defaultDashboardFilterState.searchTerm,
      statusFilter,
      activityFilter,
      sortMode,
      tagFilter: typeof parsed.tagFilter === 'string' ? parsed.tagFilter : defaultDashboardFilterState.tagFilter,
    }
  } catch {
    return defaultDashboardFilterState
  }
}

function persistDashboardFilterState(state: DashboardFilterState) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(DASHBOARD_FILTER_STATE_KEY, JSON.stringify(state))
  } catch {
    // Ignore localStorage failures and keep the UI usable.
  }
}

function readSavedFilterPresets(): SavedFilterPreset[] {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const raw = window.localStorage.getItem(DASHBOARD_SAVED_FILTERS_KEY)
    if (!raw) {
      return []
    }

    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null
        }

        const preset = item as Partial<SavedFilterPreset>
        if (typeof preset.id !== 'string' || typeof preset.name !== 'string') {
          return null
        }

        return {
          id: preset.id,
          name: preset.name,
          searchTerm: typeof preset.searchTerm === 'string' ? preset.searchTerm : '',
          statusFilter: statusFilterOptions.some((option) => option.value === preset.statusFilter)
            ? (preset.statusFilter as StatusFilter)
            : 'all',
          activityFilter: activityFilterOptions.some((option) => option.value === preset.activityFilter)
            ? (preset.activityFilter as ActivityFilter)
            : 'all',
          sortMode: sortOptions.some((option) => option.value === preset.sortMode) ? (preset.sortMode as SortMode) : 'recent',
          tagFilter: typeof preset.tagFilter === 'string' ? preset.tagFilter : 'all',
        }
      })
      .filter((item): item is SavedFilterPreset => item !== null)
      .slice(0, 8)
  } catch {
    return []
  }
}

function persistSavedFilterPresets(presets: SavedFilterPreset[]) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(DASHBOARD_SAVED_FILTERS_KEY, JSON.stringify(presets))
  } catch {
    // Ignore localStorage failures and keep the UI usable.
  }
}

export default function Dashboard() {
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [websites, setWebsites] = useState<Website[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [checksByWebsite, setChecksByWebsite] = useState<Record<number, Check[]>>({})
  const [loading, setLoading] = useState(true)
  const initialSearchTerm = searchParams.get('q') ?? readDashboardFilterState().searchTerm
  const [searchTerm, setSearchTerm] = useState(() => initialSearchTerm)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() => readDashboardFilterState().statusFilter)
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>(() => readDashboardFilterState().activityFilter)
  const [tagFilter, setTagFilter] = useState(() => readDashboardFilterState().tagFilter)
  const [sortMode, setSortMode] = useState<SortMode>(() => readDashboardFilterState().sortMode)
  const [savedFilters, setSavedFilters] = useState<SavedFilterPreset[]>(() => readSavedFilterPresets())
  const [savedFilterName, setSavedFilterName] = useState('')
  const [actionNotice, setActionNotice] = useState<ActionNotice | null>(null)
  const [runningVisibleChecks, setRunningVisibleChecks] = useState(false)
  const [duplicatingWebsiteId, setDuplicatingWebsiteId] = useState<number | null>(null)
  const [checkingWebsiteId, setCheckingWebsiteId] = useState<number | null>(null)
  const [togglingWebsiteId, setTogglingWebsiteId] = useState<number | null>(null)
  const [activeMenuWebsiteId, setActiveMenuWebsiteId] = useState<number | null>(null)
  const deferredSearchTerm = useDeferredValue(searchTerm)

  useEffect(() => {
    const querySearchTerm = searchParams.get('q') ?? ''
    if (querySearchTerm !== searchTerm) {
      setSearchTerm(querySearchTerm)
    }
  }, [searchParams, searchTerm])

  useEffect(() => {
    if (!location.hash) {
      return
    }

    const anchorId = location.hash.slice(1)
    if (!anchorId) {
      return
    }

    let frameId: number | null = null
    const scrollToAnchor = () => {
      const target = document.getElementById(anchorId)
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    }

    frameId = window.requestAnimationFrame(scrollToAnchor)
    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId)
      }
    }
  }, [deferredSearchTerm, loading, location.hash, websites.length])

  async function load() {
    setLoading(true)
    try {
      const [websiteData, alertData] = await Promise.all([websitesApi.list(), alertsApi.list()])
      setWebsites(websiteData)
      setAlerts(alertData)

      const historyEntries = await Promise.all(
        websiteData.map(async (website) => [website.id, await websitesApi.getChecks(website.id)] as const),
      )
      setChecksByWebsite(Object.fromEntries(historyEntries))
    } catch (error) {
      const status =
        typeof error === 'object' && error !== null && 'response' in error &&
        typeof (error as { response?: { status?: number } }).response?.status === 'number'
          ? (error as { response?: { status?: number } }).response?.status
          : null

      if (status === 401) {
        setActionNotice({ tone: 'error', message: 'Your session expired. Sign in again to load dashboard data.' })
        return
      }

      setActionNotice({ tone: 'error', message: 'Could not load dashboard data right now.' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  useEffect(() => {
    if (!actionNotice) {
      return undefined
    }

    const timer = window.setTimeout(() => setActionNotice(null), 3200)
    return () => window.clearTimeout(timer)
  }, [actionNotice])

  useEffect(() => {
    if (activeMenuWebsiteId === null) {
      return undefined
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest('[data-more-menu-root="true"]')) {
        return
      }

      setActiveMenuWebsiteId(null)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActiveMenuWebsiteId(null)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [activeMenuWebsiteId])

  useEffect(() => {
    persistDashboardFilterState({
      searchTerm,
      statusFilter,
      activityFilter,
      sortMode,
      tagFilter,
    })
  }, [activityFilter, searchTerm, sortMode, statusFilter, tagFilter])

  useEffect(() => {
    persistSavedFilterPresets(savedFilters)
  }, [savedFilters])

  const totals = useMemo(() => {
    const active = websites.filter((website) => !website.is_paused)
    const online = active.filter((website) => {
      const code = website.last_status_code
      return isHealthyStatus(code)
    }).length
    const paused = websites.filter((website) => website.is_paused).length
    const tagged = websites.filter((website) => website.tags.length > 0).length

    return {
      total: websites.length,
      active: active.length,
      online,
      issues: active.length - online,
      paused,
      tagged,
    }
  }, [websites])

  const availableTags = useMemo(
    () => [...new Set(websites.flatMap((website) => website.tags))].sort((left, right) => left.localeCompare(right)),
    [websites],
  )

  useEffect(() => {
    if (tagFilter !== 'all' && !availableTags.includes(tagFilter)) {
      setTagFilter('all')
    }
  }, [availableTags, tagFilter])

  const filteredWebsites = useMemo(() => {
    const searchValue = deferredSearchTerm.trim().toLowerCase()

    const filtered = websites.filter((website) => {
      const matchesSearch =
        searchValue.length === 0 ||
        website.name.toLowerCase().includes(searchValue) ||
        website.url.toLowerCase().includes(searchValue) ||
        website.tags.some((tag) => tag.toLowerCase().includes(searchValue)) ||
        splitKeywordPhrases(website.keyword).some((phrase) => phrase.toLowerCase().includes(searchValue))

      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'healthy' ? isHealthyStatus(website.last_status_code) : !isHealthyStatus(website.last_status_code))

      const matchesActivity =
        activityFilter === 'all' ||
        (activityFilter === 'paused' ? website.is_paused : !website.is_paused)

      const matchesTag = tagFilter === 'all' || website.tags.includes(tagFilter)

      return matchesSearch && matchesStatus && matchesActivity && matchesTag
    })

    const sorted = [...filtered]
    sorted.sort((left, right) => {
      if (sortMode === 'name') {
        return left.name.localeCompare(right.name)
      }

      if (sortMode === 'slowest') {
        return (right.last_response_time ?? -1) - (left.last_response_time ?? -1)
      }

      if (sortMode === 'ssl-risk') {
        const leftValue = left.last_ssl_days_left === null ? Number.MAX_SAFE_INTEGER : left.last_ssl_days_left
        const rightValue = right.last_ssl_days_left === null ? Number.MAX_SAFE_INTEGER : right.last_ssl_days_left
        return leftValue - rightValue
      }

      return new Date(right.last_checked_at ?? 0).getTime() - new Date(left.last_checked_at ?? 0).getTime()
    })

    return sorted
  }, [activityFilter, deferredSearchTerm, sortMode, statusFilter, tagFilter, websites])

  const activeWebsites = useMemo(() => websites.filter((website) => !website.is_paused), [websites])

  const latestChecks = useMemo(
    () =>
      Object.values(checksByWebsite)
        .flat()
        .sort((left, right) => new Date(right.checked_at).getTime() - new Date(left.checked_at).getTime()),
    [checksByWebsite],
  )

  const responseTrend = useMemo(
    () =>
      latestChecks
        .filter((check) => check.response_time !== null)
        .slice(0, 18)
        .reverse()
        .map((check) => check.response_time ?? 0),
    [latestChecks],
  )

  const avgResponse = useMemo(
    () =>
      average(
        websites
          .map((website) => website.last_response_time)
          .filter((value): value is number => value !== null),
      ),
    [websites],
  )

  const sslRiskSites = useMemo(
    () => websites.filter((website) => isSslAtRisk(website.last_ssl_days_left)),
    [websites],
  )

  const keywordCoverage = useMemo(
    () => websites.filter((website) => splitKeywordPhrases(website.keyword).length > 0).length,
    [websites],
  )

  const averageInterval = useMemo(() => average(activeWebsites.map((website) => website.check_interval)), [activeWebsites])

  const statusTrend = useMemo(
    () =>
      latestChecks
        .slice(0, 12)
        .reverse()
        .map((check) => (isHealthyStatus(check.status_code) ? 1 : 0.35)),
    [latestChecks],
  )

  const cadenceTrend = useMemo(
    () =>
      activeWebsites
        .slice(0, 12)
        .reverse()
        .map((website) => website.check_interval / 30),
    [activeWebsites],
  )

  const alertTrend = useMemo(
    () =>
      alerts
        .slice(0, 12)
        .reverse()
        .map((alert) => {
          if (alert.type === 'rendered_change') {
            return 0.55
          }
          if (alert.type === 'ssl_expiry') {
            return 0.72
          }
          return 1
        }),
    [alerts],
  )

  const alertMix = useMemo(() => {
    const counts = alerts.reduce<Record<string, number>>((result, alert) => {
      result[alert.type] = (result[alert.type] ?? 0) + 1
      return result
    }, {})

    return Object.entries(counts)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 4)
  }, [alerts])

  const websiteById = useMemo<Record<number, Website>>(
    () => Object.fromEntries(websites.map((website) => [website.id, website])) as Record<number, Website>,
    [websites],
  )

  const websiteNameById = useMemo<Record<number, string>>(
    () => Object.fromEntries(websites.map((website) => [website.id, website.name])) as Record<number, string>,
    [websites],
  )

  const latestCheckByWebsite = useMemo<Record<number, Check | null>>(
    () =>
      Object.fromEntries(
        Object.entries(checksByWebsite).map(([websiteId, history]) => [Number(websiteId), history[0] ?? null]),
      ) as Record<number, Check | null>,
    [checksByWebsite],
  )

  const alertsByWebsite = useMemo(() => {
    return alerts.reduce<Record<number, Alert[]>>((result, alert) => {
      result[alert.website_id] = [...(result[alert.website_id] ?? []), alert]
      return result
    }, {})
  }, [alerts])

  const latestRenderedChangeByWebsite = useMemo(() => {
    return alerts.reduce<Record<number, Alert>>((result, alert) => {
      if (alert.type !== 'rendered_change') {
        return result
      }

      const existing = result[alert.website_id]
      if (!existing || new Date(alert.sent_at).getTime() > new Date(existing.sent_at).getTime()) {
        result[alert.website_id] = alert
      }
      return result
    }, {})
  }, [alerts])

  const alertLifecycleById = useMemo<Record<number, IncidentLifecycle>>(() => {
    return alerts.reduce<Record<number, IncidentLifecycle>>((result, alert) => {
      result[alert.id] = resolveAlertLifecycle(
        alert,
        websiteById[alert.website_id],
        latestCheckByWebsite[alert.website_id] ?? null,
        latestRenderedChangeByWebsite[alert.website_id]?.id ?? null,
      )
      return result
    }, {})
  }, [alerts, latestCheckByWebsite, latestRenderedChangeByWebsite, websiteById])

  const incidentCountsByWebsite = useMemo(() => {
    return Object.entries(alertsByWebsite).reduce<Record<number, { open: number; review: number; resolved: number }>>((result, [websiteId, websiteAlerts]) => {
      const counts = { open: 0, review: 0, resolved: 0 }

      websiteAlerts.forEach((alert) => {
        const lifecycle = alertLifecycleById[alert.id] ?? 'review'
        counts[lifecycle] += 1
      })

      result[Number(websiteId)] = counts
      return result
    }, {})
  }, [alertLifecycleById, alertsByWebsite])

  const incidentCounts = useMemo(() => {
    return alerts.reduce(
      (result, alert) => {
        const lifecycle = alertLifecycleById[alert.id] ?? 'review'
        result[lifecycle] += 1
        return result
      },
      { open: 0, review: 0, resolved: 0 },
    )
  }, [alertLifecycleById, alerts])

  const priorityMonitors = useMemo(() => {
    return filteredWebsites
      .map((website) => {
        const latestCheck = latestCheckByWebsite[website.id] ?? null
        const websiteIncidentCounts = incidentCountsByWebsite[website.id] ?? { open: 0, review: 0, resolved: 0 }

        return buildMonitorPriority(website, latestCheck, websiteIncidentCounts.open, websiteIncidentCounts.review)
      })
      .filter((item): item is PriorityMonitor => item !== null)
      .sort((left, right) => right.score - left.score)
  }, [filteredWebsites, incidentCountsByWebsite, latestCheckByWebsite])

  const priorityByWebsite = useMemo<Record<number, PriorityMonitor>>(
    () => Object.fromEntries(priorityMonitors.map((item) => [item.websiteId, item])) as Record<number, PriorityMonitor>,
    [priorityMonitors],
  )

  const activeAlerts = useMemo(
    () => alerts.filter((alert) => (alertLifecycleById[alert.id] ?? 'review') !== 'resolved'),
    [alertLifecycleById, alerts],
  )

  const renderedChangeAlerts = useMemo(
    () => alerts.filter((alert) => alert.type === 'rendered_change'),
    [alerts],
  )

  const activeRenderedChangeByWebsite = useMemo(() => {
    return renderedChangeAlerts.reduce<Record<number, Alert>>((result, alert) => {
      if ((alertLifecycleById[alert.id] ?? 'review') === 'resolved') {
        return result
      }

      const existing = result[alert.website_id]
      if (!existing || new Date(alert.sent_at).getTime() > new Date(existing.sent_at).getTime()) {
        result[alert.website_id] = alert
      }

      return result
    }, {})
  }, [alertLifecycleById, renderedChangeAlerts])

  const activeIncidentTotal = incidentCounts.open + incidentCounts.review
  const actionPriorityPreview = priorityMonitors.slice(0, 4)
  const hiddenPriorityCount = Math.max(priorityMonitors.length - actionPriorityPreview.length, 0)
  const monitorPreviewWebsites = filteredWebsites.slice(0, 8)
  const hiddenMonitorCount = Math.max(filteredWebsites.length - monitorPreviewWebsites.length, 0)
  const topAlertMix = alertMix[0] ?? null

  function showNotice(message: string, tone: ActionNotice['tone'] = 'success') {
    setActionNotice({ tone, message })
  }

  function handleSearchTermChange(value: string) {
    setSearchTerm(value)
    const trimmed = value.trim()
    const nextParams = new URLSearchParams(searchParams)
    if (trimmed.length === 0) {
      nextParams.delete('q')
    } else {
      nextParams.set('q', trimmed)
    }
    setSearchParams(nextParams, { replace: true })
  }

  async function copyText(value: string, successMessage: string) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value)
      } else if (!fallbackCopyText(value)) {
        throw new Error('Clipboard not available')
      }

      showNotice(successMessage)
    } catch {
      showNotice('Clipboard access was blocked. Copy the value manually from the panel.', 'error')
    }
  }

  function handleExportAlerts() {
    if (alerts.length === 0) {
      showNotice('No incident history is available to export yet.', 'error')
      return
    }

    const rows = [
      ['sent_at', 'type', 'severity', 'lifecycle', 'website_name', 'message'],
      ...alerts.map((alert) => {
        const websiteName = websiteNameById[alert.website_id] ?? `Website #${alert.website_id}`
        const lifecycle = alertLifecycleById[alert.id] ?? 'review'
        return [
          alert.sent_at,
          alert.type,
          getSeverityLabel(getAlertSeverity(alert)),
          getLifecycleLabel(lifecycle),
          websiteName,
          formatAlertMessage(alert, websiteName),
        ]
      }),
    ]

    const csv = rows.map((row) => row.map((value) => escapeCsvValue(value)).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const objectUrl = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = objectUrl
    link.download = `status-beacon-alerts-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(objectUrl)
    showNotice('Alert history exported to CSV.')
  }

  async function handleRunVisibleChecks() {
    if (filteredWebsites.length === 0) {
      showNotice('No monitors match the current filters.', 'error')
      return
    }

    setRunningVisibleChecks(true)
    try {
      const results = await Promise.allSettled(filteredWebsites.map((website) => websitesApi.triggerCheck(website.id)))
      const succeeded = results.filter((result) => result.status === 'fulfilled').length
      const failed = results.length - succeeded

      showNotice(
        failed === 0
          ? `Queued checks for ${succeeded} monitor${succeeded === 1 ? '' : 's'}.`
          : `Queued ${succeeded} checks, ${failed} failed to start.`,
        failed === 0 ? 'success' : 'error',
      )
      await load()
    } finally {
      setRunningVisibleChecks(false)
    }
  }

  async function handleDuplicate(website: Website) {
    setDuplicatingWebsiteId(website.id)
    try {
      await websitesApi.create({
        name: `${website.name} copy`,
        url: website.url,
        check_interval: website.check_interval,
        keyword: website.keyword?.trim() || undefined,
        check_noscript: website.check_noscript,
        performance_budgets: clonePerformanceBudgets(website.performance_budgets),
        tags: website.tags,
        is_paused: website.is_paused,
      })
      showNotice(`Duplicated ${website.name}.`)
      await load()
    } catch {
      showNotice('Could not duplicate this monitor right now.', 'error')
    } finally {
      setDuplicatingWebsiteId(null)
    }
  }

  function applySavedFilter(preset: SavedFilterPreset) {
    setSearchTerm(preset.searchTerm)
    setStatusFilter(preset.statusFilter)
    setActivityFilter(preset.activityFilter)
    setSortMode(preset.sortMode)
    setTagFilter(preset.tagFilter)
    showNotice(`Applied saved filter ${preset.name}.`)
  }

  function handleSaveCurrentFilter() {
    const name = savedFilterName.trim()
    if (!name) {
      showNotice('Name the saved filter first.', 'error')
      return
    }

    const preset: SavedFilterPreset = {
      id: `${Date.now()}-${name.toLowerCase().replace(/\s+/g, '-')}`,
      name,
      searchTerm,
      statusFilter,
      activityFilter,
      sortMode,
      tagFilter,
    }

    setSavedFilters((current) => {
      const existing = current.find((item) => item.name.toLowerCase() === name.toLowerCase())
      if (existing) {
        return current.map((item) => (item.id === existing.id ? { ...preset, id: existing.id } : item))
      }

      return [preset, ...current].slice(0, 8)
    })
    setSavedFilterName('')
    showNotice(`Saved filter ${name}.`)
  }

  function handleDeleteSavedFilter(id: string) {
    setSavedFilters((current) => current.filter((item) => item.id !== id))
    showNotice('Saved filter removed.')
  }


  async function handleDelete(id: number) {
    setActiveMenuWebsiteId(null)
    try {
      await websitesApi.delete(id)
      showNotice('Monitor deleted.')
      await load()
    } catch {
      showNotice('Could not delete this monitor right now.', 'error')
    }
  }

  async function handleCheck(id: number) {
    setActiveMenuWebsiteId(null)
    setCheckingWebsiteId(id)
    try {
      await websitesApi.triggerCheck(id)
      showNotice('Manual check queued.')
      await load()
    } catch {
      showNotice('Could not queue a manual check right now.', 'error')
    } finally {
      setCheckingWebsiteId(null)
    }
  }

  async function handleTogglePause(website: Website) {
    setActiveMenuWebsiteId(null)
    setTogglingWebsiteId(website.id)
    try {
      await websitesApi.update(website.id, { is_paused: !website.is_paused })
      showNotice(website.is_paused ? `Resumed ${website.name}.` : `Paused ${website.name}.`)
      await load()
    } catch {
      showNotice('Could not update this monitor state right now.', 'error')
    } finally {
      setTogglingWebsiteId(null)
    }
  }

  return (
    <div className="relative isolate space-y-4">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[320px] rounded-[36px] bg-[radial-gradient(circle_at_10%_12%,rgba(99,102,241,0.16),transparent_38%),radial-gradient(circle_at_88%_4%,rgba(139,92,246,0.12),transparent_34%),radial-gradient(circle_at_50%_100%,rgba(6,182,212,0.08),transparent_45%)]" />
      <section className="rounded-2xl border border-slate-200/80 bg-white/92 p-5 shadow-[0_16px_60px_-40px_rgba(15,23,42,0.2)]">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-3xl">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-700">Workspace</div>
            <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-950 sm:text-[1.8rem]">
              Monitor uptime, rendered pages and regressions from one calmer surface.
            </h2>
            <p className="mt-2 text-xs leading-5 text-slate-600 sm:text-sm">
              Keep the workflow focused: rendered checks, keywords and regressions.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleRunVisibleChecks()}
              disabled={runningVisibleChecks || filteredWebsites.length === 0}
              className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {runningVisibleChecks ? 'Queueing checks...' : `Run ${filteredWebsites.length} visible checks`}
            </button>
            <button
              type="button"
              onClick={handleExportAlerts}
              disabled={alerts.length === 0}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Export alerts CSV
            </button>
            <button
              type="button"
              onClick={() => void load()}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
            >
              Refresh
            </button>
            <Link
              to="/settings"
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
            >
              Settings
            </Link>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          <div className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-3.5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-700">Monitored sites</div>
                <div className="mt-1 text-sm font-semibold text-slate-950">Sites that are currently in scope</div>
              </div>
              <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                {filteredWebsites.length} shown
              </div>
            </div>

            <div className="mt-3 space-y-2">
              {monitorPreviewWebsites.length === 0 ? (
                <div className="rounded-[20px] border border-dashed border-slate-200 bg-white px-4 py-4 text-sm text-slate-500">
                  No monitors match the current filters.
                </div>
              ) : (
                monitorPreviewWebsites.map((website) => (
                  <div key={website.id} className="rounded-[18px] border border-slate-200 bg-white px-3.5 py-2.5 shadow-sm transition hover:border-slate-300">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            to={`/dashboard#monitor-${website.id}`}
                            className="truncate text-sm font-semibold text-slate-950 transition hover:text-sky-700"
                          >
                            {website.name}
                          </Link>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] ${website.is_paused ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-700'}`}>
                            {website.is_paused ? 'Paused' : 'Live'}
                          </span>
                          {priorityByWebsite[website.id] ? (
                            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] ${getSeverityClasses(priorityByWebsite[website.id].severity)}`}>
                              {getSeverityLabel(priorityByWebsite[website.id].severity)}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1 block truncate text-xs text-slate-500">{website.url}</div>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-slate-500">{website.check_interval}m</span>
                        <Link to={`/settings?monitor=${website.id}#monitor-editor`} className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-sky-700 transition hover:border-sky-300 hover:bg-sky-100">
                          Edit
                        </Link>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {hiddenMonitorCount > 0 ? (
              <div className="mt-3 text-xs leading-5 text-slate-500">
                {hiddenMonitorCount} more monitor{hiddenMonitorCount === 1 ? '' : 's'} hidden by filters.
              </div>
            ) : null}
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-[18px] border border-slate-200 bg-white p-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Monitors</div>
              <div className="mt-2.5 flex items-end justify-between gap-3">
                <div>
                  <div className="text-2xl font-extrabold tracking-tight text-slate-950">{totals.active}</div>
                  <div className="mt-0.5 text-[11px] text-slate-500">{totals.paused} paused</div>
                </div>
              </div>
            </div>

            <div className="rounded-[18px] border border-slate-200 bg-white p-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Browser checks</div>
              <div className="mt-2.5 flex items-end justify-between gap-3">
                <div>
                  <div className="text-2xl font-extrabold tracking-tight text-slate-950">{keywordCoverage}</div>
                  <div className="mt-0.5 text-[11px] text-slate-500">{Math.max(totals.total - keywordCoverage, 0)} availability-only</div>
                </div>
              </div>
            </div>

            <div className="rounded-[18px] border border-slate-200 bg-white p-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Avg response</div>
              <div className="mt-2.5 flex items-end justify-between gap-3">
                <div>
                  <div className="text-2xl font-extrabold tracking-tight text-slate-950">{avgResponse === null ? 'N/A' : `${avgResponse.toFixed(3)}s`}</div>
                  <div className="mt-0.5 text-[11px] text-slate-500">{averageInterval === null ? 'No active cadence yet' : `${Math.round(averageInterval)} min cadence`}</div>
                </div>
              </div>
            </div>

            <div className="rounded-[18px] border border-slate-200 bg-white p-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Action queue</div>
              <div className="mt-2.5 flex items-end justify-between gap-3">
                <div>
                  <div className="text-2xl font-extrabold tracking-tight text-slate-950">{activeIncidentTotal}</div>
                  <div className="mt-0.5 text-[11px] text-slate-500">
                    {activeIncidentTotal === 0 ? 'No active incidents in the current window' : `${incidentCounts.open} open, ${incidentCounts.review} review`}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {actionNotice ? (
        <section
          className={`rounded-[22px] border px-4 py-3 text-sm font-medium shadow-[0_16px_45px_-38px_rgba(15,23,42,0.22)] ${
            actionNotice.tone === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-rose-200 bg-rose-50 text-rose-700'
          }`}
        >
          {actionNotice.message}
        </section>
      ) : null}

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.85fr)]">
        <div className="rounded-[28px] border border-slate-200/80 bg-white/92 p-5 shadow-[0_24px_80px_-52px_rgba(15,23,42,0.18)]">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-lg font-bold tracking-tight text-slate-950">Needs action now</h2>
              <p className="mt-1 text-sm text-slate-500">Prioritized from the current filtered view so the next operational step is obvious.</p>
            </div>
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{priorityMonitors.length} monitors flagged</div>
          </div>

          {actionPriorityPreview.length === 0 ? (
            <div className="mt-4 rounded-[22px] border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm leading-6 text-emerald-800">
              No monitors in the current view need immediate follow-up. This slice of the dashboard looks stable right now.
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {actionPriorityPreview.map((item) => (
                <div key={item.websiteId} className="rounded-[22px] border border-slate-200 bg-slate-50/80 px-4 py-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${getSeverityClasses(item.severity)}`}>
                          {getSeverityLabel(item.severity)}
                        </span>
                        <Link to={`/dashboard#monitor-${item.websiteId}`} className="text-sm font-semibold text-slate-950 transition hover:text-sky-700">
                          {item.websiteName}
                        </Link>
                        <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                          {item.statusLine}
                        </span>
                      </div>
                      <div className="mt-2 text-sm font-semibold text-slate-950">{item.headline}</div>
                      <div className="mt-1 text-sm leading-6 text-slate-600">{item.detail}</div>
                      <div className="mt-2 text-xs font-medium text-slate-500">Next step: {item.nextStep}</div>
                    </div>
                    <div className="text-xs text-slate-400">{formatLastCheckCompact(item.lastCheckedAt)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {hiddenPriorityCount > 0 ? (
            <div className="mt-3 text-xs leading-5 text-slate-500">{hiddenPriorityCount} more monitor{hiddenPriorityCount === 1 ? '' : 's'} still have lower-priority follow-up inside the current filters.</div>
          ) : null}
        </div>

        <div className="rounded-[28px] border border-slate-200/80 bg-white/92 p-5 shadow-[0_24px_80px_-52px_rgba(15,23,42,0.18)]">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-lg font-bold tracking-tight text-slate-950">Incident lifecycle</h2>
              <p className="mt-1 text-sm text-slate-500">Only active conditions stay visible here. Corrected issues drop out after the latest clean check.</p>
            </div>
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Based on the latest 50 alerts</div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-rose-700">Open</div>
              <div className="mt-1.5 text-2xl font-extrabold tracking-tight text-rose-700">{incidentCounts.open}</div>
            </div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-700">Needs review</div>
              <div className="mt-1.5 text-2xl font-extrabold tracking-tight text-amber-800">{incidentCounts.review}</div>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4 text-sm text-slate-600">
            {activeIncidentTotal === 0
              ? 'Latest checks are clean right now. Corrected issues are hidden from this summary.'
              : 'Corrected issues are hidden from this summary so it stays focused on active follow-up only.'}
          </div>
        </div>
      </section>

      <section className="space-y-6">
        <div className="min-w-0 space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-[28px] border border-slate-200/80 bg-white/92 p-4 shadow-[0_24px_80px_-52px_rgba(15,23,42,0.18)]">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-lg font-bold tracking-tight text-slate-950">Synthetic checks</h2>
                  <p className="mt-1 text-xs text-slate-500">Recent response-time movement from controlled checks.</p>
                </div>
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">{responseTrend.length} samples</div>
              </div>

              <div className="mt-3 rounded-[20px] border border-slate-200 bg-slate-50/80 p-3">
                <SparklineChart values={responseTrend} className="h-20 w-full" height={42} label="Response time trend" />
                <p className="mt-2 text-[11px] leading-5 text-slate-500">
                  How to read: each point is a recent response-time check. Higher line means slower response; flatter low line means stable performance.
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Current average</div>
                    <div className="mt-1.5 text-base font-bold tracking-tight text-slate-950">{avgResponse === null ? 'N/A' : `${avgResponse.toFixed(3)}s`}</div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Avg cadence</div>
                    <div className="mt-1.5 text-base font-bold tracking-tight text-slate-950">{averageInterval === null ? 'N/A' : `${Math.round(averageInterval)}m`}</div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Paused</div>
                    <div className="mt-1.5 text-base font-bold tracking-tight text-slate-950">{totals.paused}</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-[28px] border border-slate-200/80 bg-white/92 p-4 shadow-[0_24px_80px_-52px_rgba(15,23,42,0.18)]">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">Fleet health</div>
              <div className="mt-3">
                <StatusDonut healthy={totals.online} issues={totals.issues} theme="dark" />
              </div>
              <p className="mt-2 text-[11px] leading-5 text-slate-500">
                How to read: donut shows healthy vs issue monitors from active checks. Healthy rate is the same ratio in percent; SSL watchlist counts certs with expiring or problematic SSL.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Healthy rate</div>
                  <div className="mt-2 text-base font-bold tracking-tight text-slate-950">
                    {totals.active === 0 ? '0%' : `${Math.round((totals.online / totals.active) * 100)}%`}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">SSL watchlist</div>
                  <div className="mt-2 text-base font-bold tracking-tight text-slate-950">{sslRiskSites.length}</div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Alert mix</div>
                  {topAlertMix ? (
                    <>
                      <div className="mt-2 text-base font-bold tracking-tight text-slate-950">{normalizeAlertType(topAlertMix[0])}</div>
                      <div className="mt-1 text-xs text-slate-500">{topAlertMix[1]} of {alerts.length} recent alerts</div>
                    </>
                  ) : (
                    <div className="mt-2 text-base font-bold tracking-tight text-slate-950">Quiet</div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="min-w-0 overflow-hidden rounded-[30px] border border-slate-200/80 bg-white/92 p-6 shadow-[0_24px_80px_-52px_rgba(15,23,42,0.18)]">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="text-xl font-bold tracking-tight text-slate-950">Monitors</h2>
                <p className="mt-1 text-sm text-slate-500">Availability checks, browser-rendered text checks and readable result categories in one table-first workspace.</p>
              </div>
              <div className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                Showing {filteredWebsites.length} of {websites.length}
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <input
                value={searchTerm}
                onChange={(event) => handleSearchTermChange(event.target.value)}
                className="min-w-[240px] flex-[1_1_280px] rounded-2xl border border-slate-200 bg-slate-50/90 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-500"
                placeholder="Search by name, URL, keyword or tag"
              />

              <div className="inline-flex rounded-2xl border border-slate-200 bg-slate-50 p-1">
                {statusFilterOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setStatusFilter(option.value)}
                    className={`rounded-2xl px-3 py-2 text-xs font-semibold transition ${
                      statusFilter === option.value ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-950'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              <div className="inline-flex rounded-2xl border border-slate-200 bg-slate-50 p-1">
                {activityFilterOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setActivityFilter(option.value)}
                    className={`rounded-2xl px-3 py-2 text-xs font-semibold transition ${
                      activityFilter === option.value ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-950'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              <select
                value={tagFilter}
                onChange={(event) => setTagFilter(event.target.value)}
                className="min-w-[140px] rounded-2xl border border-slate-200 bg-slate-50/90 px-4 py-3 text-sm font-semibold text-slate-700 outline-none transition focus:border-sky-500"
              >
                <option value="all">All tags</option>
                {availableTags.map((tag) => (
                  <option key={tag} value={tag}>
                    {tag}
                  </option>
                ))}
              </select>

              <select
                value={sortMode}
                onChange={(event) => setSortMode(event.target.value as SortMode)}
                className="min-w-[200px] flex-[0_1_220px] rounded-2xl border border-slate-200 bg-slate-50/90 px-4 py-3 text-sm font-semibold text-slate-700 outline-none transition focus:border-sky-500"
              >
                {sortOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-4 flex flex-col gap-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
              <div className="flex min-w-0 flex-wrap gap-2">
                {savedFilters.length === 0 ? (
                  <div className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-medium text-slate-500">Saved filters stay in this browser for quick repeat review loops.</div>
                ) : (
                  savedFilters.map((preset) => (
                    <div key={preset.id} className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-2 shadow-sm">
                      <button
                        type="button"
                        onClick={() => applySavedFilter(preset)}
                        className="rounded-full px-3 py-1 text-xs font-semibold text-slate-700 transition hover:bg-white hover:text-slate-950"
                      >
                        {preset.name}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteSavedFilter(preset.id)}
                        className="rounded-full px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 transition hover:text-rose-600"
                      >
                        Remove
                      </button>
                    </div>
                  ))
                )}
              </div>

              <div className="flex flex-wrap gap-2 2xl:justify-end">
                <input
                  value={savedFilterName}
                  onChange={(event) => setSavedFilterName(event.target.value)}
                  className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-500"
                  placeholder="Save current filter as"
                />
                <button
                  type="button"
                  onClick={handleSaveCurrentFilter}
                  className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
                >
                  Save filter
                </button>
                <button
                  type="button"
                  onClick={() => {
                    handleSearchTermChange(defaultDashboardFilterState.searchTerm)
                    setStatusFilter(defaultDashboardFilterState.statusFilter)
                    setActivityFilter(defaultDashboardFilterState.activityFilter)
                    setSortMode(defaultDashboardFilterState.sortMode)
                    setTagFilter(defaultDashboardFilterState.tagFilter)
                  }}
                  className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
                >
                  Clear filters
                </button>
              </div>
            </div>

            <div className="mt-5 hidden xl:grid xl:grid-cols-[minmax(0,1.45fr)_120px_140px_110px_120px_auto] xl:gap-4 xl:px-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Monitor</div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">State</div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Coverage</div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Response</div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Last check</div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Actions</div>
            </div>

            <div className="mt-4 space-y-4">
              {loading ? (
                <div className="rounded-[24px] border border-slate-200 bg-slate-50/80 px-5 py-6 text-sm text-slate-500">
                  Loading websites...
                </div>
              ) : filteredWebsites.length === 0 ? (
                <div className="rounded-[24px] border border-slate-200 bg-slate-50/80 px-5 py-6 text-sm text-slate-500">
                  {websites.length === 0 ? 'No monitors yet. Add your first website from Settings.' : 'No monitors match the current filters. Adjust the filter state or save a broader view.'}
                </div>
              ) : (
                filteredWebsites.map((website) => {
                  const trendValues = buildWebsiteTrend(checksByWebsite[website.id] ?? [])
                  const keywordCount = splitKeywordPhrases(website.keyword).length
                  const renderedKeywordPhrases = splitKeywordPhrases(website.keyword)
                  const latestCheck = checksByWebsite[website.id]?.[0] ?? null
                  const seoReport = latestCheck?.seo_report ?? null
                  const headerReport = latestCheck?.header_report ?? null
                  const tlsReport = latestCheck?.tls_report ?? null
                  const noscriptReport = latestCheck?.noscript_report ?? null
                  const screenshotReport = latestCheck?.screenshot_report ?? null
                  const performanceReport = latestCheck?.performance_report ?? null
                  const networkReport = latestCheck?.network_report ?? null
                  const seoIssueCount = seoReport?.issues.length ?? 0
                  const seoVisibleIssues = (seoReport?.issues ?? []).filter((issue) => !isSeoIssueCoveredByCell(issue))
                  const headerIssueCount = headerReport?.issues.length ?? 0
                  const showTlsPanel = website.url.startsWith('https://') || Boolean(tlsReport?.applicable)
                  const tlsStatusMeta = getTlsStatusMeta(tlsReport)
                  const tlsSanValues = (tlsReport?.subject_alt_names ?? []).filter((value) => value.trim().length > 0)
                  const tlsVisibleSanValues = tlsSanValues.slice(0, 12)
                  const tlsHiddenSanCount = Math.max(0, tlsSanValues.length - tlsVisibleSanValues.length)
                  const formattedCertificateFingerprint = formatHexFingerprint(tlsReport?.certificate_sha256)
                  const publicKeyPinValue = tlsReport?.public_key_pin_sha256 ?? 'Unavailable'
                  const noscriptIssueCount = noscriptReport?.issues.length ?? 0
                  const screenshotIssueCount = screenshotReport?.issues.length ?? 0
                  const performanceIssueCount = performanceReport?.issues.length ?? 0
                  const networkIssueCount = networkReport?.issues.length ?? 0
                  const titleLengthStatus = getRecommendedLengthStatus(seoReport?.title_length, 20, 60)
                  const metaDescriptionLengthStatus = getRecommendedLengthStatus(seoReport?.meta_description_length, 50, 160)
                  const screenshotHasBaseline = screenshotReport?.baseline_available ?? false
                  const screenshotChanged = screenshotReport?.changed === true
                  const slowestNetworkRequest = networkReport?.slowest_requests?.[0] ?? null
                  const viewportLooksResponsive = Boolean(
                    seoReport?.viewport && seoReport.viewport.toLowerCase().includes('width=device-width') && seoReport.viewport.toLowerCase().includes('initial-scale'),
                  )
                  const charsetIsUtf8 = seoReport?.charset ? seoReport.charset.toLowerCase() === 'utf-8' : false
                  const noindexDetected = Boolean(
                    (seoReport?.robots ?? '').toLowerCase().includes('noindex') || (seoReport?.x_robots_tag ?? '').toLowerCase().includes('noindex'),
                  )
                  const imageCount = seoReport?.image_count ?? 0
                  const imagesMissingAlt = seoReport?.images_missing_alt ?? 0
                  const imageAltCoverageLabel =
                    imageCount === 0
                      ? 'No images on page'
                      : imagesMissingAlt === 0
                        ? 'Alt complete'
                        : `${imagesMissingAlt} missing alt`
                  const imageAltCoverageDetail =
                    imageCount === 0
                      ? 'Nothing to audit'
                      : `${imageCount - imagesMissingAlt}/${imageCount} with alt`
                  const customPerformanceBudgets = hasCustomPerformanceBudgets(website.performance_budgets)
                  const websiteIncidentCounts = incidentCountsByWebsite[website.id] ?? { open: 0, review: 0, resolved: 0 }
                  const monitorPriority = priorityByWebsite[website.id] ?? null
                  const twitterCoverageDetail =
                    !seoReport?.has_twitter_card
                      ? 'No Twitter card metadata detected'
                      : [
                          seoReport.twitter_title ? 'title ready' : 'title missing',
                          seoReport.twitter_description ? 'description ready' : 'description missing',
                          seoReport.twitter_card === 'summary_large_image'
                            ? seoReport.twitter_image
                              ? 'image ready'
                              : 'image missing'
                            : seoReport.twitter_image
                              ? 'image set'
                              : 'image optional',
                        ].join(' · ')
                  const coverageLabel = website.keyword
                    ? website.check_noscript
                      ? 'DOM + no-JS checks'
                      : 'DOM + text checks'
                    : website.check_noscript
                      ? 'HTTP + no-JS checks'
                      : 'HTTP + SSL checks'

                  return (
                    <article id={`monitor-${website.id}`} key={website.id} className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_24px_80px_-56px_rgba(15,23,42,0.18)] scroll-mt-28">
                      <div className="bg-[linear-gradient(180deg,rgba(248,250,252,0.96)_0%,rgba(240,249,255,0.92)_100%)] px-4 py-4 sm:px-5">
                        <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-start 2xl:justify-between">
                          <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="truncate text-base font-bold tracking-tight text-slate-950">{website.name}</div>
                            <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${website.is_paused ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
                              {website.is_paused ? 'Paused' : 'Live'}
                            </span>
                            {monitorPriority ? (
                              <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${getSeverityClasses(monitorPriority.severity)}`}>
                                {getSeverityLabel(monitorPriority.severity)} priority
                              </span>
                            ) : null}
                            <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${website.keyword ? 'bg-sky-100 text-sky-700' : 'bg-slate-200 text-slate-700'}`}>
                              {website.keyword ? 'Browser-rendered' : 'Availability'}
                            </span>
                          </div>
                          <div className="mt-1 break-all text-sm text-slate-500">{website.url}</div>
                          {monitorPriority ? (
                            <div className="mt-3 rounded-[18px] border border-slate-200 bg-white px-3 py-3 shadow-sm">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Action priority</div>
                                <div className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                                  {websiteIncidentCounts.open} open · {websiteIncidentCounts.review} review
                                </div>
                              </div>
                              <div className="mt-2 text-sm font-semibold text-slate-950">{monitorPriority.headline}</div>
                              <div className="mt-1 text-sm leading-6 text-slate-600">{monitorPriority.detail}</div>
                              <div className="mt-2 text-xs font-medium text-slate-500">Next step: {monitorPriority.nextStep}</div>
                            </div>
                          ) : null}
                          <div className="mt-3 flex flex-wrap gap-2">
                            <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-medium text-slate-600 shadow-sm">{website.check_interval}m cadence</span>
                            {keywordCount > 0 ? (
                              <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-medium text-slate-600 shadow-sm">{keywordCount} visible phrase{keywordCount === 1 ? '' : 's'}</span>
                            ) : null}
                            {website.has_basic_auth ? (
                              <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-medium text-slate-600 shadow-sm">Basic Auth</span>
                            ) : null}
                            {seoReport ? (
                              <span
                                className={`rounded-full border px-3 py-1 text-[11px] font-semibold shadow-sm ${
                                  seoReport.applicable
                                    ? seoIssueCount === 0
                                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                      : 'border-amber-200 bg-amber-50 text-amber-800'
                                    : 'border-slate-200 bg-white text-slate-500'
                                }`}
                              >
                                {!seoReport.applicable ? 'SEO n/a' : seoIssueCount === 0 ? 'SEO ok' : `SEO ${seoIssueCount} issue${seoIssueCount === 1 ? '' : 's'}`}
                              </span>
                            ) : null}
                            {headerReport ? (
                              <span
                                className={`rounded-full border px-3 py-1 text-[11px] font-semibold shadow-sm ${
                                  headerIssueCount === 0
                                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                    : 'border-amber-200 bg-amber-50 text-amber-800'
                                }`}
                              >
                                {headerIssueCount === 0 ? 'Headers ok' : `${headerIssueCount} header gap${headerIssueCount === 1 ? '' : 's'}`}
                              </span>
                            ) : null}
                            {website.check_noscript ? (
                              <span
                                className={`rounded-full border px-3 py-1 text-[11px] font-semibold shadow-sm ${
                                  !noscriptReport
                                    ? 'border-slate-200 bg-white text-slate-500'
                                    : !noscriptReport.applicable
                                      ? 'border-slate-200 bg-white text-slate-500'
                                      : noscriptIssueCount === 0
                                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                        : 'border-amber-200 bg-amber-50 text-amber-800'
                                }`}
                              >
                                {!noscriptReport
                                  ? 'NoScript on'
                                  : !noscriptReport.applicable
                                    ? 'NoScript n/a'
                                    : noscriptIssueCount === 0
                                      ? 'NoScript ok'
                                      : `NoScript ${noscriptIssueCount} issue${noscriptIssueCount === 1 ? '' : 's'}`}
                              </span>
                            ) : null}
                            {screenshotReport ? (
                              <span
                                className={`rounded-full border px-3 py-1 text-[11px] font-semibold shadow-sm ${
                                  !screenshotReport.applicable
                                    ? 'border-slate-200 bg-white text-slate-500'
                                    : screenshotChanged
                                      ? 'border-amber-200 bg-amber-50 text-amber-800'
                                      : screenshotHasBaseline
                                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                        : 'border-slate-200 bg-white text-slate-600'
                                }`}
                              >
                                {!screenshotReport.applicable
                                  ? 'Visual n/a'
                                  : screenshotChanged
                                    ? 'Visual change'
                                    : screenshotHasBaseline
                                      ? 'Visual stable'
                                      : 'Visual baseline'}
                              </span>
                            ) : null}
                            {performanceReport ? (
                              <span
                                className={`rounded-full border px-3 py-1 text-[11px] font-semibold shadow-sm ${
                                  !performanceReport.applicable
                                    ? 'border-slate-200 bg-white text-slate-500'
                                    : performanceIssueCount === 0
                                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                      : 'border-amber-200 bg-amber-50 text-amber-800'
                                }`}
                              >
                                {!performanceReport.applicable
                                  ? 'Perf n/a'
                                  : performanceIssueCount === 0
                                    ? 'Perf ok'
                                    : `Perf ${performanceIssueCount} miss${performanceIssueCount === 1 ? '' : 'es'}`}
                              </span>
                            ) : null}
                            {networkReport ? (
                              <span
                                className={`rounded-full border px-3 py-1 text-[11px] font-semibold shadow-sm ${
                                  !networkReport.applicable
                                    ? 'border-slate-200 bg-white text-slate-500'
                                    : networkIssueCount === 0
                                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                      : 'border-amber-200 bg-amber-50 text-amber-800'
                                }`}
                              >
                                {!networkReport.applicable
                                  ? 'Waterfall n/a'
                                  : networkIssueCount === 0
                                    ? `Waterfall ${networkReport.request_count ?? 0} req`
                                    : `Waterfall ${networkIssueCount} issue${networkIssueCount === 1 ? '' : 's'}`}
                              </span>
                            ) : null}
                            {customPerformanceBudgets ? (
                              <span className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-[11px] font-semibold text-violet-700 shadow-sm">
                                Custom perf budgets
                              </span>
                            ) : null}
                            {website.tags.map((tag) => (
                              <span key={tag} className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-[11px] font-semibold text-sky-700 shadow-sm">#{tag}</span>
                            ))}
                          </div>

                          {networkReport ? (
                            <div className="mt-3 rounded-[18px] border border-slate-200 bg-white px-3 py-3 shadow-sm">
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Waterfall summary</div>
                                  {!networkReport.applicable ? (
                                    <div className="mt-1 text-sm text-slate-600">{networkReport.issues[0] ?? 'Waterfall data is unavailable for this response.'}</div>
                                  ) : (
                                    <>
                                      <div className="mt-1 text-sm font-semibold text-slate-900">
                                        {networkReport.request_count ?? 0} requests, {networkReport.failed_count ?? 0} failed, {networkReport.third_party_count ?? 0} third-party
                                      </div>
                                      <div className="mt-1 text-xs text-slate-500">
                                        {slowestNetworkRequest
                                          ? `Slowest ${formatNetworkRequestLabel(slowestNetworkRequest.url)} • ${formatRequestDuration(slowestNetworkRequest.duration_ms)} • ${formatTransferSize(slowestNetworkRequest.transfer_size_kb)}`
                                          : 'Waiting for captured request timings.'}
                                      </div>
                                    </>
                                  )}
                                </div>
                                <span
                                  className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${
                                    !networkReport.applicable
                                      ? 'bg-slate-200 text-slate-600'
                                      : networkIssueCount === 0
                                        ? 'bg-emerald-100 text-emerald-700'
                                        : 'bg-amber-100 text-amber-800'
                                  }`}
                                >
                                  {!networkReport.applicable ? 'Not applicable' : networkIssueCount === 0 ? 'Stable' : `${networkIssueCount} issue${networkIssueCount === 1 ? '' : 's'}`}
                                </span>
                              </div>
                            </div>
                          ) : null}
                          </div>
                          <div className="w-full 2xl:max-w-[420px]">
                            <div className="flex items-start justify-end">
                              <div className="relative" data-more-menu-root="true">
                                <button
                                  type="button"
                                  aria-expanded={activeMenuWebsiteId === website.id}
                                  aria-haspopup="menu"
                                  onClick={() =>
                                    setActiveMenuWebsiteId((current) => (current === website.id ? null : website.id))
                                  }
                                  className="flex items-center rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:text-slate-950"
                                >
                                  More
                                </button>
                                {activeMenuWebsiteId === website.id ? (
                                  <div className="absolute right-0 z-20 mt-2 w-56 rounded-[22px] border border-slate-200 bg-white p-2 shadow-[0_24px_60px_-34px_rgba(15,23,42,0.22)]">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setActiveMenuWebsiteId(null)
                                        window.location.assign(`/settings?monitor=${website.id}#monitor-editor`)
                                      }}
                                      className="flex w-full items-center justify-between rounded-2xl bg-transparent px-3 py-2 text-left text-sm font-semibold text-slate-700 transition hover:text-slate-950"
                                    >
                                      <span>Edit monitor</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void handleCheck(website.id)}
                                      disabled={checkingWebsiteId === website.id}
                                      className="flex w-full items-center justify-between rounded-2xl bg-transparent px-3 py-2 text-left text-sm font-semibold text-sky-700 transition hover:text-sky-800 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                      <span>{checkingWebsiteId === website.id ? 'Queueing check...' : 'Run manual check'}</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void handleTogglePause(website)}
                                      disabled={togglingWebsiteId === website.id}
                                      className={`flex w-full items-center justify-between rounded-2xl bg-transparent px-3 py-2 text-left text-sm font-semibold transition hover:bg-transparent disabled:cursor-not-allowed disabled:opacity-60 ${
                                        website.is_paused
                                          ? 'text-emerald-700 hover:text-emerald-800'
                                          : 'text-amber-700 hover:text-amber-800'
                                      }`}
                                    >
                                      <span>{togglingWebsiteId === website.id ? 'Updating state...' : website.is_paused ? 'Resume automatic checks' : 'Pause automatic checks'}</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setActiveMenuWebsiteId(null)
                                        void handleDuplicate(website)
                                      }}
                                      disabled={duplicatingWebsiteId === website.id}
                                      className="flex w-full items-center justify-between rounded-2xl bg-transparent px-3 py-2 text-left text-sm font-semibold text-violet-700 transition hover:text-violet-800 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                      <span>{duplicatingWebsiteId === website.id ? 'Duplicating...' : 'Duplicate monitor'}</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void handleDelete(website.id)}
                                      className="flex w-full items-center justify-between rounded-2xl bg-transparent px-3 py-2 text-left text-sm font-semibold text-rose-700 transition hover:text-rose-800"
                                    >
                                      <span>Delete monitor</span>
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            </div>

                            <div className="mt-3 grid gap-3 sm:grid-cols-2">
                              <div className="min-w-0 overflow-hidden rounded-[22px] border border-slate-200 bg-white px-4 py-4 shadow-sm">
                                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">State</div>
                                <div className="mt-2">
                                  <StatusBadge statusCode={website.last_status_code} />
                                </div>
                                <div className="mt-2 text-xs text-slate-500">{website.is_paused ? 'Automatic checks paused' : 'Automatic checks running'}</div>
                              </div>

                              <div className="min-w-0 overflow-hidden rounded-[22px] border border-slate-200 bg-white px-4 py-4 shadow-sm">
                                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Coverage</div>
                                <div className="mt-2 break-words text-sm font-semibold text-slate-900">{coverageLabel}</div>
                                <div className="mt-2 break-words text-xs text-slate-500">{website.has_basic_auth ? 'Private route / ' : 'Public route / '}{formatSslStatus(website.last_ssl_days_left)}</div>
                              </div>

                              <div className="min-w-0 overflow-hidden rounded-[22px] border border-slate-200 bg-white px-4 py-4 shadow-sm">
                                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Response</div>
                                <div className="mt-2 text-sm font-semibold text-slate-900">{formatResponseTime(website.last_response_time)}</div>
                                <div className="mt-2 text-xs text-slate-500">TTFB {formatTtfb(latestCheck?.ttfb ?? null)}</div>
                              </div>

                              <div className="min-w-0 overflow-hidden rounded-[22px] border border-slate-200 bg-white px-4 py-4 shadow-sm">
                                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Last activity</div>
                                <div className="mt-2 text-sm font-semibold text-slate-900">{formatLastCheckCompact(website.last_checked_at)}</div>
                                <div className="mt-2 text-xs text-slate-500">Cadence every {website.check_interval} minute{website.check_interval === 1 ? '' : 's'}</div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="border-t border-slate-200 bg-white px-4 py-4 sm:px-5">
                        <div className="mt-4 grid gap-4 xl:grid-cols-12 2xl:gap-5">
                          <div className="space-y-4 xl:col-span-4 2xl:col-span-3">
                            <div className="rounded-full bg-slate-900 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white w-fit">Monitor context</div>
                            <div className="rounded-[22px] border border-slate-200 bg-slate-50/80 px-4 py-4">
                              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Request profile</div>
                              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white px-3 py-3">
                                  <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">TTFB</div>
                                  <div className="mt-1 text-sm font-semibold text-slate-900">{formatTtfb(latestCheck?.ttfb ?? null)}</div>
                                </div>
                                <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white px-3 py-3">
                                  <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Full response</div>
                                  <div className="mt-1 text-sm font-semibold text-slate-900">{formatResponseTime(website.last_response_time)}</div>
                                </div>
                                <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white px-3 py-3">
                                  <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Access</div>
                                  <div className="mt-1 break-all text-sm leading-6 text-slate-600">{website.has_basic_auth ? `Basic Auth as ${website.basic_auth_username}` : 'Public endpoint'}</div>
                                </div>
                                <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white px-3 py-3">
                                  <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">NoScript</div>
                                  <div className="mt-1 break-words text-sm leading-6 text-slate-600">
                                    {website.check_noscript
                                      ? noscriptReport
                                        ? !noscriptReport.applicable
                                          ? 'Not applicable on the latest response'
                                          : noscriptIssueCount === 0
                                            ? 'Fallback HTML still looks usable'
                                            : 'Fallback HTML needs attention'
                                        : 'Enabled, waiting for the next check'
                                      : 'Disabled'}
                                  </div>
                                </div>
                                <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white px-3 py-3">
                                  <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Perf profile</div>
                                  <div className="mt-1 break-words text-sm leading-6 text-slate-600">{customPerformanceBudgets ? 'Custom thresholds active' : 'Platform defaults active'}</div>
                                </div>
                              </div>
                            </div>

                            {website.keyword ? (
                              <div className="rounded-[22px] border border-slate-200 bg-slate-50/80 px-4 py-4">
                                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Rendered page checks</div>
                                <div className="mt-3 flex flex-wrap gap-2">
                                  {renderedKeywordPhrases.length > 0 ? (
                                    renderedKeywordPhrases.map((phrase) => (
                                      <span key={phrase} className="max-w-full rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium leading-5 text-slate-600 break-all">
                                        {phrase}
                                      </span>
                                    ))
                                  ) : (
                                    <div className="break-words text-sm leading-6 text-slate-600">{website.keyword}</div>
                                  )}
                                </div>
                              </div>
                            ) : null}

                            {activeRenderedChangeByWebsite[website.id] ? (
                              <div className="rounded-[22px] border border-amber-200 bg-amber-50 px-4 py-4 text-sm leading-6 text-amber-900">
                                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-700">Regression context</div>
                                <div className="mt-2">{formatAlertMessage(activeRenderedChangeByWebsite[website.id], website.name)}</div>
                              </div>
                            ) : null}

                            {trendValues.length > 1 ? (
                              <div className="rounded-[22px] border border-slate-200 bg-slate-50/80 px-4 py-4">
                                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Recent trend</div>
                                <SparklineChart
                                  values={trendValues}
                                  tone={isHealthyStatus(website.last_status_code) ? 'emerald' : 'amber'}
                                  className="mt-3 h-16 w-full"
                                  height={48}
                                  label={`${website.name} trend`}
                                />
                                <p className="mt-2 text-[11px] leading-5 text-slate-500">
                                  How to read: this is the short history for this monitor only. Higher points indicate slower responses; amber tone signals recent unhealthy states.
                                </p>
                              </div>
                            ) : null}

                            {!website.keyword && !activeRenderedChangeByWebsite[website.id] && trendValues.length <= 1 ? (
                              <div className="rounded-[22px] border border-slate-200 bg-slate-50/80 px-4 py-4 text-sm text-slate-500">
                                No extra detail yet. As this monitor collects more checks, this panel will show context for regressions and trend movement.
                              </div>
                            ) : null}
                          </div>

                          <div className="space-y-4 xl:col-span-8 2xl:col-span-5">
                            <div className="rounded-full bg-sky-600 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white w-fit">Content & headers</div>
                            {seoReport ? (
                              <div className="rounded-[22px] border border-slate-200 bg-slate-50/80 px-4 py-4">
                                <div className="flex items-center justify-between gap-3">
                                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">SEO checker</div>
                                  <div
                                    className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${
                                      !seoReport.applicable
                                        ? 'bg-slate-200 text-slate-600'
                                        : seoIssueCount === 0
                                          ? 'bg-emerald-100 text-emerald-700'
                                          : 'bg-amber-100 text-amber-800'
                                    }`}
                                  >
                                    {!seoReport.applicable ? 'Not applicable' : seoIssueCount === 0 ? 'No issues' : `${seoIssueCount} issue${seoIssueCount === 1 ? '' : 's'}`}
                                  </div>
                                </div>

                                {!seoReport.applicable ? (
                                  <div className="mt-3 text-sm leading-6 text-slate-500">{seoReport.issues[0] ?? 'SEO checks are unavailable for this response.'}</div>
                                ) : (
                                  <>
                                    <div className="mt-3 grid gap-3 xl:grid-cols-12">
                                      <div className="min-w-0 rounded-2xl border border-slate-200 bg-white px-3 py-3 xl:col-span-5">
                                        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Title</div>
                                        <div className={`mt-1 break-words text-sm font-semibold ${getAuditValueClass(seoReport.title, 'text-slate-900', 'text-amber-700')}`}>{seoReport.title ?? 'Missing'}</div>
                                        <div className={`mt-1 text-xs font-medium ${titleLengthStatus.className}`}>{titleLengthStatus.label}</div>
                                      </div>
                                      <div className="min-w-0 rounded-2xl border border-slate-200 bg-white px-3 py-3 xl:col-span-7">
                                        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Meta description</div>
                                        <div className={`mt-1 break-words text-sm leading-6 ${getAuditValueClass(seoReport.meta_description, 'text-slate-600')}`}>{seoReport.meta_description ?? 'Missing'}</div>
                                        <div className={`mt-1 text-xs font-medium ${metaDescriptionLengthStatus.className}`}>{metaDescriptionLengthStatus.label}</div>
                                      </div>
                                      <div className="min-w-0 rounded-2xl border border-slate-200 bg-white px-3 py-3 xl:col-span-7">
                                        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Canonical</div>
                                        <div className={`mt-1 break-all text-xs leading-5 ${getAuditValueClass(seoReport.canonical, 'text-slate-600')}`}>{seoReport.canonical ?? 'Missing'}</div>
                                      </div>
                                      <div className="min-w-0 rounded-2xl border border-slate-200 bg-white px-3 py-3 xl:col-span-5">
                                        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Robots + H1</div>
                                        <div className="mt-1 text-sm text-slate-600">
                                          {seoReport.robots ?? 'Indexable by default'}
                                          <div className="mt-1 text-xs text-slate-500">{seoReport.h1_count ?? 0} H1 heading{seoReport.h1_count === 1 ? '' : 's'}</div>
                                          {noindexDetected ? <div className="mt-1 text-xs font-semibold text-amber-700">Search engines are currently told not to index this page.</div> : null}
                                        </div>
                                      </div>
                                    </div>

                                    <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-3">
                                      <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white px-3 py-3">
                                        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Canonical tags</div>
                                        <div className="mt-1 text-sm font-semibold text-slate-900">{seoReport.canonical_count ?? 0}</div>
                                        <div className="mt-1 text-xs text-slate-500">Detected canonical link tag count</div>
                                      </div>
                                      <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white px-3 py-3">
                                        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Viewport</div>
                                        <div className={`mt-1 break-words text-sm leading-6 ${getAuditValueClass(seoReport.viewport, 'text-slate-600')}`}>{seoReport.viewport ?? 'Missing'}</div>
                                        {seoReport.viewport ? (
                                          <div className={`mt-1 text-xs font-medium ${viewportLooksResponsive ? 'text-emerald-700' : 'text-amber-700'}`}>
                                            {viewportLooksResponsive ? 'Responsive viewport looks correct' : 'Responsive viewport should include width=device-width and initial-scale'}
                                          </div>
                                        ) : null}
                                      </div>
                                      <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white px-3 py-3">
                                        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Charset + lang</div>
                                        <div className={`mt-1 break-words text-sm leading-6 ${getAuditValueClass(seoReport.charset, 'text-slate-600')}`}>{seoReport.charset ?? 'Missing'}</div>
                                        <div className="mt-1 text-xs text-slate-500">lang: <span className={getAuditValueClass(seoReport.lang, 'text-slate-500', 'font-semibold text-amber-700')}>{seoReport.lang ?? 'Missing'}</span></div>
                                        {seoReport.charset ? (
                                          <div className={`mt-1 text-xs font-medium ${charsetIsUtf8 ? 'text-emerald-700' : 'text-amber-700'}`}>
                                            {charsetIsUtf8 ? 'UTF-8 encoding is in place' : 'Non-UTF-8 encoding detected'}
                                          </div>
                                        ) : null}
                                      </div>
                                      <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white px-3 py-3">
                                        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Image alt coverage</div>
                                        <div className="mt-1 text-sm font-semibold text-slate-900">{imageAltCoverageLabel}</div>
                                        <div className="mt-1 text-xs text-slate-500">{imageAltCoverageDetail}</div>
                                      </div>
                                      <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white px-3 py-3">
                                        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Twitter card</div>
                                        <div className={`mt-1 text-sm font-semibold ${seoReport.has_twitter_card ? 'text-emerald-700' : 'text-amber-700'}`}>
                                          {seoReport.has_twitter_card ? seoReport.twitter_card ?? 'Present' : 'Missing'}
                                        </div>
                                        <div className={`mt-1 text-xs ${seoReport.has_twitter_card ? 'text-slate-500' : 'font-semibold text-amber-700'}`}>{twitterCoverageDetail}</div>
                                      </div>
                                      <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white px-3 py-3">
                                        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Structured data</div>
                                        <div className={`mt-1 text-sm font-semibold ${seoReport.has_structured_data ? 'text-emerald-700' : 'text-amber-700'}`}>
                                          {seoReport.has_structured_data ? 'JSON-LD found' : 'Missing'}
                                        </div>
                                      </div>
                                      <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white px-3 py-3 sm:col-span-2 xl:col-span-2 2xl:col-span-3">
                                        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Open Graph image</div>
                                        <div className={`mt-1 break-all text-xs leading-5 ${getAuditValueClass(seoReport.og_image, 'text-slate-600')}`}>{seoReport.og_image ?? 'Missing'}</div>
                                      </div>
                                    </div>

                                    <div className="mt-3 grid gap-3 xl:grid-cols-12">
                                      <div className="min-w-0 rounded-2xl border border-slate-200 bg-white px-3 py-3 xl:col-span-5">
                                        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Open Graph title</div>
                                        <div className={`mt-1 break-words text-sm leading-6 ${getAuditValueClass(seoReport.og_title, 'text-slate-600')}`}>{seoReport.og_title ?? 'Missing'}</div>
                                      </div>
                                      <div className="min-w-0 rounded-2xl border border-slate-200 bg-white px-3 py-3 xl:col-span-7">
                                        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Open Graph description</div>
                                        <div className={`mt-1 break-words text-sm leading-6 ${getAuditValueClass(seoReport.og_description, 'text-slate-600')}`}>{seoReport.og_description ?? 'Missing'}</div>
                                      </div>
                                    </div>

                                    {seoReport.h1 && seoReport.h1.length > 0 ? (
                                      <div className="mt-3 rounded-2xl border border-slate-200 bg-white px-3 py-3">
                                        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Detected H1 text</div>
                                        <div className="mt-2 flex flex-wrap gap-2">
                                          {seoReport.h1.map((value) => (
                                            <span key={value} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                                              {value}
                                            </span>
                                          ))}
                                        </div>
                                      </div>
                                    ) : null}

                                    {seoIssueCount === 0 ? (
                                      <div className="mt-3 flex flex-wrap gap-2">
                                        <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">No immediate SEO issues detected</span>
                                      </div>
                                    ) : seoVisibleIssues.length > 0 ? (
                                      <div className="mt-3 flex flex-wrap gap-2">
                                        {seoVisibleIssues.map((issue) => (
                                          <span key={issue} className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
                                            {issue}
                                          </span>
                                        ))}
                                      </div>
                                    ) : null}
                                  </>
                                )}
                              </div>
                            ) : null}

                            {showTlsPanel ? (
                              <div className="rounded-[22px] border border-slate-200 bg-slate-50/80 px-4 py-4">
                                <div className="flex items-center justify-between gap-3">
                                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">TLS identity</div>
                                  <div className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${tlsStatusMeta.className}`}>
                                    {tlsStatusMeta.label}
                                  </div>
                                </div>

                                {!tlsReport ? (
                                  <div className="mt-3 text-sm leading-6 text-slate-500">
                                    TLS certificate details will appear after the first HTTPS check finishes.
                                  </div>
                                ) : tlsReport.valid === false ? (
                                  <>
                                    <p className="mt-1.5 text-[11px] leading-5 text-slate-400">
                                      The monitor could not validate a trusted TLS certificate for <span className="font-medium text-slate-500">{tlsReport.hostname ?? website.url}</span>.
                                    </p>

                                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                      <div className="rounded-2xl border border-slate-200 bg-white px-3 py-3">
                                        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Observed host</div>
                                        <div className="mt-1 break-all text-xs leading-5 text-slate-600">{tlsReport.hostname ?? 'Unavailable'}</div>
                                      </div>
                                      <div className="rounded-2xl border border-slate-200 bg-white px-3 py-3">
                                        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Latest SSL status</div>
                                        <div className="mt-1 text-sm font-semibold text-rose-700">{formatSslStatus(latestCheck?.ssl_days_left ?? null)}</div>
                                      </div>
                                    </div>

                                    <div className="mt-3 flex flex-wrap gap-2">
                                      {(tlsReport.issues ?? []).map((issue) => (
                                        <span key={issue} className="rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold text-rose-700">
                                          {issue}
                                        </span>
                                      ))}
                                    </div>
                                  </>
                                ) : (
                                  <>
                                    <p className="mt-1.5 text-[11px] leading-5 text-slate-400">
                                      Certificate data read from the final HTTPS endpoint at <span className="font-medium text-slate-500">{tlsReport.hostname ?? website.url}</span>.
                                    </p>

                                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                      <div className="rounded-2xl border border-slate-200 bg-white px-3 py-3">
                                        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Issuer</div>
                                        <div className="mt-1 break-all text-xs leading-5 text-slate-600">{tlsReport.issuer ?? 'Unavailable'}</div>
                                      </div>
                                      <div className="rounded-2xl border border-slate-200 bg-white px-3 py-3">
                                        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Observed host</div>
                                        <div className="mt-1 break-all text-xs leading-5 text-slate-600">{tlsReport.hostname ?? 'Unavailable'}</div>
                                      </div>
                                      <div className="rounded-2xl border border-slate-200 bg-white px-3 py-3 sm:col-span-2">
                                        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Subject</div>
                                        <div className="mt-1 break-all text-xs leading-5 text-slate-600">{tlsReport.subject ?? 'Unavailable'}</div>
                                      </div>
                                      <div className="rounded-2xl border border-slate-200 bg-white px-3 py-3">
                                        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Valid from</div>
                                        <div className="mt-1 text-xs leading-5 text-slate-600">{formatAuditDateTime(tlsReport.not_before)}</div>
                                      </div>
                                      <div className="rounded-2xl border border-slate-200 bg-white px-3 py-3">
                                        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Valid until</div>
                                        <div className="mt-1 text-xs leading-5 text-slate-600">{formatAuditDateTime(tlsReport.not_after)}</div>
                                        <div className="mt-1 text-[11px] font-medium text-slate-400">{formatSslStatus(tlsReport.days_left ?? latestCheck?.ssl_days_left ?? null)} remaining</div>
                                      </div>
                                    </div>

                                    <div className="mt-3 rounded-2xl border border-slate-200 bg-white px-3 py-3">
                                      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Subject alternative names</div>
                                      {tlsVisibleSanValues.length > 0 ? (
                                        <>
                                          <div className="mt-2 flex flex-wrap gap-2">
                                            {tlsVisibleSanValues.map((value) => (
                                              <span key={value} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                                                {value}
                                              </span>
                                            ))}
                                          </div>
                                          {tlsHiddenSanCount > 0 ? <div className="mt-2 text-[11px] text-slate-400">+{tlsHiddenSanCount} more SAN entries on the certificate</div> : null}
                                        </>
                                      ) : (
                                        <div className="mt-2 text-xs text-slate-500">No subject alternative names were exposed by this certificate.</div>
                                      )}
                                    </div>

                                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                      <div className="rounded-2xl border border-slate-200 bg-white px-3 py-3">
                                        <div className="flex items-center justify-between gap-2">
                                          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Certificate SHA-256</div>
                                          <button
                                            type="button"
                                            onClick={() => void copyText(formattedCertificateFingerprint, 'Certificate fingerprint copied.')}
                                            disabled={!tlsReport.certificate_sha256}
                                            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
                                          >
                                            Copy
                                          </button>
                                        </div>
                                        <div className="mt-1 break-all font-mono text-[11px] leading-5 text-slate-600">{formattedCertificateFingerprint}</div>
                                      </div>
                                      <div className="rounded-2xl border border-slate-200 bg-white px-3 py-3">
                                        <div className="flex items-center justify-between gap-2">
                                          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Public key pin (SPKI SHA-256)</div>
                                          <button
                                            type="button"
                                            onClick={() => void copyText(publicKeyPinValue, 'Public key pin copied.')}
                                            disabled={!tlsReport.public_key_pin_sha256}
                                            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
                                          >
                                            Copy
                                          </button>
                                        </div>
                                        <div className="mt-1 break-all font-mono text-[11px] leading-5 text-slate-600">{publicKeyPinValue}</div>
                                      </div>
                                    </div>

                                    <div className="mt-3 flex flex-wrap gap-2">
                                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${tlsReport.baseline_available ? 'bg-slate-100 text-slate-700' : 'bg-sky-100 text-sky-700'}`}>
                                        {tlsReport.baseline_available ? 'Baseline available' : 'First trusted baseline'}
                                      </span>
                                      {tlsReport.changed_certificate ? (
                                        <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">Certificate fingerprint changed</span>
                                      ) : (
                                        <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">Certificate fingerprint stable</span>
                                      )}
                                      {tlsReport.changed_public_key ? (
                                        <span className="rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold text-rose-700">Public key changed</span>
                                      ) : (
                                        <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">Public key matches baseline</span>
                                      )}
                                      {tlsReport.serial_number ? <span className="rounded-full bg-slate-100 px-3 py-1 font-mono text-xs font-semibold text-slate-700">Serial {tlsReport.serial_number}</span> : null}
                                    </div>

                                    {(tlsReport.issues ?? []).length > 0 ? (
                                      <div className="mt-3 flex flex-wrap gap-2">
                                        {(tlsReport.issues ?? []).map((issue) => (
                                          <span key={issue} className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
                                            {issue}
                                          </span>
                                        ))}
                                      </div>
                                    ) : null}
                                  </>
                                )}
                              </div>
                            ) : null}

                            {headerReport ? (
                              <div className="rounded-[22px] border border-slate-200 bg-slate-50/80 px-4 py-4">
                                <div className="flex items-center justify-between gap-3">
                                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Header checker</div>
                                  <div
                                    className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${
                                      headerIssueCount === 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'
                                    }`}
                                  >
                                    {headerIssueCount === 0 ? 'No gaps' : `${headerIssueCount} gap${headerIssueCount === 1 ? '' : 's'}`}
                                  </div>
                                </div>

                                <p className="mt-1.5 text-[11px] leading-5 text-slate-400">
                                  Values read from <span className="font-medium text-slate-500">{website.url}</span> HTTP response headers.
                                </p>

                                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                  {headerReportOrder.map((headerName) => (
                                    <div key={headerName} className="min-w-0 rounded-2xl border border-slate-200 bg-white px-3 py-2.5">
                                      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">{formatHeaderName(headerName)}</div>
                                      <div className="mt-1 break-all text-xs leading-5 text-slate-600">{headerReport.values?.[headerName] ?? 'Not set'}</div>
                                    </div>
                                  ))}
                                </div>

                                <div className="mt-3 flex flex-wrap gap-2">
                                  {headerIssueCount === 0 ? (
                                    <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">Core response headers look good</span>
                                  ) : (
                                    headerReport.issues.map((issue) => (
                                      <span key={issue} className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
                                        {issue}
                                      </span>
                                    ))
                                  )}
                                </div>

                                {headerIssueCount > 0 && (
                                  <details className="mt-3 rounded-2xl border border-amber-200 bg-amber-50/60">
                                    <summary className="cursor-pointer select-none px-4 py-3 text-xs font-semibold text-amber-800 marker:content-['']">
                                      <span className="flex items-center justify-between gap-2">
                                        <span>How to add these headers to your server</span>
                                        <span className="text-amber-500">▾</span>
                                      </span>
                                    </summary>
                                    <div className="space-y-4 px-4 pb-4 pt-1 text-xs text-slate-600">
                                      <p className="leading-5 text-slate-500">
                                        Add the directives below to your web server config and redeploy. The monitor will pick up the new values on the next check.
                                      </p>

                                      <div>
                                        <div className="mb-1.5 font-semibold uppercase tracking-[0.14em] text-slate-400">nginx</div>
                                        <pre className="overflow-x-auto rounded-xl bg-slate-900 p-3 text-[11px] leading-5 text-slate-200">{`server {
    # inside your server {} block
    add_header Strict-Transport-Security  "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options     "nosniff" always;
    add_header X-Frame-Options            "SAMEORIGIN" always;
    add_header Referrer-Policy            "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy         "camera=(), microphone=(), geolocation=()" always;
    add_header Content-Security-Policy    "default-src 'self'" always;
    add_header X-Robots-Tag               "index, follow" always;
    add_header Cache-Control              "no-cache" always;
    add_header Server-Timing              "nginx" always;
}`}</pre>
                                      </div>

                                      <div>
                                        <div className="mb-1.5 font-semibold uppercase tracking-[0.14em] text-slate-400">Apache (.htaccess)</div>
                                        <pre className="overflow-x-auto rounded-xl bg-slate-900 p-3 text-[11px] leading-5 text-slate-200">{`<IfModule mod_headers.c>
    Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains"
    Header always set X-Content-Type-Options "nosniff"
    Header always set X-Frame-Options "SAMEORIGIN"
    Header always set Referrer-Policy "strict-origin-when-cross-origin"
    Header always set Permissions-Policy "camera=(), microphone=(), geolocation=()"
    Header always set Content-Security-Policy "default-src 'self'"
    Header always set X-Robots-Tag "index, follow"
    Header always set Cache-Control "no-cache"
    Header always set Server-Timing "apache"
</IfModule>`}</pre>
                                      </div>

                                      <div>
                                        <div className="mb-1.5 font-semibold uppercase tracking-[0.14em] text-slate-400">Cloudflare Worker / Transform Rule</div>
                                        <pre className="overflow-x-auto rounded-xl bg-slate-900 p-3 text-[11px] leading-5 text-slate-200">{`// Cloudflare Worker – add to your fetch handler
response.headers.set('X-Content-Type-Options', 'nosniff');
response.headers.set('X-Frame-Options', 'SAMEORIGIN');
response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
response.headers.set('Content-Security-Policy', "default-src 'self'");
response.headers.set('X-Robots-Tag', 'index, follow');
// Or use Cloudflare → Rules → Transform Rules → Modify Response Headers`}</pre>
                                      </div>

                                      <p className="leading-5 text-slate-400">
                                        <strong className="text-slate-500">Note on CSP:</strong> Adjust <code className="rounded bg-slate-200 px-1 py-0.5 text-slate-700">Content-Security-Policy</code> to match your actual asset sources before deploying — an overly strict policy can break your site.
                                      </p>
                                    </div>
                                  </details>
                                )}
                              </div>
                            ) : null}

                            {website.check_noscript || noscriptReport ? (
                              <div className="rounded-[22px] border border-slate-200 bg-slate-50/80 px-4 py-4">
                                <div className="flex items-center justify-between gap-3">
                                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">NoScript check</div>
                                  <div
                                    className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${
                                      !noscriptReport
                                        ? 'bg-slate-200 text-slate-600'
                                        : !noscriptReport.applicable
                                          ? 'bg-slate-200 text-slate-600'
                                          : noscriptIssueCount === 0
                                            ? 'bg-emerald-100 text-emerald-700'
                                            : 'bg-amber-100 text-amber-800'
                                    }`}
                                  >
                                    {!noscriptReport
                                      ? 'Pending'
                                      : !noscriptReport.applicable
                                        ? 'Not applicable'
                                        : noscriptIssueCount === 0
                                          ? 'No issues'
                                          : `${noscriptIssueCount} issue${noscriptIssueCount === 1 ? '' : 's'}`}
                                  </div>
                                </div>

                                {!noscriptReport ? (
                                  <div className="mt-3 text-sm leading-6 text-slate-500">This result will appear after the next check finishes.</div>
                                ) : !noscriptReport.applicable ? (
                                  <div className="mt-3 text-sm leading-6 text-slate-500">{noscriptReport.issues[0] ?? 'NoScript checks are unavailable for this response.'}</div>
                                ) : (
                                  <>
                                    <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-2">
                                      <div className="rounded-2xl border border-slate-200 bg-white px-3 py-3">
                                        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Document title</div>
                                        <div className={`mt-1 text-sm font-semibold ${getAuditValueClass(noscriptReport.title, 'text-slate-900', 'text-amber-700')}`}>{noscriptReport.title ?? 'Missing'}</div>
                                      </div>
                                      <div className="rounded-2xl border border-slate-200 bg-white px-3 py-3">
                                        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Visible text</div>
                                        <div className="mt-1 text-sm text-slate-600">{noscriptReport.body_text_length ?? 0} characters</div>
                                      </div>
                                      <div className="rounded-2xl border border-slate-200 bg-white px-3 py-3">
                                        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">H1 tags</div>
                                        <div className="mt-1 text-sm text-slate-600">{noscriptReport.h1?.length ?? 0} found</div>
                                      </div>
                                      <div className="rounded-2xl border border-slate-200 bg-white px-3 py-3">
                                        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Keyword coverage</div>
                                        <div className="mt-1 text-sm text-slate-600">
                                          {noscriptReport.keyword_ok === null
                                            ? 'No required phrases configured'
                                            : noscriptReport.keyword_ok
                                              ? 'Required phrases still visible'
                                              : 'Required phrases missing'}
                                        </div>
                                      </div>
                                    </div>

                                    {noscriptReport.h1 && noscriptReport.h1.length > 0 ? (
                                      <div className="mt-3 rounded-2xl border border-slate-200 bg-white px-3 py-3">
                                        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Visible H1 text</div>
                                        <div className="mt-2 flex flex-wrap gap-2">
                                          {noscriptReport.h1.map((value) => (
                                            <span key={value} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                                              {value}
                                            </span>
                                          ))}
                                        </div>
                                      </div>
                                    ) : null}

                                    {noscriptReport.missing_keywords && noscriptReport.missing_keywords.length > 0 ? (
                                      <div className="mt-3 rounded-2xl border border-slate-200 bg-white px-3 py-3">
                                        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Missing phrases</div>
                                        <div className="mt-2 flex flex-wrap gap-2">
                                          {noscriptReport.missing_keywords.map((value) => (
                                            <span key={value} className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
                                              {value}
                                            </span>
                                          ))}
                                        </div>
                                      </div>
                                    ) : null}

                                    <div className="mt-3 flex flex-wrap gap-2">
                                      {noscriptIssueCount === 0 ? (
                                        <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">Base HTML still exposes usable content</span>
                                      ) : (
                                        noscriptReport.issues.map((issue) => (
                                          <span key={issue} className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
                                            {issue}
                                          </span>
                                        ))
                                      )}
                                    </div>
                                  </>
                                )}
                              </div>
                            ) : null}

                            {!seoReport && !headerReport && !showTlsPanel && !website.check_noscript && !noscriptReport ? (
                              <div className="rounded-[22px] border border-slate-200 bg-slate-50/80 px-4 py-4 text-sm text-slate-500">
                                This monitor will surface content and header audits after the first rendered checks complete.
                              </div>
                            ) : null}
                          </div>

                          <div className="space-y-4 xl:col-span-12 2xl:col-span-4">
                            <div className="rounded-full bg-violet-600 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white w-fit">Visual, performance & network</div>

                            {screenshotReport || website.screenshot_current_preview ? (
                              <div className="rounded-[22px] border border-slate-200 bg-slate-50/80 px-4 py-4">
                                <div className="flex items-center justify-between gap-3">
                                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Screenshot compare</div>
                                  <div
                                    className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${
                                      !screenshotReport
                                        ? 'bg-slate-200 text-slate-600'
                                        : !screenshotReport.applicable
                                          ? 'bg-slate-200 text-slate-600'
                                          : screenshotChanged
                                            ? 'bg-amber-100 text-amber-800'
                                            : screenshotHasBaseline
                                              ? 'bg-emerald-100 text-emerald-700'
                                              : 'bg-slate-200 text-slate-600'
                                    }`}
                                  >
                                    {!screenshotReport
                                      ? 'Pending'
                                      : !screenshotReport.applicable
                                        ? 'Not applicable'
                                        : screenshotChanged
                                          ? 'Changed'
                                          : screenshotHasBaseline
                                            ? 'Stable'
                                            : 'Baseline only'}
                                  </div>
                                </div>

                                {!screenshotReport ? (
                                  <div className="mt-3 text-sm leading-6 text-slate-500">The first successful rendered check will capture a baseline screenshot here.</div>
                                ) : !screenshotReport.applicable ? (
                                  <div className="mt-3 text-sm leading-6 text-slate-500">{screenshotReport.issues[0] ?? 'Screenshot compare is unavailable for this response.'}</div>
                                ) : (
                                  <>
                                    <div className="mt-3 text-xs leading-6 text-slate-500">
                                      {website.screenshot_changed_at
                                        ? `Last visual change recorded ${formatLastCheckCompact(website.screenshot_changed_at)}.`
                                        : screenshotHasBaseline
                                          ? 'Current screenshot matches the latest stored baseline.'
                                          : 'The next successful check will start the screenshot baseline history.'}
                                    </div>

                                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                      <div className="rounded-2xl border border-slate-200 bg-white px-3 py-3">
                                        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Current capture</div>
                                        {website.screenshot_current_preview ? (
                                          <img
                                            src={website.screenshot_current_preview}
                                            alt={`${website.name} current screenshot`}
                                            loading="lazy"
                                            className="mt-3 aspect-[16/10] w-full rounded-[18px] border border-slate-200 object-cover"
                                          />
                                        ) : (
                                          <div className="mt-3 flex aspect-[16/10] items-center justify-center rounded-[18px] border border-dashed border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                                            Waiting for a rendered capture
                                          </div>
                                        )}
                                      </div>

                                      <div className="rounded-2xl border border-slate-200 bg-white px-3 py-3">
                                        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Previous baseline</div>
                                        {website.screenshot_previous_preview ? (
                                          <img
                                            src={website.screenshot_previous_preview}
                                            alt={`${website.name} previous screenshot baseline`}
                                            loading="lazy"
                                            className="mt-3 aspect-[16/10] w-full rounded-[18px] border border-slate-200 object-cover"
                                          />
                                        ) : (
                                          <div className="mt-3 flex aspect-[16/10] items-center justify-center rounded-[18px] border border-dashed border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                                            No older baseline yet
                                          </div>
                                        )}
                                      </div>
                                    </div>

                                    <div className="mt-3 flex flex-wrap gap-2">
                                      {!screenshotHasBaseline ? (
                                        <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-semibold text-slate-600">Collecting first visual baseline</span>
                                      ) : screenshotChanged ? (
                                        <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">Viewport screenshot differs from the previous stored baseline</span>
                                      ) : (
                                        <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">Viewport screenshot matches the last stored baseline</span>
                                      )}
                                      {screenshotIssueCount > 0
                                        ? screenshotReport.issues.map((issue) => (
                                            <span key={issue} className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
                                              {issue}
                                            </span>
                                          ))
                                        : null}
                                    </div>
                                  </>
                                )}
                              </div>
                            ) : null}

                            {performanceReport ? (
                              <div className="rounded-[22px] border border-slate-200 bg-slate-50/80 px-4 py-4">
                                <div className="flex items-center justify-between gap-3">
                                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Performance budgets</div>
                                  <div
                                    className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${
                                      !performanceReport.applicable
                                        ? 'bg-slate-200 text-slate-600'
                                        : performanceIssueCount === 0
                                          ? 'bg-emerald-100 text-emerald-700'
                                          : 'bg-amber-100 text-amber-800'
                                    }`}
                                  >
                                    {!performanceReport.applicable
                                      ? 'Not applicable'
                                      : performanceIssueCount === 0
                                        ? 'Within budget'
                                        : `${performanceIssueCount} miss${performanceIssueCount === 1 ? '' : 'es'}`}
                                  </div>
                                </div>

                                {!performanceReport.applicable ? (
                                  <div className="mt-3 text-sm leading-6 text-slate-500">{performanceReport.issues[0] ?? 'Performance budgets are unavailable for this response.'}</div>
                                ) : (
                                  <>
                                    <div className="mt-3 text-xs leading-6 text-slate-500">
                                      {performanceReport.passing_metrics ?? 0} of {performanceReport.evaluated_metrics ?? 0} tracked metrics are within this monitor's active performance budgets.
                                    </div>

                                    <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-2">
                                      {performanceMetricOrder.map((metric) => (
                                        <div key={metric.key} className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white px-3 py-3">
                                          <div className="space-y-1">
                                            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">{metric.label}</div>
                                            <div className="break-words text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                                              Budget {formatPerformanceMetricValue(metric.key, performanceReport.budgets?.[metric.key])}
                                            </div>
                                          </div>
                                          <div className="mt-2 text-sm font-semibold text-slate-900">
                                            {formatPerformanceMetricValue(metric.key, performanceReport.metrics?.[metric.key])}
                                          </div>
                                        </div>
                                      ))}
                                    </div>

                                    <div className="mt-3 flex flex-wrap gap-2">
                                      {performanceIssueCount === 0 ? (
                                        <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">Current render is within this monitor's performance budgets</span>
                                      ) : (
                                        performanceReport.issues.map((issue) => (
                                          <span key={issue} className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
                                            {issue}
                                          </span>
                                        ))
                                      )}
                                    </div>
                                  </>
                                )}
                              </div>
                            ) : null}

                            {networkReport ? (
                              <div className="rounded-[22px] border border-slate-200 bg-slate-50/80 px-4 py-4">
                                <div className="flex items-center justify-between gap-3">
                                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Waterfall capture</div>
                                  <div
                                    className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${
                                      !networkReport.applicable
                                        ? 'bg-slate-200 text-slate-600'
                                        : networkIssueCount === 0
                                          ? 'bg-emerald-100 text-emerald-700'
                                          : 'bg-amber-100 text-amber-800'
                                    }`}
                                  >
                                    {!networkReport.applicable ? 'Not applicable' : networkIssueCount === 0 ? 'Stable' : `${networkIssueCount} issue${networkIssueCount === 1 ? '' : 's'}`}
                                  </div>
                                </div>

                                {!networkReport.applicable ? (
                                  <div className="mt-3 text-sm leading-6 text-slate-500">{networkReport.issues[0] ?? 'Waterfall capture is unavailable for this response.'}</div>
                                ) : (
                                  <>
                                    <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-2">
                                      <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white px-3 py-3">
                                        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Requests</div>
                                        <div className="mt-1 text-sm font-semibold text-slate-900">{networkReport.request_count ?? 0}</div>
                                      </div>
                                      <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white px-3 py-3">
                                        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Failures</div>
                                        <div className="mt-1 break-words text-sm font-semibold text-slate-900">{networkReport.failed_count ?? 0} network / {networkReport.error_status_count ?? 0} HTTP</div>
                                      </div>
                                      <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white px-3 py-3">
                                        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Third-party</div>
                                        <div className="mt-1 text-sm font-semibold text-slate-900">{networkReport.third_party_count ?? 0} requests</div>
                                      </div>
                                      <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white px-3 py-3">
                                        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Transfer</div>
                                        <div className="mt-1 text-sm font-semibold text-slate-900">{formatTransferSize(networkReport.total_transfer_kb)}</div>
                                      </div>
                                    </div>

                                    {networkReport.slowest_requests && networkReport.slowest_requests.length > 0 ? (
                                      <div className="mt-3 space-y-2">
                                        {networkReport.slowest_requests.map((entry) => (
                                          <div key={`${entry.url}-${entry.resource_type ?? 'other'}-${entry.status ?? 'pending'}`} className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white px-3 py-3">
                                            <div className="flex items-start justify-between gap-3">
                                              <div className="min-w-0">
                                                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                                                  {entry.resource_type ?? 'other'}{entry.is_third_party ? ' / third-party' : ''}
                                                </div>
                                                <div className="mt-1 break-all text-sm font-semibold leading-6 text-slate-900">{formatNetworkRequestLabel(entry.url)}</div>
                                              </div>
                                              <div className="max-w-[42%] break-words text-right text-xs leading-5 text-slate-500">
                                                <div>{formatRequestDuration(entry.duration_ms)}</div>
                                                <div>{entry.failed ? entry.failure ?? 'Failed' : entry.status ?? 'No status'} • {formatTransferSize(entry.transfer_size_kb)}</div>
                                              </div>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    ) : null}

                                    <div className="mt-3 flex flex-wrap gap-2">
                                      {networkIssueCount === 0 ? (
                                        <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">Latest request waterfall looks stable</span>
                                      ) : (
                                        networkReport.issues.map((issue) => (
                                          <span key={issue} className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
                                            {issue}
                                          </span>
                                        ))
                                      )}
                                    </div>
                                  </>
                                )}
                              </div>
                            ) : null}

                            {!screenshotReport && !website.screenshot_current_preview && !performanceReport && !networkReport ? (
                              <div className="rounded-[22px] border border-slate-200 bg-slate-50/80 px-4 py-4 text-sm text-slate-500">
                                Visual baselines, budgets and waterfall evidence appear here after rendered checks finish collecting richer reports.
                              </div>
                            ) : null}

                          </div>
                        </div>
                      </div>
                    </article>
                  )
                })
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-[30px] border border-slate-200/80 bg-white/92 p-6 shadow-[0_24px_80px_-52px_rgba(15,23,42,0.18)]">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-slate-950">Active incident log</h2>
            <p className="mt-1 text-sm text-slate-500">Only open or review items remain visible here. Corrected issues disappear after the latest clean check.</p>
          </div>
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Latest 8 active alerts</div>
        </div>
        <div className="space-y-3">
          {activeAlerts.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4 text-sm text-slate-500">No active incidents right now.</div>
          ) : (
            activeAlerts.slice(0, 8).map((alert) => {
              const websiteName = websiteNameById[alert.website_id] ?? `Website #${alert.website_id}`
              const lifecycle = alertLifecycleById[alert.id] ?? 'review'
              const severity = getAlertSeverity(alert)

              return (
                <div key={alert.id} className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-4 transition hover:border-slate-300 hover:bg-white">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-semibold text-slate-950">{normalizeAlertType(alert.type)}</div>
                        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${getSeverityClasses(severity)}`}>
                          {getSeverityLabel(severity)}
                        </span>
                        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${getLifecycleClasses(lifecycle)}`}>
                          {getLifecycleLabel(lifecycle)}
                        </span>
                        <span className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">{websiteName}</span>
                      </div>
                      <div className="mt-1 text-sm text-slate-600">{formatAlertMessage(alert, websiteName)}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {lifecycle === 'open'
                            ? 'Latest data still shows this condition.'
                            : 'Latest change evidence still needs a human review.'}
                      </div>
                    </div>
                    <div className="text-xs text-slate-400">{new Date(alert.sent_at).toLocaleString()}</div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </section>
    </div>
  )
}