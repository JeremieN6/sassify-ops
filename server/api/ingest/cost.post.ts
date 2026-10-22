import { z } from 'zod'

const tokenCount = z.number().int().min(0).max(100_000_000)

const llmSchema = z.object({
  model: z.string().min(1).max(120),
  inputTokens: tokenCount.optional(),
  outputTokens: tokenCount.optional(),
  cacheReadTokens: tokenCount.optional(),
  cacheWriteTokens: tokenCount.optional(),
  imageInputTokens: tokenCount.optional(),
  imageOutputTokens: tokenCount.optional()
})

// Soit `amount` (le SaaS connait le cout), soit `llm` (le SaaS envoie des tokens, ops calcule le cout).
const eventSchema = z
  .object({
    project: z.string().regex(/^[a-z0-9-]{2,40}$/, 'slug invalide (a-z, 0-9, tirets)'),
    provider: z.string().min(1).max(60),
    endpoint: z.string().max(120).optional(),
    units: z.number().min(0).optional(),
    unitLabel: z.string().max(30).optional(),
    amount: z.number().min(0).max(1_000_000).optional(),
    currency: z.enum(['EUR', 'USD']).default('EUR'),
    llm: llmSchema.optional(),
    occurredAt: z.string().datetime().optional(),
    meta: z.record(z.string(), z.unknown()).optional()
  })
  .refine((value) => value.amount !== undefined || value.llm !== undefined, {
    message: 'amount ou llm requis'
  })

type IngestEvent = z.infer<typeof eventSchema>

const bodySchema = z.union([
  eventSchema,
  z.object({ events: z.array(eventSchema).min(1).max(500) })
])

// Calcule montant/devise/unites/meta d'un evenement, en s'appuyant sur la table de prix pour les LLM.
function resolveCost(item: IngestEvent) {
  const meta: Record<string, unknown> = { ...(item.meta ?? {}) }

  if (!item.llm) {
    return {
      amount: item.amount as number,
      currency: item.currency,
      endpoint: item.endpoint ?? null,
      units: item.units ?? null,
      unitLabel: item.unitLabel ?? null,
      meta
    }
  }

  const occurredAt = item.occurredAt ? new Date(item.occurredAt) : new Date()
  const cost = computeLlmCost(item.provider, item.llm, occurredAt)
  const { model, ...tokens } = item.llm
  const totalTokens = Object.values(tokens).reduce((sum, value) => sum + (value ?? 0), 0)

  meta.llm = { model, ...tokens }
  if (!cost.priced) {
    meta.priceMissing = true
    meta.priceMissingReason = cost.reason
  } else {
    meta.priceConfidence = cost.confidence
    if (cost.usedFallbackRate) {
      meta.priceFallbackRate = true
    }
  }

  // Si le SaaS fournit aussi un montant, il prime (mais les tokens restent traces en meta).
  const useProvidedAmount = item.amount !== undefined
  return {
    amount: useProvidedAmount ? (item.amount as number) : cost.amountUsd,
    currency: useProvidedAmount ? item.currency : ('USD' as const),
    endpoint: item.endpoint ?? model,
    units: item.units ?? totalTokens,
    unitLabel: item.unitLabel ?? 'tokens',
    meta
  }
}

export default defineEventHandler(async (event) => {
  const { ingestKey } = useRuntimeConfig()
  const provided = getRequestHeader(event, 'x-ops-key') || ''
  if (!ingestKey || !safeEqual(provided, ingestKey)) {
    throw createError({ statusCode: 401, statusMessage: 'Cle invalide' })
  }

  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message ?? 'Payload invalide' })
  }

  const events = 'events' in parsed.data ? parsed.data.events : [parsed.data]

  for (const item of events) {
    if (item.meta && JSON.stringify(item.meta).length > 2000) {
      throw createError({ statusCode: 400, statusMessage: 'meta trop volumineux (2000 caracteres max)' })
    }
  }

  const slugs = [...new Set(events.map((item) => item.project))]
  const projects = await Promise.all(
    slugs.map((slug) =>
      prisma.project.upsert({ where: { slug }, update: {}, create: { slug, name: slug } })
    )
  )
  const projectIds = new Map(projects.map((project) => [project.slug, project.id]))

  await prisma.costEvent.createMany({
    data: events.map((item) => {
      const resolved = resolveCost(item)
      return {
        projectId: projectIds.get(item.project)!,
        provider: item.provider.toLowerCase(),
        endpoint: resolved.endpoint,
        units: resolved.units,
        unitLabel: resolved.unitLabel,
        amount: resolved.amount,
        currency: resolved.currency,
        amountEur: toEur(resolved.amount, resolved.currency),
        occurredAt: item.occurredAt ? new Date(item.occurredAt) : new Date(),
        meta: resolved.meta as object
      }
    })
  })

  return { ok: true, count: events.length }
})
