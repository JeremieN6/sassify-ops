// Table de prix des modeles LLM (USD par million de tokens), source unique pour tous les SaaS :
// les SaaS envoient des tokens, ops calcule le cout. Un modele absent n'est JAMAIS devine :
// cout 0 + drapeau `priceMissing` (visible sur le dashboard).
//
// Conventions d'usage (a respecter cote client, voir clients/ops-cost.*) :
//   inputTokens      = tokens d'entree NON mis en cache (hors cacheRead/cacheWrite)
//   outputTokens     = tokens de sortie texte, reflexion incluse
//   imageInputTokens = tokens d'image en entree (si tarif different du texte)
//   imageOutputTokens= tokens d'image generee (si tarif different du texte)

export type LlmUsage = {
  model: string
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  imageInputTokens?: number
  imageOutputTokens?: number
}

type Rates = {
  input: number
  output: number
  cacheRead?: number
  cacheWrite?: number
  imageInput?: number
  imageOutput?: number
}

type PriceEntry = {
  provider: 'anthropic' | 'openai' | 'gemini'
  model: string
  rates: Rates | ((at: Date) => Rates)
  // official-page : lu verbatim sur la page tarifaire ; summary : resume non verbatim, a reverifier
  confidence: 'official-page' | 'summary'
  verifiedOn: string
}

const VERIFIED = '2026-10-19'
const GEMINI_FLASH_PRICE_CHANGE = new Date('2027-01-01T00:00:00Z')

const SONNET_4: Rates = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }

const PRICES: PriceEntry[] = [
  // Anthropic - https://platform.claude.com/docs/en/about-claude/pricing (cache: ecriture 5 min = 1.25x, lecture = 0.1x)
  { provider: 'anthropic', model: 'claude-sonnet-4-6', rates: SONNET_4, confidence: 'official-page', verifiedOn: VERIFIED },
  { provider: 'anthropic', model: 'claude-sonnet-4-20250514', rates: SONNET_4, confidence: 'official-page', verifiedOn: VERIFIED },
  { provider: 'anthropic', model: 'claude-sonnet-4-0', rates: SONNET_4, confidence: 'official-page', verifiedOn: VERIFIED },
  {
    provider: 'anthropic',
    model: 'claude-opus-4-5',
    rates: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
    confidence: 'official-page',
    verifiedOn: VERIFIED
  },

  // OpenAI - https://developers.openai.com/api/docs/pricing (Standard)
  {
    provider: 'openai',
    model: 'gpt-4.1-mini',
    rates: { input: 0.4, output: 1.6, cacheRead: 0.1 },
    confidence: 'official-page',
    verifiedOn: VERIFIED
  },
  {
    provider: 'openai',
    model: 'gpt-image-1',
    rates: { input: 5, output: 0, cacheRead: 1.25, imageInput: 10, imageOutput: 40 },
    confidence: 'official-page',
    verifiedOn: VERIFIED
  },

  // Gemini - https://ai.google.dev/gemini-api/docs/pricing (Standard, palier payant)
  {
    provider: 'gemini',
    model: 'gemini-3.8-flash',
    // Tarif promotionnel jusqu'au 31/12/2026 puis doublement (page tarifaire)
    rates: (at) =>
      at < GEMINI_FLASH_PRICE_CHANGE
        ? { input: 0.75, output: 3.75, cacheRead: 0.075 }
        : { input: 1.5, output: 7.5, cacheRead: 0.15 },
    confidence: 'official-page',
    verifiedOn: VERIFIED
  },
  {
    provider: 'gemini',
    model: 'gemini-3.1-flash-image',
    rates: { input: 0.5, output: 3, imageOutput: 60 },
    confidence: 'summary',
    verifiedOn: VERIFIED
  },
  {
    provider: 'gemini',
    model: 'gemini-3-pro-image-preview',
    rates: { input: 2, output: 12, imageOutput: 120 },
    confidence: 'summary',
    verifiedOn: VERIFIED
  },
  {
    provider: 'gemini',
    model: 'gemini-3-pro-image',
    rates: { input: 2, output: 12, imageOutput: 120 },
    confidence: 'summary',
    verifiedOn: VERIFIED
  }
]

// "claude-opus-4-5-20251101" ou "gpt-4.1-mini-2025-04-14" -> entree "claude-opus-4-5" / "gpt-4.1-mini".
// Seuls les suffixes de type date sont acceptes : "gpt-image-1-mini" ne doit PAS etre facture comme "gpt-image-1".
export function findPrice(provider: string, model: string) {
  const wanted = model.trim().toLowerCase().replace(/^models\//, '')
  return PRICES.find((entry) => {
    if (entry.provider !== provider.toLowerCase()) {
      return false
    }
    if (wanted === entry.model) {
      return true
    }
    return wanted.startsWith(`${entry.model}-`) && /^\d/.test(wanted.slice(entry.model.length + 1))
  })
}

export type LlmCost =
  | { priced: true; amountUsd: number; confidence: PriceEntry['confidence']; usedFallbackRate: boolean }
  | { priced: false; amountUsd: 0; reason: 'unknown_model' | 'usage_missing' }

export function computeLlmCost(provider: string, usage: LlmUsage, at: Date = new Date()): LlmCost {
  const entry = findPrice(provider, usage.model)
  if (!entry) {
    return { priced: false, amountUsd: 0, reason: 'unknown_model' }
  }

  const counts = [
    usage.inputTokens,
    usage.outputTokens,
    usage.cacheReadTokens,
    usage.cacheWriteTokens,
    usage.imageInputTokens,
    usage.imageOutputTokens
  ]
  if (counts.every((value) => value === undefined)) {
    return { priced: false, amountUsd: 0, reason: 'usage_missing' }
  }

  const rates = typeof entry.rates === 'function' ? entry.rates(at) : entry.rates
  let usedFallbackRate = false
  // Categorie utilisee mais sans tarif dedie : on retombe sur le tarif d'entree/sortie texte et on le signale.
  const part = (tokens: number | undefined, rate: number | undefined, fallback: number) => {
    if (!tokens) {
      return 0
    }
    if (rate === undefined) {
      usedFallbackRate = true
    }
    return tokens * (rate ?? fallback)
  }

  const amountUsd =
    (part(usage.inputTokens, rates.input, rates.input) +
      part(usage.outputTokens, rates.output, rates.output) +
      part(usage.cacheReadTokens, rates.cacheRead, rates.input) +
      part(usage.cacheWriteTokens, rates.cacheWrite, rates.input) +
      part(usage.imageInputTokens, rates.imageInput, rates.input) +
      part(usage.imageOutputTokens, rates.imageOutput, rates.output)) /
    1_000_000

  return { priced: true, amountUsd, confidence: entry.confidence, usedFallbackRate }
}
