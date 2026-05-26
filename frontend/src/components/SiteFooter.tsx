import { Link } from 'react-router-dom'
import { BrandMark } from './BrandLogo'

type FooterMode = 'marketing' | 'app'

type FooterLink = {
  label: string
  href: string
  kind: 'route' | 'anchor'
}

type FooterGroup = {
  title: string
  links: FooterLink[]
}

const footerGroups: Record<FooterMode, FooterGroup[]> = {
  marketing: [
    {
      title: 'Platform',
      links: [
        { label: 'Try it live', href: '/#live-demo', kind: 'anchor' },
        { label: 'Features', href: '/#features', kind: 'anchor' },
        { label: 'Pricing', href: '/#pricing', kind: 'anchor' },
        { label: 'Security', href: '/#security', kind: 'anchor' },
      ],
    },
    {
      title: 'Access',
      links: [
        { label: 'Sign in', href: '/login', kind: 'route' },
        { label: 'Create account', href: '/register', kind: 'route' },
        { label: 'Dashboard', href: '/dashboard', kind: 'route' },
      ],
    },
    {
      title: 'Workspace',
      links: [
        { label: 'Monitor settings', href: '/settings', kind: 'route' },
        { label: 'Monitoring cockpit', href: '/dashboard', kind: 'route' },
        { label: 'Home', href: '/', kind: 'route' },
      ],
    },
  ],
  app: [
    {
      title: 'Workspace',
      links: [
        { label: 'Dashboard', href: '/dashboard', kind: 'route' },
        { label: 'Settings', href: '/settings', kind: 'route' },
        { label: 'Marketing site', href: '/', kind: 'route' },
      ],
    },
    {
      title: 'Explore',
      links: [
        { label: 'Try it live', href: '/#live-demo', kind: 'anchor' },
        { label: 'Features', href: '/#features', kind: 'anchor' },
        { label: 'Pricing', href: '/#pricing', kind: 'anchor' },
        { label: 'Security', href: '/#security', kind: 'anchor' },
      ],
    },
    {
      title: 'Operations',
      links: [
        { label: 'Monitoring dashboard', href: '/dashboard', kind: 'route' },
        { label: 'Billing & plans', href: '/settings#billing', kind: 'anchor' },
        { label: 'Alert routing', href: '/settings#notifications', kind: 'anchor' },
      ],
    },
  ],
}

interface SiteFooterProps {
  mode?: FooterMode
}

export default function SiteFooter({ mode = 'marketing' }: SiteFooterProps) {
  const year = new Date().getFullYear()

  return (
    <footer className="mt-10 rounded-2xl border border-slate-200/80 bg-slate-950 px-6 py-8 text-white shadow-[0_20px_70px_-40px_rgba(2,6,23,0.8)] sm:px-8">
      <div className="grid gap-6 lg:grid-cols-[1.25fr_0.75fr_0.75fr_0.75fr]">
        <div>
          <BrandMark className="h-12 w-12 rounded-lg" />
          <p className="mt-2 max-w-sm text-xs leading-5 text-slate-400">
            Cleaner website monitoring for teams that need readable incident signal, rendered content checks and fast alert routing.
          </p>
        </div>

        {footerGroups[mode].map((group) => (
          <div key={group.title}>
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-200">{group.title}</div>
            <div className="mt-3 space-y-2 text-xs text-slate-400">
              {group.links.map((link) =>
                link.kind === 'route' ? (
                  <Link key={link.label} to={link.href} className="block transition hover:text-white">
                    {link.label}
                  </Link>
                ) : (
                  <a key={link.label} href={link.href} className="block transition hover:text-white">
                    {link.label}
                  </a>
                ),
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-col gap-1 border-t border-white/10 pt-3 text-[11px] text-slate-500 sm:flex-row sm:items-center sm:justify-between">
        <div>© {year} status-beacon.com</div>
        <div>Website monitoring with rendered text, SSL checks and fast alerts</div>
      </div>
    </footer>
  )
}