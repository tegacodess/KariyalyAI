/**
 * A fake fetch that stands in for Supabase, Gemini and Groq, so the ai function can be
 * tested without real accounts, network access or quota. Each test sets the behaviour
 * it needs on `state` and inspects what the function sent.
 */
import type { HandlerResponse } from '@netlify/functions'

export type ProviderMode = 'ok' | 'hang' | 'http503' | 'http429' | 'network' | 'badjson'

export interface GeminiRequest {
  search: boolean
  json: boolean
  system: string
  user: string
}

export interface FakeState {
  validUser: boolean
  minuteCount: number
  dayCount: number
  globalTotal: number
  globalGrounded: number
  cacheRow: { response: unknown; created_at: string } | null
  failGroundingUpdate: boolean
  /** What Gemini returns for each call. Defaults to `geminiReply`. */
  gemini: (request: GeminiRequest, signal: AbortSignal) => Promise<Response>
  /** What Groq returns. Defaults to `groqReply`. */
  groq: (body: Record<string, unknown>, signal: AbortSignal) => Promise<Response>
  geminiCalls: GeminiRequest[]
  groqCalls: Record<string, unknown>[]
  usageInserts: Record<string, unknown>[]
  usageUpdates: Record<string, unknown>[]
  cacheUpserts: Record<string, unknown>[]
}

export function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

/** A Gemini response body with text and optional grounding sources. */
export function geminiBody(text: string, sources?: Array<{ uri: string; title: string }>) {
  return {
    candidates: [
      {
        content: { parts: [{ text }] },
        ...(sources
          ? { groundingMetadata: { groundingChunks: sources.map((web) => ({ web })) } }
          : {}),
      },
    ],
  }
}

export function groqBody(text: string) {
  return { choices: [{ message: { content: text } }] }
}

/** Builds a provider reply for a failure mode, honouring the abort signal for "hang". */
export function providerFailure(mode: ProviderMode, signal: AbortSignal): Promise<Response> {
  switch (mode) {
    case 'hang':
      return new Promise((_, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason)),
      )
    case 'network':
      return Promise.reject(new TypeError('fetch failed'))
    case 'http503':
      return Promise.resolve(json(503, {}))
    case 'http429':
      return Promise.resolve(json(429, {}))
    default:
      throw new Error(`providerFailure does not handle "${mode}"`)
  }
}

/** A provider reply that arrives after `ms`, unless the call is aborted first. */
export function delayed(ms: number, body: unknown, signal: AbortSignal): Promise<Response> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(json(200, body)), ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(signal.reason)
    })
  })
}

export function createFakeServices() {
  const state: FakeState = {
    validUser: true,
    minuteCount: 0,
    dayCount: 0,
    globalTotal: 0,
    globalGrounded: 0,
    cacheRow: null,
    failGroundingUpdate: false,
    gemini: async () => {
      throw new Error('Set state.gemini in the test.')
    },
    groq: async () => {
      throw new Error('Set state.groq in the test.')
    },
    geminiCalls: [],
    groqCalls: [],
    usageInserts: [],
    usageUpdates: [],
    cacheUpserts: [],
  }

  const fakeFetch = async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init.method ?? 'GET').toUpperCase()
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined

    if (url.includes('generativelanguage.googleapis.com')) {
      const request: GeminiRequest = {
        search: Array.isArray(body?.tools),
        json: body?.generationConfig?.responseMimeType === 'application/json',
        system: body?.systemInstruction?.parts?.[0]?.text ?? '',
        user: body?.contents?.[0]?.parts?.[0]?.text ?? '',
      }
      state.geminiCalls.push(request)
      return state.gemini(request, init.signal as AbortSignal)
    }

    if (url.includes('api.groq.com')) {
      state.groqCalls.push(body)
      return state.groq(body, init.signal as AbortSignal)
    }

    if (url.includes('/auth/v1/user')) {
      return state.validUser
        ? json(200, { id: 'user-1', aud: 'authenticated', role: 'authenticated' })
        : json(401, { message: 'invalid JWT' })
    }

    if (url.includes('/rpc/global_ai_usage_today')) {
      return json(200, body?.grounded_only ? state.globalGrounded : state.globalTotal)
    }

    if (url.includes('/rest/v1/ai_cache')) {
      if (method === 'POST') {
        state.cacheUpserts.push(body)
        return json(201, null)
      }
      return json(200, state.cacheRow)
    }

    if (url.includes('/rest/v1/ai_usage')) {
      if (method === 'POST') {
        state.usageInserts.push(body)
        return json(201, { id: `usage-${state.usageInserts.length}` })
      }
      if (method === 'PATCH') {
        state.usageUpdates.push(body)
        return state.failGroundingUpdate ? json(500, { message: 'boom' }) : json(204, null)
      }
      // HEAD count queries: the per-minute window starts about a minute ago.
      const since = decodeURIComponent(url.match(/created_at=gte\.([^&]+)/)?.[1] ?? '')
      const ageMs = Date.now() - Date.parse(since)
      const count = ageMs < 120_000 ? state.minuteCount : state.dayCount
      return new Response(null, { status: 200, headers: { 'content-range': `*/${count}` } })
    }

    throw new Error(`Unexpected request in test: ${method} ${url}`)
  }

  return { state, fakeFetch }
}

export interface CallResult {
  status: number
  body: {
    ok: boolean
    data?: Record<string, unknown>
    cached?: boolean
    error?: { code: string; message: string }
  }
  ms: number
}

type AnyHandler = (event: never, context: never) => Promise<HandlerResponse | void> | void

/** Invokes the Netlify handler with a POST body and parses the JSON reply. */
export async function invoke(
  handler: AnyHandler,
  body: unknown,
  options: { method?: string; token?: string | null } = {},
): Promise<CallResult> {
  const started = Date.now()
  const token = options.token === undefined ? 'test-token' : options.token
  const event = {
    httpMethod: options.method ?? 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }
  const response = (await handler(event as never, {} as never)) as HandlerResponse
  return {
    status: response.statusCode,
    body: JSON.parse(response.body ?? '{}'),
    ms: Date.now() - started,
  }
}
