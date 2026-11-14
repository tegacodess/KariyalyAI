# Testing KariyalyAI

## Automated tests

```bash
npm test            # run once
npm run test:watch  # rerun on save
```

The tests use fake versions of Supabase, Gemini and Groq, so they need no keys, no network and no quota. They run on every pull request through GitHub Actions (`.github/workflows/ci.yml`), together with lint and the build. Do not merge a pull request with a red check.

| File | What it protects |
|---|---|
| `tests/ai.handler.test.ts` | The `ai` function: authentication, input validation, cache, per-user limits, the shared `BUSY` cap, schema retries, Groq fallback (Gemini slow, down, rate limited or unreachable), the time budget, and every company brief grounding and fallback path |
| `tests/workAuth.test.ts` | The visa check: the decision order, the sponsorship phrase patterns (and positive wording that must not match), and the sponsor match threshold |
| `tests/prompts.test.ts` | Each prompt describes exactly the JSON its schema accepts. A prompt that drifts from the schema fails every real call, and mock mode would never show it |
| `tests/schema.test.ts` | Mock fixtures match the schemas, old profiles with free-text countries still load, output caps |
| `tests/countries.test.ts` | Country spellings map to one name, and anything else becomes null rather than a guess |
| `tests/grounding.test.ts` | Company news links come only from Google's grounding data |
| `tests/loadSponsors.test.ts` | The sponsor register loader reads the GOV.UK CSV correctly |

When you change a prompt, a schema or the visa phrases, add or update a test in the same pull request. When a real job posting is misclassified, add its wording to `tests/workAuth.test.ts` first, then fix the pattern.

## Manual check on the live site

The automated tests never call the real Gemini, Groq or Supabase. Before demo day, run this on the deployed site with a confirmed test account, and again after any change to the AI function or the database.

| # | Do this | Expect |
|---|---|---|
| 1 | Sign up with a new email | A "Check your email" message appears and a confirmation email arrives; its link opens the sign-in page; signing in works only after confirming |
| 1a | Open `/app/tracker` directly in a new tab, then refresh it | The app loads (or sends you to sign in), never a Netlify "Page not found" |
| 2 | Upload a PDF CV, tick consent, analyse | A profile you can edit; nothing is invented |
| 3 | Try to analyse without ticking consent | The button stays disabled |
| 4 | Set country of residence and right-to-work countries, save | Only countries from the list can be added |
| 5 | Paste a UK job with "We are unable to offer visa sponsorship" | Score and gaps; work authorisation shows the sponsorship restriction |
| 6 | Paste a UK job at a well-known sponsor, with no restriction | "Likely licensed to sponsor" with the register date, once the register is loaded |
| 7 | Paste a job in a country you listed as right to work | "No visa sponsorship needed" |
| 8 | Paste a remote job with no location | "No visa sponsorship needed" with a note to check the posting |
| 9 | Tailor: generate, edit, copy, reload the page | Your edits are still there; Copy works |
| 10 | Research five real companies | Most briefs show recent news with working source links. If most show "No live search", time the search and tell the team: news is the point of this feature |
| 11 | Research with `GROUNDING_ENABLED=false` in Netlify | Fallback notice, no news, no error |
| 12 | Outreach on LinkedIn and on email | No subject line on LinkedIn; a subject on email |
| 13 | Tracker: add, change status, undo, view history, delete | Each works; delete asks first |
| 14 | Profile: Delete my data | Everything is gone after reloading |
| 15 | Time a company brief and a CV parse | Each finishes in under 10 seconds |
| 16 | Set `GEMINI_MODEL` to a name that does not exist in Netlify, redeploy, analyse a CV | Groq answers (Gemini returns an error, which triggers the fallback). Put the real model name back afterwards. Removing `GEMINI_API_KEY` does not test this: a missing key is treated as a setup error, not an outage |

Write down anything that fails, with the page, what you did and what you saw.
