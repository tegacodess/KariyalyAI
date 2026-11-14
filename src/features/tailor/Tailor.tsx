import { useEffect, useState } from 'react'
import {
  Sparkles,
  RefreshCw,
  FileText,
  Download,
  Cloud,
  CloudOff,
  Loader2,
  Lightbulb,
} from 'lucide-react'
import { callAI } from '../../lib/ai'
import { copy } from '../../lib/copy'
import { supabase } from '../../lib/supabase'
import type { ProfileForAI, Tone } from '../../../shared/schema'
import { Badge } from '../../components/Badge'
import { CopyButton } from '../../components/CopyButton'

type OutputKind = 'cv_summary' | 'cover_letter'
type SaveState = 'saved' | 'saving' | 'error'

interface JobData {
  id: string
  title: string
  company: string
  description_text: string
}

interface TailorContent {
  cv_summary?: string
  cover_letter?: string
  key_changes?: string[]
}

interface GeneratedOutput {
  id: string
  kind: OutputKind
  content: unknown
  edited_content: string | null
  meta: unknown
  created_at: string
}

interface EditableOutput {
  id: string
  text: string
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }

  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>

    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
      .join(',')}}`
  }

  return JSON.stringify(value)
}

async function createInputHash(task: string, input: unknown): Promise<string> {
  const encoded = new TextEncoder().encode(`${task}:${stableStringify(input)}`)
  const digest = await crypto.subtle.digest('SHA-256', encoded)

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function readContent(content: unknown, kind: OutputKind): string {
  if (typeof content === 'string') return content

  if (content && typeof content === 'object') {
    const value = content as TailorContent & {
      text?: string
      content?: string
    }

    if (typeof value[kind] === 'string') return value[kind]
    if (typeof value.text === 'string') return value.text
    if (typeof value.content === 'string') return value.content
  }

  return ''
}

function readKeyChanges(content: unknown): string[] {
  if (!content || typeof content !== 'object') return []

  const keyChanges = (content as TailorContent).key_changes
  return Array.isArray(keyChanges)
    ? keyChanges.filter((change): change is string => typeof change === 'string')
    : []
}

function readTone(meta: unknown): Tone | null {
  if (!meta || typeof meta !== 'object') return null

  const value = (meta as { tone?: unknown }).tone
  return value === 'professional' || value === 'friendly' || value === 'concise'
    ? value
    : null
}

interface TailorProps {
  jobId: string
}

export default function Tailor({ jobId }: TailorProps) {
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [tone, setTone] = useState<Tone>('professional')

  const [profile, setProfile] = useState<ProfileForAI | null>(null)
  const [job, setJob] = useState<JobData | null>(null)
  const [summary, setSummary] = useState<EditableOutput | null>(null)
  const [coverLetter, setCoverLetter] = useState<EditableOutput | null>(null)
  const [savedSummary, setSavedSummary] = useState('')
  const [savedCoverLetter, setSavedCoverLetter] = useState('')
  const [summarySaveState, setSummarySaveState] = useState<SaveState>('saved')
  const [coverLetterSaveState, setCoverLetterSaveState] =
    useState<SaveState>('saved')
  const [keyChanges, setKeyChanges] = useState<string[]>([])

  useEffect(() => {
    let active = true

    async function loadData() {
      setLoading(true)
      setError('')

      try {
        const [jobResult, profileResult, outputsResult] = await Promise.all([
          supabase
            .from('jobs')
            .select('id, title, company, description_text')
            .eq('id', jobId)
            .single(),
          supabase
            .from('profiles')
            .select(
              'full_name, summary, skills, experience, education, target_roles',
            )
            .maybeSingle(),
          supabase
            .from('generated_outputs')
            .select('id, kind, content, edited_content, meta, created_at')
            .eq('job_id', jobId)
            .in('kind', ['cv_summary', 'cover_letter'])
            .order('created_at', { ascending: false }),
        ])

        if (jobResult.error) throw jobResult.error
        if (profileResult.error) throw profileResult.error
        if (outputsResult.error) throw outputsResult.error
        if (!jobResult.data) throw new Error('We could not find this job.')
        if (!profileResult.data) {
          throw new Error(
            'Create your professional profile before tailoring your application.',
          )
        }

        const profileData: ProfileForAI = {
          full_name: profileResult.data.full_name ?? '',
          summary: profileResult.data.summary ?? '',
          skills: profileResult.data.skills ?? [],
          experience: profileResult.data.experience ?? [],
          education: profileResult.data.education ?? [],
          target_roles: profileResult.data.target_roles ?? [],
        }

        if (!active) return

        setJob(jobResult.data)
        setProfile(profileData)

        const outputs = (outputsResult.data ?? []) as GeneratedOutput[]
        const savedCv = outputs.find((output) => output.kind === 'cv_summary')
        const savedLetter = outputs.find(
          (output) => output.kind === 'cover_letter',
        )
        const firstOutput = savedCv ?? savedLetter
        const savedTone = firstOutput ? readTone(firstOutput.meta) : null

        if (savedTone) setTone(savedTone)
        if (savedCv) {
          const text =
            savedCv.edited_content ??
            readContent(savedCv.content, 'cv_summary')
          setSummary({ id: savedCv.id, text })
          setSavedSummary(text)
          setKeyChanges(readKeyChanges(savedCv.content))
        }
        if (savedLetter) {
          const text =
            savedLetter.edited_content ??
            readContent(savedLetter.content, 'cover_letter')
          setCoverLetter({ id: savedLetter.id, text })
          setSavedCoverLetter(text)
          if (!savedCv) setKeyChanges(readKeyChanges(savedLetter.content))
        }
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error
              ? err.message
              : 'Unable to load the tailoring workspace.',
          )
        }
      } finally {
        if (active) setLoading(false)
      }
    }

    void loadData()
    return () => {
      active = false
    }
  }, [jobId])

  function downloadCoverLetter() {
    if (!coverLetter?.text.trim()) return

    const blob = new Blob([coverLetter.text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${job?.company || 'job'}-cover-letter.txt`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  async function generate(force = false) {
    if (!profile || !job) return

    setGenerating(true)
    setError('')
    setFeedback('')

    const input = {
      profile,
      job: {
        title: job.title,
        company: job.company,
        description: job.description_text,
      },
      tone,
    }

    try {
      const [result, inputHash] = await Promise.all([
        callAI('tailor_application', input, { force }),
        createInputHash('tailor_application', input),
      ])

      if (!result.ok) throw new Error(result.error.message)

      const content = {
        cv_summary: result.data.cv_summary,
        cover_letter: result.data.cover_letter,
        key_changes: result.data.key_changes,
      }

      const { data, error: outputError } = await supabase
        .from('generated_outputs')
        .upsert(
          [
            {
              job_id: jobId,
              kind: 'cv_summary',
              content,
              ...(force ? { edited_content: null } : {}),
              meta: { tone },
              input_hash: inputHash,
            },
            {
              job_id: jobId,
              kind: 'cover_letter',
              content,
              ...(force ? { edited_content: null } : {}),
              meta: { tone },
              input_hash: inputHash,
            },
          ],
          { onConflict: 'user_id,input_hash,kind' },
        )
        .select('id, kind, content, edited_content, meta, created_at')

      if (outputError) throw outputError

      const outputs = (data ?? []) as GeneratedOutput[]
      const savedCv = outputs.find((output) => output.kind === 'cv_summary')
      const savedLetter = outputs.find(
        (output) => output.kind === 'cover_letter',
      )

      if (!savedCv || !savedLetter) {
        throw new Error(copy.tailor.missingOutputs)
      }

      const cvText = force
        ? readContent(savedCv.content, 'cv_summary')
        : savedCv.edited_content ?? readContent(savedCv.content, 'cv_summary')
      const letterText = force
        ? readContent(savedLetter.content, 'cover_letter')
        : savedLetter.edited_content ??
          readContent(savedLetter.content, 'cover_letter')

      setSummary({ id: savedCv.id, text: cvText })
      setCoverLetter({ id: savedLetter.id, text: letterText })
      setSavedSummary(cvText)
      setSavedCoverLetter(letterText)
      setSummarySaveState('saved')
      setCoverLetterSaveState('saved')
      setKeyChanges(result.data.key_changes)
      setFeedback(copy.tailor.ready)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : copy.tailor.generationError,
      )
    } finally {
      setGenerating(false)
    }
  }

  // Autosave CV Summary edits
  useEffect(() => {
    if (!summary || summary.text === savedSummary) return

    const timeout = window.setTimeout(async () => {
      setSummarySaveState('saving')
      const { error: saveError } = await supabase
        .from('generated_outputs')
        .update({ edited_content: summary.text })
        .eq('id', summary.id)
        .eq('job_id', jobId)

      if (saveError) {
        setSummarySaveState('error')
        setError(copy.tailor.saveError)
        return
      }

      setSavedSummary(summary.text)
      setSummarySaveState('saved')
    }, 700)

    return () => window.clearTimeout(timeout)
  }, [jobId, summary, savedSummary])

  // Autosave Cover Letter edits
  useEffect(() => {
    if (!coverLetter || coverLetter.text === savedCoverLetter) return

    const timeout = window.setTimeout(async () => {
      setCoverLetterSaveState('saving')
      const { error: saveError } = await supabase
        .from('generated_outputs')
        .update({ edited_content: coverLetter.text })
        .eq('id', coverLetter.id)
        .eq('job_id', jobId)

      if (saveError) {
        setCoverLetterSaveState('error')
        setError(copy.tailor.saveError)
        return
      }

      setSavedCoverLetter(coverLetter.text)
      setCoverLetterSaveState('saved')
    }, 700)

    return () => window.clearTimeout(timeout)
  }, [jobId, coverLetter, savedCoverLetter])

  if (loading) {
    return (
      <div className="flex min-h-[300px] flex-col items-center justify-center space-y-3">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        <p className="text-sm font-medium text-slate-500">
          {copy.tailor.loading}
        </p>
      </div>
    )
  }

  if (error && !job) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center text-xs font-semibold text-rose-800">
        {error}
      </div>
    )
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* Configuration Header Card */}
      <section className="rounded-3xl border border-slate-200/80 bg-white p-6 sm:p-7 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-1 max-w-xl">
            <div className="flex items-center gap-2">
              <Badge variant="ai" size="sm">
                {copy.tailor.aiLabel}
              </Badge>
              <span className="text-xs text-slate-500">
                Tailored for {job?.title} at {job?.company}
              </span>
            </div>
            <h2 className="text-xl font-bold text-slate-900 pt-1">
              {copy.tailor.title}
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
              Generate an aligned CV profile summary and a custom cover letter based purely on your real profile facts.
            </p>
          </div>

          {/* Tone Selector Pills */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <div className="flex rounded-xl bg-slate-100 p-1 border border-slate-200/60">
              {(['professional', 'friendly', 'concise'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTone(t)}
                  disabled={generating}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition-all cursor-pointer ${
                    tone === t
                      ? 'bg-white text-blue-700 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => void generate(Boolean(summary || coverLetter))}
              disabled={generating}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white shadow-md shadow-blue-600/20 hover:bg-blue-700 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 transition-all cursor-pointer"
            >
              {generating ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>{summary ? copy.tailor.regenerating : copy.tailor.generating}</span>
                </>
              ) : (
                <>
                  {summary ? (
                    <RefreshCw className="h-3.5 w-3.5" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  <span>{summary ? copy.tailor.regenerate : copy.tailor.generate}</span>
                </>
              )}
            </button>
          </div>
        </div>

        {feedback && (
          <p className="mt-3 text-xs font-semibold text-emerald-700 animate-in fade-in">
            {feedback}
          </p>
        )}
        {error && (
          <p className="mt-3 text-xs font-semibold text-rose-700 animate-in fade-in">
            {error}
          </p>
        )}
      </section>

      {/* Empty State before first generation */}
      {!summary && !coverLetter && !generating && (
        <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center sm:p-14">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 border border-blue-100 mb-3">
            <FileText className="h-6 w-6" />
          </div>
          <h3 className="text-base font-bold text-slate-900">
            No tailored content generated yet
          </h3>
          <p className="mt-1.5 max-w-md text-xs sm:text-sm text-slate-500 leading-relaxed">
            {copy.tailor.generatePrompt}
          </p>
          <button
            type="button"
            onClick={() => void generate(false)}
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-xs font-semibold text-white shadow-xs hover:bg-blue-700 cursor-pointer"
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>Generate CV Summary & Letter</span>
          </button>
        </div>
      )}

      {/* Editor Cards */}
      <div className="space-y-6">
        {/* CV Summary Editor Card */}
        {summary && (
          <article className="rounded-3xl border border-slate-200/80 bg-white p-6 sm:p-8 shadow-xs space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
                  <FileText className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    {copy.tailor.summaryTitle}
                  </h3>
                  <span className="text-[11px] text-slate-400">
                    Editable profile highlight · Autosaves as you type
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400">
                  {summarySaveState === 'saving' ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
                      <span>Saving...</span>
                    </>
                  ) : summarySaveState === 'error' ? (
                    <>
                      <CloudOff className="h-3 w-3 text-rose-500" />
                      <span className="text-rose-600">Save failed</span>
                    </>
                  ) : (
                    <>
                      <Cloud className="h-3 w-3 text-emerald-500" />
                      <span className="text-emerald-700">Saved</span>
                    </>
                  )}
                </span>

                <CopyButton text={summary.text} size="sm" label="Copy Summary" />
              </div>
            </div>

            <textarea
              value={summary.text}
              onChange={(event) => {
                setSummary({ ...summary, text: event.target.value })
                setSummarySaveState('saving')
              }}
              rows={5}
              aria-label={copy.tailor.summaryTitle}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50/40 p-4 text-xs sm:text-sm text-slate-800 focus:bg-white focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-100 transition-all leading-relaxed font-sans"
            />
          </article>
        )}

        {/* Cover Letter Editor Card */}
        {coverLetter && (
          <article className="rounded-3xl border border-slate-200/80 bg-white p-6 sm:p-8 shadow-xs space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700">
                  <FileText className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    {copy.tailor.coverLetterTitle}
                  </h3>
                  <span className="text-[11px] text-slate-400">
                    Full tailored letter · Autosaves as you type
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400">
                  {coverLetterSaveState === 'saving' ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
                      <span>Saving...</span>
                    </>
                  ) : coverLetterSaveState === 'error' ? (
                    <>
                      <CloudOff className="h-3 w-3 text-rose-500" />
                      <span className="text-rose-600">Save failed</span>
                    </>
                  ) : (
                    <>
                      <Cloud className="h-3 w-3 text-emerald-500" />
                      <span className="text-emerald-700">Saved</span>
                    </>
                  )}
                </span>

                <div className="flex items-center gap-2">
                  <CopyButton text={coverLetter.text} size="sm" label="Copy Letter" />
                  <button
                    type="button"
                    onClick={downloadCoverLetter}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>Download</span>
                  </button>
                </div>
              </div>
            </div>

            <textarea
              value={coverLetter.text}
              onChange={(event) => {
                setCoverLetter({ ...coverLetter, text: event.target.value })
                setCoverLetterSaveState('saving')
              }}
              rows={14}
              aria-label={copy.tailor.coverLetterTitle}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50/40 p-4 text-xs sm:text-sm text-slate-800 focus:bg-white focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-100 transition-all leading-relaxed font-sans"
            />
          </article>
        )}

        {/* Key Changes Highlights Card */}
        {keyChanges.length > 0 && (
          <section className="rounded-3xl border border-blue-200/80 bg-blue-50/40 p-6 sm:p-7 shadow-xs space-y-3">
            <div className="flex items-center gap-2">
              <Lightbulb className="h-4.5 w-4.5 text-blue-600" />
              <h3 className="text-sm font-bold text-slate-900">
                {copy.tailor.keyChangesTitle}
              </h3>
            </div>
            <ul className="space-y-2 text-xs sm:text-sm text-slate-700">
              {keyChanges.map((change, index) => (
                <li key={`${change}-${index}`} className="flex items-start gap-2.5 leading-relaxed">
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-600 mt-2 shrink-0" />
                  <span>{change}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}
