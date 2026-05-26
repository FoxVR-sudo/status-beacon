import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BrandMark } from '../components/BrandLogo'
import { billingPlans as subscriptionPlans } from '../billingPlans'
import { useAuthStore } from '../store/authStore'

const COOKIE_CONSENT_KEY = 'status-beacon.cookie-consent'

const heroStats = [
  {
    value: '7',
    label: 'Core signals',
  },
  {
    value: '6',
    label: 'Categories',
  },
  {
    value: '24/7',
    label: 'Coverage',
  },
  {
    value: '100%',
    label: 'Visible output',
  },
]

const marketingNav = [
  { label: 'Live demo', href: '#live-demo' },
  { label: 'Features', href: '#features' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'Security', href: '#security' },
]

const heroHighlights = [
  {
    title: 'Urgent work first',
    body: 'Priority scoring keeps the next operator action obvious.',
  },
  {
    title: 'Rendered proof',
    body: 'Keyword, screenshot, waterfall and budget evidence stay together.',
  },
  {
    title: 'SEO visibility',
    body: 'Canonical, social, viewport and indexability gaps surface from the same pass.',
  },
  {
    title: 'Active incident lifecycle',
    body: 'Open issues and review-only changes stay visible without stale alert noise.',
  },
]

const demoSnapshotMetrics = [
  {
    label: 'Last check',
    value: '38s ago',
    body: 'Rendered page returned 200 and completed within the current budget window.',
  },
  {
    label: 'Slowest request',
    value: '842 ms',
    body: 'Hero media and primary CSS stayed inside the performance threshold for the sample run.',
  },
  {
    label: 'SEO gaps',
    value: '4',
    body: 'The demo monitor still flags social metadata, structured data and image-alt follow-up.',
  },
]

const demoSnapshotFindings = [
  {
    title: 'Rendered content drift',
    status: 'Needs review',
    body: 'The pricing route CTA copy changed from the previous visual baseline after the last deploy.',
  },
  {
    title: 'Alert delivery',
    status: 'Delivered',
    body: 'Telegram and email alerts reached the configured destination for the latest timeout event.',
  },
]

const workflowSteps = [
  {
    step: '01',
    title: 'Point a monitor at a real route',
    body: 'Start with a landing page, login flow, pricing page or any production route that matters to the team.',
  },
  {
    step: '02',
    title: 'Run a browser-aware check',
    body: 'Status Beacon renders the page, captures keyword, SEO, performance and waterfall evidence, then stores the result visibly.',
  },
  {
    step: '03',
    title: 'Review what changed first',
    body: 'Dashboards prioritize the most urgent monitors and keep alerts, regressions and SEO follow-up readable.',
  },
]

const monitoringCategories = [
  {
    title: 'Availability Monitoring',
    items: [
      'HTTP status validation',
      'Response time tracking',
      'SSL expiry awareness',
      'Downtime visibility',
      'Manual reruns',
      'Always-on cadence',
    ],
  },
  {
    title: 'Rendered Content Checks',
    items: [
      'Rendered keyword matching',
      'Meta description checks',
      'Page title verification',
      'Auto-suggested phrases',
      'JavaScript-aware rendering',
      'Visible text validation',
    ],
  },
  {
    title: 'Performance Analysis',
    items: [
      'Core rendering metrics',
      'Per-monitor budgets',
      'Budget breach flags',
      'Slow resource visibility',
      'TTFB tracking',
      'Lighthouse-style reporting',
    ],
  },
  {
    title: 'Network Visibility',
    items: [
      'Request waterfall summaries',
      'Asset count breakdowns',
      'Slowest request surfaces',
      'Failed request capture',
      'Rendered page evidence',
      'Non-HTML fallback coverage',
    ],
  },
  {
    title: 'Alert Routing',
    items: [
      'Email notifications',
      'Telegram delivery',
      'Test alert sending',
      'Signal-first messages',
      'Operational handoff',
      'Production-safe routing',
    ],
  },
  {
    title: 'Advanced Workflows',
    items: [
      'Settings-based configuration',
      'Dashboard category views',
      'Duplicate monitor actions',
      'CSV incident exports',
      'Operator-friendly review flows',
      'Team-ready read surfaces',
    ],
  },
]

