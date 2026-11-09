import { SERVER_METRIC_RETENTION_DAYS, resolveCapturedAt, serverMetricSchema } from '../../utils/serverIngest'

// Reception des mesures de l'agent installe sur le VPS (voir agent/). Meme cle que les couts : en-tete `x-ops-key`.
// Purge opportuniste des mesures de plus de 7 jours, au plus une fois par heure par processus.
let lastPurgeAt = 0

export default defineEventHandler(async (event) => {
  const { ingestKey } = useRuntimeConfig()
  const provided = getRequestHeader(event, 'x-ops-key') || ''
  if (!ingestKey || !safeEqual(provided, ingestKey)) {
    throw createError({ statusCode: 401, statusMessage: 'Cle invalide' })
  }

  const parsed = serverMetricSchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message ?? 'Payload invalide' })
  }
  const metric = parsed.data

  await prisma.serverMetric.create({
    data: {
      host: metric.host,
      capturedAt: resolveCapturedAt(metric.capturedAt),
      cpuPct: metric.cpuPct ?? null,
      memPct: metric.memPct ?? null,
      diskPct: metric.diskPct ?? null,
      netOutMbps: metric.netOutMbps ?? null,
      payload: { processes: metric.processes }
    }
  })

  if (Date.now() - lastPurgeAt > 3_600_000) {
    lastPurgeAt = Date.now()
    const cutoff = new Date(Date.now() - SERVER_METRIC_RETENTION_DAYS * 24 * 3_600_000)
    void prisma.serverMetric.deleteMany({ where: { capturedAt: { lt: cutoff } } }).catch(() => undefined)
  }

  return { ok: true }
})
