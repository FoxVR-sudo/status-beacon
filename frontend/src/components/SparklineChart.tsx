import { useId } from 'react'

type Tone = 'sky' | 'emerald' | 'amber'

const tones: Record<Tone, { stroke: string; fillStart: string; fillEnd: string; glow: string; dot: string; grid: string }> = {
  sky: {
    stroke: '#818cf8',
    fillStart: 'rgba(99, 102, 241, 0.20)',
    fillEnd: 'rgba(99, 102, 241, 0.01)',
    glow: 'rgba(99, 102, 241, 0.24)',
    dot: '#a5b4fc',
    grid: 'rgba(148, 163, 184, 0.14)',
  },
  emerald: {
    stroke: '#34d399',
    fillStart: 'rgba(16, 185, 129, 0.18)',
    fillEnd: 'rgba(16, 185, 129, 0.01)',
    glow: 'rgba(16, 185, 129, 0.24)',
    dot: '#6ee7b7',
    grid: 'rgba(110, 231, 183, 0.14)',
  },
  amber: {
    stroke: '#f59e0b',
    fillStart: 'rgba(245, 158, 11, 0.18)',
    fillEnd: 'rgba(245, 158, 11, 0.01)',
    glow: 'rgba(245, 158, 11, 0.24)',
    dot: '#fcd34d',
    grid: 'rgba(245, 158, 11, 0.14)',
  },
}

interface SparklineChartProps {
  values: number[]
  tone?: Tone
  className?: string
  height?: number
  label?: string
}

export default function SparklineChart({
  values,
  tone = 'sky',
  className = 'h-24 w-full',
  height = 72,
  label = 'Trend',
}: SparklineChartProps) {
  const gradientId = useId().replace(/:/g, '')
  const palette = tones[tone]
  const sanitized = values.filter((value) => Number.isFinite(value))

  if (sanitized.length === 0) {
    return (
      <div className={`flex items-center justify-center rounded-2xl border border-indigo-400/20 bg-slate-950/35 text-xs text-slate-400 ${className}`}>
        {label} unavailable
      </div>
    )
  }

  const max = Math.max(...sanitized)
  const min = Math.min(...sanitized)
  const range = max - min || 1
  const points = sanitized.map((value, index) => {
    const x = sanitized.length === 1 ? 50 : (index / (sanitized.length - 1)) * 100
    const y = height - ((value - min) / range) * (height - 14) - 7
    return { x, y }
  })

  const polylinePoints = points.map(({ x, y }) => `${x},${y}`).join(' ')
  const areaPoints = `0,${height} ${polylinePoints} 100,${height}`
  const linePath = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ')
  const lastPoint = points[points.length - 1]
  const firstPoint = points[0]
  const midPoint = points[Math.floor(points.length / 2)]
  const gridLines = [height * 0.2, height * 0.45, height * 0.7]
  const verticalLines = [10, 30, 50, 70, 90]

  return (
    <svg viewBox={`0 0 100 ${height}`} className={className} preserveAspectRatio="none" role="img" aria-label={label}>
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={palette.fillStart} />
          <stop offset="100%" stopColor={palette.fillEnd} />
        </linearGradient>
        <filter id={`${gradientId}-glow`} x="-26%" y="-34%" width="160%" height="180%">
          <feDropShadow dx="0" dy="0" stdDeviation="2.2" floodColor={palette.glow} />
        </filter>
      </defs>
      <rect x="0" y="0" width="100" height={height} fill="rgba(15,23,42,0.12)" rx="8" />
      {verticalLines.map((line) => (
        <line key={`v-${line}`} x1={line} y1="2" x2={line} y2={height} stroke={palette.grid} strokeOpacity="0.3" strokeWidth="0.55" />
      ))}
      {gridLines.map((line) => (
        <line
          key={line}
          x1="0"
          y1={line}
          x2="100"
          y2={line}
          stroke={palette.grid}
          strokeWidth="0.8"
          strokeDasharray="2.6 4.2"
        />
      ))}
      <polygon className="sparkline-anim-area" points={areaPoints} fill={`url(#${gradientId})`} />
      <path
        className="sparkline-anim-line"
        d={linePath}
        fill="none"
        stroke={palette.stroke}
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        filter={`url(#${gradientId}-glow)`}
      />
      <circle cx={firstPoint.x} cy={firstPoint.y} r="1.6" fill={palette.stroke} opacity="0.45" />
      {points.length > 2 ? <circle cx={midPoint.x} cy={midPoint.y} r="1.9" fill={palette.dot} opacity="0.58" /> : null}
      <circle className="sparkline-anim-dot" cx={lastPoint.x} cy={lastPoint.y} r="3.8" fill={palette.glow} />
      <circle className="sparkline-anim-dot" cx={lastPoint.x} cy={lastPoint.y} r="2.1" fill={palette.dot} />
    </svg>
  )
}