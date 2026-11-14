import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Sparkles,
  Building2,
  MapPin,
  Globe,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  HelpCircle,
  ExternalLink,
  Kanban,
  Check,
  CheckCircle2,
  ArrowLeft,
  FileText,
  Search,
  Send,
  Loader2,
  AlertTriangle,
  Lightbulb,
} from 'lucide-react'
import { copy } from '../../lib/copy'
import { supabase } from '../../lib/supabase'
import {
  evaluateWorkAuth,
  lookupUkSponsor,
  type WorkAuthResult,
} from '../../../shared/workAuth'
import Tailor from '../tailor/Tailor'
import Research from '../research/Research'
import Outreach from '../outreach/Outreach'
import { Badge } from '../../components/Badge'
import { ScoreMeter } from '../../components/ScoreMeter'

interface JobRecord {
  id: string
  title: string
  company: string
  location_text: string
  location_country: string | null
  is_remote: boolean | null
  description_text: string
  source_url: string | null
  created_at: string
}

interface Gap {
  gap: string
  suggestion: string
}

interface MatchRecord {
  score: number
  verdict: 'strong' | 'moderate' | 'weak'
  summary: string
  strengths: string[]
  gaps: Gap[]
}

const verdictDescriptions = {
  strong: 'Your profile demonstrates strong alignment with the key requirements for this position.',
  moderate: 'Your qualifications match several requirements, but there are addressable skill or experience gaps.',
  weak: 'There are notable differences between your current profile and this role’s stated prerequisites.',
}

