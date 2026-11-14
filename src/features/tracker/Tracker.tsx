import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Kanban,
  List as ListIcon,
  Search,
  Plus,
  Clock,
  Trash2,
  ExternalLink,
  RotateCcw,
  Building2,
  AlertCircle,
  Loader2,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Modal } from '../../components/Modal'
import { EmptyState } from '../../components/EmptyState'

const STATUSES = ['saved', 'applied', 'interview', 'offer', 'rejected'] as const
type ApplicationStatus = (typeof STATUSES)[number]

interface Application {
  id: string
  job_id: string | null
  company: string
  role: string
  notes: string
  status: ApplicationStatus
  applied_at: string | null
  created_at: string
  updated_at: string
}

interface StatusHistory {
  id: string
  from_status: ApplicationStatus | null
  to_status: ApplicationStatus
  changed_at: string
}

const statusLabels: Record<ApplicationStatus, string> = {
  saved: 'Saved',
  applied: 'Applied',
  interview: 'Interview',
  offer: 'Offer',
  rejected: 'Rejected',
}

const statusTheme: Record<
  ApplicationStatus,
  { bg: string; border: string; headerBg: string; text: string; badge: 'saved' | 'applied' | 'interview' | 'offer' | 'rejected' }
> = {
  saved: {
    bg: 'bg-slate-50/70',
    border: 'border-slate-200/80',
    headerBg: 'bg-slate-100',
    text: 'text-slate-700',
    badge: 'saved',
  },
  applied: {
    bg: 'bg-blue-50/40',
    border: 'border-blue-200/70',
    headerBg: 'bg-blue-100/70',
    text: 'text-blue-800',
    badge: 'applied',
  },
  interview: {
    bg: 'bg-purple-50/40',
    border: 'border-purple-200/70',
    headerBg: 'bg-purple-100/70',
    text: 'text-purple-800',
    badge: 'interview',
  },
  offer: {
    bg: 'bg-emerald-50/40',
    border: 'border-emerald-200/70',
    headerBg: 'bg-emerald-100/70',
    text: 'text-emerald-800',
    badge: 'offer',
  },
  rejected: {
    bg: 'bg-rose-50/30',
    border: 'border-rose-200/60',
    headerBg: 'bg-rose-100/60',
    text: 'text-rose-800',
    badge: 'rejected',
  },
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export default function Tracker() {
  const navigate = useNavigate()
  const [applications, setApplications] = useState<Application[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [viewMode, setViewMode] = useState<'board' | 'list'>('board')

  // Add application modal state
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [company, setCompany] = useState('')
  const [role, setRole] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  // Delete modal state
  const [deleteTarget, setDeleteTarget] = useState<Application | null>(null)
  const [deleting, setDeleting] = useState(false)

  // History modal state
  const [historyFor, setHistoryFor] = useState<Application | null>(null)
  const [history, setHistory] = useState<StatusHistory[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')

  // Undo state
  const [undo, setUndo] = useState<{
    applicationId: string
    previousStatus: ApplicationStatus
    nextStatus: ApplicationStatus
    timeLeft: number
  } | null>(null)

  const undoTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    let mounted = true

    async function loadApplications() {
      setLoading(true)
      setError('')
      const { data, error: fetchError } = await supabase
        .from('applications')
        .select(
          'id, job_id, company, role, notes, status, applied_at, created_at, updated_at',
        )
        .order('updated_at', { ascending: false })

      if (!mounted) return
      if (fetchError) {
        setError('Unable to load your application tracker. Please try again.')
      } else {
        setApplications((data ?? []) as Application[])
      }
      setLoading(false)
    }

    void loadApplications()
    return () => {
      mounted = false
      if (undoTimer.current) clearInterval(undoTimer.current)
    }
  }, [])

  function startUndoCountdown(applicationId: string, previousStatus: ApplicationStatus, nextStatus: ApplicationStatus) {
    if (undoTimer.current) clearInterval(undoTimer.current)
    setUndo({ applicationId, previousStatus, nextStatus, timeLeft: 8 })

    undoTimer.current = setInterval(() => {
      setUndo((current) => {
        if (!current || current.timeLeft <= 1) {
          if (undoTimer.current) clearInterval(undoTimer.current)
          return null
        }
        return { ...current, timeLeft: current.timeLeft - 1 }
      })
    }, 1000)
  }

  async function changeStatus(
    application: Application,
    nextStatus: ApplicationStatus,
  ) {
    if (application.status === nextStatus) return

    const previousStatus = application.status

    // Optimistic UI update
    setApplications((current) =>
      current.map((item) =>
        item.id === application.id ? { ...item, status: nextStatus } : item,
      ),
    )

    startUndoCountdown(application.id, previousStatus, nextStatus)

    const { error: updateError } = await supabase
      .from('applications')
      .update({ status: nextStatus })
      .eq('id', application.id)

    if (updateError) {
      // Rollback
      setApplications((current) =>
        current.map((item) =>
          item.id === application.id ? { ...item, status: previousStatus } : item,
        ),
      )
      setUndo(null)
      setError('Failed to update status. Please try again.')
    }
  }

  async function handleUndo() {
    if (!undo) return
    const { applicationId, previousStatus } = undo
    if (undoTimer.current) clearInterval(undoTimer.current)
    setUndo(null)

    setApplications((current) =>
      current.map((item) =>
        item.id === applicationId ? { ...item, status: previousStatus } : item,
      ),
    )

    const { error: undoError } = await supabase
      .from('applications')
      .update({ status: previousStatus })
      .eq('id', applicationId)

    if (undoError) {
      setApplications((current) =>
        current.map((item) =>
          item.id === applicationId ? { ...item, status: undo.nextStatus } : item,
        ),
      )
      setError('Failed to undo the status change. Please try again.')
    }
  }

  async function handleAddApplication(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!company.trim() || !role.trim()) return

    setSaving(true)
    setError('')

    try {
      const { data, error: insertError } = await supabase
        .from('applications')
        .insert({
          company: company.trim(),
          role: role.trim(),
          notes: notes.trim(),
          status: 'saved',
        })
        .select('id, job_id, company, role, notes, status, applied_at, created_at, updated_at')
        .single()

      if (insertError || !data) throw insertError || new Error('Could not save application')

      setApplications((current) => [data as Application, ...current])
      setCompany('')
      setRole('')
      setNotes('')
      setAddModalOpen(false)
    } catch {
      setError('Unable to add application to tracker.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget) return
    setDeleting(true)

    const { error: deleteError } = await supabase
      .from('applications')
      .delete()
      .eq('id', deleteTarget.id)

    if (deleteError) {
      setError('Unable to delete this application.')
      setDeleting(false)
      return
    }

    setApplications((current) =>
      current.filter((item) => item.id !== deleteTarget.id),
    )
    if (historyFor?.id === deleteTarget.id) setHistoryFor(null)
    setDeleting(false)
    setDeleteTarget(null)
  }

  async function openHistory(application: Application) {
    setHistoryFor(application)
    setHistory([])
    setHistoryError('')
    setHistoryLoading(true)

    const { data, error: fetchError } = await supabase
      .from('application_status_history')
      .select('id, from_status, to_status, changed_at')
      .eq('application_id', application.id)
      .order('changed_at', { ascending: false })

    if (fetchError) {
      setHistoryError('Unable to load status history.')
    } else {
      setHistory((data ?? []) as StatusHistory[])
    }
    setHistoryLoading(false)
  }

  const filteredApplications = applications.filter((app) => {
    if (!searchQuery.trim()) return true
    const q = searchQuery.toLowerCase()
    return (
      app.company.toLowerCase().includes(q) ||
      app.role.toLowerCase().includes(q) ||
      app.notes.toLowerCase().includes(q)
    )
  })

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* Top Header Card */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-200/80">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
              <Kanban className="h-3.5 w-3.5" />
            </span>
            <span className="text-xs font-bold uppercase tracking-wider text-blue-600">
              Application Pipeline
            </span>
          </div>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            Application Tracker
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-slate-500">
            Track applications from Saved to Offer with instant one-click status transitions.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* View Mode Toggle */}
          <div className="flex rounded-xl bg-slate-100 p-1 border border-slate-200/60">
            <button
              type="button"
              onClick={() => setViewMode('board')}
              aria-label="Kanban board view"
              className={`rounded-lg p-2 text-xs font-semibold transition-all cursor-pointer ${
                viewMode === 'board'
                  ? 'bg-white text-blue-700 shadow-xs'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <Kanban className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              aria-label="Table list view"
              className={`rounded-lg p-2 text-xs font-semibold transition-all cursor-pointer ${
                viewMode === 'list'
                  ? 'bg-white text-blue-700 shadow-xs'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <ListIcon className="h-4 w-4" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => setAddModalOpen(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white shadow-md shadow-blue-600/20 hover:bg-blue-700 transition-all cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            <span>Add Application</span>
          </button>
        </div>
      </div>

      {/* Filter & Metric Summary Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        {/* Search Input */}
        <div className="relative flex-1 max-w-md">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-400">
            <Search className="h-4 w-4" />
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search company or role title..."
            className="w-full rounded-xl border border-slate-300 bg-white py-2 pl-10 pr-4 text-xs text-slate-900 placeholder-slate-400 focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-100 transition-colors"
          />
        </div>

        {/* Status Count Pills */}
        <div className="flex flex-wrap items-center gap-2">
          {STATUSES.map((status) => {
            const count = applications.filter((a) => a.status === status).length
            return (
              <span
                key={status}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 shadow-2xs"
              >
                <span className="capitalize">{statusLabels[status]}:</span>
                <span className="font-bold text-slate-900">{count}</span>
              </span>
            )
          })}
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-semibold text-rose-800 flex items-center gap-2"
        >
          <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex min-h-[300px] flex-col items-center justify-center space-y-3">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          <p className="text-sm font-medium text-slate-500">Loading your applications...</p>
        </div>
      ) : applications.length === 0 ? (
        <EmptyState
          icon={<Kanban className="h-7 w-7 text-blue-600" />}
          title="Your pipeline is empty"
          description="Track your applications, update their interview stages, and save job opportunities in one clean dashboard."
          action={
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setAddModalOpen(true)}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white shadow-xs hover:bg-blue-700"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add Application Manually</span>
              </button>
              <button
                type="button"
                onClick={() => navigate('/app/jobs/new')}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50"
              >
                <span>Analyse a Job</span>
              </button>
            </div>
          }
        />
      ) : viewMode === 'board' ? (
        /* KANBAN BOARD VIEW */
        <div className="grid gap-5 lg:grid-cols-5 items-start overflow-x-auto pb-4">
          {STATUSES.map((status) => {
            const items = filteredApplications.filter((item) => item.status === status)
            const theme = statusTheme[status]

            return (
              <section
                key={status}
                className={`flex flex-col rounded-3xl border ${theme.border} ${theme.bg} p-4 shadow-xs min-h-[480px]`}
              >
                {/* Column Header */}
                <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-200/60">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-bold uppercase tracking-wider ${theme.text}`}>
                      {statusLabels[status]}
                    </span>
                  </div>
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-[11px] font-bold text-slate-700 shadow-2xs border border-slate-200">
                    {items.length}
                  </span>
                </div>

                {/* Cards List */}
                <div className="space-y-3 flex-1">
                  {items.map((application) => (
                    <article
                      key={application.id}
                      className="group rounded-2xl border border-slate-200/90 bg-white p-4 shadow-2xs hover:shadow-md transition-all space-y-3"
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="text-sm font-bold text-slate-900 group-hover:text-blue-600 transition-colors">
                            {application.role}
                          </h3>
                        </div>
                        <p className="text-xs font-semibold text-slate-600 flex items-center gap-1.5 mt-1">
                          <Building2 className="h-3 w-3 text-slate-400" />
                          <span>{application.company}</span>
                        </p>
                      </div>

                      {application.notes && (
                        <p className="text-[11px] text-slate-500 line-clamp-2 leading-relaxed bg-slate-50 p-2 rounded-lg border border-slate-100">
                          {application.notes}
                        </p>
                      )}

                      {/* Status Selector Dropdown */}
                      <div>
                        <select
                          aria-label={`Change status for ${application.role} at ${application.company}`}
                          value={application.status}
                          onChange={(e) =>
                            void changeStatus(application, e.target.value as ApplicationStatus)
                          }
                          className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-white focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100 transition-colors cursor-pointer"
                        >
                          {STATUSES.map((option) => (
                            <option key={option} value={option}>
                              Move to {statusLabels[option]}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Footer Actions */}
                      <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-[11px]">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void openHistory(application)}
                            title="View Status History"
                            className="inline-flex items-center gap-1 font-semibold text-slate-500 hover:text-blue-600 transition-colors cursor-pointer"
                          >
                            <Clock className="h-3 w-3" />
                            <span>History</span>
                          </button>

                          {application.job_id && (
                            <button
                              type="button"
                              onClick={() => navigate(`/app/jobs/${application.job_id}`)}
                              title="Open Job Match"
                              className="inline-flex items-center gap-0.5 font-semibold text-blue-600 hover:underline cursor-pointer"
                            >
                              <span>Analysis</span>
                              <ExternalLink className="h-2.5 w-2.5" />
                            </button>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => setDeleteTarget(application)}
                          title="Delete application"
                          className="text-slate-400 hover:text-rose-600 p-1 rounded transition-colors cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </article>
                  ))}

                  {items.length === 0 && (
                    <div className="flex h-32 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200/80 p-4 text-center">
                      <p className="text-xs text-slate-400 italic">No applications in {statusLabels[status]}</p>
                    </div>
                  )}
                </div>
              </section>
            )
          })}
        </div>
      ) : (
        /* TABLE / LIST VIEW */
        <div className="rounded-3xl border border-slate-200/80 bg-white shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-700">
              <thead className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-6 py-4">Role & Company</th>
                  <th className="px-6 py-4">Current Status</th>
                  <th className="px-6 py-4">Notes</th>
                  <th className="px-6 py-4">Last Updated</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredApplications.map((application) => (
                  <tr key={application.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-bold text-slate-900">{application.role}</div>
                      <div className="text-slate-500 font-medium">{application.company}</div>
                    </td>
                    <td className="px-6 py-4">
                      <select
                        value={application.status}
                        onChange={(e) =>
                          void changeStatus(application, e.target.value as ApplicationStatus)
                        }
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-800 cursor-pointer shadow-2xs"
                      >
                        {STATUSES.map((option) => (
                          <option key={option} value={option}>
                            {statusLabels[option]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-6 py-4 max-w-xs truncate text-slate-500">
                      {application.notes || '—'}
                    </td>
                    <td className="px-6 py-4 text-slate-400">
                      {formatDate(application.updated_at)}
                    </td>
                    <td className="px-6 py-4 text-right space-x-3">
                      {application.job_id && (
                        <button
                          type="button"
                          onClick={() => navigate(`/app/jobs/${application.job_id}`)}
                          className="font-semibold text-blue-600 hover:underline"
                        >
                          Analysis
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void openHistory(application)}
                        className="font-semibold text-slate-600 hover:text-slate-900"
                      >
                        History
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(application)}
                        className="font-semibold text-rose-600 hover:text-rose-800"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Floating Undo Snackbar Toast */}
      {undo && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-4 rounded-2xl bg-slate-950 px-5 py-3.5 text-xs text-white shadow-2xl border border-slate-800 animate-in fade-in slide-in-from-bottom-4 duration-200"
        >
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 rounded-full bg-blue-400 animate-ping" />
            <span>
              Moved to <strong>{statusLabels[undo.nextStatus]}</strong>
            </span>
          </div>

          <button
            type="button"
            onClick={() => void handleUndo()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1 font-bold text-white hover:bg-blue-500 transition-colors cursor-pointer"
          >
            <RotateCcw className="h-3 w-3" />
            <span>Undo ({undo.timeLeft}s)</span>
          </button>
        </div>
      )}

      {/* Add Application Modal */}
      <Modal
        isOpen={addModalOpen}
        onClose={() => !saving && setAddModalOpen(false)}
        title="Add Application to Tracker"
        description="Record an application in your pipeline to track interviews and follow-ups."
      >
        <form onSubmit={handleAddApplication} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 mb-1.5">
              Company *
            </label>
            <input
              required
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="e.g. Stripe, Monzo, Google"
              className="w-full rounded-xl border border-slate-300 p-2.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-100"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 mb-1.5">
              Role Title *
            </label>
            <input
              required
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="e.g. Senior Frontend Engineer"
              className="w-full rounded-xl border border-slate-300 p-2.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-100"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 mb-1.5">
              Notes & Next Steps
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="e.g. Referral from Jane, salary range £85k, stage 2 technical round on Thursday"
              className="w-full rounded-xl border border-slate-300 p-2.5 text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-100 leading-relaxed"
            />
          </div>

          <div className="flex justify-end gap-3 pt-3">
            <button
              type="button"
              disabled={saving}
              onClick={() => setAddModalOpen(false)}
              className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !company.trim() || !role.trim()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
            >
              {saving ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <Plus className="h-3.5 w-3.5" />
                  <span>Add to Tracker</span>
                </>
              )}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={Boolean(deleteTarget)}
        onClose={() => !deleting && setDeleteTarget(null)}
        title="Delete Application"
        description={
          deleteTarget
            ? `Are you sure you want to delete ${deleteTarget.role} at ${deleteTarget.company} from your pipeline?`
            : ''
        }
      >
        <div className="space-y-4">
          <p className="text-xs text-slate-500 leading-relaxed">
            This will permanently remove this application and its status change history from your tracker.
          </p>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              disabled={deleting}
              onClick={() => setDeleteTarget(null)}
              className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={deleting}
              onClick={() => void handleDeleteConfirm()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-rose-700 disabled:opacity-50 cursor-pointer"
            >
              {deleting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Deleting...</span>
                </>
              ) : (
                <>
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Confirm Delete</span>
                </>
              )}
            </button>
          </div>
        </div>
      </Modal>

      {/* Status History Slide-over / Modal */}
      <Modal
        isOpen={Boolean(historyFor)}
        onClose={() => setHistoryFor(null)}
        title="Status History"
        description={historyFor ? `${historyFor.role} at ${historyFor.company}` : ''}
      >
        <div className="space-y-4">
          {historyLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
            </div>
          ) : historyError ? (
            <p className="text-xs font-semibold text-rose-600">{historyError}</p>
          ) : history.length === 0 ? (
            <p className="text-xs text-slate-400 italic py-4 text-center">
              No status changes recorded yet.
            </p>
          ) : (
            <ol className="space-y-4 py-2">
              {history.map((item) => (
                <li key={item.id} className="relative pl-6 pb-4 border-l-2 border-blue-200 last:border-l-transparent last:pb-0">
                  <div className="absolute -left-1.5 top-0.5 h-3 w-3 rounded-full bg-blue-600 border-2 border-white" />
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs font-bold text-slate-900">
                      {item.from_status ? (
                        <>
                          <span className="text-slate-500 font-medium">{statusLabels[item.from_status]}</span>
                          <span className="mx-1 text-slate-400">→</span>
                        </>
                      ) : (
                        <span className="text-slate-400 font-normal">Initial: </span>
                      )}
                      <span className="text-blue-700">{statusLabels[item.to_status]}</span>
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">
                    {formatDate(item.changed_at)}
                  </p>
                </li>
              ))}
            </ol>
          )}

          <div className="flex justify-end pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setHistoryFor(null)}
              className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Close
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
