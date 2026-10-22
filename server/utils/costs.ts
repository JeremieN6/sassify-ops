// Calcul des couts partage par /api/costs/summary, /api/overview et l'alerte de budget.

export type CostRange = '7d' | '30d' | '90d' | 'month' | 'lastmonth'

const DAY = 86_400_000

export function resolveRange(range: CostRange) {
  const now = new Date()
  const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const tomorrow = new Date(startOfToday.getTime() + DAY)

  switch (range) {
    case '7d':
      return { from: new Date(tomorrow.getTime() - 7 * DAY), to: tomorrow }
    case '90d':
      return { from: new Date(tomorrow.getTime() - 90 * DAY), to: tomorrow }
    case 'month':
      return { from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), to: tomorrow }
    case 'lastmonth':
      return {
        from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)),
        to: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
      }
    default:
      return { from: new Date(tomorrow.getTime() - 30 * DAY), to: tomorrow }
  }
}

export async function getBudgetEur(): Promise<number | null> {
  const row = await prisma.setting.findUnique({ where: { key: 'monthly_budget_eur' } })
  const value = row ? Number(row.value) : NaN
  return Number.isFinite(value) && value > 0 ? value : null
}

// Total (variable + fixe) d'une fenetre, sans le detail : sert aux comparaisons et au budget.
export async function totalsFor(from: Date, to: Date) {
  const where = { occurredAt: { gte: from, lt: to } }
  const [sum, fixedCosts] = await Promise.all([
    prisma.costEvent.aggregate({ where, _sum: { amountEur: true } }),
    prisma.fixedCost.findMany({
      where: { startsOn: { lt: to }, OR: [{ endsOn: null }, { endsOn: { gt: from } }] }
    })
  ])
  const variable = Number(sum._sum.amountEur ?? 0)
  const fixed = fixedCosts.reduce(
    (total, item) =>
      total +
      fixedCostInRange(
        { amountEur: Number(item.amountEur), period: item.period, startsOn: item.startsOn, endsOn: item.endsOn },
        from,
        to
      ),
    0
  )
  return { variable, fixed, total: variable + fixed }
}

export async function monthSpendEur() {
  const { from, to } = resolveRange('month')
  return (await totalsFor(from, to)).total
}

export async function getCostSummary(range: CostRange) {
  const { from, to } = resolveRange(range)
  const where = { occurredAt: { gte: from, lt: to } }

  const [projects, byProjectRows, byProviderRows, dailyRows, recent, fixedCosts, unpriced, previous, budget] = await Promise.all([
    prisma.project.findMany({ select: { id: true, slug: true, name: true } }),
    prisma.costEvent.groupBy({ by: ['projectId'], where, _sum: { amountEur: true }, _count: true }),
    prisma.costEvent.groupBy({
      by: ['provider'],
      where,
      _sum: { amountEur: true, units: true },
      _count: true
    }),
    prisma.$queryRaw<{ day: Date; total: unknown }[]>`
      SELECT date_trunc('day', ("occurredAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Paris') AS day,
             SUM("amountEur") AS total
      FROM "CostEvent"
      WHERE "occurredAt" >= ${from} AND "occurredAt" < ${to}
      GROUP BY 1
      ORDER BY 1
    `,
    prisma.costEvent.findMany({
      where,
      orderBy: { occurredAt: 'desc' },
      take: 25,
      include: { project: { select: { slug: true } } }
    }),
    prisma.fixedCost.findMany({
      where: { startsOn: { lt: to }, OR: [{ endsOn: null }, { endsOn: { gt: from } }] }
    }),
    // Appels LLM dont le modele n'a pas de tarif connu (cout compte a 0) : a corriger dans server/utils/pricing.ts
    prisma.costEvent.count({ where: { ...where, meta: { path: ['priceMissing'], equals: true } } }),
    totalsFor(new Date(from.getTime() - (to.getTime() - from.getTime())), from),
    getBudgetEur()
  ])

  const slugById = new Map(projects.map((project) => [project.id, project]))

  type Line = { variable: number; fixed: number; events: number; units: number }
  const byProject = new Map<string, Line & { name: string }>()
  const byProvider = new Map<string, Line>()

  const lineFor = <T extends Line>(map: Map<string, T>, key: string, create: () => T) => {
    let line = map.get(key)
    if (!line) {
      line = create()
      map.set(key, line)
    }
    return line
  }

  for (const row of byProjectRows) {
    const project = slugById.get(row.projectId)
    const key = project?.slug ?? row.projectId
    const line = lineFor(byProject, key, () => ({ name: project?.name ?? key, variable: 0, fixed: 0, events: 0, units: 0 }))
    line.variable += Number(row._sum.amountEur ?? 0)
    line.events += row._count
  }

  for (const row of byProviderRows) {
    const line = lineFor(byProvider, row.provider, () => ({ variable: 0, fixed: 0, events: 0, units: 0 }))
    line.variable += Number(row._sum.amountEur ?? 0)
    line.events += row._count
    line.units += Number(row._sum.units ?? 0)
  }

  const SHARED = 'infrastructure'
  let fixedTotal = 0
  for (const fixed of fixedCosts) {
    const share = fixedCostInRange(
      { amountEur: Number(fixed.amountEur), period: fixed.period, startsOn: fixed.startsOn, endsOn: fixed.endsOn },
      from,
      to
    )
    if (share <= 0) {
      continue
    }
    fixedTotal += share

    const project = fixed.projectId ? slugById.get(fixed.projectId) : undefined
    const projectKey = project?.slug ?? SHARED
    lineFor(byProject, projectKey, () => ({
      name: project?.name ?? 'Infrastructure partagée',
      variable: 0,
      fixed: 0,
      events: 0,
      units: 0
    })).fixed += share

    lineFor(byProvider, fixed.provider.toLowerCase(), () => ({ variable: 0, fixed: 0, events: 0, units: 0 })).fixed += share
  }

  const variableTotal = [...byProject.values()].reduce((sum, line) => sum + line.variable, 0)

  const rank = <T extends Line>(entries: [string, T][]) =>
    entries
      .map(([key, line]) => ({ key, ...line, total: line.variable + line.fixed }))
      .sort((a, b) => b.total - a.total)

  const total = variableTotal + fixedTotal
  return {
    range,
    from: from.toISOString(),
    to: to.toISOString(),
    totals: { variable: variableTotal, fixed: fixedTotal, total },
    previousTotal: previous.total,
    deltaPct: previous.total > 0 ? ((total - previous.total) / previous.total) * 100 : null,
    budgetEur: budget,
    unpriced,
    byProject: rank([...byProject.entries()]),
    byProvider: rank([...byProvider.entries()]),
    daily: dailyRows.map((row) => ({ day: row.day.toISOString().slice(0, 10), total: Number(row.total) })),
    recent: recent.map((item) => ({
      id: item.id,
      project: item.project.slug,
      provider: item.provider,
      endpoint: item.endpoint,
      units: item.units,
      unitLabel: item.unitLabel,
      amountEur: Number(item.amountEur),
      occurredAt: item.occurredAt.toISOString()
    }))
  }
}
