import type { PerformanceBudgets } from './types'

export const intervalOptions = [5, 15, 30]

export const defaultPerformanceBudgets: PerformanceBudgets = {
  ttfb_ms: 800,
  first_contentful_paint_ms: 1800,
  largest_contentful_paint_ms: 2500,
  cumulative_layout_shift: 0.1,
  total_blocking_time_ms: 200,
  dom_content_loaded_ms: 1500,
  transfer_size_kb: 512,
}

type PerformanceMetricDefinition = {
  key: keyof PerformanceBudgets
  label: string
  step: string
  min: string
  hint: string
}

export const performanceMetricOrder: PerformanceMetricDefinition[] = [
  { key: 'ttfb_ms', label: 'TTFB', step: '50', min: '1', hint: 'Server first byte threshold' },
  { key: 'first_contentful_paint_ms', label: 'FCP', step: '100', min: '1', hint: 'First paint threshold' },
  { key: 'largest_contentful_paint_ms', label: 'LCP', step: '100', min: '1', hint: 'Largest paint threshold' },
  { key: 'cumulative_layout_shift', label: 'CLS', step: '0.01', min: '0.01', hint: 'Layout shift threshold' },
  { key: 'total_blocking_time_ms', label: 'TBT', step: '25', min: '1', hint: 'Main-thread blocking threshold' },
  { key: 'dom_content_loaded_ms', label: 'DOMContentLoaded', step: '100', min: '1', hint: 'DOMContentLoaded threshold' },
  { key: 'transfer_size_kb', label: 'Transfer size', step: '16', min: '1', hint: 'Transferred page weight threshold' },
]

export type MonitorFormState = {
  name: string
  url: string
  check_interval: number
  keyword: string
  tags: string
  basic_auth_username: string
  basic_auth_password: string
  check_noscript: boolean
  performance_budgets: PerformanceBudgets
}

export function splitKeywordPhrases(value: string | null) {
  if (!value) {
    return []
  }

  return value
    .split(/[\n,]+/)
    .map((part) => part.trim())
    .filter(Boolean)
}

export function splitTagPhrases(value: string) {
  return value
    .split(/[\n,]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 8)
}

export function clonePerformanceBudgets(value?: Partial<PerformanceBudgets> | null): PerformanceBudgets {
  return {
    ...defaultPerformanceBudgets,
    ...(value ?? {}),
  }
}

export function hasCustomPerformanceBudgets(value?: Partial<PerformanceBudgets> | null) {
  const budgets = clonePerformanceBudgets(value)
  return performanceMetricOrder.some((metric) => budgets[metric.key] !== defaultPerformanceBudgets[metric.key])
}

export function createEmptyMonitorForm(): MonitorFormState {
  return {
    name: '',
    url: '',
    check_interval: 15,
    keyword: '',
    tags: '',
    basic_auth_username: '',
    basic_auth_password: '',
    check_noscript: false,
    performance_budgets: clonePerformanceBudgets(),
  }
}