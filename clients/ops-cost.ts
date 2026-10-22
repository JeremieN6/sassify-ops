/**
 * Client de telemetrie de couts vers Sassify Ops. A copier tel quel dans les SaaS TypeScript
 * (tifo: lib/ops-cost.ts, skincareapp: lib/ops-cost.ts). Version JS pour plotline : ops-cost.plotline.js.
 * Copie canonique : ops/clients/ops-cost.ts - garder les copies synchronisees.
 *
 * Variables d'environnement du SaaS (sans effet si absentes) :
 *   OPS_URL         ex: https://ops.sassify.fr
 *   OPS_INGEST_KEY  la meme valeur que NUXT_INGEST_KEY cote ops
 *
 * Regle d'or : la telemetrie ne doit JAMAIS casser ni ralentir l'app. Rien n'est attendu (fire and forget),
 * aucune erreur ne remonte, timeout de 10 s (demarrage a froid de Neon), circuit breaker apres 5 echecs consecutifs (pause 5 min).
 *
 * Les prix NE sont PAS ici : on envoie des tokens, ops calcule le cout (server/utils/pricing.ts).
 * Limites connues : les reponses en streaming ne sont pas comptees ; le cache Anthropic d'1 h est facture comme celui de 5 min.
 */

export type LlmUsage = {
  model: string
  inputTokens?: number // tokens d'entree NON mis en cache
  outputTokens?: number // sortie texte, reflexion incluse
  cacheReadTokens?: number
  cacheWriteTokens?: number
  imageInputTokens?: number
  imageOutputTokens?: number
}

export type CostEvent = {
  project: string
  provider: string
  endpoint?: string
  units?: number
  unitLabel?: string
  amount?: number // cout connu du SaaS ; sinon fournir `llm`
  currency?: 'EUR' | 'USD'
  llm?: LlmUsage
  occurredAt?: string
  meta?: Record<string, unknown>
}

let consecutiveFailures = 0
let pausedUntil = 0

export async function trackCost(event: CostEvent): Promise<void> {
  const url = process.env.OPS_URL
  const key = process.env.OPS_INGEST_KEY
  if (!url || !key || Date.now() < pausedUntil) {
    return
  }

  try {
    const response = await fetch(`${url.replace(/\/$/, '')}/api/ingest/cost`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ops-key': key },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(10_000)
    })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    consecutiveFailures = 0
  } catch {
    consecutiveFailures += 1
    if (consecutiveFailures >= 5) {
      pausedUntil = Date.now() + 5 * 60 * 1000
      consecutiveFailures = 0
    }
  }
}

type Obj = Record<string, unknown>
const obj = (value: unknown): Obj => (value && typeof value === 'object' ? (value as Obj) : {})
const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined
const str = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined)

// Branche un traitement sur une promesse sans la modifier ni la retarder, et sans jamais lever d'erreur.
function tap(promise: unknown, handler: (result: unknown) => void) {
  const thenable = promise as { then?: (ok: (value: unknown) => void, ko: () => void) => unknown } | null
  if (thenable && typeof thenable.then === 'function') {
    thenable.then(
      (result) => {
        try {
          handler(result)
        } catch {
          // la telemetrie n'a jamais le droit de casser l'app
        }
      },
      () => undefined
    )
  }
  return promise
}

// Remplace une methode par une version qui observe sa reponse. No-op si la methode n'existe pas ou est deja branchee.
const PATCHED = Symbol.for('sassify.ops.patched')

function patchMethod(target: Obj, name: string, onResult: (result: unknown, args: unknown[]) => void) {
  const original = target[name] as ((...args: unknown[]) => unknown) & { [PATCHED]?: boolean } | undefined
  if (typeof original !== 'function' || original[PATCHED]) {
    return
  }

  const wrapped = function (this: unknown, ...args: unknown[]) {
    const promise = original.apply(this, args)
    return tap(promise, (result) => onResult(result, args))
  } as typeof original
  wrapped[PATCHED] = true
  target[name] = wrapped
}

/** Anthropic : observe client.messages.create (hors streaming). */
export function instrumentAnthropic<T extends object>(client: T, project: string): T {
  patchMethod(obj(obj(client).messages), 'create', (message, args) => {
    if (obj(args[0]).stream === true) {
      return
    }
    const usage = obj(obj(message).usage)
    const model = str(obj(message).model) ?? str(obj(args[0]).model) ?? 'unknown'
    const hasUsage = Object.keys(usage).length > 0
    void trackCost({
      project,
      provider: 'anthropic',
      llm: hasUsage
        ? {
            model,
            inputTokens: num(usage.input_tokens),
            outputTokens: num(usage.output_tokens),
            cacheReadTokens: num(usage.cache_read_input_tokens),
            cacheWriteTokens: num(usage.cache_creation_input_tokens)
          }
        : { model }
    })
  })
  return client
}

/** OpenAI : observe chat.completions.create, images.generate et images.edit (hors streaming). */
export function instrumentOpenAI<T extends object>(client: T, project: string): T {
  const root = obj(client)

  patchMethod(obj(obj(root.chat).completions), 'create', (completion, args) => {
    if (obj(args[0]).stream === true) {
      return
    }
    const usage = obj(obj(completion).usage)
    const model = str(obj(completion).model) ?? str(obj(args[0]).model) ?? 'unknown'
    if (Object.keys(usage).length === 0) {
      void trackCost({ project, provider: 'openai', llm: { model } })
      return
    }
    // prompt_tokens INCLUT les tokens en cache : on les separe pour les facturer au bon tarif.
    const cached = num(obj(usage.prompt_tokens_details).cached_tokens) ?? 0
    const prompt = num(usage.prompt_tokens) ?? 0
    void trackCost({
      project,
      provider: 'openai',
      llm: {
        model,
        inputTokens: Math.max(0, prompt - cached),
        outputTokens: num(usage.completion_tokens),
        cacheReadTokens: cached
      }
    })
  })

  const trackImage = (response: unknown, args: unknown[]) => {
    const usage = obj(obj(response).usage)
    const model = str(obj(args[0]).model) ?? str(obj(response).model) ?? 'unknown'
    if (Object.keys(usage).length === 0) {
      void trackCost({ project, provider: 'openai', llm: { model } })
      return
    }
    const details = obj(usage.input_tokens_details)
    const textTokens = num(details.text_tokens)
    void trackCost({
      project,
      provider: 'openai',
      llm: {
        model,
        inputTokens: textTokens ?? num(usage.input_tokens),
        imageInputTokens: num(details.image_tokens),
        imageOutputTokens: num(usage.output_tokens) // gpt-image-1 : la sortie est faite de tokens d'image
      }
    })
  }
  const images = obj(root.images)
  patchMethod(images, 'generate', trackImage)
  patchMethod(images, 'edit', trackImage)

  return client
}
