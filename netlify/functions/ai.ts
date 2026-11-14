import type { Handler } from '@netlify/functions'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'
import { z } from 'zod'

import {
  aiTasks,
  CompanyBriefInput,
  CompanyBriefOutput,
  RATE_LIMITS,
  type AiErrorCode,
  type FallbackReason,
  type TaskName,
} from '../../shared/schema'

import {
  buildNews,
  extractSources,
  getText,
  GroundedBriefModel,
  type GeminiBody,
} from './lib/grounding'

import { parseCvPrompt } from './prompts/parse_cv'
import { matchJobPrompt } from './prompts/match_job'
import { tailorApplicationPrompt } from './prompts/tailor_application'
import {
  companyBriefPrompt,
  companyBriefResearchPrompt,
  companyBriefStructurePrompt,
} from './prompts/company_brief'
import { outreachPrompt } from './prompts/outreach'

const TASK_PROMPTS: Record<TaskName, string> = {
  parse_cv: parseCvPrompt,
  match_job: matchJobPrompt,
  tailor_application: tailorApplicationPrompt,
  company_brief: companyBriefPrompt,
  outreach: outreachPrompt,
}

// ---------------------------------------------------------------------------
// Configuration (all overridable from Netlify environment variables)
// ---------------------------------------------------------------------------

function envInt(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? '', 10)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

/**
 * Shared daily caps across ALL users. The defaults are placeholders: set
 * GLOBAL_DAILY_AI_CAP and GLOBAL_DAILY_GROUNDED_CAP from the limits shown in Google AI
 * Studio for the chosen model, with a safety margin. One request can use several Gemini
 * calls (a retry, or grounding plus structuring), so keep the caps well below the quota.
 */
const GLOBAL_DAILY_AI_CAP = () => envInt('GLOBAL_DAILY_AI_CAP', 250)
const GLOBAL_DAILY_GROUNDED_CAP = () => envInt('GLOBAL_DAILY_GROUNDED_CAP', 100)

/** Search grounding is on unless GROUNDING_ENABLED is exactly "false". */
const groundingEnabled = () => process.env.GROUNDING_ENABLED !== 'false'

/**
 * Netlify synchronous functions time out after 10 seconds by default, so the grounded
 * path has its own, shorter timeouts. Tune them after measuring real latency.
 */
const GROUNDING_TIMEOUT_MS = () => envInt('GROUNDING_TIMEOUT_MS', 6000)
const STRUCTURE_TIMEOUT_MS = () => envInt('STRUCTURE_TIMEOUT_MS', 3500)
const GROQ_TIMEOUT_MS = () => envInt('GROQ_TIMEOUT_MS', 4000)

/**
 * Time limit for one Gemini call on standard tasks. Kept short so that, when Gemini is
 * slow or unresponsive, Groq still has time to answer within the request budget.
 */
const GEMINI_TIMEOUT_MS = () => envInt('GEMINI_TIMEOUT_MS', 5000)

/**
 * Total time one request may spend calling AI providers. Netlify synchronous functions
 * stop after about 10 seconds on the default plan, so the default leaves headroom.
 * Raise it (and the provider timeouts) only if the site's function limit is higher.
 */
const REQUEST_BUDGET_MS = () => envInt('REQUEST_BUDGET_MS', 9000)

/**
 * Time limit for a standard Gemini call. With a Groq key the limit is short, to leave
 * Groq time to answer. With no fallback provider there is nothing to save time for, so
 * Gemini may use the whole remaining budget and a slow but valid answer still succeeds.
 */
const standardGeminiTimeoutMs = () =>
  process.env.GROQ_API_KEY ? GEMINI_TIMEOUT_MS() : REQUEST_BUDGET_MS()

/** Set at the start of each request. Netlify runs one request per instance at a time. */
let requestDeadline = Number.POSITIVE_INFINITY

/** Grounded briefs contain news, so a cached one is only reused for this long. */
const COMPANY_BRIEF_CACHE_HOURS = 24

// ---------------------------------------------------------------------------
// Errors and helpers
// ---------------------------------------------------------------------------

class GeminiProviderError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'GeminiProviderError'
    this.status = status
  }
}

/** An error that maps directly to a response for the caller. */
class AiFailure extends Error {
  code: AiErrorCode
  status: number

