import { useId } from 'react'

type BrandMarkProps = {
  className?: string
  title?: string
}

export function BrandMark({ className = 'h-10 w-10 rounded-[18px]', title = 'Status Beacon logo' }: BrandMarkProps) {
  const gradientId = useId().replace(/:/g, '')
  const glowId = useId().replace(/:/g, '')

  return (
    <svg viewBox="0 0 64 64" className={className} fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label={title}>
      <defs>
        <linearGradient id={gradientId} x1="10" y1="9" x2="54" y2="56" gradientUnits="userSpaceOnUse">
          <stop stopColor="#38bdf8" />
          <stop offset="0.5" stopColor="#6366f1" />
          <stop offset="1" stopColor="#8b5cf6" />
        </linearGradient>
        <radialGradient id={glowId} cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(32 20) rotate(90) scale(32)">
          <stop stopColor="#38bdf8" stopOpacity="0.34" />
          <stop offset="1" stopColor="#38bdf8" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect x="4" y="4" width="56" height="56" rx="18" fill="#081226" />
      <rect x="4" y="4" width="56" height="56" rx="18" fill={`url(#${glowId})`} />
      <path d="M32 18a5 5 0 1 0 0 10a5 5 0 0 0 0-10Z" fill={`url(#${gradientId})`} />
      <path d="M32 29.5V44.5" stroke="white" strokeWidth="3.4" strokeLinecap="round" />
      <path d="M23.5 38.5c2.1-2.5 5.2-4 8.5-4s6.4 1.5 8.5 4" stroke={`url(#${gradientId})`} strokeWidth="3" strokeLinecap="round" />
      <path d="M18.5 45c3.5-4.1 8.5-6.5 13.5-6.5S42 40.9 45.5 45" stroke={`url(#${gradientId})`} strokeWidth="3" strokeLinecap="round" opacity="0.9" />
      <path d="M24 48.5H40" stroke="white" strokeOpacity="0.55" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  )
}