// Moteur d'alertes : ouverture / resolution / notification, avec un cache memoire des alertes ouvertes
// pour ne JAMAIS lire la base a chaque tour de sonde (Neon gratuit : voir prisma/schema.prisma).
import { DEFAULT_RULES, desiredBudgetAlert, type DesiredAlert, type RuleSet } from './uptime'

export const RULE_DEFS = [
  { key: 'service_down', label: 'Service injoignable (2 vérifications consécutives)', severity: 'CRITICAL', params: null },
  { key: 'latency_high', label: 'Latence p95 élevée sur une fenêtre glissante', severity: 'CRITICAL', params: { thresholdMs: 800, windowMin: 10 } },
  { key: 'cert_expiry', label: 'Certificat SSL proche de l’expiration', severity: 'WARNING', params: { days: 14 } },
  { key: 'deploy_failed', label: 'Déploiement en production échoué', severity: 'WARNING', params: null },
  { key: 'budget_threshold', label: 'Budget mensuel proche du plafond', severity: 'WARNING', params: { pct: 85 } }
] as const

type Cache = {
  openFp: Set<string> | null
  rules: { at: number; set: RuleSet; enabled: Record<string, boolean>; budgetPct: number } | null
  lastBudgetCheck: number
}
const g = globalThis as unknown as { __opsAlerts?: Cache }
const cache = (): Cache => (g.__opsAlerts ??= { openFp: null, rules: null, lastBudgetCheck: 0 })

export async function ensureRules() {
  const existing = await prisma.alertRule.findMany({ select: { key: true } })
  const have = new Set(existing.map((rule) => rule.key))
  const missing = RULE_DEFS.filter((def) => !have.has(def.key))
  if (missing.length) {
    await prisma.alertRule.createMany({
      data: missing.map((def) => ({ key: def.key, label: def.label, severity: def.severity, params: def.params ?? undefined })),
      skipDuplicates: true
    })
  }
}

export function invalidateRules() {
  cache().rules = null
}

// Regles chargees depuis la base au plus une fois par heure (invalidees quand on les modifie).
export async function getRuleConfig() {
  const c = cache()
  if (c.rules && Date.now() - c.rules.at < 3_600_000) {
    return c.rules
  }
  await ensureRules()
  const rows = await prisma.alertRule.findMany()
  const byKey = new Map(rows.map((row) => [row.key, row]))
  const params = (key: string) => (byKey.get(key)?.params ?? {}) as Record<string, number>
  const enabled = (key: string) => byKey.get(key)?.enabled ?? true

  const set: RuleSet = {
    service_down: { enabled: enabled('service_down') },
    latency_high: {
      enabled: enabled('latency_high'),
      thresholdMs: params('latency_high').thresholdMs ?? DEFAULT_RULES.latency_high.thresholdMs,
      windowMin: params('latency_high').windowMin ?? DEFAULT_RULES.latency_high.windowMin
    },
    cert_expiry: { enabled: enabled('cert_expiry'), days: params('cert_expiry').days ?? DEFAULT_RULES.cert_expiry.days }
  }
  c.rules = {
    at: Date.now(),
    set,
    enabled: Object.fromEntries(RULE_DEFS.map((def) => [def.key, enabled(def.key)])),
    budgetPct: params('budget_threshold').pct ?? 85
  }
  return c.rules
}

