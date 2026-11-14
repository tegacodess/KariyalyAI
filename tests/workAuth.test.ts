import { describe, expect, it } from 'vitest'

import {
  evaluateWorkAuth,
  hasNoSponsorshipPhrase,
  lookupUkSponsor,
  type WorkAuthInput,
} from '../shared/workAuth'

const base: WorkAuthInput = {
  locationCountry: 'United Kingdom',
  isRemote: false,
  rightToWorkCountries: ['Nigeria'],
  description: 'A great analyst role.',
}

describe('evaluateWorkAuth decision order', () => {
  it('1. no visa needed when the job country is in the right-to-work list', () => {
    expect(
      evaluateWorkAuth({ ...base, rightToWorkCountries: ['UK'], description: 'No sponsorship.' }).state,
    ).toBe('no_visa_needed')
  })

  it('2. no visa needed for a remote job with no restriction', () => {
    expect(evaluateWorkAuth({ ...base, locationCountry: null, isRemote: true }).state).toBe(
      'no_visa_needed',
    )
  })

  it('a remote job with a restriction is not treated as visa-free', () => {
    expect(
      evaluateWorkAuth({ ...base, isRemote: true, description: 'Remote, but no sponsorship.' }).state,
    ).toBe('no_sponsorship')
  })

  it('3. unknown location when the country cannot be read', () => {
    expect(evaluateWorkAuth({ ...base, locationCountry: 'Europe' }).state).toBe('unknown_location')
  })

  it('4. no sponsorship when the posting restricts it', () => {
    expect(
      evaluateWorkAuth({ ...base, description: 'We are unable to offer visa sponsorship.' }).state,
    ).toBe('no_sponsorship')
  })

  it('5 and 6. not checked otherwise (the UK register is looked up separately)', () => {
    expect(evaluateWorkAuth(base).state).toBe('not_checked')
    expect(evaluateWorkAuth({ ...base, locationCountry: 'Canada' }).state).toBe('not_checked')
  })

  it('matches right-to-work countries saved as free text', () => {
    expect(evaluateWorkAuth({ ...base, rightToWorkCountries: ['england'] }).state).toBe(
      'no_visa_needed',
    )
  })
})

describe('hasNoSponsorshipPhrase', () => {
  it.each([
    'We are unable to offer visa sponsorship for this role.',
    'Unfortunately we cannot sponsor visas.',
    'Applicants must have the right to work in the UK.',
    'You must already have the right to work in the UK.',
    'Sponsorship is not available for this position.',
    'We do not offer sponsorship.',
    'Candidates must be eligible to work in the UK.',
    'The right to work in the UK is essential.',
    'We are not able to provide visa sponsorship.',
    'This role does not offer sponsorship.',
    "We won't be able to sponsor applicants.",
    'You will need to work in the UK without sponsorship.',
    'No visa sponsorship.',
    'We are UNABLE TO OFFER\nvisa sponsorship.',
  ])('catches: %s', (text) => {
    expect(hasNoSponsorshipPhrase(text)).toBe(true)
  })

  it.each([
    'Great role in London with a friendly team.',
    'We offer visa sponsorship for the right candidate.',
    'Visa sponsorship is available.',
    'We are proud to sponsor local charities.',
    "Don't worry about relocation, we help with visas.",
    'We can sponsor Skilled Worker visas.',
    'Sponsorship available for exceptional candidates.',
  ])('does not flag: %s', (text) => {
    expect(hasNoSponsorshipPhrase(text)).toBe(false)
  })

  it('uses AI-quoted phrases only if they appear in the posting', () => {
    expect(hasNoSponsorshipPhrase('Applicants need settled status.', ['need settled status'])).toBe(true)
    expect(hasNoSponsorshipPhrase('A nice job.', ['no sponsorship'])).toBe(false)
  })
})

describe('lookupUkSponsor', () => {
  const lookup = (similarity: number | null, error: string | null = null) => async () => ({
    data:
      similarity === null
        ? []
        : [{ org_name: 'Acme Ltd', town: 'London', similarity, register_date: '2026-11-10' }],
    error: error ? { message: error } : null,
  })

  it('is likely licensed at similarity 0.6 or higher', async () => {
    const result = await lookupUkSponsor('Acme', lookup(0.6))
    expect(result).toMatchObject({ state: 'likely_licensed', matched_org: 'Acme Ltd', register_date: '2026-11-10' })
  })

  it('is not found below 0.6, and does not present the weak match as a sponsor', async () => {
    const result = await lookupUkSponsor('Acme', lookup(0.59))
    expect(result).toMatchObject({
      state: 'not_found',
      matched_org: null,
      similarity: null,
      register_date: '2026-11-10',
    })
  })

  it('is not found when there is no match at all', async () => {
    expect((await lookupUkSponsor('Acme', lookup(null))).state).toBe('not_found')
  })

  it('throws when the lookup fails, so the page can show an error', async () => {
    await expect(lookupUkSponsor('Acme', lookup(0.9, 'db down'))).rejects.toThrow('db down')
  })
})