  constructor(code: AiErrorCode, status: number, message: string) {
    super(message)
    this.name = 'AiFailure'
    this.code = code
    this.status = status
  }
}

class GroqProviderError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'GroqProviderError'
    this.status = status
  }
}

/**
 * Caps a provider call so it ends before the request budget runs out. Throws TIMEOUT
 * when too little time is left to make a call worth starting.
 */
function budget(preferredMs: number): number {
  const remaining = requestDeadline - Date.now() - 250
  if (remaining < 800) {
    throw new AiFailure(
      'TIMEOUT',
      504,
      'The AI took too long to respond. Please try again.',
    )
  }
  return Math.min(preferredMs, remaining)
}

/**
 * fetch that turns a timeout or network failure into the provider's error class, so
 * "slow or unreachable" is handled the same way as an HTTP error (504 or 503).
 */
async function fetchOrThrow(
  url: string,
  init: RequestInit,
  toError: (status: number, message: string) => Error,
): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch (error) {
    if (error instanceof AiFailure) throw error
    const timedOut =
      error instanceof Error &&
      (error.name === 'TimeoutError' || error.name === 'AbortError')
    throw toError(timedOut ? 504 : 503, timedOut ? 'timed out' : 'could not be reached')
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }

  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>

    return `{${Object.keys(object)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableStringify(object[key])}`,
      )
      .join(',')}}`
  }

  return JSON.stringify(value)
}

function response(
  statusCode: number,
  payload: Record<string, unknown>,
) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  }
}

function failure(code: AiErrorCode, statusCode: number, message: string) {
  return response(statusCode, { ok: false, error: { code, message } })
}

// ---------------------------------------------------------------------------
// Gemini calls
// ---------------------------------------------------------------------------

interface GeminiCall {
  system: string
  user: string
  /** true: ask for JSON output. Must be false when search is true. */
  json: boolean
  /** true: enable Google Search grounding. */
  search?: boolean
  timeoutMs?: number
}

interface GroqCall {
  system: string
  user: string
  timeoutMs?: number
}

async function callGemini(call: GeminiCall): Promise<GeminiBody> {
  const apiKey = process.env.GEMINI_API_KEY
  const model = process.env.GEMINI_MODEL

  if (!apiKey || !model) {
    throw new Error('AI environment variables are missing.')
  }

  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${model}:generateContent?key=${apiKey}`

  const result = await fetchOrThrow(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: call.system }],
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: call.user }],
        },
      ],
      ...(call.search ? { tools: [{ google_search: {} }] } : {}),
      ...(call.json
        ? { generationConfig: { responseMimeType: 'application/json' } }
        : {}),
    }),
    signal: AbortSignal.timeout(budget(call.timeoutMs ?? GEMINI_TIMEOUT_MS())),
  }, (status, message) => new GeminiProviderError(status, `Gemini ${message}.`))

  if (!result.ok) {
    throw new GeminiProviderError(
      result.status,
      `Gemini returned HTTP ${result.status}.`,
    )
  }

  return (await result.json()) as GeminiBody
}

async function callGroq(call: GroqCall): Promise<unknown> {
  const apiKey = process.env.GROQ_API_KEY
  const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'

  if (!apiKey) throw new Error('GROQ_API_KEY is missing.')

  const result = await fetchOrThrow('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: call.system },
        { role: 'user', content: call.user },
      ],
    }),
    signal: AbortSignal.timeout(budget(call.timeoutMs ?? GROQ_TIMEOUT_MS())),
  }, (status, message) => new GroqProviderError(status, `Groq ${message}.`))

  if (!result.ok) {
    throw new GroqProviderError(result.status, `Groq returned HTTP ${result.status}.`)
  }
  return result.json()
}

function getGroqText(body: unknown): string {
  if (!body || typeof body !== 'object') return ''
  const choices = (body as { choices?: unknown }).choices
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== 'object') {
    return ''
  }
  const message = (choices[0] as { message?: unknown }).message
  if (!message || typeof message !== 'object') return ''
  const content = (message as { content?: unknown }).content
  return typeof content === 'string' ? content : ''
}

function withBase(prompt: string, retryFeedback?: string): string {
  const retryInstruction = retryFeedback
    ? `\n\nYour previous response was invalid.
Correct these issues and return a completely valid JSON object:
${retryFeedback}`
    : ''

  return (
    'You are KariyalyAI, an AI-powered career assistant.\n\n' +
    prompt +
    '\n\nReturn valid JSON only. No Markdown or explanations.' +
    retryInstruction
  )
}

