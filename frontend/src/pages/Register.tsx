import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { authApi } from '../api/auth'
import TurnstileField from '../components/TurnstileField'

const planLabels = {
  free: 'Free',
  pro: 'Pro',
  agency: 'Agency',
} as const

export default function Register() {
  const [searchParams] = useSearchParams()
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [captchaToken, setCaptchaToken] = useState('')
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const selectedPlanId = searchParams.get('plan')
  const selectedPlan = selectedPlanId === 'free' || selectedPlanId === 'pro' || selectedPlanId === 'agency'
    ? planLabels[selectedPlanId]
    : null

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSuccessMessage('')
    if (!firstName.trim() || !lastName.trim()) {
      setError('First name and last name are required.')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (!captchaToken && import.meta.env.VITE_TURNSTILE_SITE_KEY) {
      setError('Complete the captcha challenge.')
      return
    }
    setLoading(true)
    try {
      const result = await authApi.register({
        email,
        password,
        firstName,
        lastName,
        companyName: companyName.trim() || undefined,
        captchaToken,
      })
      setSuccessMessage(
        selectedPlan && selectedPlanId !== 'free'
          ? `${result.message} Sign in after verification, then finish your ${selectedPlan} subscription from Billing.`
          : result.message,
      )
      setPassword('')
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        ?? 'Registration failed.'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-200 w-full max-w-md">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Create account</h1>
        <p className="text-sm text-gray-500 mb-6">Create your account and verify your email to sign in</p>

        {selectedPlan ? (
          <div className="mb-6 rounded-xl border border-sky-100 bg-sky-50 px-4 py-3 text-sm text-sky-900">
            {selectedPlanId === 'free'
              ? 'You selected the Free plan. Create your account to start monitoring immediately.'
              : `You selected the ${selectedPlan} plan. Create your account first, then complete Stripe checkout from Billing.`}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="bg-red-50 text-red-600 px-4 py-3 rounded-lg text-sm">{error}</div>
          )}
          {successMessage && (
            <div className="bg-emerald-50 text-emerald-700 px-4 py-3 rounded-lg text-sm">{successMessage}</div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">First name</label>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
                autoFocus
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="John"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Last name</label>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Doe"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Company / Agency (optional)</label>
            <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Acme Agency"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="min 8 characters"
            />
          </div>
          <TurnstileField onTokenChange={setCaptchaToken} />
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition disabled:opacity-50"
          >
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="text-center text-sm text-gray-500 mt-6">
          Already have an account?{' '}
          <Link to="/login" className="text-blue-600 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
