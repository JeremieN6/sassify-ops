import { z } from 'zod'

const querySchema = z.object({ status: z.enum(['all', 'open', 'ack', 'done']).default('all') })

const STATUS = { open: 'OPEN', ack: 'ACKNOWLEDGED', done: 'RESOLVED' } as const

export default defineEventHandler(async (event) => {
  const { status } = querySchema.parse(getQuery(event))
  const since = new Date(Date.now() - 7 * 86_400_000)
  await ensureRules()

  // Historique sur 7 jours + toute alerte encore active, quel que soit son age
  const scope = { OR: [{ openedAt: { gte: since } }, { status: { in: ['OPEN', 'ACKNOWLEDGED'] as ('OPEN' | 'ACKNOWLEDGED')[] } }] }

  const [rows, grouped, rules, budget] = await Promise.all([
    prisma.alert.findMany({
      where: status === 'all' ? scope : { AND: [scope, { status: STATUS[status] }] },
      orderBy: [{ openedAt: 'desc' }],
      take: 100
    }),
    prisma.alert.groupBy({ by: ['status'], where: scope, _count: true }),
    prisma.alertRule.findMany({ orderBy: { key: 'asc' } }),
    getBudgetEur()
  ])

  const count = (value: string) => grouped.find((row) => row.status === value)?._count ?? 0
  const params = (key: string) => (rules.find((rule) => rule.key === key)?.params ?? {}) as Record<string, number>

  // Libelles lisibles construits a partir des parametres courants
  const describe = (key: string, fallback: string) => {
    switch (key) {
      case 'service_down':
        return 'Service injoignable (2 vérifications consécutives)'
      case 'latency_high':
        return `Latence p95 > ${params(key).thresholdMs ?? 800} ms pendant ${params(key).windowMin ?? 10} min`
      case 'cert_expiry':
        return `Certificat SSL qui expire dans moins de ${params(key).days ?? 14} jours`
      case 'budget_threshold':
        return `Budget à ${params(key).pct ?? 85} % du plafond mensuel`
      default:
        return fallback
    }
  }

  return {
    counts: { all: count('OPEN') + count('ACKNOWLEDGED') + count('RESOLVED'), open: count('OPEN'), ack: count('ACKNOWLEDGED'), done: count('RESOLVED') },
    rows: rows.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      source: row.source,
      severity: row.severity,
      status: row.status,
      openedAt: row.openedAt.toISOString(),
      resolvedAt: row.resolvedAt?.toISOString() ?? null
    })),
    // Ordre de RULE_DEFS (gravité puis type), pas l'ordre alphabétique des clés
    rules: [...rules]
      .sort((a, b) => RULE_DEFS.findIndex((def) => def.key === a.key) - RULE_DEFS.findIndex((def) => def.key === b.key))
      .map((rule) => ({ key: rule.key, label: describe(rule.key, rule.label), severity: rule.severity, enabled: rule.enabled })),
    budgetEur: budget,
    telegramConfigured: isTelegramConfigured()
  }
})