/**
 * Calls Gemini in JSON mode, validates the output with `schema`, and retries once
 * (with the validation errors as feedback) if the output is invalid.
 * Provider errors (HTTP failures) are thrown immediately without a retry.
 */
async function generateValidated<T>(
  systemPrompt: string,
  input: unknown,
  schema: z.ZodType<T>,
  timeoutMs = standardGeminiTimeoutMs(),
): Promise<T> {
  let feedback = ''

  for (let attempt = 0; attempt < 2; attempt++) {
    let generated: unknown

    try {
      const body = await callGemini({
        system: withBase(systemPrompt, feedback || undefined),
        user: JSON.stringify(input),
        json: true,
        timeoutMs,
      })

      const text = getText(body)
      if (!text) throw new Error('Gemini returned an empty response.')

      try {
        generated = JSON.parse(text)
      } catch {
        throw new Error('Gemini returned invalid JSON.')
      }

    } catch (error) {
      if (error instanceof GeminiProviderError || error instanceof AiFailure) {
        throw error
      }

      console.error(
        '[AI] Gemini generation error:',
        error instanceof Error ? error.message : 'Unknown error',
      )

      feedback =
        error instanceof Error
          ? error.message
          : 'Gemini returned an invalid response.'

      continue
    }

    const outputResult = schema.safeParse(generated)

    if (outputResult.success) {
      return outputResult.data
    }

    feedback = outputResult.error.issues
      .map((issue) => {
        const field = issue.path.join('.')
        return `${field || 'response'}: ${issue.message}`
      })
      .join('\n')

    // Log field paths only, never values.
    console.error(
      '[AI] Gemini output failed schema validation at:',
      outputResult.error.issues
        .map((issue) => issue.path.join('.') || 'response')
        .join(', '),
    )
  }

  throw new AiFailure(
    'BAD_OUTPUT',
    502,
    'The AI could not produce a valid response. Please try again.',
  )
}

async function generateValidatedWithGroq<T>(
  systemPrompt: string,
  input: unknown,
  schema: z.ZodType<T>,
): Promise<T> {
  let feedback = ''

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const body = await callGroq({
        system: withBase(systemPrompt, feedback || undefined),
        user: JSON.stringify(input),
      })
      const text = getGroqText(body)
      if (!text) throw new Error('Groq returned an empty response.')

      let generated: unknown
      try {
        generated = JSON.parse(text)
      } catch {
        throw new Error('Groq returned invalid JSON.')
      }

      const outputResult = schema.safeParse(generated)
      if (outputResult.success) return outputResult.data

      feedback = outputResult.error.issues
        .map((issue) => `${issue.path.join('.') || 'response'}: ${issue.message}`)
        .join('\n')
    } catch (error) {
      if (error instanceof AiFailure) throw error

      // An outage or timeout will not fix itself on an immediate retry.
      if (error instanceof GroqProviderError) {
        console.error('[AI] Groq fallback failed. HTTP status:', error.status)
        throw new AiFailure(
          error.status === 504 ? 'TIMEOUT' : 'MODEL_ERROR',
          error.status === 504 ? 504 : 502,
          error.status === 504
            ? 'The AI took too long to respond. Please try again.'
            : 'The AI service is unavailable right now. Please try again shortly.',
        )
      }

      console.error(
        '[AI] Groq fallback generation error:',
        error instanceof Error ? error.message : 'Unknown error',
      )
      feedback =
        error instanceof Error ? error.message : 'Groq returned an invalid response.'
    }
  }

  throw new AiFailure(
    'BAD_OUTPUT',
    502,
    'The fallback AI could not produce a valid response. Please try again.',
  )
}

async function generateValidatedWithProviderFallback<T>(
  systemPrompt: string,
  input: unknown,
  schema: z.ZodType<T>,
): Promise<T> {
  try {
    return await generateValidated(systemPrompt, input, schema)
  } catch (error) {
    if (!(error instanceof GeminiProviderError) || !process.env.GROQ_API_KEY) {
      throw error
    }

    console.error(
      '[AI] Gemini failed; using Groq fallback. HTTP status:',
      error.status,
    )
    return generateValidatedWithGroq(systemPrompt, input, schema)
  }
}

