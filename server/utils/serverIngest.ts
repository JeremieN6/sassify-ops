// Schema de reception des mesures serveur (agent VPS -> Sassify Ops). Pur : testable sans Nuxt ni base.
import { z } from 'zod'

const pct = z.number().min(0).max(100)

export const processSchema = z.object({
  name: z.string().min(1).max(80),
  cpu: z.number().min(0).max(100_000).optional(), // % d'un coeur, peut depasser 100 sur plusieurs coeurs
  memMb: z.number().min(0).max(1_000_000).optional(),
  restarts: z.number().int().min(0).max(10_000_000).optional(),
  uptime: z.string().max(40).optional(),
  status: z.string().max(20).optional()
})

export const serverMetricSchema = z.object({
  host: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,60}$/, 'nom de machine invalide (a-z, 0-9, points, tirets)'),
  cpuPct: pct.nullable().optional(),
  memPct: pct.nullable().optional(),
  diskPct: pct.nullable().optional(),
  netOutMbps: z.number().min(0).max(100_000).nullable().optional(),
  processes: z.array(processSchema).max(80).default([]),
  capturedAt: z.string().datetime().optional()
})

export type ServerMetricInput = z.infer<typeof serverMetricSchema>

export const SERVER_METRIC_RETENTION_DAYS = 7

// Date de mesure : celle de l'agent si elle est plausible (pas dans le futur, pas plus vieille que 10 min), sinon maintenant.
export function resolveCapturedAt(input: string | undefined, now: Date = new Date()): Date {
  if (!input) {
    return now
  }
  const at = new Date(input)
  const age = now.getTime() - at.getTime()
  return Number.isNaN(at.getTime()) || age < -60_000 || age > 10 * 60_000 ? now : at
}
