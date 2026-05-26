import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import MonitorSettingsPanel from '../components/MonitorSettingsPanel'
import { settingsApi } from '../api/settings'
import { billingPlans as subscriptionPlans } from '../billingPlans'
import type { BillingPlanId, BillingSummary, TelegramConnectSession, UserSettings } from '../types'

const telegramSetupSteps = [
  {
    title: 'Start the automatic connect flow',
    description: 'Click the connect button below. status-beacon.com opens your Telegram bot with a one-time secure start link for this account.',
  },
  {
    title: 'Press Start in Telegram',
    description: 'Telegram opens the bot chat. Press Start once so the bot can receive your one-time connect code and reply to this account later.',
  },
  {
    title: 'Wait for this page to confirm',
    description: 'After the bot receives the start command, this settings page checks the bot updates and links the chat automatically.',
  },
  {
    title: 'Receive alerts in the same chat',
    description: 'When a monitored website fails, status-beacon.com sends the alert message to the Telegram chat that was linked automatically.',
  },
]

function isBillingPlanId(value: string | null): value is BillingPlanId {
  return value === 'free' || value === 'pro' || value === 'agency'
}

function getRequestErrorMessage(error: unknown, fallback: string) {
  return (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? fallback
}

function formatBillingStatus(status: string | null, currentPlanId: BillingPlanId | null) {
  if (!status) {
    return currentPlanId === 'free' ? 'Free plan active' : 'Waiting for Stripe'
  }

  return status
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function formatBillingDate(value: string | null) {
  if (!value) {
    return null
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value))
}

export default function Settings() {
  const [searchParams] = useSearchParams()
  const [settings, setSettings] = useState<UserSettings | null>(null)
  const [billing, setBilling] = useState<BillingSummary | null>(null)
  const [connectSession, setConnectSession] = useState<TelegramConnectSession | null>(null)
  const [connectBusy, setConnectBusy] = useState(false)
  const [connectError, setConnectError] = useState('')
  const [testBusy, setTestBusy] = useState(false)
  const [testMessage, setTestMessage] = useState('')
  const [testError, setTestError] = useState('')
  const [billingBusy, setBillingBusy] = useState<string | null>(null)
  const [billingError, setBillingError] = useState('')
  const [billingMessage, setBillingMessage] = useState('')

  const telegramBotUrl = settings?.telegram_bot_username
    ? `https://t.me/${settings.telegram_bot_username.replace(/^@/, '')}`
    : null
  const telegramChatId = settings?.telegram_chat_id ?? connectSession?.telegram_chat_id ?? ''
  const telegramConnected = telegramChatId.trim().length > 0
  const automaticConnectAvailable = Boolean(telegramBotUrl)
  const telegramDeliveryMode = settings?.telegram_delivery_mode ?? 'disabled'
  const accountEmail = settings?.email ?? 'Loading...'
  const featuredPlan = subscriptionPlans.find((plan) => plan.featured) ?? subscriptionPlans[0]
  const selectedPlanId = isBillingPlanId(searchParams.get('plan'))
    ? searchParams.get('plan')
    : null
  const currentPlan = subscriptionPlans.find((plan) => plan.id === billing?.current_plan_id) ?? subscriptionPlans[0]
  const spotlightPlan = subscriptionPlans.find((plan) => plan.id === (selectedPlanId ?? billing?.current_plan_id ?? featuredPlan.id)) ?? currentPlan
  const billingStatusLabel = formatBillingStatus(billing?.subscription_status ?? null, billing?.current_plan_id ?? null)
  const billingPeriodEndLabel = formatBillingDate(billing?.current_period_end ?? null)

  const deliveryModeLabel = telegramDeliveryMode === 'webhook'
    ? 'Webhook mode'
    : telegramDeliveryMode === 'polling_fallback'
      ? 'Local fallback mode'
      : 'Telegram disabled'

  const deliveryModeDescription = telegramDeliveryMode === 'webhook'
    ? 'Telegram is using the production webhook path. New /start events are pushed directly into the app.'
    : telegramDeliveryMode === 'polling_fallback'
      ? 'This environment is still using the localhost fallback because Telegram cannot call back into a non-public HTTP endpoint.'
      : 'Telegram bot delivery is not configured yet in this environment.'

  const automaticConnectMessage = connectSession?.status === 'pending'
    ? 'Waiting for you to press Start in Telegram. This page is checking for the bot confirmation automatically.'
    : connectSession?.status === 'connected'
      ? `Telegram connected automatically to chat ${connectSession.telegram_chat_id}.`
      : connectSession?.status === 'expired'
        ? 'This connect request expired. Start a new Telegram connect request to try again.'
        : 'Users no longer need to paste a chat ID manually. Start the flow here and Telegram will be linked after the bot receives the one-time start link.'

  useEffect(() => {
    async function load() {
      try {
        const [userSettings, billingSummary] = await Promise.all([
          settingsApi.me(),
          settingsApi.getBillingSummary(),
        ])
        setSettings(userSettings)
        setBilling(billingSummary)
      } catch (error) {
        console.error(error)
        setBillingError('Billing data could not be loaded right now. Refresh the page and try again.')
      }
    }

    void load()
  }, [])

  useEffect(() => {
    const checkoutState = searchParams.get('checkout')
    const portalState = searchParams.get('portal')

    if (checkoutState === 'success') {
      const planLabel = spotlightPlan.name
      setBillingMessage(`${planLabel} checkout completed. Stripe will sync the subscription status back into this workspace shortly.`)
      setBillingError('')
      return
    }

    if (checkoutState === 'cancel') {
      setBillingMessage('Stripe checkout was canceled before payment details were confirmed.')
      setBillingError('')
      return
    }

    if (portalState === 'return') {
      setBillingMessage('Returned from the Stripe billing portal. Refresh the billing state below if you changed a subscription.')
      setBillingError('')
    }
  }, [searchParams, spotlightPlan.name])

  useEffect(() => {
    if (!connectSession || connectSession.status !== 'pending') {
      return undefined
    }

    const intervalId = window.setInterval(() => {
      void (async () => {
        try {
          const nextSession = await settingsApi.getTelegramConnectStatus(connectSession.token)
          setConnectSession(nextSession)
          if (nextSession.status === 'connected') {
            setSettings((current) => (current ? { ...current, telegram_chat_id: nextSession.telegram_chat_id } : current))
            setConnectError('')
            setTestError('')
          }
        } catch (error) {
          console.error(error)
        }
      })()
    }, 2500)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [connectSession])

  async function handleAutomaticConnect() {
    setConnectBusy(true)
    setConnectError('')
    setTestMessage('')
    setTestError('')
    try {
      const session = await settingsApi.startTelegramConnect()
      setConnectSession(session)
      if (session.connect_url) {
        window.open(session.connect_url, '_blank', 'noopener,noreferrer')
      }
    } catch (error) {
      console.error(error)
      setConnectError('Automatic Telegram connect is unavailable right now. Check the bot configuration and try again.')
    } finally {
      setConnectBusy(false)
    }
  }

  async function handleSendTest() {
    setTestBusy(true)
    setTestMessage('')
    setTestError('')
    try {
      const result = await settingsApi.sendTelegramTest()
      setTestMessage(result.message)
    } catch (error) {
      console.error(error)
      setTestError('Telegram test message failed to send. Reconnect the bot and try again.')
    } finally {
      setTestBusy(false)
    }
  }

  async function handleStartCheckout(planId: BillingPlanId) {
    setBillingBusy(`checkout:${planId}`)
    setBillingError('')
    setBillingMessage('')
    try {
      const session = await settingsApi.startBillingCheckout(planId)
      window.location.assign(session.url)
    } catch (error) {
      console.error(error)
      setBillingError(getRequestErrorMessage(error, 'Stripe checkout could not be started right now.'))
    } finally {
      setBillingBusy(null)
    }
  }

  async function handleOpenBillingPortal() {
    setBillingBusy('portal')
    setBillingError('')
    setBillingMessage('')
    try {
      const session = await settingsApi.openBillingPortal()
      window.location.assign(session.url)
    } catch (error) {
      console.error(error)
      setBillingError(getRequestErrorMessage(error, 'Stripe billing portal could not be opened right now.'))
    } finally {
      setBillingBusy(null)
    }
  }

  return (
    <div className="relative isolate space-y-6">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[320px] rounded-[36px] bg-[radial-gradient(circle_at_14%_10%,rgba(99,102,241,0.16),transparent_38%),radial-gradient(circle_at_84%_12%,rgba(139,92,246,0.12),transparent_34%),radial-gradient(circle_at_48%_100%,rgba(6,182,212,0.08),transparent_45%)]" />
      <MonitorSettingsPanel />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.18fr)_360px]">
        <div className="space-y-6">
          <section id="notifications" className="overflow-hidden rounded-[30px] border border-slate-200 bg-white/95 shadow-[0_18px_65px_-44px_rgba(15,23,42,0.22)]">
            <div className="bg-[linear-gradient(180deg,rgba(248,250,252,0.98)_0%,rgba(239,246,255,0.9)_100%)] px-6 py-5">
              <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">Notifications</div>
                  <h2 className="mt-2 text-xl font-bold tracking-tight text-slate-900">Delivery overview</h2>
                  <p className="mt-1 max-w-2xl text-sm text-slate-500">Email stays tied to the account. Telegram connects with a one-time start flow and becomes the live incident route.</p>
                </div>
                <div className={`inline-flex rounded-full px-3 py-1.5 text-xs font-semibold ${telegramConnected ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                  {telegramConnected ? 'Connected' : 'Disconnected'}
                </div>
              </div>
            </div>

            <div className="grid gap-4 px-6 py-6 lg:grid-cols-3">
              <div className="rounded-[22px] border border-slate-200 bg-slate-50/80 p-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Account email</div>
                <div className="mt-2 text-sm font-semibold text-slate-900">{accountEmail}</div>
                <div className="mt-1 text-xs text-slate-500">Primary fallback for monitor alerts.</div>
              </div>

              <div className="rounded-[22px] border border-slate-200 bg-slate-50/80 p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Telegram route</div>
                  <div className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold ${telegramConnected ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                    {telegramConnected ? 'Ready' : 'Pending'}
                  </div>
                </div>
                <div className="mt-2 text-sm font-semibold text-slate-900">{telegramConnected ? `Chat ${telegramChatId}` : 'Not linked yet'}</div>
                <div className="mt-1 text-xs text-slate-500">Use Telegram for faster incident acknowledgement.</div>
              </div>

              <div className="rounded-[22px] border border-slate-200 bg-slate-50/80 p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Delivery mode</div>
                  <div className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold ${telegramDeliveryMode === 'webhook' ? 'bg-emerald-50 text-emerald-700' : telegramDeliveryMode === 'polling_fallback' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
                    {deliveryModeLabel}
                  </div>
                </div>
                <div className="mt-2 text-xs leading-5 text-slate-500">{deliveryModeDescription}</div>
              </div>
            </div>
          </section>

          <section className="overflow-hidden rounded-[30px] border border-slate-200 bg-white/95 shadow-[0_18px_65px_-44px_rgba(15,23,42,0.22)]">
            <div className="bg-[linear-gradient(180deg,rgba(248,250,252,0.98)_0%,rgba(241,245,249,0.96)_100%)] px-6 py-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">Telegram setup</div>
                  <h2 className="mt-2 text-xl font-bold tracking-tight text-slate-900">Automatic connect flow</h2>
                  <p className="mt-1 text-sm text-slate-500">Start the bot once, then this page watches for the one-time confirmation and links the chat automatically.</p>
                </div>

                {telegramBotUrl ? (
                  <a
                    href={telegramBotUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-700"
                  >
                    Open Bot
                  </a>
                ) : null}
              </div>
            </div>

            <div className="px-6 py-6">
              <div className="rounded-[24px] border border-sky-100 bg-sky-50 px-4 py-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Auto connect</div>
                    <div className="mt-1 text-xs leading-5 text-slate-600">{automaticConnectMessage}</div>
                  </div>

                  <button
                    type="button"
                    onClick={handleAutomaticConnect}
                    disabled={!automaticConnectAvailable || connectBusy || connectSession?.status === 'pending'}
                    className="inline-flex rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {connectSession?.status === 'pending' ? 'Waiting...' : connectBusy ? 'Preparing...' : telegramConnected ? 'Reconnect' : 'Connect'}
                  </button>
                </div>

                {connectError ? <div className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">{connectError}</div> : null}
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {telegramSetupSteps.map((step, index) => (
                  <div key={step.title} className="rounded-[22px] border border-slate-200 bg-slate-50/80 px-4 py-4">
                    <div className="flex items-start gap-3">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">
                        {index + 1}
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{step.title}</div>
                        <div className="mt-1 text-xs leading-5 text-slate-600">{step.description}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 rounded-[20px] border border-sky-100 bg-sky-50 px-4 py-3 text-xs leading-5 text-sky-900">
                Press Start in Telegram before delivery will work. Once linked, the same chat receives test messages and live incidents.
              </div>
            </div>
          </section>
        </div>

        <aside className="space-y-6">
          <section className="rounded-[28px] border border-slate-200 bg-white/95 p-5 shadow-[0_18px_65px_-44px_rgba(15,23,42,0.22)]">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">Status & actions</div>
              <h2 className="mt-2 text-lg font-bold tracking-tight text-slate-900">Operational rail</h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">Quick checks for route health, connectability and outbound test delivery.</p>
            </div>

            <div className="mt-4 space-y-3">
              <div className="rounded-[20px] border border-slate-200 bg-slate-50/80 px-4 py-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Bot availability</div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-slate-900">{automaticConnectAvailable ? 'Bot is configured' : 'Bot is unavailable'}</div>
                  <div className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold ${automaticConnectAvailable ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                    {automaticConnectAvailable ? 'Ready' : 'Setup needed'}
                  </div>
                </div>
              </div>

              <div className="rounded-[20px] border border-slate-200 bg-slate-50/80 px-4 py-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Current chat</div>
                <div className="mt-2 text-sm font-semibold text-slate-900">{telegramConnected ? `Chat ${telegramChatId}` : 'Waiting for Telegram connect'}</div>
                <div className="mt-1 text-xs leading-5 text-slate-500">Reconnect if you want alerts to move to a different Telegram destination.</div>
              </div>

              <div className="rounded-[20px] border border-slate-200 bg-slate-50/80 px-4 py-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Send test</div>
                <div className="mt-2 text-xs leading-5 text-slate-600">Verify that alert messages can reach the linked Telegram chat right now.</div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSendTest}
                    disabled={!telegramConnected || testBusy}
                    className="rounded-xl bg-sky-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {testBusy ? 'Sending...' : 'Test delivery'}
                  </button>
                </div>

                {testMessage ? <div className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{testMessage}</div> : null}
                {testError ? <div className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">{testError}</div> : null}
              </div>
            </div>
          </section>

          <section className="rounded-[28px] border border-slate-200 bg-[linear-gradient(180deg,rgba(240,249,255,0.85)_0%,rgba(255,255,255,1)_100%)] p-5 shadow-[0_18px_65px_-44px_rgba(15,23,42,0.22)]">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">Billing snapshot</div>
            <h2 className="mt-2 text-lg font-bold tracking-tight text-slate-900">Current plan: {currentPlan.name}</h2>
            <p className="mt-1 text-sm text-slate-500">{currentPlan.summary}</p>

            <div className="mt-4 flex items-end gap-1">
              <span className="text-3xl font-extrabold text-slate-950">{currentPlan.price}</span>
              <span className="pb-1 text-xs text-slate-500">{currentPlan.cadence}</span>
            </div>

            <div className="mt-4 space-y-2 text-xs text-slate-700">
              {currentPlan.features.slice(0, 3).map((feature) => (
                <div key={feature} className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-500" />
                  <span>{feature}</span>
                </div>
              ))}
            </div>

            <div className="mt-4 rounded-[20px] border border-sky-100 bg-white/80 px-4 py-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Subscription status</div>
              <div className="mt-2 text-sm font-semibold text-slate-900">{billingStatusLabel}</div>
              <div className="mt-1 text-xs leading-5 text-slate-500">
                {billingPeriodEndLabel
                  ? `Current period ends ${billingPeriodEndLabel}.`
                  : billing?.current_plan_id === 'free'
                    ? 'Free plan stays active until a paid Stripe subscription is attached.'
                    : 'Stripe has not synced a paid billing period to this workspace yet.'}
              </div>
            </div>

            <div className={`analytics-pill mt-4 inline-flex rounded-full px-3 py-1 text-xs font-semibold shadow-sm ${billing?.checkout_enabled ? 'bg-white text-sky-700' : 'bg-amber-50 text-amber-700'}`}>
              {billing?.checkout_enabled ? 'Stripe ready' : 'Stripe setup needed'}
            </div>

            {billing?.portal_available ? (
              <button
                type="button"
                onClick={handleOpenBillingPortal}
                disabled={billingBusy === 'portal'}
                className="mt-4 inline-flex w-full items-center justify-center rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {billingBusy === 'portal' ? 'Opening Stripe...' : 'Manage in Stripe'}
              </button>
            ) : null}
          </section>
        </aside>
      </div>

      <section id="billing" className="rounded-[30px] border border-slate-200 bg-white/95 p-6 shadow-[0_18px_65px_-44px_rgba(15,23,42,0.22)]">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">Billing & subscriptions</div>
            <h2 className="mt-2 text-xl font-bold tracking-tight text-slate-900">Stripe plan management</h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">Paid plans now create real Stripe checkout sessions. If this workspace already has a paid subscription, use the billing portal to change or cancel it safely.</p>
          </div>
          <div className={`analytics-pill inline-flex rounded-full px-3 py-1.5 text-xs font-semibold ${billing?.checkout_enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
            {billing?.checkout_enabled ? 'Stripe live' : 'Stripe unavailable'}
          </div>
        </div>

        {billingMessage ? <div className="mt-5 rounded-[20px] border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{billingMessage}</div> : null}
        {billingError ? <div className="mt-5 rounded-[20px] border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">{billingError}</div> : null}

        <div className="mt-5 rounded-[22px] border border-slate-200 bg-slate-50/80 px-4 py-4 text-sm text-slate-600">
          {selectedPlanId
            ? `${spotlightPlan.name} is selected from the landing page. Complete checkout here once Stripe is available for this environment.`
            : 'Select a plan below. The Free tier stays active by default, while paid tiers redirect through Stripe checkout.'}
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          {subscriptionPlans.map((plan) => (
            <div
              key={plan.id}
              className={`rounded-[24px] border p-5 ${
                plan.id === (selectedPlanId ?? billing?.current_plan_id ?? featuredPlan.id)
                  ? 'analytics-featured-plan border-sky-300 bg-gradient-to-br from-sky-50 to-blue-50 shadow-[0_18px_48px_-34px_rgba(14,116,144,0.35)]'
                  : plan.featured
                    ? 'analytics-featured-plan border-sky-200 bg-gradient-to-br from-sky-50 to-blue-50'
                    : 'border-slate-200 bg-slate-50/60'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-bold text-slate-900">{plan.name}</div>
                  <div className="mt-1 text-xs leading-5 text-slate-600">{plan.summary}</div>
                </div>
                {plan.featured ? <span className="rounded-full bg-sky-600 px-2.5 py-1 text-[10px] font-semibold text-white">Popular</span> : null}
              </div>

              <div className="mt-4 flex items-end gap-1">
                <span className="text-2xl font-extrabold text-slate-950">{plan.price}</span>
                <span className="pb-0.5 text-xs text-slate-500">{plan.cadence}</span>
              </div>

              <div className="mt-4 space-y-2 text-xs text-slate-700">
                {plan.features.map((feature) => (
                  <div key={feature} className="flex items-start gap-2">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-500" />
                    <span>{feature}</span>
                  </div>
                ))}
              </div>

              <div className="mt-5 flex items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                <span>{billing?.current_plan_id === plan.id ? 'Current workspace plan' : 'Available plan'}</span>
                {plan.id !== 'free' && !(billing?.configured_plan_ids ?? []).includes(plan.id) ? <span>Not configured</span> : null}
              </div>

              {plan.id === 'free' ? (
                <button
                  type="button"
                  disabled
                  className="mt-5 inline-flex w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-500 disabled:cursor-not-allowed"
                >
                  {billing?.current_plan_id === 'free' ? 'Included by default' : 'Base plan'}
                </button>
              ) : !billing?.checkout_enabled ? (
                <button
                  type="button"
                  disabled
                  className="mt-5 inline-flex w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-500 disabled:cursor-not-allowed"
                >
                  Stripe unavailable
                </button>
              ) : !(billing?.configured_plan_ids ?? []).includes(plan.id) ? (
                <button
                  type="button"
                  disabled
                  className="mt-5 inline-flex w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-500 disabled:cursor-not-allowed"
                >
                  Price not configured
                </button>
              ) : billing?.current_plan_id === plan.id || !billing?.can_start_checkout ? (
                <button
                  type="button"
                  onClick={handleOpenBillingPortal}
                  disabled={!billing?.portal_available || billingBusy === 'portal'}
                  className="mt-5 inline-flex w-full items-center justify-center rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {billingBusy === 'portal' ? 'Opening Stripe...' : billing?.current_plan_id === plan.id ? 'Manage in Stripe' : 'Change in Stripe'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => handleStartCheckout(plan.id)}
                  disabled={billingBusy === `checkout:${plan.id}`}
                  className={`mt-5 inline-flex w-full items-center justify-center rounded-xl px-4 py-3 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60 ${
                    plan.featured ? 'bg-sky-600 hover:bg-sky-700' : 'bg-slate-900 hover:bg-slate-800'
                  }`}
                >
                  {billingBusy === `checkout:${plan.id}` ? 'Redirecting to Stripe...' : 'Checkout with Stripe'}
                </button>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}