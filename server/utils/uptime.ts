// Logique pure de la surveillance (aucun acces reseau ni base) : testable seule.

export type ProbeSample = {
  at: number // ms epoch
  ok: boolean
  latencyMs: number | null
  statusCode: number | null
}

export type ServiceHealth = 'up' | 'degraded' | 'down' | 'unknown'

export const HOUR_MS = 3_600_000

export function hourStart(ts: number) {
  return Math.floor(ts / HOUR_MS) * HOUR_MS
}

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) {
    return null
  }
  const sorted = [...values].sort((a, b) => a - b)
  // Methode "nearest rank" : simple et stable sur de petits echantillons
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[rank]
}

export function summarize(samples: ProbeSample[]) {
  const latencies = samples.filter((s) => s.ok && s.latencyMs !== null).map((s) => s.latencyMs as number)
  return {
    checks: samples.length,
    failures: samples.filter((s) => !s.ok).length,
    avgMs: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null,
    p95Ms: percentile(latencies, 95),
    maxMs: latencies.length ? Math.max(...latencies) : null
  }
}

export function uptimePct(checks: number, failures: number) {
  if (checks <= 0) {
    return null
  }
  return ((checks - failures) / checks) * 100
}

// Fusionne un cumul deja en base avec un cumul calcule en memoire pour la meme heure
// (cas d'un redemarrage en cours d'heure). Le p95 fusionne est le plus pessimiste des deux.
export function mergeRollup(
  a: { checks: number; failures: number; avgMs: number | null; p95Ms: number | null; maxMs: number | null },
  b: { checks: number; failures: number; avgMs: number | null; p95Ms: number | null; maxMs: number | null }
) {
  const checks = a.checks + b.checks
  const okA = a.checks - a.failures
  const okB = b.checks - b.failures
  const okTotal = okA + okB
  const avgMs =
    okTotal > 0 && (a.avgMs !== null || b.avgMs !== null)
      ? Math.round(((a.avgMs ?? 0) * okA + (b.avgMs ?? 0) * okB) / okTotal)
      : (a.avgMs ?? b.avgMs)
  const maxOf = (x: number | null, y: number | null) => (x === null ? y : y === null ? x : Math.max(x, y))
  return {
    checks,
    failures: a.failures + b.failures,
    avgMs,
    p95Ms: maxOf(a.p95Ms, b.p95Ms),
    maxMs: maxOf(a.maxMs, b.maxMs)
  }
}

// "down" : les `downAfter` dernieres sondes ont toutes echoue (evite une fausse alerte sur un incident isole).
// "degraded" : MEDIANE des dernieres sondes reussies au-dessus du seuil (au moins 3 mesures). La mediane, pas le
// p95 : sur 5 mesures le p95 est le maximum, donc un seul pic isole (connexion froide, GC) suffirait a "degrader" un service.
export function healthOf(samples: ProbeSample[], opts: { downAfter?: number; degradedMs?: number; window?: number } = {}): ServiceHealth {
  const downAfter = opts.downAfter ?? 2
  const degradedMs = opts.degradedMs ?? 800
  const window = opts.window ?? 5
  if (samples.length === 0) {
    return 'unknown'
  }
  const lastN = samples.slice(-downAfter)
  if (lastN.length >= downAfter && lastN.every((s) => !s.ok)) {
    return 'down'
  }
  const recentOk = samples
    .slice(-window)
    .filter((s) => s.ok && s.latencyMs !== null)
    .map((s) => s.latencyMs as number)
  const median = percentile(recentOk, 50)
  if (recentOk.length >= 3 && median !== null && median > degradedMs) {
    return 'degraded'
  }
  return 'up'
}

// Reduit une serie a `n` points (moyenne par paquet) pour une sparkline.
export function downsample(values: number[], n: number): number[] {
  if (values.length <= n) {
    return values
  }
  const size = values.length / n
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const chunk = values.slice(Math.floor(i * size), Math.floor((i + 1) * size))
    out.push(Math.round(chunk.reduce((a, b) => a + b, 0) / Math.max(1, chunk.length)))
  }
  return out
}

// ---------------------------------------------------------------------------
// Regles d'alerte (pures) : on calcule l'ensemble des alertes SOUHAITEES, un reconciliateur
// (server/utils/alerts.ts) ouvre/ferme celles qui different de l'existant.
// ---------------------------------------------------------------------------

export type DesiredAlert = {
  fingerprint: string
  rule: string
  severity: 'CRITICAL' | 'WARNING'
  title: string
  description: string
  source: string
}

