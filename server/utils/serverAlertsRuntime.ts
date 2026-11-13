// Evaluation periodique des alertes serveur : lit les mesures recentes, calcule les alertes souhaitees (serverAlerts.ts, pur)
// et laisse le moteur (alerts.ts) ouvrir / fermer / notifier. Appelee toutes les 2 minutes par server/plugins/server-alerts.ts.
import { getMetricStore } from './metricStore'
import { DEFAULT_SERVER_RULES, SERVER_RULE_KEYS, desiredServerAlerts, hostOfFingerprint, withLastSeen, type MetricSample, type ServerRuleSet } from './serverAlerts'

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

  // Mesures des 45 dernieres minutes + date de derniere mesure de chaque machine, lues dans le magasin LOCAL (en memoire, rechargee
  // depuis un fichier au demarrage) : AUCUN acces a Neon pour evaluer les alertes (incident du 2026-11-13 : `distinct` de Prisma
  // relisait toute la table toutes les 2 minutes ; et ecrire/lire chaque minute dans Neon l'empechait de se mettre en veille).
  const store = getMetricStore()
  const [recent, lastSeen] = await Promise.all([store.since(now - WINDOW_MS), store.lastSeen()])

  const samples: MetricSample[] = withLastSeen(
    recent.map((row) => ({
      host: row.host,
      at: row.capturedAt.getTime(),
      cpuPct: row.cpuPct,
      memPct: row.memPct,
      diskPct: row.diskPct,
      processes: toProcesses(row.payload)
    })),
    lastSeen
  )

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
