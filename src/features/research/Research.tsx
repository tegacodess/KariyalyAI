import { useEffect, useState } from 'react'
import {
  Search,
  Building2,
  ExternalLink,
  Sparkles,
  HelpCircle,
  Newspaper,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  BookmarkCheck,
} from 'lucide-react'
import type { TaskOutput } from '../../../shared/schema'
import { callAI } from '../../lib/ai'
import { supabase } from '../../lib/supabase'
import { Badge } from '../../components/Badge'

interface ResearchProps {
  jobId: string
  company: string
  role: string
  sourceUrl: string | null
}

type CompanyBriefOutput = TaskOutput<'company_brief'>

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

async function inputHash(input: unknown) {
  const encoded = new TextEncoder().encode(
    `company_brief:${stableStringify(input)}`,
  )
  const digest = await crypto.subtle.digest('SHA-256', encoded)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

const FALLBACK_NOTICE: Record<string, string> = {
  disabled: 'Live search is switched off.',
  quota: "Today's live search limit has been reached.",
  error: 'Live search did not respond in time.',
  no_results: 'Live search found no sources for this company.',
}

export default function Research({
  jobId,
  company,
  role,
  sourceUrl,
}: ResearchProps) {
  const [aboutText, setAboutText] = useState('')
  const [brief, setBrief] = useState<CompanyBriefOutput | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true

    // Load the most recent brief for this job. The pasted About text is not kept
    // between visits, so looking the brief up by its input hash would never match.
    async function loadSaved() {
      const { data, error: loadError } = await supabase
        .from('generated_outputs')
        .select('content')
        .eq('job_id', jobId)
        .eq('kind', 'company_brief')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (active && !loadError && data?.content) {
        setBrief(data.content as CompanyBriefOutput)
      }
      if (active) setLoading(false)
    }

    void loadSaved()
    return () => {
      active = false
    }
  }, [jobId])

  async function generate() {
    const input = {
      company,
      role,
      ...(aboutText.trim() ? { about_text: aboutText.trim() } : {}),
      ...(sourceUrl ? { url: sourceUrl } : {}),
    }

    setGenerating(true)
    setError('')

    try {
      const [result, hash] = await Promise.all([
        callAI('company_brief', input, { force: true }),
        inputHash(input),
      ])

      if (!result.ok) throw new Error(result.error.message)

      const { error: saveError } = await supabase.from('generated_outputs').upsert(
        {
          job_id: jobId,
          kind: 'company_brief',
          content: result.data,
          input_hash: hash,
          meta: { grounded: result.data.grounded },
        },
        { onConflict: 'user_id,input_hash,kind' },
      )

      if (saveError) throw saveError
      setBrief(result.data)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to research this company.',
      )
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* Research Configuration Card */}
      <section className="rounded-3xl border border-slate-200/80 bg-white p-6 sm:p-8 shadow-xs space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                <Search className="h-3.5 w-3.5" />
              </span>
              <span className="text-xs font-bold uppercase tracking-wider text-blue-600">
                Google Search Grounded Research
              </span>
            </div>
            <h2 className="mt-1.5 text-xl font-bold tracking-tight text-slate-900">
              Research {company || 'Employer'}
            </h2>
            <p className="mt-1 text-xs sm:text-sm text-slate-500">
              Gather live intelligence on company operations, culture, talking points, and verified recent news.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void generate()}
            disabled={generating}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-xs font-semibold text-white shadow-md shadow-blue-600/20 hover:bg-blue-700 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 transition-all cursor-pointer shrink-0"
          >
            {generating ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Researching Company...</span>
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5" />
                <span>{brief ? 'Refresh Research' : 'Run Company Research'}</span>
              </>
            )}
          </button>
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 mb-1.5">
            About text (Optional pasted fallback)
          </label>
          <textarea
            value={aboutText}
            onChange={(event) => setAboutText(event.target.value)}
            rows={3}
            placeholder="Paste text from the company's About or Careers page if search grounding is unavailable..."
            className="w-full rounded-2xl border border-slate-300 p-3.5 text-xs text-slate-800 placeholder-slate-400 focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-100 transition-colors leading-relaxed"
          />
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-semibold text-rose-800 flex items-center gap-2"
          >
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </section>

      {loading && (
        <div className="flex min-h-[250px] flex-col items-center justify-center space-y-3">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          <p className="text-sm font-medium text-slate-500">Loading saved research...</p>
        </div>
      )}

      {/* Render Brief Results */}
      {brief && (
        <div className="space-y-6 animate-in fade-in duration-300">
          {/* Header Card */}
          <section className="rounded-3xl border border-slate-200/80 bg-white p-6 sm:p-8 shadow-xs space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 font-bold">
                  <Building2 className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">{company}</h3>
                  <p className="text-xs text-slate-500">Intelligence Dossier</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="ai" size="sm">
                  AI-generated, please verify
                </Badge>
                {brief.grounded ? (
                  <Badge variant="success" size="sm" icon={<CheckCircle2 className="h-3 w-3" />}>
                    Grounded Live Search
                  </Badge>
                ) : (
                  <Badge variant="warning" size="sm" icon={<AlertTriangle className="h-3 w-3" />}>
                    No live search
                  </Badge>
                )}
                <Badge variant="neutral" size="sm">
                  Confidence: {brief.confidence}
                </Badge>
              </div>
            </div>

            {!brief.grounded && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 text-xs text-amber-900 leading-relaxed">
                {FALLBACK_NOTICE[brief.fallback_reason ?? 'error']} This brief has no recent
                news. It uses only the company name, the role and any About text you pasted.
              </div>
            )}

            <div className="pt-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                What They Do
              </h4>
              <p className="text-xs sm:text-sm text-slate-700 leading-relaxed">
                {brief.what_they_do}
              </p>
            </div>
          </section>

          {/* Cards Grid: Talking Points & Questions */}
          <div className="grid gap-6 md:grid-cols-2">
            {/* Talking Points */}
            <section className="rounded-3xl border border-slate-200/80 bg-white p-6 sm:p-7 shadow-xs space-y-3">
              <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
                <BookmarkCheck className="h-4 w-4 text-blue-600" />
                <h4>Interview Talking Points</h4>
              </div>
              {brief.talking_points.length > 0 ? (
                <ul className="space-y-2.5 text-xs sm:text-sm text-slate-700">
                  {brief.talking_points.map((point, index) => (
                    <li key={index} className="flex items-start gap-2.5 leading-relaxed">
                      <span className="h-1.5 w-1.5 rounded-full bg-blue-600 mt-2 shrink-0" />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-400 italic">No talking points provided.</p>
              )}
            </section>

            {/* Questions to Ask */}
            <section className="rounded-3xl border border-slate-200/80 bg-white p-6 sm:p-7 shadow-xs space-y-3">
              <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
                <HelpCircle className="h-4 w-4 text-indigo-600" />
                <h4>Questions to Ask the Interviewer</h4>
              </div>
              {brief.questions_to_ask.length > 0 ? (
                <ul className="space-y-2.5 text-xs sm:text-sm text-slate-700">
                  {brief.questions_to_ask.map((q, index) => (
                    <li key={index} className="flex items-start gap-2.5 leading-relaxed">
                      <span className="h-1.5 w-1.5 rounded-full bg-indigo-600 mt-2 shrink-0" />
                      <span>{q}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-400 italic">No suggested questions available.</p>
              )}
            </section>
          </div>

          {/* Values & News Grid */}
          <div className="grid gap-6 md:grid-cols-2">
            {/* Values */}
            <section className="rounded-3xl border border-slate-200/80 bg-white p-6 sm:p-7 shadow-xs space-y-3">
              <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
                <Sparkles className="h-4 w-4 text-emerald-600" />
                <h4>Company Values</h4>
              </div>
              {brief.values.length > 0 ? (
                <div className="flex flex-wrap gap-2 pt-1">
                  {brief.values.map((val, index) => (
                    <span
                      key={index}
                      className="inline-flex rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-1.5 text-xs font-semibold text-emerald-800"
                    >
                      {val}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400 italic">No stated values available.</p>
              )}
            </section>

            {/* Recent News */}
            <section className="rounded-3xl border border-slate-200/80 bg-white p-6 sm:p-7 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
                  <Newspaper className="h-4 w-4 text-blue-600" />
                  <h4>Recent Verified News</h4>
                </div>
                {brief.recent_news.length > 0 && (
                  <span className="text-[11px] font-semibold text-slate-400">
                    {brief.recent_news.length} items
                  </span>
                )}
              </div>

              {brief.recent_news.length > 0 ? (
                <div className="space-y-3">
                  {brief.recent_news.map((item, idx) => (
                    <div
                      key={idx}
                      className="rounded-2xl border border-slate-200/80 bg-slate-50/50 p-3.5 space-y-1.5"
                    >
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-bold text-slate-900 hover:text-blue-600 hover:underline flex items-center justify-between gap-2"
                      >
                        <span className="leading-snug">{item.headline}</span>
                        <ExternalLink className="h-3 w-3 shrink-0 text-slate-400" />
                      </a>
                      <div className="flex items-center gap-2 text-[11px] text-slate-500">
                        <span className="font-medium text-slate-700">{item.source}</span>
                        {item.date && <span>· {item.date}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400 italic">
                  No grounded news articles found for this company.
                </p>
              )}
            </section>
          </div>

          {/* Sources List */}
          {brief.sources.length > 0 && (
            <section className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-xs space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Grounding Verification Sources
              </h4>
              <div className="grid gap-2 sm:grid-cols-2">
                {brief.sources.map((src, index) => (
                  <a
                    key={index}
                    href={src.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs text-slate-700 hover:bg-slate-100 transition-colors"
                  >
                    <span className="truncate pr-2 font-medium">{src.title || src.url}</span>
                    <ExternalLink className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  </a>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
