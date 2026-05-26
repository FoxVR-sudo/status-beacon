export interface Website {
  id: number
  name: string
  url: string
  check_interval: number
  keyword: string | null
  basic_auth_username: string | null
  has_basic_auth: boolean
  check_noscript: boolean
  performance_budgets: PerformanceBudgets | null
  tls_baseline: TlsBaseline | null
  tls_baseline_approved_at: string | null
  screenshot_current_preview: string | null
  screenshot_previous_preview: string | null
  screenshot_changed_at: string | null
  tags: string[]
  is_paused: boolean
  created_at: string
  traffic_ingest_token: string | null
  traffic_ingest_url: string | null
  last_traffic_requests: number | null
  last_traffic_errors: number | null
  last_suspicious_requests: number | null
  last_traffic_window_minutes: number | null
  last_traffic_sampled_at: string | null
  last_status_code: number | null
  last_response_time: number | null
  last_ssl_days_left: number | null
  last_keyword_ok: boolean | null
  last_checked_at: string | null
}

export interface SeoReport {
  applicable: boolean
  content_type?: string | null
  title?: string | null
  title_length?: number | null
  meta_description?: string | null
  meta_description_length?: number | null
  canonical?: string | null
  canonical_count?: number
  viewport?: string | null
  charset?: string | null
  robots?: string | null
  meta_robots?: string | null
  x_robots_tag?: string | null
  lang?: string | null
  h1?: string[]
  h1_count?: number
  og_title?: string | null
  og_description?: string | null
  og_image?: string | null
  twitter_card?: string | null
  twitter_title?: string | null
  twitter_description?: string | null
  twitter_image?: string | null
  has_twitter_card?: boolean
  has_structured_data?: boolean
  image_count?: number
  images_missing_alt?: number
  issues: string[]
}

export interface HeaderReport {
  values: Record<string, string | null>
  issues: string[]
}

export interface TlsBaseline {
  applicable: boolean
  valid?: boolean
  hostname?: string | null
  subject?: string | null
  issuer?: string | null
  serial_number?: string | null
  subject_alt_names?: string[]
  certificate_sha256?: string | null
  public_key_pin_sha256?: string | null
  not_before?: string | null
  not_after?: string | null
}

export interface TlsReport {
  applicable: boolean
  valid?: boolean
  hostname?: string | null
  subject?: string | null
  issuer?: string | null
  serial_number?: string | null
  subject_alt_names?: string[]
  certificate_sha256?: string | null
  public_key_pin_sha256?: string | null
  not_before?: string | null
  not_after?: string | null
  days_left?: number | null
  baseline_available?: boolean
  baseline_pending_approval?: boolean
  baseline_approved_at?: string | null
  changed_certificate?: boolean
  changed_public_key?: boolean
  issues: string[]
}

export interface NoScriptReport {
  applicable: boolean
  content_type?: string | null
  title?: string | null
  h1?: string[]
  body_text_length?: number | null
  keyword_ok?: boolean | null
  missing_keywords?: string[]
  issues: string[]
}

export interface ScreenshotReport {
  applicable: boolean
  content_type?: string | null
  baseline_available?: boolean
  changed?: boolean | null
  issues: string[]
}

export interface PerformanceBudgets {
  ttfb_ms: number
  first_contentful_paint_ms: number
  largest_contentful_paint_ms: number
  cumulative_layout_shift: number
  total_blocking_time_ms: number
  dom_content_loaded_ms: number
  transfer_size_kb: number
}

export interface PerformanceReport {
  applicable: boolean
  content_type?: string | null
  metrics?: Record<string, number | null | undefined>
  budgets?: PerformanceBudgets
  evaluated_metrics?: number
  passing_metrics?: number
  issues: string[]
}

export interface NetworkRequestSummary {
  url: string
  host?: string | null
  method?: string | null
  resource_type?: string | null
  status?: number | null
  duration_ms?: number | null
  transfer_size_kb?: number | null
  failed: boolean
  failure?: string | null
  is_third_party: boolean
  is_navigation_request: boolean
}

export interface NetworkReport {
  applicable: boolean
  content_type?: string | null
  request_count?: number
  failed_count?: number
  error_status_count?: number
  third_party_count?: number
  total_transfer_kb?: number | null
  slowest_request_ms?: number | null
  slowest_requests?: NetworkRequestSummary[]
  issues: string[]
}

