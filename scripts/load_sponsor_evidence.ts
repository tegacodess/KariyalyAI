/**
 * Import generic NL/US sponsor-evidence CSV data into sponsor_search_evidence.
 *
 * Required columns: country, employer (or company/organisation/organization).
 * Employer names are trimmed and lowercased before insertion.
 *
 * Example:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   npx tsx scripts/load_sponsor_evidence.ts evidence.csv --country=NL --dry-run
 */
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { parseCsv } from './load_sponsors'

const countryArg = process.argv.find((arg) => arg.startsWith('--country='))?.split('=')[1]
const filePath = process.argv.find((arg) => !arg.startsWith('--'))
const dryRun = process.argv.includes('--dry-run')

if (!filePath || (countryArg !== 'NL' && countryArg !== 'US')) {
  console.error('Usage: npx tsx scripts/load_sponsor_evidence.ts <file.csv> --country=NL|US [--dry-run]')
  process.exit(1)
}

const [header, ...rows] = parseCsv(readFileSync(filePath, 'utf8'))
const headers = header.map((value) => value.trim().toLowerCase())
const employerIndex = headers.findIndex((value) =>
  ['employer', 'company', 'organisation', 'organization'].some((name) =>
    value.includes(name),
  ),
)

if (employerIndex === -1) {
  throw new Error(`No employer/company column found in ${basename(filePath)}.`)
}

const employers = [
  ...new Set(
    rows
      .map((row) => row[employerIndex]?.trim().toLowerCase())
      .filter((employer): employer is string => Boolean(employer)),
  ),
]
const records = employers.map((employer) => ({ country: countryArg, employer }))

console.log(`Prepared ${records.length} ${countryArg} employers.`)
if (dryRun) {
  console.log('Dry run: nothing was written.')
  process.exit(0)
}

const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.')

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const { error } = await supabase
  .from('sponsor_search_evidence')
  .upsert(records, { onConflict: 'country,employer' })

if (error) throw new Error(`Import failed: ${error.message}`)
console.log(`Imported ${records.length} employers from ${basename(filePath)}.`)