const whyChoose = [
  {
    title: 'Async Checks',
    body: 'Checks run asynchronously and return clear, visible status without blocking the operator workflow.',
  },
  {
    title: 'Detailed Reports',
    body: 'Each monitor exposes content, performance and network evidence instead of hiding outcomes behind collapsible details.',
  },
  {
    title: 'REST-friendly Stack',
    body: 'API-first architecture makes it straightforward to connect ingest, alerting and deployment workflows.',
  },
  {
    title: 'Team Workflow',
    body: 'Settings owns configuration, Dashboard owns runtime signal, so teams can move faster with less UI friction.',
  },
  {
    title: 'High Visibility',
    body: 'Grouped result categories keep the important state obvious during incidents and routine monitoring alike.',
  },
  {
    title: 'Transparent Platform',
    body: 'Self-hostable code, explicit reporting and readable output make the system easier to trust and extend.',
  },
]

const privacyColumns = [
  {
    title: 'Data Protection',
    items: [
      'HTTPS everywhere',
      'Per-account monitor history',
      'No third-party alert relays by default',
      'Self-host friendly stack',
      'Operational transparency',
    ],
  },
  {
    title: 'Responsible Monitoring',
    items: [
      'Run checks on assets you own',
      'Non-destructive visibility only',
      'Rate-aware request patterns',
      'Clear alert routing boundaries',
      'Operationally safe defaults',
    ],
  },
]

const footerLinks = [
  {
    label: 'Login',
    href: '/login',
  },
  {
    label: 'Get Started',
    href: '/register',
  },
  {
    label: 'Dashboard',
    href: '/dashboard',
  },
]

