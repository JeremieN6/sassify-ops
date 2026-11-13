// Alertes serveur (CPU, memoire, disque, processus PM2, agent silencieux) a partir des mesures de l'agent (table ServerMetric).
// Fonctions PURES (aucun acces base ni Nuxt) : testables seules. Meme principe que les alertes de sondes (uptime.ts) :
// on decrit les alertes SOUHAITEES, le moteur (alerts.ts) ouvre / ferme / notifie.
//
// Principes :
//   - CPU et memoire : condition SOUTENUE (>= 80 % des mesures de la fenetre au-dessus du seuil), jamais un pic isole
//     (une compilation ou un deploiement fait monter le CPU quelques minutes : ce n'est pas un incident) ;
//   - disque : derniere mesure au-dessus du seuil (le disque evolue lentement) ; critique a partir de 95 % ;
//   - PM2 : un processus arrete / en erreur sur les 2 DERNIERES lectures (l'agent lit PM2 toutes les 5 min : ~10 min)
//     ou plus de N redemarrages dans la fenetre (boucle de redemarrage) ;
//   - agent silencieux : plus aucune mesure depuis X minutes ; les AUTRES alertes de cette machine sont alors figees
//     (on ne peut pas conclure sans donnees : voir `silentHosts`), ni ouvertes ni fermees.
import type { DesiredAlert } from './uptime'

export type ProcessSample = { name: string; restarts?: number; status?: string }
export type MetricSample = {
  host: string
  at: number // ms
  cpuPct: number | null
  memPct: number | null
  diskPct: number | null
  processes: ProcessSample[] | null // null = PM2 non lu pour cette mesure (1 minute sur 5)
}

export type ServerRuleSet = {
  server_cpu: { enabled: boolean; pct: number; windowMin: number }
  server_memory: { enabled: boolean; pct: number; windowMin: number }
  server_disk: { enabled: boolean; pct: number }
  pm2_unhealthy: { enabled: boolean; restarts: number; windowMin: number }
  agent_silent: { enabled: boolean; minutes: number }
}

export const DEFAULT_SERVER_RULES: ServerRuleSet = {
  server_cpu: { enabled: true, pct: 90, windowMin: 10 },
  server_memory: { enabled: true, pct: 90, windowMin: 10 },
  server_disk: { enabled: true, pct: 85 },
  pm2_unhealthy: { enabled: true, restarts: 5, windowMin: 30 },
  agent_silent: { enabled: true, minutes: 10 }
}

export const SERVER_RULE_KEYS = ['server_cpu', 'server_memory', 'server_disk', 'pm2_unhealthy', 'agent_silent'] as const

const MIN = 60_000
const SUSTAINED_SHARE = 0.8
const NOT_RUNNING = new Set(['stopped', 'errored', 'stopping', 'launching', 'one-launch-status'])

// Hotes dont on ne connait que la DATE de derniere mesure (agrege cote base : un GROUP BY renvoie quelques lignes, au lieu de relire
// toute la table). Un hote absent des mesures recentes devient une mesure vide a cette date : c'est ce qui permet de declarer un
// agent silencieux meme apres plus de 45 minutes, sans charger d'historique.
export function withLastSeen(samples: MetricSample[], lastSeen: { host: string; at: number }[]): MetricSample[] {
  const known = new Set(samples.map((sample) => sample.host))
  const stale: MetricSample[] = lastSeen
    .filter((entry) => !known.has(entry.host))
    .map((entry) => ({ host: entry.host, at: entry.at, cpuPct: null, memPct: null, diskPct: null, processes: null }))
  return [...stale, ...samples]
}

export type ServerAlertResult = { desired: DesiredAlert[]; silentHosts: Set<string> }

// Hote d'une empreinte `regle:hote[:detail]` (les noms de machine ne contiennent pas de ':').
export function hostOfFingerprint(fingerprint: string): string | null {
  const parts = fingerprint.split(':')
  return parts.length >= 2 ? parts[1] : null
}

const fmtPct = (value: number) => `${Math.round(value)} %`

