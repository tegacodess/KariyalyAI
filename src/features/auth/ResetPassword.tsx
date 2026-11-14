import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Lock, Mail, Loader2, ArrowRight } from 'lucide-react'
import { supabase } from '../../lib/supabase'

export default function ResetPassword() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [recoverySession, setRecoverySession] = useState(() =>
    window.location.hash.includes('type=recovery'),
  )

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setRecoverySession(true)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function requestReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setMessage('')
    setLoading(true)

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email,
      { redirectTo: `${window.location.origin}/reset-password` },
    )

    setLoading(false)

    if (resetError) {
      setError(resetError.message)
      return
    }

    setMessage('Check your email for a password reset link.')
  }

  async function updatePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setMessage('')

    if (password.length < 8) {
      setError('Your password must be at least 8 characters.')
      return
    }

    if (password !== confirmPassword) {
      setError('The passwords do not match.')
      return
    }

    setLoading(true)
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setLoading(false)

    if (updateError) {
      setError(updateError.message)
      return
    }

    setMessage('Your password has been updated. You can now sign in.')
    setPassword('')
    setConfirmPassword('')
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-12">
      <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          {recoverySession ? 'Set a new password' : 'Reset your password'}
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          {recoverySession
            ? 'Choose a new password for your KariyalyAI account.'
            : 'We will email you a secure link to choose a new password.'}
        </p>

        {(error || message) && (
          <div
            role={error ? 'alert' : 'status'}
            className={`mt-6 rounded-xl border p-4 text-sm ${
              error
                ? 'border-rose-200 bg-rose-50 text-rose-800'
                : 'border-emerald-200 bg-emerald-50 text-emerald-800'
            }`}
          >
            {error || message}
          </div>
        )}

        {recoverySession ? (
          <form onSubmit={updatePassword} className="mt-6 space-y-4">
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700">
              New password
              <div className="relative mt-1.5">
                <Lock className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4 text-slate-400" />
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="new-password"
                  required
                  className="w-full rounded-xl border border-slate-300 py-3 pl-10 pr-4 text-sm focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-100"
                />
              </div>
            </label>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700">
              Confirm password
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
                required
                className="mt-1.5 w-full rounded-xl border border-slate-300 py-3 px-4 text-sm focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-100"
              />
            </label>
            <button
              type="submit"
              disabled={loading}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              Update password
            </button>
          </form>
        ) : (
          <form onSubmit={requestReset} className="mt-6 space-y-4">
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700">
              Account email
              <div className="relative mt-1.5">
                <Mail className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4 text-slate-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  required
                  placeholder="name@example.com"
                  className="w-full rounded-xl border border-slate-300 py-3 pl-10 pr-4 text-sm focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-100"
                />
              </div>
            </label>
            <button
              type="submit"
              disabled={loading}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
              Email reset link
            </button>
          </form>
        )}

        <button
          type="button"
          onClick={() => navigate('/login')}
          className="mt-6 w-full text-center text-sm font-semibold text-blue-600 hover:underline"
        >
          Back to sign in
        </button>
        <p className="mt-3 text-center text-xs text-slate-500">
          <Link to="/signup" className="font-semibold text-blue-600 hover:underline">
            Create an account
          </Link>
        </p>
      </section>
    </main>
  )
}
