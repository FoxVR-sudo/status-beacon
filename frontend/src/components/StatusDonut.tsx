interface StatusDonutProps {
  healthy: number
  issues: number
  theme?: 'light' | 'dark'
}

export default function StatusDonut({ healthy, issues, theme = 'light' }: StatusDonutProps) {
  const total = healthy + issues
  const healthyRatio = total === 0 ? 0 : healthy / total
  const radius = 44
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - healthyRatio)
  const issueRatio = total === 0 ? 0 : issues / total
  const issueOffset = circumference * (1 - issueRatio)
  const isDark = theme === 'dark'

  return (
    <div className="flex items-center gap-5">
      <div className="relative h-32 w-32 shrink-0">
        <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
          <defs>
            <linearGradient id="status-donut-health" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0%" stopColor="#a5b4fc" />
              <stop offset="100%" stopColor="#6366f1" />
            </linearGradient>
            <linearGradient id="status-donut-issues" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0%" stopColor="#fbbf24" />
              <stop offset="100%" stopColor="#fb7185" />
            </linearGradient>
          </defs>
          <circle cx="60" cy="60" r={radius} fill="none" stroke={isDark ? 'rgba(99,102,241,0.22)' : 'rgba(148,163,184,0.14)'} strokeWidth="12" />
          {issues > 0 ? (
            <circle
              cx="60"
              cy="60"
              r={radius}
              fill="none"
              stroke="url(#status-donut-issues)"
              strokeWidth="12"
              strokeDasharray={circumference}
              strokeDashoffset={issueOffset}
              strokeLinecap="round"
              opacity="0.5"
            />
          ) : null}
          <circle
            cx="60"
            cy="60"
            r={radius}
            fill="none"
            stroke="url(#status-donut-health)"
            strokeWidth="12"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
          />
        </svg>
        <div className={`absolute inset-[18px] flex flex-col items-center justify-center rounded-full border shadow-[0_14px_35px_-22px_rgba(15,23,42,0.35)] ${
          isDark ? 'border-indigo-400/30 bg-[#141b37] text-white' : 'border-white/70 bg-white/90 text-slate-900'
        }`}>
          <div className={`text-2xl font-extrabold tracking-tight ${isDark ? 'text-white' : 'text-slate-900'}`}>{total === 0 ? '--' : `${Math.round(healthyRatio * 100)}%`}</div>
          <div className={`text-[11px] uppercase tracking-[0.22em] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>healthy</div>
        </div>
      </div>

      <div className={`space-y-3 text-sm ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
        <div className="flex items-center gap-3">
          <span className="h-2.5 w-2.5 rounded-full bg-indigo-400" />
          <span>{healthy} healthy monitors</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
          <span>{issues} requiring attention</span>
        </div>
        <div className={`rounded-2xl px-3 py-3 text-xs leading-5 ${isDark ? 'border border-indigo-400/20 bg-[#121a34] text-slate-400' : 'bg-slate-50 text-slate-500'}`}>
          Healthy share and issue pressure update automatically from the live monitor mix.
        </div>
      </div>
    </div>
  )
}