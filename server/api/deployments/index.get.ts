import { z } from 'zod'

const querySchema = z.object({ env: z.enum(['all', 'production', 'preview']).default('all') })

export default defineEventHandler(async (event) => {
  const { env } = querySchema.parse(getQuery(event))
  const since = new Date(Date.now() - 7 * 86_400_000)

  const [rows, last7, totals] = await Promise.all([
    prisma.deployment.findMany({
      where: env === 'all' ? {} : { environment: env },
      orderBy: { startedAt: 'desc' },
      take: 50,
      include: { project: { select: { slug: true, name: true } } }
    }),
    prisma.deployment.findMany({ where: { startedAt: { gte: since } }, select: { startedAt: true, status: true, durationSec: true } }),
    prisma.deployment.groupBy({ by: ['environment'], _count: true })
  ])

  // 7 derniers jours (fuseau de Paris), du plus ancien au plus recent
  const fmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', timeZone: 'Europe/Paris' })
  const key = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(date)
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(Date.now() - (6 - index) * 86_400_000)
    return { key: key(date), label: fmt.format(date).replace('.', ''), total: 0, failed: 0 }
  })
  for (const item of last7) {
    const day = days.find((d) => d.key === key(item.startedAt))
    if (day) {
      day.total += 1
      if (item.status === 'FAILED') day.failed += 1
    }
  }

  const finished = last7.filter((item) => item.status !== 'RUNNING')
  const durations = last7.map((item) => item.durationSec).filter((value): value is number => value !== null)
  const counts = Object.fromEntries(totals.map((row) => [row.environment, row._count]))

  return {
    counts: { all: totals.reduce((n, row) => n + row._count, 0), production: counts.production ?? 0, preview: counts.preview ?? 0 },
    summary: {
      total7d: last7.length,
      failed7d: last7.filter((item) => item.status === 'FAILED').length,
      successRate: finished.length ? (finished.filter((item) => item.status === 'SUCCESS').length / finished.length) * 100 : null,
      avgDurationSec: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null
    },
    days: days.map(({ label, total, failed }) => ({ label, total, failed })),
    rows: rows.map((row) => ({
      id: row.id,
      project: row.project.name,
      environment: row.environment,
      status: row.status,
      commit: row.commitSha.slice(0, 7),
      message: row.message,
      branch: row.branch,
      durationSec: row.durationSec,
      startedAt: row.startedAt.toISOString(),
      runUrl: row.runUrl
    }))
  }
})
