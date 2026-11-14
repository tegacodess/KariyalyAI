import { useEffect, useState, type FormEvent } from 'react'
import { Bell, Loader2, Search } from 'lucide-react'
import { supabase } from '../../lib/supabase'

interface SavedSearch {
  id: string
  query: string
  location: string
  mode: '' | 'remote' | 'hybrid' | 'on-site'
  eligibility: string
  cadence: 'daily' | 'weekly'
  timezone: string
  active: boolean
  jobs: Array<{ title?: string; company_name?: string; location?: string; url?: string }>
  new_count: number
  last_run: string | null
}

const emptyForm = {
  query: '',
  location: '',
  mode: '' as SavedSearch['mode'],
  eligibility: '',
  cadence: 'daily' as SavedSearch['cadence'],
}

export default function SavedSearches() {
  const [searches, setSearches] = useState<SavedSearch[]>([])
  const [form, setForm] = useState(emptyForm)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function loadSearches() {
    const { data, error: loadError } = await supabase
      .from('saved_searches')
      .select('id, query, location, mode, eligibility, cadence, timezone, active, jobs, new_count, last_run')
    if (loadError) setError(loadError.message)
    else setSearches((data ?? []) as SavedSearch[])
    setLoading(false)
  }

  useEffect(() => {
    void Promise.resolve().then(loadSearches)
  }, [])

  async function createSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSaving(true)
    const { error: saveError } = await supabase.from('saved_searches').insert({
      ...form,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    })
    setSaving(false)
    if (saveError) {
      setError(saveError.message)
      return
    }
    setForm(emptyForm)
    await loadSearches()
  }

  async function toggleSearch(search: SavedSearch) {
    const { error: updateError } = await supabase
      .from('saved_searches')
      .update({ active: !search.active })
      .eq('id', search.id)
    if (updateError) setError(updateError.message)
    else setSearches((current) => current.map((item) => item.id === search.id ? { ...item, active: !item.active } : item))
  }

  async function deleteSearch(id: string) {
    const { error: deleteError } = await supabase.from('saved_searches').delete().eq('id', id)
    if (deleteError) setError(deleteError.message)
    else setSearches((current) => current.filter((search) => search.id !== id))
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Saved job searches</h1>
        <p className="mt-1 text-sm text-slate-500">Arbeitnow checks active searches hourly and stores matching jobs.</p>
      </header>

      <form onSubmit={createSearch} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <input required maxLength={100} value={form.query} onChange={(event) => setForm({ ...form, query: event.target.value })} placeholder="Keywords, e.g. React TypeScript" className="rounded-xl border border-slate-300 px-4 py-3 text-sm" />
          <input maxLength={100} value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} placeholder="Location, optional" className="rounded-xl border border-slate-300 px-4 py-3 text-sm" />
          <select value={form.mode} onChange={(event) => setForm({ ...form, mode: event.target.value as SavedSearch['mode'] })} className="rounded-xl border border-slate-300 px-4 py-3 text-sm">
            <option value="">Any work mode</option><option value="remote">Remote</option><option value="hybrid">Hybrid</option><option value="on-site">On-site</option>
          </select>
          <input maxLength={100} value={form.eligibility} onChange={(event) => setForm({ ...form, eligibility: event.target.value })} placeholder="Eligibility note, optional" className="rounded-xl border border-slate-300 px-4 py-3 text-sm" />
          <select value={form.cadence} onChange={(event) => setForm({ ...form, cadence: event.target.value as SavedSearch['cadence'] })} className="rounded-xl border border-slate-300 px-4 py-3 text-sm">
            <option value="daily">Daily</option><option value="weekly">Weekly</option>
          </select>
        </div>
        <button disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Save search
        </button>
      </form>

      {error && <p role="alert" className="rounded-xl bg-rose-50 p-4 text-sm text-rose-800">{error}</p>}
      {loading ? <Loader2 className="h-6 w-6 animate-spin text-blue-600" /> : (
        <div className="space-y-4">
          {searches.map((search) => (
            <section key={search.id} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-xs">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><h2 className="font-bold text-slate-900">{search.query}</h2><p className="text-xs text-slate-500">{search.location || 'Any location'} · {search.cadence}</p></div>
                <div className="flex items-center gap-2"><button onClick={() => void toggleSearch(search)} className="rounded-lg border px-3 py-2 text-xs font-semibold">{search.active ? 'Pause' : 'Resume'}</button><button onClick={() => void deleteSearch(search.id)} className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700">Delete</button></div>
              </div>
              <p className="mt-3 flex items-center gap-2 text-xs text-slate-500"><Bell className="h-3.5 w-3.5" /> {search.new_count} new matches · {search.jobs.length} stored</p>
              {search.jobs.length > 0 && <ul className="mt-4 space-y-2">{search.jobs.slice(0, 5).map((job, index) => <li key={`${job.url ?? job.title}-${index}`}><a href={job.url} target="_blank" rel="noreferrer" className="text-sm font-semibold text-blue-600 hover:underline">{job.title || 'Untitled job'}</a><span className="ml-2 text-xs text-slate-500">{job.company_name} {job.location ? `· ${job.location}` : ''}</span></li>)}</ul>}
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