export type RuleSet = {
  service_down: { enabled: boolean }
  latency_high: { enabled: boolean; thresholdMs: number; windowMin: number }
  cert_expiry: { enabled: boolean; days: number }
}

export const DEFAULT_RULES: RuleSet = {
  service_down: { enabled: true },
  latency_high: { enabled: true, thresholdMs: 800, windowMin: 10 },
  cert_expiry: { enabled: true, days: 14 }
}

export type ServiceSnapshot = {
  slug: string
  name: string
  samples: ProbeSample[]
  certExpiresAt: number | null
}

export function desiredServiceAlerts(snap: ServiceSnapshot, rules: RuleSet, now: number, intervalSec: number): DesiredAlert[] {
  const out: DesiredAlert[] = []
  const source = `Sondes · ${snap.name}`

  if (rules.service_down.enabled && healthOf(snap.samples, { downAfter: 2 }) === 'down') {
    const last = snap.samples[snap.samples.length - 1]
    out.push({
      fingerprint: `service_down:${snap.slug}`,
      rule: 'service_down',
      severity: 'CRITICAL',
      title: `${snap.name} ne répond pas`,
      description: `Les 2 dernières vérifications ont échoué${last?.statusCode ? ` (dernier code HTTP : ${last.statusCode})` : ' (aucune réponse)'}.`,
      source
    })
  }

  if (rules.latency_high.enabled) {
    const since = now - rules.latency_high.windowMin * 60_000
    const window = snap.samples.filter((s) => s.at >= since && s.ok && s.latencyMs !== null).map((s) => s.latencyMs as number)
    // Il faut assez de points pour que la fenetre ait un sens (au moins 3 sondes)...
    const minPoints = Math.min(3, Math.max(1, Math.floor((rules.latency_high.windowMin * 60) / Math.max(1, intervalSec))))
    // ... et la lenteur doit etre SOUTENUE : au moins 60 % des mesures au-dessus du seuil. Un pic isole (connexion
    // froide, ramasse-miettes) ne declenche rien, sinon chaque redemarrage produirait une alerte.
    const over = window.filter((ms) => ms > rules.latency_high.thresholdMs).length
    const p95 = percentile(window, 95)
    if (p95 !== null && window.length >= minPoints && over / window.length >= 0.6) {
      out.push({
        fingerprint: `latency_high:${snap.slug}`,
        rule: 'latency_high',
        severity: 'CRITICAL',
        title: `Latence p95 > ${rules.latency_high.thresholdMs} ms sur ${snap.name}`,
        description: `p95 à ${p95} ms sur les ${rules.latency_high.windowMin} dernières minutes (${over} mesure${over > 1 ? 's' : ''} sur ${window.length} au-dessus du seuil de ${rules.latency_high.thresholdMs} ms).`,
        source
      })
    }
  }

  if (rules.cert_expiry.enabled && snap.certExpiresAt !== null) {
    const daysLeft = Math.floor((snap.certExpiresAt - now) / 86_400_000)
    if (daysLeft <= rules.cert_expiry.days) {
      const date = new Date(snap.certExpiresAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' })
      out.push({
        fingerprint: `cert_expiry:${snap.slug}`,
        rule: 'cert_expiry',
        severity: daysLeft <= 3 ? 'CRITICAL' : 'WARNING',
        title: daysLeft < 0 ? `Certificat de ${snap.name} expiré` : `Certificat de ${snap.name} : expire dans ${daysLeft} jour${daysLeft > 1 ? 's' : ''}`,
        description: `Expiration le ${date}.`,
        source
      })
    }
  }

  return out
}

// Alerte budget : seuil en % du plafond mensuel (verifie a l'ingestion de couts et chaque heure).
export function desiredBudgetAlert(spentEur: number, budgetEur: number | null, pct: number): DesiredAlert | null {
  if (!budgetEur || budgetEur <= 0) {
    return null
  }
  const used = (spentEur / budgetEur) * 100
  if (used < pct) {
    return null
  }
  const fmt = (n: number) => n.toFixed(2).replace('.', ',')
  return {
    fingerprint: 'budget_threshold:monthly',
    rule: 'budget_threshold',
    severity: used >= 100 ? 'CRITICAL' : 'WARNING',
    title: used >= 100 ? 'Plafond mensuel dépassé' : `Budget à ${Math.floor(used)} % du plafond mensuel`,
    description: `${fmt(spentEur)} € dépensés sur ${fmt(budgetEur)} € ce mois-ci.`,
    source: 'Coûts'
  }
}
