import { normaliseCountry, type Country } from './countries'

export type WorkAuthState =
  | 'no_visa_needed'
  | 'no_sponsorship'
  | 'likely_licensed'
  | 'not_found'
  | 'not_checked'
  | 'unknown_location'

export interface WorkAuthResult {
  state: WorkAuthState
  matched_org?: string | null
  matched_town?: string | null
  register_date?: string | null
  similarity?: number | null
  note?: string
}

export interface WorkAuthInput {
  locationCountry: string | null
  isRemote: boolean | null
  rightToWorkCountries: string[]
  description: string
  noSponsorshipPhrases?: string[]
}

/**
 * Wording that restricts sponsorship or requires existing work rights. Patterns, not
 * fixed strings, because postings phrase this many ways ("unable to offer visa
 * sponsorship", "cannot sponsor", "sponsorship is not available", ...).
 * Positive wording ("we offer visa sponsorship") deliberately does not match.
 */
const NO_SPONSORSHIP_PATTERNS: RegExp[] = [
  // unable to offer visa sponsorship / cannot sponsor / do not provide sponsorship
  /\b(?:unable|not able|cannot|can ?not|can't|won't|will not|do not|does not|don't|doesn't|are not|is not|aren't|isn't)\s+(?:to\s+)?(?:currently\s+)?(?:offer|provide|support|consider|sponsor|be\s+(?:able\s+to\s+)?(?:offer|provide)?)?\s*(?:any\s+)?(?:visa\s+|work\s+permit\s+)?sponsor/,
  // no sponsorship / no visa sponsorship
  /\bno\s+(?:visa\s+)?sponsorship\b/,
  // sponsorship is not available / sponsorship unavailable
  /\bsponsorship\s+(?:is\s+)?(?:not\s+|un)available\b/,
  // without sponsorship / without the need for visa sponsorship
  /\bwithout\s+(?:the\s+need\s+for\s+|requiring\s+)?(?:visa\s+)?sponsorship\b/,
  // must (already) have / hold the (full) right to work
  /\bmust\s+(?:already\s+)?(?:have|hold|possess)\s+(?:the\s+|a\s+|full\s+|existing\s+|valid\s+|current\s+)*right\s+to\s+work\b/,
  // must be eligible / authorised / entitled to work
  /\bmust\s+(?:already\s+)?be\s+(?:legally\s+)?(?:eligible|authori[sz]ed|entitled|permitted)\s+to\s+work\b/,
  // right to work in the UK is required / essential
  /\bright\s+to\s+work\b[^.]{0,40}\b(?:required|essential|mandatory|necessary)\b/,
]

export function hasNoSponsorshipPhrase(
  description: string,
  phrases: string[] = [],
): boolean {
  const text = description.toLowerCase().replace(/\s+/g, ' ')

  // AI-quoted phrases count only if they really appear in the posting.
  if (phrases.some((phrase) => phrase.trim() && text.includes(phrase.toLowerCase().trim()))) {
    return true
  }

  return NO_SPONSORSHIP_PATTERNS.some((pattern) => pattern.test(text))
}

export function evaluateWorkAuth(input: WorkAuthInput): WorkAuthResult {
  const location = normaliseCountry(input.locationCountry)
  const rightToWork = new Set(
    input.rightToWorkCountries
      .map((country) => normaliseCountry(country))
      .filter((country): country is Country => country !== null),
  )

  if (location && rightToWork.has(location)) {
    return {
      state: 'no_visa_needed',
      note: 'Your profile says you can work in this country without sponsorship.',
    }
  }

  if (
    input.isRemote === true &&
    !hasNoSponsorshipPhrase(input.description, input.noSponsorshipPhrases)
  ) {
    return {
      state: 'no_visa_needed',
      note: 'This role is marked remote and no sponsorship restriction was found.',
    }
  }

  if (!location) {
    return {
      state: 'unknown_location',
      note: 'The job location was not identified as a country.',
    }
  }

  if (hasNoSponsorshipPhrase(input.description, input.noSponsorshipPhrases)) {
    return {
      state: 'no_sponsorship',
      note: 'The posting contains language restricting sponsorship or work authorisation.',
    }
  }

  if (location === 'United Kingdom') {
    return {
      state: 'not_checked',
      note: 'The UK sponsor register is being checked.',
    }
  }

  return {
    state: 'not_checked',
    note: 'No sponsor-register lookup is available for this country.',
  }
}

export async function lookupUkSponsor(
  company: string,
  runLookup: (company: string) => Promise<{
      data: Array<{
        org_name: string
        town: string | null
        similarity: number
        register_date: string | null
      }> | null
      error: { message: string } | null
    }>,
): Promise<WorkAuthResult> {
  const { data, error } = await runLookup(company)

  if (error) throw new Error(error.message)

  const match = data?.[0]
  if (!match || match.similarity < 0.6) {
    // Do not return the weak match: showing an unrelated organisation as a "sponsor
    // match" under a "not found" result is misleading.
    return {
      state: 'not_found',
      matched_org: null,
      matched_town: null,
      register_date: match?.register_date ?? null,
      similarity: null,
      note: 'No close match was found in the UK sponsor register.',
    }
  }

  return {
    state: 'likely_licensed',
    matched_org: match.org_name,
    matched_town: match.town,
    register_date: match.register_date,
    similarity: match.similarity,
    note: 'A close match was found in the UK sponsor register.',
  }
}