async function openFingerprints() {
  const c = cache()
  if (!c.openFp) {
    const rows = await prisma.alert.findMany({
      where: { status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
      select: { fingerprint: true }
    })
    c.openFp = new Set(rows.map((row) => row.fingerprint))
  }
  return c.openFp
}

export async function openAlert(alert: DesiredAlert) {
  const open = await openFingerprints()
  if (open.has(alert.fingerprint)) {
    return
  }
  const created = await prisma.alert.create({
    data: {
      fingerprint: alert.fingerprint,
      rule: alert.rule,
      severity: alert.severity,
      title: alert.title,
      description: alert.description,
      source: alert.source
    }
  })
  open.add(alert.fingerprint)
  if (await sendTelegram(formatAlertMessage(alert, 'open'))) {
    await prisma.alert.update({ where: { id: created.id }, data: { notifiedAt: new Date() } })
  }
}

export async function resolveAlert(fingerprint: string) {
  const open = await openFingerprints()
  const current = await prisma.alert.findFirst({
    where: { fingerprint, status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
    orderBy: { openedAt: 'desc' }
  })
  await prisma.alert.updateMany({
    where: { fingerprint, status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
    data: { status: 'RESOLVED', resolvedAt: new Date() }
  })
  open.delete(fingerprint)
  if (current) {
    // Resolution : message silencieux (seuls les incidents doivent faire sonner le telephone)
    await sendTelegram(formatAlertMessage({ severity: current.severity, title: current.title, source: current.source }, 'resolved'), { silent: true })
  }
}

/**
 * Aligne les alertes ouvertes sur l'ensemble des alertes souhaitees pour les regles de `scope`.
 * `hold(fp)` : empeche de RESOUDRE une alerte quand on n'a pas assez de mesures pour conclure
 * (ex: juste apres un redemarrage), afin d'eviter ouverture/fermeture en boucle.
 */
export async function reconcileAlerts(
  scope: string[],
  desired: DesiredAlert[],
  opts: { enrich?: (alert: DesiredAlert) => Promise<DesiredAlert>; hold?: (fingerprint: string) => boolean } = {}
) {
  const open = await openFingerprints()
  const desiredFps = new Set(desired.map((alert) => alert.fingerprint))

  for (const alert of desired) {
    if (!open.has(alert.fingerprint)) {
      await openAlert(opts.enrich ? await opts.enrich(alert) : alert)
    }
  }
  for (const fingerprint of [...open]) {
    const rule = fingerprint.split(':')[0]
    if (scope.includes(rule) && !desiredFps.has(fingerprint) && !opts.hold?.(fingerprint)) {
      await resolveAlert(fingerprint)
    }
  }
}

// Si un deploiement en production precede de peu l'incident, on le dit dans l'alerte.
export async function correlateDeployment(projectSlug: string | null, now = Date.now()) {
  if (!projectSlug) {
    return null
  }
  const deployment = await prisma.deployment.findFirst({
    where: {
      project: { slug: projectSlug },
      environment: 'production',
      startedAt: { gte: new Date(now - 90 * 60_000), lte: new Date(now) }
    },
    orderBy: { startedAt: 'desc' }
  })
  if (!deployment) {
    return null
  }
  const minutes = Math.max(0, Math.round((now - deployment.startedAt.getTime()) / 60_000))
  return `Détectée ${minutes} minute${minutes > 1 ? 's' : ''} après le déploiement ${deployment.commitSha.slice(0, 7)}.`
}

// Verification du budget : au plus une fois toutes les 10 minutes (appelee a l'ingestion de couts et chaque heure).
export async function checkBudget(force = false) {
  const c = cache()
  if (!force && Date.now() - c.lastBudgetCheck < 600_000) {
    return
  }
  c.lastBudgetCheck = Date.now()
  const rules = await getRuleConfig()
  const budget = await getBudgetEur()
  const desired = rules.enabled.budget_threshold && budget ? desiredBudgetAlert(await monthSpendEur(), budget, rules.budgetPct) : null
  await reconcileAlerts(['budget_threshold'], desired ? [desired] : [])
}

// Resultat d'un deploiement : un echec en production ouvre une alerte, un succes la resout.
export async function handleDeployResult(project: string, environment: string, status: string, commitSha: string, branch: string | null) {
  if (environment !== 'production') {
    return
  }
  const fingerprint = `deploy_failed:${project}`
  if (status === 'SUCCESS') {
    // Seulement l'alerte de CE projet : un succes ailleurs ne doit pas fermer l'echec d'un autre.
    if ((await openFingerprints()).has(fingerprint)) {
      await resolveAlert(fingerprint)
    }
    return
  }
  if (status === 'FAILED') {
    const rules = await getRuleConfig()
    if (!rules.enabled.deploy_failed) {
      return
    }
    await openAlert({
      fingerprint,
      rule: 'deploy_failed',
      severity: 'WARNING',
      title: `Échec du déploiement de ${project} en production`,
      description: `Build ou démarrage en erreur${branch ? ` sur ${branch}` : ''} (${commitSha.slice(0, 7)}).`,
      source: `Déploiements · ${project}`
    })
  }
}
