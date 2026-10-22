// Donnees de l'ecran "Vue d'ensemble" : services, alertes, couts, derniers deploiements.
export default defineEventHandler(async () => {
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000)

  const [services, costs, alerts, openBySeverity, recentDeployments, deploys7d, failed7d] = await Promise.all([
    getServicesView(),
    getCostSummary('30d'),
    prisma.alert.findMany({
      where: { status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
      orderBy: [{ severity: 'asc' }, { openedAt: 'desc' }],
      take: 3
    }),
    prisma.alert.groupBy({ by: ['severity'], where: { status: 'OPEN' }, _count: true }),
    prisma.deployment.findMany({ orderBy: { startedAt: 'desc' }, take: 5, include: { project: { select: { slug: true, name: true } } } }),
    prisma.deployment.count({ where: { startedAt: { gte: sevenDaysAgo } } }),
    prisma.deployment.count({ where: { startedAt: { gte: sevenDaysAgo }, status: 'FAILED' } })
  ])

  const measured = services.filter((service) => service.uptime30 !== null)
  const availability = measured.length ? measured.reduce((sum, service) => sum + (service.uptime30 as number), 0) / measured.length : null
  const count = (health: string) => services.filter((service) => service.health === health).length
  const severityCount = (severity: string) => openBySeverity.find((row) => row.severity === severity)?._count ?? 0

  return {
    monitoring: monitoringStatus(),
    summary: { total: services.length, up: count('up'), degraded: count('degraded'), down: count('down'), unknown: count('unknown') },
    services,
    kpis: {
      availability30: availability,
      costs30: costs.totals.total,
      costsDeltaPct: costs.deltaPct,
      budgetEur: costs.budgetEur,
      deploys7d,
      deploysFailed7d: failed7d,
      openAlerts: severityCount('CRITICAL') + severityCount('WARNING'),
      openCritical: severityCount('CRITICAL'),
      openWarning: severityCount('WARNING')
    },
    cost: {
      variable: costs.totals.variable,
      events: costs.byProvider.reduce((sum, line) => sum + line.events, 0),
      daily: costs.daily
    },
    alerts: alerts.map((alert) => ({
      id: alert.id,
      title: alert.title,
      severity: alert.severity,
      status: alert.status,
      source: alert.source,
      openedAt: alert.openedAt.toISOString()
    })),
    deployments: recentDeployments.map((deployment) => ({
      id: deployment.id,
      project: deployment.project.name,
      environment: deployment.environment,
      status: deployment.status,
      message: deployment.message,
      startedAt: deployment.startedAt.toISOString()
    }))
  }
})
