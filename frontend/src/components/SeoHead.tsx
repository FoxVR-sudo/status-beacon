import { Helmet } from 'react-helmet-async'
import { useLocation } from 'react-router-dom'


type SeoConfig = {
  title: string
  description: string
  image?: string
  type?: string
  jsonLd?: Record<string, any>
}

const DEFAULT_SEO: SeoConfig = {
  title: 'status-beacon.com — Website Monitoring',
  description:
    'Status Beacon monitors uptime, SSL, rendered content, and performance with clear operational alerts and dashboards.',
  image: 'https://status-beacon.com/og-image.png',
  type: 'website',
  jsonLd: {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    url: 'https://status-beacon.com/',
    name: 'status-beacon.com — Website Monitoring',
    description: 'Status Beacon monitors uptime, SSL, rendered content, and performance with clear operational alerts and dashboards.',
    publisher: {
      '@type': 'Organization',
      name: 'Status Beacon',
    },
  },
}

const SEO_BY_PATH: Record<string, SeoConfig> = {
  '/': {
    title: 'status-beacon.com — Website Monitoring',
    description:
      'Production-ready website monitoring for uptime, SSL, rendered content, performance, and incident alerts in one workspace.',
    image: 'https://status-beacon.com/og-image.png',
    type: 'website',
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      url: 'https://status-beacon.com/',
      name: 'status-beacon.com — Website Monitoring',
      description: 'Production-ready website monitoring for uptime, SSL, rendered content, performance, and incident alerts in one workspace.',
      publisher: {
        '@type': 'Organization',
        name: 'Status Beacon',
      },
    },
  },
  '/login': {
    title: 'Sign In — Status Beacon',
    description: 'Sign in to your Status Beacon workspace and manage website monitoring, alerts, and incident visibility.',
    image: 'https://status-beacon.com/og-image.png',
    type: 'website',
  },
  '/register': {
    title: 'Create Account — Status Beacon',
    description: 'Create a Status Beacon account and start monitoring uptime, SSL, and rendered page health in minutes.',
    image: 'https://status-beacon.com/og-image.png',
    type: 'website',
  },
  '/forgot-password': {
    title: 'Forgot Password — Status Beacon',
    description: 'Request a secure password reset link for your Status Beacon account.',
    image: 'https://status-beacon.com/og-image.png',
    type: 'website',
  },
  '/reset-password': {
    title: 'Reset Password — Status Beacon',
    description: 'Set a new password for your Status Beacon account securely.',
    image: 'https://status-beacon.com/og-image.png',
    type: 'website',
  },
  '/verify-email': {
    title: 'Verify Email — Status Beacon',
    description: 'Verify your email address to activate your Status Beacon account.',
    image: 'https://status-beacon.com/og-image.png',
    type: 'website',
  },
  '/dashboard': {
    title: 'Dashboard — Status Beacon',
    description: 'Track monitor health, incidents, response time, SEO checks, and alert status from your monitoring dashboard.',
    image: 'https://status-beacon.com/og-image.png',
    type: 'website',
  },
  '/settings': {
    title: 'Settings — Status Beacon',
    description: 'Manage monitors, alert channels, profile settings, and account preferences in Status Beacon.',
    image: 'https://status-beacon.com/og-image.png',
    type: 'website',
  },
  '/admin': {
    title: 'Admin — Status Beacon',
    description: 'Admin workspace for user and website management in Status Beacon.',
    image: 'https://status-beacon.com/og-image.png',
    type: 'website',
  },
}

export default function SeoHead() {
  const location = useLocation()
  const seo = SEO_BY_PATH[location.pathname] ?? DEFAULT_SEO
  const canonical = `https://status-beacon.com${location.pathname === '/' ? '/' : location.pathname}`

  return (
    <Helmet>
      <title>{seo.title}</title>
      <meta name="description" content={seo.description} />
      <link rel="canonical" href={canonical} />
      {/* Open Graph Meta Tags */}
      <meta property="og:title" content={seo.title} />
      <meta property="og:description" content={seo.description} />
      <meta property="og:type" content={seo.type || 'website'} />
      <meta property="og:url" content={canonical} />
      {seo.image && <meta property="og:image" content={seo.image} />}
      {/* Twitter Card Meta Tags */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={seo.title} />
      <meta name="twitter:description" content={seo.description} />
      {seo.image && <meta name="twitter:image" content={seo.image} />}
      {/* Structured Data (JSON-LD) */}
      {seo.jsonLd && (
        <script type="application/ld+json">
          {JSON.stringify(seo.jsonLd)}
        </script>
      )}
    </Helmet>
  )
}
