import { useEffect, useMemo, useRef, useState } from 'react'

type TurnstileApi = {
  render: (
    container: string | HTMLElement,
    options: {
      sitekey: string
      callback?: (token: string) => void
      'expired-callback'?: () => void
      'error-callback'?: () => void
      theme?: 'light' | 'dark' | 'auto'
    },
  ) => string
  reset: (widgetId?: string) => void
  remove?: (widgetId?: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

type TurnstileFieldProps = {
  onTokenChange: (token: string) => void
  className?: string
}

const SCRIPT_ID = 'cf-turnstile-script'
let scriptLoadPromise: Promise<void> | null = null

function ensureTurnstileScript() {
  if (window.turnstile) {
    return Promise.resolve()
  }

  if (scriptLoadPromise) {
    return scriptLoadPromise
  }

  const existing = document.getElementById(SCRIPT_ID)
  if (existing) {
    scriptLoadPromise = new Promise((resolve, reject) => {
      if (window.turnstile) {
        resolve()
        return
      }

      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('Failed to load Turnstile script.')), { once: true })
    })

    return scriptLoadPromise
  }

  scriptLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.id = SCRIPT_ID
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Failed to load Turnstile script.'))
    document.head.appendChild(script)
  })

  return scriptLoadPromise
}

export default function TurnstileField({ onTokenChange, className }: TurnstileFieldProps) {
  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY ?? ''
  const containerRef = useRef<HTMLDivElement | null>(null)
  const widgetIdRef = useRef<string | null>(null)
  const [widgetId, setWidgetId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const enabled = useMemo(() => siteKey.trim().length > 0, [siteKey])

  useEffect(() => {
    if (!enabled) {
      onTokenChange('')
      return
    }

    let cancelled = false
    setError(null)
    onTokenChange('')

    ensureTurnstileScript()
      .then(() => {
        if (cancelled || !window.turnstile || !containerRef.current) {
          return
        }

        const existingWidgetId = widgetIdRef.current
        if (existingWidgetId) {
          window.turnstile.remove?.(existingWidgetId)
          widgetIdRef.current = null
        }

        try {
          const id = window.turnstile.render(containerRef.current, {
            sitekey: siteKey,
            theme: 'light',
            callback: (token) => onTokenChange(token),
            'expired-callback': () => onTokenChange(''),
            'error-callback': () => {
              onTokenChange('')
              setError('Captcha failed to load. Please refresh and try again.')
            },
          })

          widgetIdRef.current = id
          setWidgetId(id)
        } catch {
          setError('Captcha failed to initialize. Please refresh and try again.')
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError('Captcha script could not be loaded. Please refresh and try again.')
        }
      })

    return () => {
      cancelled = true
      const existingWidgetId = widgetIdRef.current
      if (existingWidgetId && window.turnstile) {
        window.turnstile.remove?.(existingWidgetId)
      }
      widgetIdRef.current = null
    }
  }, [enabled, onTokenChange, siteKey])

  useEffect(() => {
    if (!enabled) {
      setWidgetId(null)
      setError(null)
    }
  }, [enabled])

  if (!enabled) {
    return null
  }

  return (
    <div className={className}>
      <div ref={containerRef} />
      {widgetId || error ? null : <div className="text-xs text-gray-500">Loading captcha...</div>}
      {error ? <div className="mt-2 text-xs text-red-600">{error}</div> : null}
    </div>
  )
}