// ---------------------------------------------------------------------------
// company_brief: grounded path with a pasted-text fallback
// ---------------------------------------------------------------------------

type CompanyBriefInputData = z.infer<typeof CompanyBriefInput>
type CompanyBriefResult = z.infer<typeof CompanyBriefOutput>

const CompanyBriefCore = CompanyBriefOutput.pick({
  what_they_do: true,
  values: true,
  talking_points: true,
  questions_to_ask: true,
  confidence: true,
})

type GroundingAttempt =
  | { ok: true; data: CompanyBriefResult }
  | { ok: false; reason: FallbackReason }

/**
 * Two Gemini calls: (1) search grounding, plain text; (2) JSON structuring without
 * search. Gemini does not accept the search tool together with JSON output on every
 * model, so this works on all of them. News URLs always come from the grounding
 * metadata, never from the model.
 */
async function tryGroundedBrief(
  input: CompanyBriefInputData,
): Promise<GroundingAttempt> {
  try {
    const research = await callGemini({
      system: companyBriefResearchPrompt,
      user: JSON.stringify({
        company: input.company,
        role: input.role,
        about_text: input.about_text ?? '',
      }),
      json: false,
      search: true,
      timeoutMs: GROUNDING_TIMEOUT_MS(),
    })

    const researchText = getText(research).trim()
    const sources = extractSources(research)

    if (!researchText || sources.length === 0) {
      return { ok: false, reason: 'no_results' }
    }

    const structured = await generateValidated(
      companyBriefStructurePrompt,
      {
        company: input.company,
        role: input.role,
        about_text: input.about_text ?? '',
        research_text: researchText.slice(0, 12_000),
        sources: sources.map((source, index) => ({
          index,
          title: source.title,
        })),
      },
      GroundedBriefModel,
      STRUCTURE_TIMEOUT_MS(),
    )

    const data = CompanyBriefOutput.parse({
      what_they_do: structured.what_they_do,
      values: structured.values,
      talking_points: structured.talking_points,
      questions_to_ask: structured.questions_to_ask,
      recent_news: buildNews(structured.recent_news, sources),
      sources,
      grounded: true,
      fallback_reason: null,
      confidence: 'medium',
    })

    return { ok: true, data }
  } catch (error) {
    if (error instanceof GeminiProviderError) {
      console.error('[AI] Grounded brief failed. HTTP status:', error.status)
      return { ok: false, reason: error.status === 429 ? 'quota' : 'error' }
    }

    console.error(
      '[AI] Grounded brief failed:',
      error instanceof Error ? error.name : 'Unknown error',
    )
    return { ok: false, reason: 'error' }
  }
}

/** No search. Builds the brief from the pasted About text only. */
async function fallbackBrief(
  input: CompanyBriefInputData,
  reason: FallbackReason,
  provider: 'gemini' | 'groq' = 'gemini',
): Promise<CompanyBriefResult> {
  const fallbackInput = {
    company: input.company,
    role: input.role,
    about_text: input.about_text ?? '',
  }
  const core =
    provider === 'groq'
      ? await generateValidatedWithGroq(
          companyBriefPrompt,
          fallbackInput,
          CompanyBriefCore,
        )
      : await generateValidated(companyBriefPrompt, fallbackInput, CompanyBriefCore)

  const hasAboutText = Boolean(input.about_text?.trim())

  return CompanyBriefOutput.parse({
    ...core,
    // Plain code decides confidence: no search and no pasted text means low.
    confidence: hasAboutText ? core.confidence : 'low',
    recent_news: [],
    sources: [],
    grounded: false,
    fallback_reason: reason,
  })
}

async function runCompanyBrief(
  input: CompanyBriefInputData,
  grounding: { attempt: boolean; reason: FallbackReason },
): Promise<CompanyBriefResult> {
  let reason = grounding.reason
  let groqAlreadyTried = false

  if (grounding.attempt) {
    // Start the Groq fallback brief at the same time as the search. If the search fails,
    // even late, the fallback is already written. The search therefore does not have to
    // leave time for a fallback and can use the whole request budget; holding time back
    // for Groq instead cut the search off after a few seconds, so news rarely appeared.
    const standby = process.env.GROQ_API_KEY
      ? fallbackBrief(input, 'error', 'groq').catch(() => null)
      : null
    groqAlreadyTried = standby !== null

    const attempt = await tryGroundedBrief(input)
    if (attempt.ok) return attempt.data
    reason = attempt.reason

    const ready = standby ? await standby : null
    if (ready) return { ...ready, fallback_reason: reason }
  }

  if (process.env.GROQ_API_KEY && !groqAlreadyTried) {
    try {
      return await fallbackBrief(input, reason, 'groq')
    } catch (error) {
      console.error(
        '[AI] Groq company brief fallback failed:',
        error instanceof Error ? error.message : 'Unknown error',
      )
    }
  }

  return fallbackBrief(input, reason)
}

