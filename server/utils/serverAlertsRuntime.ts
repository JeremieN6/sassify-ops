// Evaluation periodique des alertes serveur : lit les mesures recentes, calcule les alertes souhaitees (serverAlerts.ts, pur)
// et laisse le moteur (alerts.ts) ouvrir / fermer / notifier. Appelee toutes les 2 minutes par server/plugins/server-alerts.ts.
import { DEFAULT_SERVER_RULES, SERVER_RULE_KEYS, desiredServerAlerts, hostOfFingerprint, type MetricSample, type ServerRuleSet } from './serverAlerts'

const WINDOW_MS = 45 * 60_000

function toProcesses(payload: unknown): MetricSample['processes'] {
  const list = (payload as { processes?: unknown } | null)?.processes
  if (!Array.isArray(list)) {
    return null
  }
  return list
    .map((item) => item as { name?: unknown; restarts?: unknown; status?: unknown })
    .filter((item) => typeof item.name === 'string')
    .map((item) => ({
      name: item.name as string,
      restarts: typeof item.restarts === 'number' ? item.restarts : undefined,
      status: typeof item.status === 'string' ? item.status : undefined
    }))
}

export async function checkServerAlerts(now = Date.now()) {
  const config = await getRuleConfig()
  const param = (key: keyof ServerRuleSet, name: string, fallback: number) => config.params[key]?.[name] ?? fallback
  const defaults = DEFAULT_SERVER_RULES
  const rules: ServerRuleSet = {
    server_cpu: { enabled: config.enabled.server_cpu, pct: param('server_cpu', 'pct', defaults.server_cpu.pct), windowMin: param('server_cpu', 'windowMin', defaults.server_cpu.windowMin) },
    server_memory: { enabled: config.enabled.server_memory, pct: param('server_memory', 'pct', defaults.server_memory.pct), windowMin: param('server_memory', 'windowMin', defaults.server_memory.windowMin) },
    server_disk: { enabled: config.enabled.server_disk, pct: param('server_disk', 'pct', defaults.server_disk.pct) },
    pm2_unhealthy: { enabled: config.enabled.pm2_unhealthy, restarts: param('pm2_unhealthy', 'restarts', defaults.pm2_unhealthy.restarts), windowMin: param('pm2_unhealthy', 'windowMin', defaults.pm2_unhealthy.windowMin) },
    agent_silent: { enabled: config.enabled.agent_silent, minutes: param('agent_silent', 'minutes', defaults.agent_silent.minutes) }
  }

  // Mesures des 45 dernieres minutes + derniere mesure connue de chaque machine (meme ancienne : c'est ce qui permet de
  // declarer un agent silencieux apres plus de 45 minutes).
  const [recent, latestPerHost] = await Promise.all([
    prisma.serverMetric.findMany({ where: { capturedAt: { gte: new Date(now - WINDOW_MS) } }, orderBy: { capturedAt: 'asc' }, take: 1000 }),
    prisma.serverMetric.findMany({ distinct: ['host'], orderBy: { capturedAt: 'desc' } })
  ])
  const seen = new Set(recent.map((row) => row.id))
  const rows = [...latestPerHost.filter((row) => !seen.has(row.id)), ...recent]

  const samples: MetricSample[] = rows.map((row) => ({
    host: row.host,
    at: row.capturedAt.getTime(),
    cpuPct: row.cpuPct,
    memPct: row.memPct,
    diskPct: row.diskPct,
    processes: toProcesses(row.payload)
  }))

  const { desired, silentHosts } = desiredServerAlerts(samples, rules, now)
  await reconcileAlerts([...SERVER_RULE_KEYS], desired, {
    // Agent silencieux : on ne ferme pas les autres alertes de la machine (pas de donnees pour conclure).
    hold: (fingerprint) => {
      if (fingerprint.startsWith('agent_silent:')) return false
      const host = hostOfFingerprint(fingerprint)
      return host !== null && silentHosts.has(host)
    }
  })
}
