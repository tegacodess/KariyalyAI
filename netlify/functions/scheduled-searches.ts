import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

interface ArbeitnowJob {
  slug?: string
  title?: string
  company_name?: string
  location?: string
  remote?: boolean
  url?: string
  description?: string
  tags?: string[]
}

interface SavedSearch {
  id: string
  query: string
  location: string
  mode: '' | 'remote' | 'hybrid' | 'on-site'
  active: boolean
  jobs: unknown
}

function matchesSearch(job: ArbeitnowJob, search: SavedSearch): boolean {
  const haystack = [
    job.title,
    job.company_name,
    job.location,
    job.description,
    ...(job.tags ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  const queryTerms = search.query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
  const location = search.location.trim().toLowerCase()

  if (queryTerms.some((term) => !haystack.includes(term))) return false
  if (location && !(job.location ?? '').toLowerCase().includes(location)) return false
  if (search.mode === 'remote' && !job.remote) return false
  if (search.mode === 'on-site' && job.remote) return false

  return true
}

export const config = { schedule: '@hourly' }

export const handler: Handler = async () => {
  const url = process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceKey) {
    console.error('[Scheduled searches] Missing server credentials.')
    return { statusCode: 500, body: 'Missing server credentials.' }
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: searches, error: searchError } = await supabase
    .from('saved_searches')
    .select('id, query, location, mode, active, jobs')
    .eq('active', true)

  if (searchError) {
    console.error('[Scheduled searches] Could not load searches:', searchError.message)
    return { statusCode: 500, body: 'Could not load searches.' }
  }

  const jobsResponse = await fetch('https://www.arbeitnow.com/api/job-board-api')
  if (!jobsResponse.ok) {
    console.error('[Scheduled searches] Arbeitnow returned:', jobsResponse.status)
    return { statusCode: 502, body: 'Job provider unavailable.' }
  }

  const payload = (await jobsResponse.json()) as { data?: ArbeitnowJob[] }
  const jobs = payload.data ?? []

  for (const search of (searches ?? []) as SavedSearch[]) {
    const matches = jobs.filter((job) => matchesSearch(job, search)).slice(0, 50)
    const previous = Array.isArray(search.jobs) ? search.jobs : []
    const previousUrls = new Set(
      previous.flatMap((job) =>
        job && typeof job === 'object' && 'url' in job && typeof job.url === 'string'
          ? [job.url]
          : [],
      ),
    )
    const newCount = matches.filter((job) => job.url && !previousUrls.has(job.url)).length

    const { error: updateError } = await supabase
      .from('saved_searches')
      .update({
        jobs: matches,
        new_count: newCount,
        last_run: new Date().toISOString(),
      })
      .eq('id', search.id)

    if (updateError) {
      console.error('[Scheduled searches] Could not update search:', search.id, updateError.message)
    }
  }

  return { statusCode: 200, body: JSON.stringify({ searches: searches?.length ?? 0 }) }
}