// ---------------------------------------------------------------------------
// Usage limits
// ---------------------------------------------------------------------------

async function globalUsageToday(
  supabase: SupabaseClient,
  groundedOnly: boolean,
): Promise<number> {
  const { data, error } = await supabase.rpc('global_ai_usage_today', {
    grounded_only: groundedOnly,
  })

  if (error || typeof data !== 'number') {
    throw new Error('Unable to check shared AI usage.')
  }

  return data
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const handler: Handler = async (event) => {
  requestDeadline = Date.now() + REQUEST_BUDGET_MS()
  if (event.httpMethod !== 'POST') {
    return failure('INVALID_INPUT', 405, 'Only POST requests are supported.')
  }

  try {
    const authorization = event.headers.authorization

    if (!authorization?.startsWith('Bearer ')) {
      return failure('UNAUTHENTICATED', 401, 'Please log in to continue.')
    }

    const token = authorization.slice(7)

    const supabaseUrl = process.env.SUPABASE_URL
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('Supabase environment variables are missing.')
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })

    const { data: authData, error: authError } =
      await supabase.auth.getUser(token)

    if (authError || !authData.user) {
      return failure(
        'UNAUTHENTICATED',
        401,
        'Your session is invalid. Please log in again.',
      )
    }

    let body: Record<string, unknown>

    try {
      body = JSON.parse(event.body ?? '')
    } catch {
      return failure('INVALID_INPUT', 400, 'Invalid request body.')
    }

    const task = body.task

    if (
      typeof task !== 'string' ||
      !Object.prototype.hasOwnProperty.call(aiTasks, task)
    ) {
      return failure('INVALID_INPUT', 400, 'Unsupported AI task.')
    }

    const taskName = task as TaskName
    const config = aiTasks[taskName]
    const inputResult = config.input.safeParse(body.input)

    if (!inputResult.success) {
      return failure('INVALID_INPUT', 400, 'The supplied input is invalid.')
    }

    const input = inputResult.data
    const force = body.force === true
    const userId = authData.user.id

    const inputHash = createHash('sha256')
      .update(`${taskName}:${stableStringify(input)}`)
      .digest('hex')

    // 1. Cache. A hit costs no usage and no Gemini call.
    if (!force) {
      const { data: cached, error: cacheError } = await supabase
        .from('ai_cache')
        .select('response, created_at')
        .eq('task', taskName)
        .eq('input_hash', inputHash)
        .maybeSingle()

      if (cacheError) {
        // A broken cache must not block generation.
        console.error('[AI] Cache lookup failed.')
      } else if (cached) {
        const ageHours =
          (Date.now() - new Date(cached.created_at as string).getTime()) /
          3_600_000
        const stale =
          taskName === 'company_brief' && ageHours > COMPANY_BRIEF_CACHE_HOURS

        if (!stale) {
          const cachedResult = config.output.safeParse(cached.response)

          if (cachedResult.success) {
            return response(200, {
              ok: true,
              data: cachedResult.data,
              cached: true,
            })
          }
        }
      }
    }

    // 2. Per-user limits (see RATE_LIMITS in shared/schema.ts).
    const now = Date.now()
    const oneMinuteAgo = new Date(now - 60_000).toISOString()
    const oneDayAgo = new Date(now - 86_400_000).toISOString()

    const [minuteUsage, dailyUsage] = await Promise.all([
      supabase
        .from('ai_usage')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('created_at', oneMinuteAgo),

      supabase
        .from('ai_usage')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('created_at', oneDayAgo),
    ])

    if (minuteUsage.error || dailyUsage.error) {
      throw new Error('Unable to check AI usage limits.')
    }

    if (
      (minuteUsage.count ?? 0) >= RATE_LIMITS.perMinute ||
      (dailyUsage.count ?? 0) >= RATE_LIMITS.perDay
    ) {
      return failure(
        'RATE_LIMITED',
        429,
        'You have reached your AI usage limit. Please try again later.',
      )
    }

    // 3. Shared daily cap across all users. The project's Gemini quota is shared, so a
    // few testers could otherwise use it up for everyone.
    if ((await globalUsageToday(supabase, false)) >= GLOBAL_DAILY_AI_CAP()) {
      return failure(
        'BUSY',
        503,
        'KariyalyAI is very busy right now. Please try again shortly.',
      )
    }

    // 4. Decide whether this request may use search grounding.
    let grounding: { attempt: boolean; reason: FallbackReason } = {
      attempt: false,
      reason: 'disabled',
    }

    if (taskName === 'company_brief') {
      if (!groundingEnabled()) {
        grounding = { attempt: false, reason: 'disabled' }
      } else if (
        (await globalUsageToday(supabase, true)) >= GLOBAL_DAILY_GROUNDED_CAP()
      ) {
        grounding = { attempt: false, reason: 'quota' }
      } else {
        grounding = { attempt: true, reason: 'error' }
      }
    }

    // 5. Record the request immediately so failed generations still count
    // against the per-user and shared AI limits. Grounding is updated only
    // after the final output confirms that search grounding succeeded.
    const { data: usageRow, error: usageError } = await supabase
      .from('ai_usage')
      .insert({ task: taskName, grounded: false })
      .select('id')
      .single()

    if (usageError || !usageRow) {
      throw new Error('Unable to record AI usage.')
    }

    // 6. Generate and validate.
    let validatedOutput: unknown

    if (taskName === 'company_brief') {
      validatedOutput = await runCompanyBrief(
        input as CompanyBriefInputData,
        grounding,
      )
    } else {
      validatedOutput = await generateValidatedWithProviderFallback(
        TASK_PROMPTS[taskName],
        input,
        config.output as z.ZodType<unknown>,
      )
    }

    // Plain-code rule: LinkedIn messages never have a subject line.
    if (taskName === 'outreach') {
      const outreachInput = input as { channel: string }
      if (outreachInput.channel === 'linkedin') {
        validatedOutput = {
          ...(validatedOutput as Record<string, unknown>),
          subject: null,
        }
      }
    }

    const grounded =
      taskName === 'company_brief' &&
      (validatedOutput as CompanyBriefResult).grounded === true

    const { error: groundingUpdateError } = await supabase
      .from('ai_usage')
      .update({ grounded })
      .eq('id', usageRow.id)

    if (groundingUpdateError) {
      // The user already has a good result. Do not fail the request over bookkeeping.
      console.error('[AI] Unable to record AI grounding usage.')
    }

    // 7. Cache. Briefs that fell back are not cached, so the next request tries grounding
    // again instead of serving a brief with no news.
    const cacheable =
      taskName !== 'company_brief' ||
      (validatedOutput as CompanyBriefResult).grounded

    if (cacheable) {
      const { error: saveCacheError } = await supabase.from('ai_cache').upsert(
        {
          task: taskName,
          input_hash: inputHash,
          response: validatedOutput,
        },
        { onConflict: 'user_id,task,input_hash' },
      )

      if (saveCacheError) {
        // The user already has a good result. Do not fail the request over the cache.
        console.error('[AI] Unable to save the AI cache.')
      }
    }

    return response(200, {
      ok: true,
      data: validatedOutput,
      cached: false,
    })
  } catch (error) {
    if (error instanceof AiFailure) {
      return failure(error.code, error.status, error.message)
    }

    if (error instanceof GeminiProviderError) {
      console.error(
        '[AI] Gemini API request failed. HTTP status:',
        error.status,
      )

      if (error.status === 504) {
        return failure(
          'TIMEOUT',
          504,
          'The AI took too long to respond. Please try again.',
        )
      }

      const message =
        error.status === 429
          ? 'Gemini usage limit reached. Please try again later.'
          : `Gemini rejected the request (HTTP ${error.status}). Check your model and API configuration.`

      return failure('MODEL_ERROR', 502, message)
    }

    console.error(
      '[AI] Function error:',
      error instanceof Error ? error.message : 'Unknown error',
    )

    return failure(
      'MODEL_ERROR',
      500,
      'Something went wrong while processing your request.',
    )
  }
}