export default function Landing() {
  const [showCookieNotice, setShowCookieNotice] = useState(() => {
    if (typeof window === 'undefined') {
      return false
    }

    try {
      return !window.localStorage.getItem(COOKIE_CONSENT_KEY)
    } catch {
      return true
    }
  })
  const [showDemoSnapshot, setShowDemoSnapshot] = useState(false)
  const token = useAuthStore((state) => state.token)
  const primaryHref = token ? '/dashboard' : '/register'
  const planHref = useMemo(
    () => (planId: string) => (token ? `/settings?plan=${planId}#billing` : `/register?plan=${planId}`),
    [token],
  )

  function dismissCookieNotice(value: 'accepted' | 'declined') {
    try {
      window.localStorage.setItem(COOKIE_CONSENT_KEY, value)
    } catch {
      // Ignore storage issues and still hide the banner for the current session.
    }
    setShowCookieNotice(false)
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#0b1020] px-4 py-5 text-slate-100 sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(99,102,241,0.18),_transparent_30%),radial-gradient(circle_at_50%_0%,_rgba(79,70,229,0.15),_transparent_30%)]" />

      <div className="relative mx-auto max-w-[1180px]">
        <header className="mb-12 flex flex-wrap items-center gap-4 py-3">
          <Link to="/" className="flex min-w-0 flex-1 items-center gap-3 rounded-[24px] border border-white/10 bg-white/[0.04] px-4 py-3 shadow-[0_22px_60px_-42px_rgba(2,6,23,0.92)] transition hover:border-white/20 hover:bg-white/[0.06] sm:max-w-[370px] sm:flex-none">
            <BrandMark className="h-12 w-12 rounded-2xl" />
            <span className="min-w-0">
              <span className="block text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-200/85">Status Beacon</span>
              <span className="block truncate text-sm text-slate-300">Operational monitoring cockpit</span>
            </span>
          </Link>

          <nav className="order-3 hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] p-1.5 lg:order-2 lg:ml-auto lg:flex">
              {marketingNav.map((item) => (
                <a key={item.label} href={item.href} className="rounded-full px-4 py-2 text-sm font-semibold text-slate-300 transition hover:bg-white/[0.06] hover:text-white">
                  {item.label}
                </a>
              ))}
          </nav>

          <div className="order-2 ml-auto flex w-full items-center justify-between gap-4 text-base text-slate-200 sm:w-auto sm:justify-start sm:text-lg lg:order-3 lg:ml-0">
            <Link to={token ? '/dashboard' : '/login'} className="transition hover:text-white">
                Login
            </Link>
            <Link
              to={primaryHref}
              className="rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 px-6 py-3 text-sm font-semibold text-white shadow-[0_24px_60px_-30px_rgba(99,102,241,0.95)] transition hover:from-indigo-400 hover:to-violet-400 sm:px-7 sm:text-base"
            >
              Get Started
            </Link>
          </div>
        </header>

        <section className="grid gap-8 px-1 pb-4 pt-4 min-[720px]:grid-cols-[minmax(0,0.9fr)_minmax(260px,0.95fr)] min-[720px]:items-start lg:grid-cols-[minmax(0,0.94fr)_minmax(320px,0.9fr)]">
          <div className="sm:px-2 lg:px-0">
            <div className="max-w-[820px]">
              <div className="inline-flex items-center gap-2 rounded-full border border-sky-300/15 bg-sky-400/10 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-100">
                Clear runtime evidence without noisy tooling
              </div>
              <h1 className="mt-6 max-w-[14ch] text-4xl font-extrabold leading-[0.96] tracking-tight text-white sm:text-5xl min-[720px]:max-w-none lg:max-w-[15ch] lg:text-[4.1rem] xl:text-[4.35rem]">
                Website monitoring that shows what changed, what broke, and what needs action next.
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300 sm:text-[1.15rem] sm:leading-9">
                Status Beacon combines uptime, rendered content, SEO quality, visual baselines, budgets and alert lifecycle into one calmer operator surface.
              </p>
            </div>

            <div className="mt-10 grid gap-3 rounded-[26px] border border-white/10 bg-white/[0.03] p-4 sm:grid-cols-2 min-[720px]:hidden">
              {heroStats.map((stat) => (
                <div key={stat.label} className="rounded-[20px] border border-white/8 bg-[#0f1528]/70 px-4 py-4">
                  <div className="text-xl font-extrabold text-white sm:text-2xl">{stat.value}</div>
                  <div className="mt-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-4 min-[720px]:pt-10 lg:pt-16">
            <div className="rounded-[30px] border border-white/10 bg-white/[0.03] p-5 shadow-[0_30px_80px_-60px_rgba(15,23,42,1)]">
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-sky-200/85">Built for active monitoring</div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {heroHighlights.map((item) => (
                <div key={item.title} className="flex gap-3 rounded-[22px] border border-white/10 bg-white/[0.025] px-4 py-4 shadow-[0_24px_60px_-44px_rgba(15,23,42,1)]">
                  <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-sky-300 shadow-[0_0_16px_rgba(125,211,252,0.8)]" />
                  <div>
                    <div className="text-sm font-semibold text-white">{item.title}</div>
                    <div className="mt-1 text-sm leading-6 text-slate-300">{item.body}</div>
                  </div>
                </div>
              ))}
            </div>
            </div>

            <div className="hidden gap-3 rounded-[26px] border border-white/10 bg-white/[0.03] p-4 min-[720px]:grid min-[720px]:grid-cols-2">
              {heroStats.map((stat) => (
                <div key={stat.label} className="rounded-[20px] border border-white/8 bg-[#0f1528]/70 px-4 py-4">
                  <div className="text-xl font-extrabold text-white sm:text-2xl">{stat.value}</div>
                  <div className="mt-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mt-14 grid gap-6 lg:grid-cols-[0.9fr_1.1fr]" id="live-demo">
          <div className="rounded-[28px] border border-white/10 bg-white/[0.03] px-6 py-8 shadow-[0_30px_90px_-60px_rgba(15,23,42,1)] sm:px-8">
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-200/85">Try it live</div>
            <h2 className="mt-3 text-2xl font-bold text-white sm:text-3xl">See the operator workflow before you commit to it</h2>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
              Create a monitor, run an immediate check, and watch rendered content, SEO, performance and waterfall evidence land in one review surface.
            </p>

            <div className="mt-6 space-y-3">
              {workflowSteps.map((step) => (
                <div key={step.step} className="rounded-[22px] border border-white/10 bg-white/[0.04] px-4 py-4">
                  <div className="flex items-start gap-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-400/25 to-indigo-500/25 text-sm font-bold text-white">
                      {step.step}
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-white">{step.title}</div>
                      <div className="mt-1 text-sm leading-7 text-slate-300">{step.body}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05)_0%,rgba(255,255,255,0.03)_100%)] px-6 py-8 shadow-[0_30px_90px_-60px_rgba(15,23,42,1)] sm:px-8">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Demo route</div>
                <div className="mt-1 text-lg font-bold text-white">Preview sample monitoring data on a real property</div>
              </div>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-300">
                No login needed
              </span>
            </div>

            <div className="mt-5 rounded-2xl border border-white/10 bg-[#12182c] p-4">
              <div className="flex flex-col gap-3 sm:flex-row">
                <input
                  type="text"
                  readOnly
                  value="https://status-beacon.com"
                  className="min-w-0 flex-1 rounded-xl border border-white/10 bg-[#0f1528] px-4 py-4 text-base text-slate-200 outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowDemoSnapshot((current) => !current)}
                  aria-expanded={showDemoSnapshot}
                  aria-controls="demo-monitoring-snapshot"
                  className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 px-6 py-4 text-base font-semibold text-white transition hover:from-indigo-400 hover:to-violet-400"
                >
                  {showDemoSnapshot ? 'Hide demo data' : 'View demo data'}
                </button>
              </div>
            </div>

            {showDemoSnapshot ? (
              <div id="demo-monitoring-snapshot" className="mt-5 rounded-[24px] border border-sky-300/15 bg-sky-400/10 p-4 sm:p-5">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-sky-100">Demo monitoring snapshot</div>
                    <div className="mt-1 text-lg font-bold text-white">Sample output from a real monitoring run</div>
                  </div>
                  <div className="text-sm text-sky-100/90">Public preview only. Full drill-down stays inside the dashboard.</div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  {demoSnapshotMetrics.map((item) => (
                    <div key={item.label} className="rounded-[20px] border border-white/10 bg-[#0f1528]/65 px-4 py-4">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">{item.label}</div>
                      <div className="mt-2 text-2xl font-extrabold tracking-tight text-white">{item.value}</div>
                      <div className="mt-2 text-sm leading-6 text-slate-300">{item.body}</div>
                    </div>
                  ))}
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {demoSnapshotFindings.map((item) => (
                    <div key={item.title} className="rounded-[20px] border border-white/10 bg-[#0f1528]/65 px-4 py-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-semibold text-white">{item.title}</div>
                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-300">
                          {item.status}
                        </span>
                      </div>
                      <div className="mt-2 text-sm leading-6 text-slate-300">{item.body}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded-[22px] border border-white/10 bg-white/[0.04] px-4 py-4">
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Rendered checks</div>
                <div className="mt-2 text-lg font-bold text-white">DOM + No-JS</div>
                <div className="mt-1 text-sm leading-6 text-slate-300">Compare visible text in the rendered page and the fallback document.</div>
              </div>
              <div className="rounded-[22px] border border-white/10 bg-white/[0.04] px-4 py-4">
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">SEO audit</div>
                <div className="mt-2 text-lg font-bold text-white">Quality-first</div>
                <div className="mt-1 text-sm leading-6 text-slate-300">Surface canonical, social metadata, viewport and indexability issues from one run.</div>
              </div>
              <div className="rounded-[22px] border border-white/10 bg-white/[0.04] px-4 py-4">
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Alert routing</div>
                <div className="mt-2 text-lg font-bold text-white">Readable signal</div>
                <div className="mt-1 text-sm leading-6 text-slate-300">Send clear, operator-focused messages by email or Telegram without losing context.</div>
              </div>
            </div>
          </div>
        </section>

        <section id="features" className="mt-16">
          <div className="text-center">
            <h2 className="text-3xl font-bold text-white sm:text-4xl">Complete Website Monitoring Platform</h2>
            <p className="mx-auto mt-5 max-w-4xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
              Status Beacon provides comprehensive monitoring across six specialized categories. From uptime and rendered content to performance budgets, network visibility, and alert routing.
            </p>
          </div>

          <div className="mt-10 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {monitoringCategories.map((category) => (
              <div key={category.title} className="rounded-[26px] border border-white/10 bg-white/[0.04] p-6 shadow-[0_28px_70px_-56px_rgba(15,23,42,1)] transition hover:border-indigo-400/30 hover:bg-white/[0.05]">
                <div className="mb-5 h-12 w-12 rounded-2xl bg-gradient-to-br from-indigo-500/25 to-violet-500/20" />
                <h3 className="text-[1.35rem] font-bold text-white sm:text-2xl">{category.title}</h3>
                <div className="mt-5 space-y-3">
                  {category.items.map((item) => (
                    <div key={item} className="flex items-start gap-3 text-sm text-slate-300">
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-violet-400" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-16">
          <div className="text-center">
            <h2 className="text-3xl font-bold text-white sm:text-4xl">Why Choose Status Beacon</h2>
          </div>

          <div className="mt-10 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {whyChoose.map((item) => (
              <div key={item.title} className="rounded-[24px] border border-white/10 bg-white/[0.04] p-6 shadow-[0_24px_70px_-52px_rgba(15,23,42,1)]">
                <div className="mb-5 h-11 w-11 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-violet-500/20" />
                <h3 className="text-[1.35rem] font-bold text-white sm:text-2xl">{item.title}</h3>
                <p className="mt-4 text-sm leading-7 text-slate-300 sm:text-base sm:leading-8">{item.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="pricing" className="mt-16">
          <div className="text-center">
            <h2 className="text-3xl font-bold text-white sm:text-4xl">Subscriptions</h2>
            <p className="mx-auto mt-5 max-w-4xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
              Pick a plan here, then complete Stripe checkout from the billing workspace after sign in. Existing customers manage upgrades and cancellations through the same billing surface.
            </p>
          </div>

          <div className="mt-10 grid gap-6 xl:grid-cols-3">
            {subscriptionPlans.map((plan) => (
              <div
                key={plan.id}
                className={`rounded-[26px] border p-6 shadow-[0_28px_70px_-56px_rgba(15,23,42,1)] ${
                  plan.featured
                    ? 'border-indigo-300/30 bg-gradient-to-br from-indigo-500/12 to-violet-500/10'
                    : 'border-white/10 bg-white/[0.04]'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[1.35rem] font-bold text-white sm:text-2xl">{plan.name}</div>
                    <div className="mt-2 text-sm leading-7 text-slate-300">{plan.description}</div>
                  </div>
                  {plan.featured ? <span className="rounded-full bg-indigo-500 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-white">Most popular</span> : null}
                </div>

                <div className="mt-5 flex items-end gap-1">
                  <span className="text-4xl font-extrabold text-white">{plan.price}</span>
                  <span className="pb-1 text-sm text-slate-400">{plan.cadence}</span>
                </div>

                <div className="mt-5 space-y-3">
                  {plan.features.map((feature) => (
                    <div key={feature} className="flex items-start gap-3 text-sm text-slate-300">
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-violet-400" />
                      <span>{feature}</span>
                    </div>
                  ))}
                </div>

                <Link
                  to={planHref(plan.id)}
                  className={`mt-6 inline-flex w-full items-center justify-center rounded-xl px-5 py-3 text-sm font-semibold transition ${
                    plan.featured
                      ? 'bg-gradient-to-r from-indigo-500 to-violet-500 text-white hover:from-indigo-400 hover:to-violet-400'
                      : 'border border-white/10 bg-white/[0.03] text-slate-100 hover:border-white/20 hover:bg-white/[0.06]'
                  }`}
                >
                  {plan.ctaLabel}
                </Link>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-16 rounded-[28px] border border-white/10 bg-white/[0.03] px-6 py-10 text-center shadow-[0_28px_80px_-58px_rgba(15,23,42,1)] sm:px-10">
          <h2 className="text-3xl font-bold text-white sm:text-4xl">Open-source, community supported</h2>
          <p className="mx-auto mt-5 max-w-4xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
            Status Beacon is designed to stay transparent, readable, and self-host friendly. Teams can inspect the stack, run it on their own infrastructure, and keep operational monitoring close to the rest of their product tooling.
          </p>
        </section>

        <section id="security" className="mt-16">
          <div className="text-center">
            <h2 className="text-3xl font-bold text-white sm:text-4xl">Security & Privacy First</h2>
          </div>

          <div className="mt-10 grid gap-6 lg:grid-cols-2">
            {privacyColumns.map((column) => (
              <div key={column.title} className="rounded-[26px] border border-white/10 bg-white/[0.04] p-7 shadow-[0_24px_70px_-52px_rgba(15,23,42,1)]">
                <h3 className="text-[1.35rem] font-bold text-white sm:text-2xl">{column.title}</h3>
                <div className="mt-5 space-y-3 text-sm text-slate-300 sm:text-base">
                  {column.items.map((item) => (
                    <div key={item} className="flex items-start gap-3">
                      <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-violet-400" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <footer className="mt-16 border-t border-white/10 py-8 text-slate-400">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <BrandMark className="h-12 w-12 rounded-2xl" />
              <div className="mt-3 text-sm font-semibold text-white">Status Beacon</div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Monitoring cockpit</div>
              <div className="mt-2 text-sm">© 2026</div>
            </div>
            <div className="flex flex-wrap gap-5 text-sm">
              <a href="#live-demo" className="transition hover:text-white">
                Try it live
              </a>
              <a href="#features" className="transition hover:text-white">
                Features
              </a>
              <a href="#pricing" className="transition hover:text-white">
                Pricing
              </a>
              {footerLinks.map((link) => (
                <Link key={link.label} to={link.href} className="transition hover:text-white">
                  {link.label}
                </Link>
              ))}
              <a href="https://github.com/FoxVR-sudo/status-beacon" className="transition hover:text-white">
                GitHub
              </a>
            </div>
          </div>
          <p className="mt-5 text-sm">Monitor only assets you own or are explicitly authorized to test.</p>
        </footer>

        {showCookieNotice ? (
          <div className="fixed inset-x-4 bottom-4 z-20 mx-auto max-w-[740px] rounded-2xl border border-white/10 bg-[#11172b]/95 px-5 py-4 shadow-[0_30px_100px_-55px_rgba(0,0,0,1)] backdrop-blur-xl">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="text-lg font-semibold text-white">This site uses cookies</div>
                <p className="mt-1 max-w-2xl text-sm leading-7 text-slate-300">
                  We use cookies to improve your experience, remember preferences, and personalize content. By continuing to use this site, you agree to our privacy and service terms.
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <button
                  type="button"
                  onClick={() => dismissCookieNotice('declined')}
                  className="rounded-xl px-4 py-2 text-sm text-slate-300 transition hover:bg-white/[0.04] hover:text-white"
                >
                  Decline
                </button>
                <button
                  type="button"
                  onClick={() => dismissCookieNotice('accepted')}
                  className="rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:from-indigo-400 hover:to-violet-400"
                >
                  Accept
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}