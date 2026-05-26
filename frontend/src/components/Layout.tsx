import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { type FormEvent, useEffect, useState } from 'react'
import { BrandMark } from './BrandLogo'
import { useAuthStore } from '../store/authStore'

export default function Layout() {
  const { logout } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()
  const [headerSearch, setHeaderSearch] = useState('')
  const sectionLinks = [
    { label: 'Monitors', href: '/settings#monitor-editor' },
    { label: 'Billing', href: '/settings#billing' },
    { label: 'Notifications', href: '/settings#notifications' },
    { label: 'Admin', href: '/admin' },
    { label: 'Pricing', href: '/#pricing' },
  ]

  const pageMeta = location.pathname.startsWith('/settings')
    ? {
        title: 'Settings',
        subtitle: 'Control monitor configuration, Telegram delivery, alert routing and account-side operational settings without leaving the product workspace.',
      }
    : {
        title: 'Dashboard',
        subtitle: 'Track uptime, SSL, rendered content changes and runtime evidence from one calmer monitoring workspace.',
      }

    useEffect(() => {
      const currentQuery = new URLSearchParams(location.search).get('q') ?? ''
      setHeaderSearch(currentQuery)
    }, [location.pathname, location.search])

    function applyHeaderSearch(value: string) {
      const trimmed = value.trim()
      const nextParams = new URLSearchParams()
      if (trimmed.length > 0) {
        nextParams.set('q', trimmed)
      }

      const search = nextParams.toString()
      navigate(
        {
          pathname: '/dashboard',
          search: search.length > 0 ? `?${search}` : '',
        },
        { replace: true },
      )
    }

    function handleHeaderSearchSubmit(event: FormEvent<HTMLFormElement>) {
      event.preventDefault()
      applyHeaderSearch(headerSearch)
    }

    function handleHeaderSearchClear() {
      setHeaderSearch('')
      navigate('/dashboard', { replace: true })
    }

  function handleLogout() {
    logout()
    navigate('/')
  }

  return (
    <div className="analytics-shell relative min-h-screen overflow-hidden bg-[#0b1020] text-slate-900">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(99,102,241,0.2),_transparent_34%),radial-gradient(circle_at_18%_86%,_rgba(6,182,212,0.12),_transparent_38%),radial-gradient(circle_at_84%_84%,_rgba(139,92,246,0.13),_transparent_36%)]" />
      <div className="mx-auto max-w-[1480px] px-4 py-5 sm:px-6 lg:px-8">
        <header className="rounded-[30px] border border-slate-900/70 bg-[#071120]/92 px-5 py-4 text-slate-100 shadow-[0_28px_90px_-48px_rgba(2,6,23,0.88)] backdrop-blur lg:px-7 lg:py-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-4">
              <Link to="/dashboard" className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 transition hover:border-white/20 hover:bg-white/[0.06]">
                <BrandMark className="h-7 w-7 rounded-lg" />
                <span>
                  <span className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-200/80">Status Beacon</span>
                  <span className="text-[11px] text-slate-400">Monitor workspace</span>
                </span>
              </Link>

              <nav className="inline-flex flex-wrap items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] p-1">
                <NavLink
                  to="/dashboard"
                  className={({ isActive }) =>
                    `inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition ${
                      isActive
                        ? 'bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-[0_14px_30px_-18px_rgba(79,70,229,0.95)]'
                        : 'text-slate-300 hover:text-white'
                    }`
                  }
                >
                  <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M3 4.5h5.5V10H3zM11.5 4.5H17V7h-5.5zM11.5 10H17v5.5h-5.5zM3 12.5h5.5V17H3z" />
                  </svg>
                  <span>Dashboard</span>
                </NavLink>
                <NavLink
                  to="/settings"
                  className={({ isActive }) =>
                    `inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition ${
                      isActive
                        ? 'bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-[0_14px_30px_-18px_rgba(79,70,229,0.95)]'
                        : 'text-slate-300 hover:text-white'
                    }`
                  }
                >
                  <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M10 2.5v2.2m0 10.6v2.2M4.7 4.7l1.6 1.6m7.4 7.4 1.6 1.6M2.5 10h2.2m10.6 0h2.2M4.7 15.3l1.6-1.6m7.4-7.4 1.6-1.6" />
                    <circle cx="10" cy="10" r="3.2" />
                  </svg>
                  <span>Settings</span>
                </NavLink>
              </nav>
            </div>

            <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
              <form onSubmit={handleHeaderSearchSubmit} className="flex min-w-[220px] items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-slate-400">
                <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="9" cy="9" r="5.5" />
                  <path d="M13.5 13.5 17 17" />
                </svg>
                <input
                  type="text"
                  placeholder="Search monitors..."
                  value={headerSearch}
                  onChange={(event) => setHeaderSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      applyHeaderSearch(headerSearch)
                    }
                  }}
                  className="w-full border-none bg-transparent text-xs text-slate-100 outline-none placeholder:text-slate-500"
                />
                {headerSearch.trim().length > 0 ? (
                  <button
                    type="button"
                    onClick={handleHeaderSearchClear}
                    className="rounded-md border border-white/10 px-2 py-0.5 text-[10px] font-semibold text-slate-300 transition hover:border-white/20 hover:text-white"
                  >
                    Clear
                  </button>
                ) : null}
                <button
                  type="submit"
                  onClick={() => applyHeaderSearch(headerSearch)}
                  className="rounded-md border border-white/10 px-2 py-0.5 text-[10px] font-semibold text-slate-300 transition hover:border-white/20 hover:text-white"
                >
                  Go
                </button>
              </form>

              <Link
                to="/"
                className="inline-flex items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-xs font-semibold text-slate-300 transition hover:border-white/20 hover:text-white"
              >
                Public
              </Link>

              <button
                onClick={handleLogout}
                className="inline-flex items-center justify-center rounded-lg border border-rose-400/20 bg-rose-400/10 px-2.5 py-1.5 text-xs font-semibold text-rose-300 transition hover:border-rose-400/30 hover:text-rose-100"
              >
                Exit
              </button>
            </div>
          </div>

          <div className="mt-3 flex flex-col gap-3 border-t border-white/10 pt-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-200/80">Workspace</div>
              <h1 className="mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">{pageMeta.title}</h1>
              <p className="mt-0.5 max-w-3xl text-xs leading-5 text-slate-400">{pageMeta.subtitle}</p>
            </div>

            <div className="flex flex-wrap gap-1.5 text-[10px] font-semibold text-slate-300">
              {sectionLinks.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 transition hover:border-white/20 hover:bg-white/[0.05] hover:text-white"
                >
                  {link.label}
                </a>
              ))}
            </div>
          </div>
        </header>

        <main className="analytics-workspace mt-6 min-w-0">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