export default function JobResults() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [job, setJob] = useState<JobRecord | null>(null)
  const [match, setMatch] = useState<MatchRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState<'match' | 'tailor' | 'research' | 'outreach'>('match')
  const [workAuth, setWorkAuth] = useState<WorkAuthResult | null>(null)
  const [savingTracker, setSavingTracker] = useState(false)
  const [trackerFeedback, setTrackerFeedback] = useState('')
  const [isSavedInTracker, setIsSavedInTracker] = useState(false)

  useEffect(() => {
    let isMounted = true

    async function loadResults() {
      if (!id) {
        setError(copy.jobs.notFound)
        setLoading(false)
        return
      }

      setLoading(true)
      setError('')

      try {
        const [jobResult, matchResult, profileResult, appResult] = await Promise.all([
          supabase
            .from('jobs')
            .select(
              'id, title, company, location_text, location_country, is_remote, description_text, source_url, created_at',
            )
            .eq('id', id)
            .maybeSingle(),
          supabase
            .from('matches')
            .select('score, verdict, summary, strengths, gaps')
            .eq('job_id', id)
            .maybeSingle(),
          supabase
            .from('profiles')
            .select('right_to_work_countries')
            .maybeSingle(),
          supabase
            .from('applications')
            .select('id')
            .eq('job_id', id)
            .maybeSingle(),
        ])

        const { data: jobData, error: jobError } = jobResult
        const { data: matchData, error: matchError } = matchResult
        const { data: profileData, error: profileError } = profileResult

        if (jobError || matchError || profileError) {
          throw jobError ?? matchError ?? profileError
        }

        if (!jobData || !matchData) {
          if (isMounted) {
            setError(copy.jobs.notFound)
            setLoading(false)
          }
          return
        }

        if (isMounted) {
          setJob(jobData as JobRecord)
          setMatch(matchData as MatchRecord)
          if (appResult?.data) {
            setIsSavedInTracker(true)
          }

          const baseResult = evaluateWorkAuth({
            locationCountry: jobData.location_country,
            isRemote: jobData.is_remote,
            rightToWorkCountries: profileData?.right_to_work_countries ?? [],
            description: jobData.description_text,
          })
          setWorkAuth(baseResult)
          setLoading(false)

          if (
            baseResult.state === 'not_checked' &&
            jobData.location_country === 'United Kingdom'
          ) {
            try {
              // An empty register would make every UK company look "not found".
              const { data: registerMeta, error: metaError } = await supabase
                .from('sponsor_register_meta')
                .select('register_date')
                .maybeSingle()

              if (metaError) throw metaError

              if (!registerMeta) {
                if (isMounted) {
                  setWorkAuth({
                    ...baseResult,
                    note: copy.workAuth.registerNotLoaded,
                  })
                }
                return
              }

              const sponsorResult = await lookupUkSponsor(
                jobData.company,
                async (company) =>
                  await supabase.rpc('match_sponsor', { q: company }),
              )
              if (isMounted) {
                setWorkAuth({
                  ...sponsorResult,
                  register_date:
                    sponsorResult.register_date ?? registerMeta.register_date,
                })
              }
            } catch {
              if (isMounted) {
                setWorkAuth({
                  ...baseResult,
                  note: copy.workAuth.sponsorError,
                })
              }
            }
          }
        }
      } catch {
        if (isMounted) {
          setError(copy.jobs.resultsError)
          setLoading(false)
        }
      }
    }

    void loadResults()

    return () => {
      isMounted = false
    }
  }, [id])

  async function saveToTracker() {
    if (!job) return

    setSavingTracker(true)
    setTrackerFeedback('')

    try {
      const { data: existing, error: existingError } = await supabase
        .from('applications')
        .select('id')
        .eq('job_id', job.id)
        .maybeSingle()

      if (existingError) throw existingError
      if (existing) {
        setIsSavedInTracker(true)
        setTrackerFeedback(copy.workAuth.alreadyTracked)
        return
      }

      const { error: saveError } = await supabase.from('applications').insert({
        job_id: job.id,
        company: job.company,
        role: job.title,
        status: 'saved',
      })

      if (saveError) throw saveError
      setIsSavedInTracker(true)
      setTrackerFeedback(copy.workAuth.savedTracker)
    } catch {
      setTrackerFeedback(copy.workAuth.trackerError)
    } finally {
      setSavingTracker(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center space-y-3">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        <p className="text-sm font-medium text-slate-500">
          {copy.jobs.loadingResults}
        </p>
      </div>
    )
  }

  if (error || !job || !match) {
    return (
      <div className="mx-auto max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-xs">
        <AlertTriangle className="mx-auto h-10 w-10 text-amber-500 mb-3" />
        <h1 className="text-lg font-bold text-slate-900">Analysis Not Found</h1>
        <p className="mt-1 text-xs text-slate-500 leading-relaxed">
          {error || copy.jobs.notFound}
        </p>
        <button
          type="button"
          onClick={() => navigate('/app/jobs/new')}
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-xs font-semibold text-white shadow-xs hover:bg-blue-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>{copy.jobs.backButton}</span>
        </button>
      </div>
    )
  }

  const getWorkAuthTheme = () => {
    if (!workAuth) return null
    switch (workAuth.state) {
      case 'likely_licensed':
      case 'no_visa_needed':
        return {
          icon: ShieldCheck,
          border: 'border-emerald-200',
          bg: 'bg-emerald-50/50',
          badge: 'success' as const,
          text: 'text-emerald-950',
          subtext: 'text-emerald-800',
        }
      case 'no_sponsorship':
        return {
          icon: ShieldX,
          border: 'border-rose-200',
          bg: 'bg-rose-50/50',
          badge: 'danger' as const,
          text: 'text-rose-950',
          subtext: 'text-rose-800',
        }
      case 'not_found':
        return {
          icon: ShieldAlert,
          border: 'border-amber-200',
          bg: 'bg-amber-50/50',
          badge: 'warning' as const,
          text: 'text-amber-950',
          subtext: 'text-amber-800',
        }
      default:
        return {
          icon: HelpCircle,
          border: 'border-slate-200',
          bg: 'bg-slate-50',
          badge: 'neutral' as const,
          text: 'text-slate-900',
          subtext: 'text-slate-600',
        }
    }
  }

  const authTheme = getWorkAuthTheme()
  const AuthIcon = authTheme?.icon ?? ShieldCheck

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* Job Header Card */}
      <section className="rounded-3xl border border-slate-200/80 bg-white p-6 sm:p-8 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
          <div className="space-y-3 max-w-2xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-800 border border-blue-100">
                <Building2 className="h-3.5 w-3.5 text-blue-600" />
                <span>{job.company || 'Company Unspecified'}</span>
              </span>

              {job.location_text && (
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                  <MapPin className="h-3.5 w-3.5 text-slate-500" />
                  <span>{job.location_text}</span>
                </span>
              )}

              {job.is_remote && (
                <Badge variant="primary" size="sm">
                  Remote Eligible
                </Badge>
              )}

              {job.source_url && (
                <a
                  href={job.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 hover:underline"
                >
                  <Globe className="h-3.5 w-3.5" />
                  <span>Original Posting</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>

            <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              {job.title || 'Untitled Role'}
            </h1>
          </div>

          {/* Quick Actions */}
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => void saveToTracker()}
              disabled={savingTracker || isSavedInTracker}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold transition-all shadow-xs cursor-pointer ${
                isSavedInTracker
                  ? 'border border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'bg-slate-900 text-white hover:bg-slate-800'
              }`}
            >
              {savingTracker ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Saving to tracker...</span>
                </>
              ) : isSavedInTracker ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-600" />
                  <span>Tracked in Pipeline</span>
                </>
              ) : (
                <>
                  <Kanban className="h-3.5 w-3.5" />
                  <span>+ Add to Tracker</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => navigate('/app/jobs/new')}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors shadow-xs"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Analyse Another</span>
            </button>
          </div>
        </div>

        {trackerFeedback && (
          <p
            role="status"
            className="mt-3 text-xs font-semibold text-emerald-700 animate-in fade-in"
          >
            {trackerFeedback}
          </p>
        )}
      </section>

      {/* Workspace Tabs */}
      <nav
        aria-label="Job decision hub sections"
        className="flex gap-2 border-b border-slate-200/80 overflow-x-auto pb-px"
      >
        {[
          { id: 'match', label: 'Match & Gap Analysis', icon: Sparkles },
          { id: 'tailor', label: 'Tailor CV & Letter', icon: FileText },
          { id: 'research', label: 'Company Research', icon: Search },
          { id: 'outreach', label: 'Outreach Generator', icon: Send },
        ].map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              aria-current={isActive ? 'page' : undefined}
              className={`group inline-flex items-center gap-2 whitespace-nowrap rounded-t-xl px-5 py-3 text-xs font-semibold transition-all border-b-2 cursor-pointer ${
                isActive
                  ? 'border-blue-600 bg-white text-blue-600 shadow-2xs'
                  : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800'
              }`}
            >
              <Icon
                className={`h-4 w-4 transition-colors ${
                  isActive ? 'text-blue-600' : 'text-slate-400 group-hover:text-slate-600'
                }`}
              />
              <span>{tab.label}</span>
            </button>
          )
        })}
      </nav>

      {/* TAB 1: Match & Gaps */}
      {activeTab === 'match' && (
        <div className="space-y-8 animate-in fade-in duration-150">
          {/* Work Authorisation Card */}
          {workAuth && (
            <section
              className={`rounded-3xl border ${authTheme?.border} ${authTheme?.bg} p-6 sm:p-7 shadow-xs space-y-4`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white shadow-2xs border border-slate-200/60">
                    <AuthIcon className="h-5 w-5 text-current" />
                  </div>
                  <div>
                    <h2 className={`text-sm font-bold ${authTheme?.text}`}>
                      {copy.workAuth.title}
                    </h2>
                    <p className={`text-xs font-semibold ${authTheme?.subtext}`}>
                      {workAuth.state === 'no_visa_needed' && copy.workAuth.noVisaNeeded}
                      {workAuth.state === 'no_sponsorship' && copy.workAuth.noSponsorship}
                      {workAuth.state === 'likely_licensed' && copy.workAuth.likelyLicensed}
                      {workAuth.state === 'not_found' && copy.workAuth.notFound}
                      {workAuth.state === 'not_checked' && copy.workAuth.notChecked}
                      {workAuth.state === 'unknown_location' && copy.workAuth.unknownLocation}
                    </p>
                  </div>
                </div>

                <Badge variant={authTheme?.badge} size="sm">
                  {workAuth.state.replace(/_/g, ' ').toUpperCase()}
                </Badge>
              </div>

              <p className="text-xs sm:text-sm text-slate-700 leading-relaxed">
                {workAuth.note}
              </p>

              {/* UK Sponsor Register Details */}
              {workAuth.matched_org && (
                <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 text-xs text-slate-800 space-y-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-bold">
                      Home Office Sponsor Match: {workAuth.matched_org}
                    </span>
                    {workAuth.similarity !== null && workAuth.similarity !== undefined && (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800">
                        {Math.round(workAuth.similarity * 100)}% Name Match
                      </span>
                    )}
                  </div>
                  {workAuth.matched_town && (
                    <p className="text-slate-500">
                      Town / Location: {workAuth.matched_town}
                    </p>
                  )}
                  {workAuth.register_date && (
                    <p className="text-slate-500">
                      Licensed sponsor register as of: {workAuth.register_date}
                    </p>
                  )}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 text-[11px] text-slate-500">
                <span>{copy.workAuth.disclaimer}</span>
                <a
                  href="https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-blue-600 hover:text-blue-700 underline flex items-center gap-1"
                >
                  <span>Verify on GOV.UK</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </section>
          )}

          {/* Match Score & Verdict Section */}
          <section className="rounded-3xl border border-slate-200/80 bg-white p-6 sm:p-8 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-8 pb-6 border-b border-slate-100">
              <div className="space-y-2 max-w-xl">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  {copy.jobs.scoreLabel} & Verdict
                </span>
                <h2 className="text-xl font-bold text-slate-900">
                  {verdictDescriptions[match.verdict]}
                </h2>
                <p className="text-xs sm:text-sm text-slate-600 leading-relaxed pt-1">
                  {match.summary}
                </p>
              </div>

              <div className="shrink-0 flex items-center justify-center">
                <ScoreMeter score={match.score} verdict={match.verdict} size="lg" />
              </div>
            </div>

            <div className="pt-4 flex items-center justify-between text-xs text-slate-400">
              <span>{copy.jobs.aiLabel}</span>
              <span>Based on candidate profile vs job description</span>
            </div>
          </section>

          {/* Strengths & Gaps Columns */}
          <div className="grid gap-6 md:grid-cols-2">
            {/* Strengths Card */}
            <section className="rounded-3xl border border-slate-200/80 bg-white p-6 sm:p-8 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                    <CheckCircle2 className="h-4 w-4" />
                  </div>
                  <h2 className="text-base font-bold text-slate-900">
                    {copy.jobs.strengthsLabel}
                  </h2>
                </div>
                <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-700">
                  {match.strengths.length} verified
                </span>
              </div>

              {match.strengths.length > 0 ? (
                <ul className="space-y-3 pt-2">
                  {match.strengths.map((strength, index) => (
                    <li
                      key={index}
                      className="flex items-start gap-3 rounded-2xl border border-emerald-100 bg-emerald-50/30 p-3.5 text-xs text-slate-800 leading-relaxed"
                    >
                      <Check className="h-4 w-4 shrink-0 text-emerald-600 mt-0.5" />
                      <span>{strength}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-500 italic">No direct strengths identified.</p>
              )}
            </section>

            {/* Gaps & Improvement Actions */}
            <section className="rounded-3xl border border-slate-200/80 bg-white p-6 sm:p-8 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                    <Lightbulb className="h-4 w-4" />
                  </div>
                  <h2 className="text-base font-bold text-slate-900">
                    {copy.jobs.gapsLabel}
                  </h2>
                </div>
                <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-bold text-amber-800">
                  {match.gaps.length} areas
                </span>
              </div>

              {match.gaps.length > 0 ? (
                <div className="space-y-3 pt-2">
                  {match.gaps.map((item, index) => (
                    <div
                      key={index}
                      className="rounded-2xl border border-amber-200/70 bg-amber-50/30 p-4 text-xs space-y-2"
                    >
                      <p className="font-semibold text-slate-900 leading-relaxed">
                        {item.gap}
                      </p>
                      <div className="rounded-xl bg-white p-3 border border-amber-100 text-slate-700 leading-relaxed">
                        <span className="font-semibold text-amber-900 block mb-1">
                          Recommended strategy:
                        </span>
                        {item.suggestion}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-500 italic">No significant gaps detected.</p>
              )}
            </section>
          </div>
        </div>
      )}

      {/* TAB 2: Tailor Application */}
      {activeTab === 'tailor' && <Tailor jobId={job.id} />}

      {/* TAB 3: Company Research */}
      {activeTab === 'research' && (
        <Research
          jobId={job.id}
          company={job.company}
          role={job.title}
          sourceUrl={job.source_url}
        />
      )}

      {/* TAB 4: Outreach */}
      {activeTab === 'outreach' && (
        <Outreach jobId={job.id} company={job.company} role={job.title} />
      )}
    </div>
  )
}
