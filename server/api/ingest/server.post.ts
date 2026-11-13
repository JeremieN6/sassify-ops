import { resolveCapturedAt, serverMetricSchema } from '../../utils/serverIngest'
import { getMetricStore } from '../../utils/metricStore'

// Reception des mesures de l'agent installe sur le VPS (voir agent/). Meme cle que les couts : en-tete `x-ops-key`.
// Les mesures vont dans un fichier LOCAL (server/utils/metricStore.ts), pas dans Neon : ecrire chaque minute y maintenait la base
// eveillee en permanence (incident du 2026-11-13). Aucun acces a la base ici.

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

  await getMetricStore().append({
    host: metric.host,
    capturedAt: resolveCapturedAt(metric.capturedAt),
    cpuPct: metric.cpuPct ?? null,
    memPct: metric.memPct ?? null,
    diskPct: metric.diskPct ?? null,
    netOutMbps: metric.netOutMbps ?? null,
    payload: metric.processes ? { processes: metric.processes } : null
  })

  return { ok: true }
})
