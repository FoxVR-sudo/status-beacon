import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { websitesApi } from '../api/websites'
import {
  clonePerformanceBudgets,
  createEmptyMonitorForm,
  hasCustomPerformanceBudgets,
  intervalOptions,
  performanceMetricOrder,
  splitKeywordPhrases,
  splitTagPhrases,
} from '../monitorConfig'
import type { Website } from '../types'

type ActionNotice = { tone: 'success' | 'error'; message: string }

function getRequestErrorMessage(error: unknown, fallback: string) {
  return (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? fallback
}

function formatLastCheck(value: string | null) {
  if (!value) {
    return 'Never checked yet'
  }

  return new Date(value).toLocaleString()
}

export default function MonitorSettingsPanel() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [websites, setWebsites] = useState<Website[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [suggestingKeywords, setSuggestingKeywords] = useState(false)
  const [keywordSuggestions, setKeywordSuggestions] = useState<string[]>([])
  const [keywordSuggestionError, setKeywordSuggestionError] = useState<string | null>(null)
  const [actionNotice, setActionNotice] = useState<ActionNotice | null>(null)
  const [form, setForm] = useState(createEmptyMonitorForm)

  const editingWebsiteId = useMemo(() => {
    const rawValue = searchParams.get('monitor')
    if (!rawValue) {
      return null
    }

    const parsedValue = Number(rawValue)
    return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : null
  }, [searchParams])

  const editingWebsite = useMemo(
    () => (editingWebsiteId === null ? null : websites.find((website) => website.id === editingWebsiteId) ?? null),
    [editingWebsiteId, websites],
  )

  function showNotice(message: string, tone: ActionNotice['tone'] = 'success') {
    setActionNotice({ tone, message })
  }

  function setEditingMonitor(id: number | null) {
    const nextParams = new URLSearchParams(searchParams)
    if (id === null) {
      nextParams.delete('monitor')
    } else {
      nextParams.set('monitor', String(id))
    }

    setSearchParams(nextParams, { replace: true })
  }

  function updatePerformanceBudget(metricKey: keyof typeof form.performance_budgets, rawValue: string) {
    const parsedValue = Number(rawValue)
    setForm((current) => ({
      ...current,
      performance_budgets: {
        ...current.performance_budgets,
        [metricKey]: rawValue === '' || !Number.isFinite(parsedValue) ? current.performance_budgets[metricKey] : parsedValue,
      },
    }))
  }

  function resetForm() {
    setEditingMonitor(null)
    setForm(createEmptyMonitorForm())
    setKeywordSuggestions([])
    setKeywordSuggestionError(null)
  }

  async function loadWebsites() {
    setLoading(true)
    try {
      const websiteData = await websitesApi.list()
      setWebsites(websiteData)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadWebsites()
  }, [])

  useEffect(() => {
    if (!actionNotice) {
      return undefined
    }

    const timer = window.setTimeout(() => setActionNotice(null), 3200)
    return () => window.clearTimeout(timer)
  }, [actionNotice])

  useEffect(() => {
    if (!editingWebsite) {
      setForm(createEmptyMonitorForm())
      setKeywordSuggestions([])
      setKeywordSuggestionError(null)
      return
    }

    setForm({
      name: editingWebsite.name,
      url: editingWebsite.url,
      check_interval: editingWebsite.check_interval,
      keyword: editingWebsite.keyword ?? '',
      tags: editingWebsite.tags.join(', '),
      basic_auth_username: editingWebsite.basic_auth_username ?? '',
      basic_auth_password: '',
      check_noscript: editingWebsite.check_noscript,
      performance_budgets: clonePerformanceBudgets(editingWebsite.performance_budgets),
    })
    setKeywordSuggestions(splitKeywordPhrases(editingWebsite.keyword))
    setKeywordSuggestionError(null)
  }, [editingWebsite])

  useEffect(() => {
    if (!loading && editingWebsiteId !== null && editingWebsite === null) {
      showNotice('This monitor is no longer available. Start from a new monitor instead.', 'error')
      setEditingMonitor(null)
    }
  }, [editingWebsite, editingWebsiteId, loading])

  async function handleSuggestKeywords() {
    const url = form.url.trim()
    if (!url) {
      setKeywordSuggestionError('Enter a website URL first.')
      setKeywordSuggestions([])
      return
    }

    setSuggestingKeywords(true)
    setKeywordSuggestionError(null)
    try {
      const result = await websitesApi.suggestKeywords(url, {
        basic_auth_username: form.basic_auth_username.trim() || undefined,
        basic_auth_password: form.basic_auth_password.trim() || undefined,
      })

      setKeywordSuggestions(result.suggestions)
      if (result.suggestions.length === 0) {
        setKeywordSuggestionError('No strong phrases were found for this page yet. Try another URL or leave the field empty.')
        return
      }

      setForm((current) => ({ ...current, keyword: result.suggestions.join('\n') }))
    } catch {
      setKeywordSuggestions([])
      setKeywordSuggestionError('Could not analyze this page right now. Check the URL and try again.')
    } finally {
      setSuggestingKeywords(false)
    }
  }

  function addSuggestedKeyword(suggestion: string) {
    const nextKeywords = splitKeywordPhrases(form.keyword)
    if (!nextKeywords.some((item) => item.toLowerCase() === suggestion.toLowerCase())) {
      nextKeywords.push(suggestion)
    }

    setForm((current) => ({ ...current, keyword: nextKeywords.join('\n') }))
  }

  async function handleSaveMonitor(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    try {
      const basicAuthUsername = form.basic_auth_username.trim()
      const basicAuthPassword = form.basic_auth_password.trim()

      if (!basicAuthUsername && basicAuthPassword) {
        showNotice('Basic Auth username is required when you set a password.', 'error')
        return
      }

      if (
        basicAuthUsername &&
        !basicAuthPassword &&
        (editingWebsiteId === null || !editingWebsite?.has_basic_auth || editingWebsite.basic_auth_username !== basicAuthUsername)
      ) {
        showNotice('Enter the Basic Auth password as well.', 'error')
        return
      }

      const basicAuthPayload: {
        basic_auth_username?: string | null
        basic_auth_password?: string | null
      } = {}

      if (!basicAuthUsername) {
        if (editingWebsite?.has_basic_auth) {
          basicAuthPayload.basic_auth_username = null
          basicAuthPayload.basic_auth_password = null
        }
      } else {
        basicAuthPayload.basic_auth_username = basicAuthUsername
        if (basicAuthPassword) {
          basicAuthPayload.basic_auth_password = basicAuthPassword
        }
      }

      const payload = {
        name: form.name,
        url: form.url,
        check_interval: form.check_interval,
        keyword: form.keyword.trim() || undefined,
        check_noscript: form.check_noscript,
        performance_budgets: clonePerformanceBudgets(form.performance_budgets),
        tags: splitTagPhrases(form.tags),
        ...basicAuthPayload,
      }

      if (editingWebsiteId === null) {
        await websitesApi.create(payload)
        showNotice(`Added ${payload.name}.`)
      } else {
        await websitesApi.update(editingWebsiteId, payload)
        showNotice(`Updated ${payload.name}.`)
      }

      resetForm()
      await loadWebsites()
    } catch (error) {
      showNotice(getRequestErrorMessage(error, 'Could not save this monitor right now.'), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section id="monitor-editor" className="overflow-hidden rounded-[32px] border border-slate-200 bg-white/96 shadow-[0_28px_90px_-56px_rgba(15,23,42,0.22)]">
      <div className="bg-[linear-gradient(180deg,rgba(248,250,252,0.98)_0%,rgba(239,246,255,0.9)_100%)] px-6 py-5 sm:px-7">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">Monitor settings</div>
            <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">Configuration workspace</h2>
            <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-500">
              Shape how each monitor checks uptime, rendered content and runtime evidence without crowding the dashboard itself.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={resetForm}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
            >
              New monitor
            </button>
            <Link
              to="/dashboard"
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
            >
              Open dashboard
            </Link>
          </div>
        </div>

        {actionNotice ? (
          <div
            className={`mt-4 rounded-[18px] border px-4 py-3 text-sm font-medium ${
              actionNotice.tone === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-rose-200 bg-rose-50 text-rose-700'
            }`}
          >
            {actionNotice.message}
          </div>
        ) : null}
      </div>

      <div className="grid gap-5 px-6 py-6 sm:px-7 xl:grid-cols-[300px_minmax(0,1fr)]">
        <div className="space-y-4">
          <div className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Saved monitors</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{websites.length} configured monitor{websites.length === 1 ? '' : 's'}</div>
              </div>
              <div className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-500 shadow-sm">
                {loading ? 'Loading...' : editingWebsiteId === null ? 'Create mode' : 'Edit mode'}
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {loading ? (
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-sm text-slate-500">Loading monitors...</div>
              ) : websites.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-4 text-sm leading-6 text-slate-500">
                  No monitors yet. Create the first one from the workspace on the right.
                </div>
              ) : (
                websites.map((website) => {
                  const isSelected = website.id === editingWebsiteId
                  return (
                    <button
                      key={website.id}
                      type="button"
                      onClick={() => setEditingMonitor(website.id)}
                      className={`w-full rounded-[22px] border px-4 py-4 text-left transition ${
                        isSelected
                          ? 'border-sky-300 bg-sky-50 shadow-sm'
                          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-slate-900">{website.name}</div>
                          <div className="mt-1 truncate text-xs text-slate-500">{website.url}</div>
                        </div>
                        <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${website.is_paused ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-700'}`}>
                          {website.is_paused ? 'Paused' : 'Live'}
                        </span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-medium text-slate-500">
                        <span className="rounded-full bg-slate-100 px-2.5 py-1">{website.check_interval}m cadence</span>
                        <span className="rounded-full bg-slate-100 px-2.5 py-1">{website.keyword ? 'Browser checks' : 'Availability only'}</span>
                      </div>
                      <div className="mt-3 text-xs leading-5 text-slate-500">Last check: {formatLastCheck(website.last_checked_at)}</div>
                    </button>
                  )
                })
              )}
            </div>
          </div>

          <div className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-5 text-sm leading-6 text-slate-600">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Workspace split</div>
            <div className="mt-2">Settings now owns monitor configuration, while the dashboard stays focused on recent signal, audits and visible check evidence.</div>
          </div>
        </div>

        <form onSubmit={handleSaveMonitor} className="space-y-4">
          <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_20px_60px_-42px_rgba(15,23,42,0.18)]">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">Monitor editor</div>
                <h3 className="mt-2 text-xl font-bold tracking-tight text-slate-950">{editingWebsiteId === null ? 'Add website' : `Edit ${editingWebsite?.name ?? 'monitor'}`}</h3>
                <p className="mt-1 text-sm text-slate-500">
                  {editingWebsiteId === null
                    ? 'Create an availability or browser-rendered synthetic check in one pass.'
                    : 'Update cadence, rendered checks and access settings in one compact workspace.'}
                </p>
              </div>

              <div className="flex flex-wrap gap-2 text-xs font-semibold">
                <span className={`rounded-full px-3 py-1.5 ${form.keyword.trim() ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-600'}`}>
                  {form.keyword.trim() ? 'Browser render + text verification' : 'Availability + SSL + response time'}
                </span>
                <span className={`rounded-full px-3 py-1.5 ${hasCustomPerformanceBudgets(form.performance_budgets) ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-600'}`}>
                  {hasCustomPerformanceBudgets(form.performance_budgets) ? 'Custom performance budgets' : 'Default performance budgets'}
                </span>
              </div>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-[0_18px_45px_-36px_rgba(15,23,42,0.14)] xl:col-span-2">
              <div className="mb-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Monitor basics</div>
                <div className="mt-1 text-sm text-slate-500">Name the target, point to the URL and choose cadence and routing tags.</div>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Name</label>
                  <input
                    value={form.name}
                    onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50/90 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-500"
                    placeholder="Main website"
                    required
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">URL</label>
                  <input
                    type="url"
                    value={form.url}
                    onChange={(event) => {
                      const nextUrl = event.target.value
                      setForm((current) => ({ ...current, url: nextUrl }))
                      setKeywordSuggestions([])
                      setKeywordSuggestionError(null)
                    }}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50/90 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-500"
                    placeholder="https://example.com"
                    required
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Check interval</label>
                  <select
                    value={form.check_interval}
                    onChange={(event) => setForm((current) => ({ ...current, check_interval: Number(event.target.value) }))}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50/90 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-500"
                  >
                    {intervalOptions.map((value) => (
                      <option key={value} value={value}>
                        {value} min
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Tags</label>
                  <input
                    value={form.tags}
                    onChange={(event) => setForm((current) => ({ ...current, tags: event.target.value }))}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50/90 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-500"
                    placeholder="marketing, checkout, client-a"
                  />
                  <div className="mt-2 text-xs leading-5 text-slate-500">Use commas or new lines. Up to 8 tags per monitor.</div>
                </div>
              </div>
            </section>

            <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-[0_18px_45px_-36px_rgba(15,23,42,0.14)]">
              <div className="mb-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Access & auth</div>
                <div className="mt-1 text-sm text-slate-500">Use HTTP Basic Auth for staging or private routes.</div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Basic Auth username</label>
                  <input
                    value={form.basic_auth_username}
                    onChange={(event) => setForm((current) => ({ ...current, basic_auth_username: event.target.value }))}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50/90 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-500"
                    placeholder="staging-user"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Basic Auth password</label>
                  <input
                    type="password"
                    value={form.basic_auth_password}
                    onChange={(event) => setForm((current) => ({ ...current, basic_auth_password: event.target.value }))}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50/90 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-500"
                    placeholder={editingWebsite?.has_basic_auth ? 'Leave blank to keep current password' : 'Optional'}
                  />
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-xs leading-5 text-slate-500">
                  {editingWebsite?.has_basic_auth
                    ? 'Leave the password empty to keep the current secret. Clear the username field to remove Basic Auth.'
                    : 'Optional. Use this for staging or private routes protected with HTTP Basic Auth.'}
                </div>
              </div>
            </section>

            <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-[0_18px_45px_-36px_rgba(15,23,42,0.14)]">
              <div className="mb-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Fallback coverage</div>
                <div className="mt-1 text-sm text-slate-500">Control the extra no-JS verification pass for fragile app shells.</div>
              </div>

              <label className="flex cursor-pointer items-start gap-3 rounded-[22px] border border-slate-200 bg-slate-50/80 px-4 py-4 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={form.check_noscript}
                  onChange={(event) => setForm((current) => ({ ...current, check_noscript: event.target.checked }))}
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                />
                <span>
                  <span className="block font-semibold text-slate-900">Run NoScript fallback check</span>
                  <span className="mt-1 block text-xs leading-6 text-slate-500">
                    Run a second browser pass with JavaScript disabled. This catches empty app shells, missing fallback copy and keyword loss when the page depends too heavily on client-side rendering.
                  </span>
                </span>
              </label>
            </section>

            <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-[0_18px_45px_-36px_rgba(15,23,42,0.14)] xl:col-span-2">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Performance budgets</div>
                  <div className="mt-1 text-sm text-slate-500">Set pass/fail thresholds per monitor instead of relying only on shared defaults.</div>
                </div>
                <button
                  type="button"
                  onClick={() => setForm((current) => ({ ...current, performance_budgets: clonePerformanceBudgets() }))}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
                >
                  Reset defaults
                </button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {performanceMetricOrder.map((metric) => (
                  <label key={metric.key} className="rounded-2xl border border-slate-200 bg-slate-50/80 px-3 py-3">
                    <span className="flex items-center justify-between gap-3">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">{metric.label}</span>
                      <span className="text-[10px] text-slate-400">{metric.hint}</span>
                    </span>
                    <input
                      type="number"
                      min={metric.min}
                      step={metric.step}
                      value={form.performance_budgets[metric.key]}
                      onChange={(event) => updatePerformanceBudget(metric.key, event.target.value)}
                      className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-500"
                    />
                  </label>
                ))}
              </div>
            </section>

            <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-[0_18px_45px_-36px_rgba(15,23,42,0.14)] xl:col-span-2">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Rendered page checks</div>
                  <div className="mt-1 text-sm text-slate-500">Track visible copy, page title and meta description from the rendered page.</div>
                </div>
                <button
                  type="button"
                  onClick={() => void handleSuggestKeywords()}
                  disabled={!form.url.trim() || suggestingKeywords}
                  className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-700 transition hover:border-sky-300 hover:text-sky-900 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {suggestingKeywords ? 'Analyzing site...' : 'Suggest visible text'}
                </button>
              </div>

              <textarea
                value={form.keyword}
                onChange={(event) => setForm((current) => ({ ...current, keyword: event.target.value }))}
                className="min-h-[120px] w-full rounded-2xl border border-slate-200 bg-slate-50/90 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-500"
                placeholder={'Login\nCreate Free Account\nSecurity & Privacy First'}
                rows={4}
              />

              <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-xs leading-6 text-slate-500">
                The app renders the page in a headless browser, then checks the rendered text, page title and meta description. Use short visible phrases like Login, Pricing or Contact us. Leave it empty if you only want HTTP, SSL and response-time monitoring.
              </div>

              {keywordSuggestionError ? (
                <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-6 text-amber-800">
                  {keywordSuggestionError}
                </div>
              ) : null}

              {keywordSuggestions.length > 0 ? (
                <div className="mt-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Suggested phrases</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {keywordSuggestions.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => addSuggestedKeyword(suggestion)}
                        className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-sky-300 hover:text-sky-900"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </section>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex rounded-xl bg-sky-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:opacity-60"
            >
              {saving ? 'Saving...' : editingWebsiteId === null ? 'Add website' : 'Save changes'}
            </button>
            {editingWebsiteId !== null ? (
              <button
                type="button"
                onClick={resetForm}
                className="inline-flex rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
              >
                Cancel
              </button>
            ) : null}
          </div>
        </form>
      </div>
    </section>
  )
}