import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { authApi } from '../api/auth'

export default function VerifyEmail() {
  const [searchParams] = useSearchParams()
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [message, setMessage] = useState('')

  useEffect(() => {
    const token = searchParams.get('token')
    if (!token) {
      setStatus('error')
      setMessage('Verification token is missing.')
      return
    }

    void (async () => {
      try {
        const result = await authApi.verifyEmail(token)
        setStatus('success')
        setMessage(result.message)
      } catch (err: unknown) {
        const detail =
          (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
          ?? 'Email verification failed.'
        setStatus('error')
        setMessage(detail)
      }
    })()
  }, [searchParams])

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-200 w-full max-w-md">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Email verification</h1>
        {status === 'loading' ? (
          <p className="text-sm text-gray-500">Verifying your email...</p>
        ) : (
          <div className={`rounded-lg px-4 py-3 text-sm ${status === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
            {message}
          </div>
        )}

        <p className="text-center text-sm text-gray-500 mt-6">
          <Link to="/login" className="text-blue-600 hover:underline">
            Go to sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