export function desiredServerAlerts(samples: MetricSample[], rules: ServerRuleSet, now: number): ServerAlertResult {
  const desired: DesiredAlert[] = []
  const silentHosts = new Set<string>()

  const byHost = new Map<string, MetricSample[]>()
  for (const sample of [...samples].sort((a, b) => a.at - b.at)) {
    const list = byHost.get(sample.host) ?? []
    list.push(sample)
    byHost.set(sample.host, list)
  }

  for (const [host, list] of byHost) {
    const source = `Serveurs · ${host}`
    const last = list[list.length - 1]

    // Agent silencieux : sans mesure recente on ne conclut rien sur le reste.
    const silentMinutes = Math.floor((now - last.at) / MIN)
    if (silentMinutes >= rules.agent_silent.minutes) {
      silentHosts.add(host)
      if (rules.agent_silent.enabled) {
        desired.push({
          fingerprint: `agent_silent:${host}`,
          rule: 'agent_silent',
          severity: 'WARNING',
          title: `Plus de mesures reçues de ${host}`,
          description: `Dernière mesure il y a ${silentMinutes} minutes (seuil : ${rules.agent_silent.minutes} min). L'agent est arrêté ou le serveur ne répond plus : vérifier 'systemctl status pilotage-agent.timer'.`,
          source
        })
      }
      continue
    }

    // CPU et memoire : condition soutenue sur la fenetre glissante.
    for (const [rule, label, pick] of [
      ['server_cpu', 'CPU', (s: MetricSample) => s.cpuPct],
      ['server_memory', 'Mémoire', (s: MetricSample) => s.memPct]
    ] as const) {
      const config = rules[rule]
      if (!config.enabled) continue
      const since = now - config.windowMin * MIN
      const values = list.filter((s) => s.at >= since).map(pick).filter((v): v is number => v !== null)
      const minPoints = Math.max(3, Math.floor(config.windowMin / 2))
      const over = values.filter((v) => v >= config.pct).length
      if (values.length >= minPoints && over / values.length >= SUSTAINED_SHARE) {
        const average = values.reduce((sum, v) => sum + v, 0) / values.length
        desired.push({
          fingerprint: `${rule}:${host}`,
          rule,
          severity: 'WARNING',
          title: `${label} de ${host} à ${fmtPct(average)} depuis ${config.windowMin} minutes`,
          description: `${over} mesure${over > 1 ? 's' : ''} sur ${values.length} au-dessus de ${config.pct} % (moyenne ${fmtPct(average)}). Un pic isolé ne déclenche rien : la charge est soutenue.`,
          source
        })
      }
    }

    // Disque : derniere mesure.
    if (rules.server_disk.enabled && last.diskPct !== null && last.diskPct >= rules.server_disk.pct) {
      desired.push({
        fingerprint: `server_disk:${host}`,
        rule: 'server_disk',
        severity: last.diskPct >= 95 ? 'CRITICAL' : 'WARNING',
        title: `Disque de ${host} à ${fmtPct(last.diskPct)}`,
        description: `Seuil d'alerte : ${rules.server_disk.pct} %. Penser aux journaux PM2 ('pm2 flush'), aux anciennes versions et aux sauvegardes.`,
        source
      })
    }

    // PM2 : uniquement les mesures qui contiennent une lecture de PM2.
    if (rules.pm2_unhealthy.enabled) {
      const reads = list.filter((s) => s.processes !== null)
      const latest = reads[reads.length - 1]
      const previous = reads[reads.length - 2]

      if (latest && previous) {
        for (const process of latest.processes ?? []) {
          const before = previous.processes?.find((p) => p.name === process.name)
          if (before && NOT_RUNNING.has(process.status ?? '') && NOT_RUNNING.has(before.status ?? '')) {
            desired.push({
              fingerprint: `pm2_unhealthy:${host}:${process.name}:down`,
              rule: 'pm2_unhealthy',
              severity: 'CRITICAL',
              title: `Le processus ${process.name} est ${process.status === 'errored' ? 'en erreur' : 'arrêté'} sur ${host}`,
              description: `État « ${process.status} » sur les 2 dernières lectures de PM2 (environ 10 minutes).`,
              source
            })
          }
        }
      }

      if (latest) {
        const since = now - rules.pm2_unhealthy.windowMin * MIN
        const first = reads.find((s) => s.at >= since)
        if (first && first !== latest) {
          for (const process of latest.processes ?? []) {
            const before = first.processes?.find((p) => p.name === process.name)
            const delta = (process.restarts ?? 0) - (before?.restarts ?? 0)
            if (before && delta >= rules.pm2_unhealthy.restarts) {
              desired.push({
                fingerprint: `pm2_unhealthy:${host}:${process.name}:loop`,
                rule: 'pm2_unhealthy',
                severity: 'WARNING',
                title: `${process.name} redémarre en boucle sur ${host}`,
                description: `${delta} redémarrages en ${Math.round((latest.at - first.at) / MIN)} minutes (seuil : ${rules.pm2_unhealthy.restarts} sur ${rules.pm2_unhealthy.windowMin} min). Voir 'pm2 logs ${process.name}'.`,
                source
              })
            }
          }
        }
      }
    }
  }

  return { desired, silentHosts }
}