export interface Check {
  id: number
  website_id: number
  status_code: number | null
  response_time: number | null
  ttfb: number | null
  ssl_days_left: number | null
  keyword_ok: boolean | null
  seo_report: SeoReport | null
  header_report: HeaderReport | null
  tls_report: TlsReport | null
  noscript_report: NoScriptReport | null
  screenshot_report: ScreenshotReport | null
  performance_report: PerformanceReport | null
  network_report: NetworkReport | null
  checked_at: string
}

export interface Alert {
  id: number
  website_id: number
  type: string
  message: string
  sent_at: string
}

export interface UserSettings {
  email: string
  first_name: string
  last_name: string
  company_name: string | null
  is_email_verified: boolean
  is_admin: boolean
  telegram_chat_id: string | null
  telegram_bot_username: string | null
  telegram_delivery_mode: 'disabled' | 'webhook' | 'polling_fallback'
}

export type AccountStatus = 'active' | 'suspended' | 'disabled'

export type BillingPlanId = 'free' | 'pro' | 'agency'

export interface BillingSummary {
  current_plan_id: BillingPlanId
  subscription_status: string | null
  current_period_end: string | null
  checkout_enabled: boolean
  can_start_checkout: boolean
  portal_available: boolean
  configured_plan_ids: BillingPlanId[]
}

export interface BillingRedirectSession {
  url: string
}

export interface AdminOverview {
  users: number
  admins: number
  active_subscriptions: number
  websites: number
  checks: number
  alerts: number
}

export interface AdminUserItem {
  id: number
  email: string
  first_name: string
  last_name: string
  company_name: string | null
  account_status: AccountStatus
  is_admin: boolean
  is_email_verified: boolean
  websites_count: number
  current_plan_id: BillingPlanId
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  stripe_price_id: string | null
  stripe_subscription_status: string | null
  stripe_current_period_end: string | null
  created_at: string | null
}

export interface AdminUserUpdatePayload {
  email?: string
  first_name?: string
  last_name?: string
  company_name?: string | null
  account_status?: AccountStatus
  is_admin?: boolean
  is_email_verified?: boolean
  current_plan_id?: BillingPlanId
  stripe_customer_id?: string | null
  stripe_subscription_id?: string | null
  stripe_price_id?: string | null
  stripe_subscription_status?: string | null
  stripe_current_period_end?: string | null
}

export interface AdminWebsiteItem {
  id: number
  user_id: number
  name: string
  url: string
  check_interval: number
  is_paused: boolean
  created_at: string | null
}

export interface AdminWebsiteUpdatePayload {
  user_id?: number
  name?: string
  url?: string
  check_interval?: number
  is_paused?: boolean
}

export interface AdminSubscriptionItem {
  user_id: number
  email: string
  account_status: AccountStatus
  current_plan_id: BillingPlanId
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  stripe_subscription_status: string | null
  stripe_current_period_end: string | null
  created_at: string | null
}

export interface AdminSubscriptionUpsertPayload {
  user_id?: number
  current_plan_id?: BillingPlanId
  stripe_customer_id?: string | null
  stripe_subscription_id?: string | null
  stripe_subscription_status?: string | null
  stripe_current_period_end?: string | null
}

export interface AdminCheckItem {
  id: number
  website_id: number
  website_name: string | null
  user_id: number | null
  status_code: number | null
  response_time: number | null
  ttfb: number | null
  ssl_days_left: number | null
  keyword_ok: boolean | null
  checked_at: string | null
}

export interface AdminCheckUpsertPayload {
  website_id?: number
  status_code?: number
  response_time?: number
  ttfb?: number
  ssl_days_left?: number
  keyword_ok?: boolean
  checked_at?: string
}

export interface AdminAlertItem {
  id: number
  website_id: number
  website_name: string | null
  user_id: number | null
  type: string
  message: string
  sent_at: string | null
}

export interface AdminAlertUpsertPayload {
  website_id?: number
  type?: string
  message?: string
  sent_at?: string
}

export interface TelegramConnectSession {
  token: string
  status: 'pending' | 'connected' | 'expired'
  expires_at: string
  connect_url: string | null
  telegram_chat_id: string | null
}

export interface ActionResponse {
  message: string
}

export interface KeywordSuggestionResult {
  suggestions: string[]
  source: 'rendered_browser'
}
