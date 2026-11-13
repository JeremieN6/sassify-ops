// Magasin LOCAL des mesures serveur (fichier JSON-lignes sur le disque du VPS), a la place de la table Neon `ServerMetric`.
//
// Pourquoi (incident Neon du 2026-11-13) : l'agent ecrit chaque minute ; dans Neon cela maintient la base eveillee en permanence
// (~182 CU-heures/mois contre 100 gratuites) et chaque lecture consomme du transfert (5 Go/mois). Ici : aucun appel reseau,
// ~200 octets ajoutes par minute (~700 octets quand PM2 est lu), 48 heures conservees (~3 Mo), memoire ~1-2 Mo.
//
// Fonctionnement : un seul processus (pilotage). Les mesures des 48 dernieres heures sont gardees en memoire, rechargees depuis le
// fichier au demarrage ; chaque ecriture AJOUTE une ligne ; une fois par heure le fichier est reecrit sans les lignes trop anciennes
// (ecriture dans un fichier temporaire puis renommage : jamais de fichier a moitie ecrit). Une ligne illisible est ignoree.

import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export type ProcessInfo = { name: string; cpu?: number; memMb?: number; restarts?: number; uptime?: string; status?: string }

// Meme forme que la ligne de la table ServerMetric : les consommateurs (page Serveurs, alertes) n'ont presque pas change.
export type StoredMetric = {
  host: string
  capturedAt: Date
  cpuPct: number | null
  memPct: number | null
  diskPct: number | null
  netOutMbps: number | null
  payload: { processes: ProcessInfo[] } | null // null = PM2 non lu pour cette mesure
}

type Line = { h: string; t: number; c: number | null; m: number | null; d: number | null; n: number | null; p?: ProcessInfo[] }

const HOUR = 3_600_000
export const KEEP_MS = 48 * HOUR
const COMPACT_EVERY_MS = HOUR

export class MetricStore {
  private rows: StoredMetric[] = []
  private seen = new Map<string, number>() // host -> date (ms) de la derniere mesure
  private loading: Promise<void> | null = null
  private lastCompaction = 0

  constructor(
    private readonly dir: string,
    private readonly fileName = 'server-metrics.jsonl',
    private readonly now: () => number = () => Date.now()
  ) {}

  private get file() {
    return join(this.dir, this.fileName)
  }

  private load(): Promise<void> {
    this.loading ??= (async () => {
      let text = ''
      try {
        text = await readFile(this.file, 'utf8')
      } catch {
        // premier demarrage : pas encore de fichier
      }
      const limit = this.now() - KEEP_MS
      for (const raw of text.split(String.fromCharCode(10))) {
        const metric = parseLine(raw)
        if (metric && metric.capturedAt.getTime() >= limit) {
          this.insert(metric)
        }
      }
      this.lastCompaction = this.now()
    })()
    return this.loading
  }

  // Insertion en gardant l'ordre chronologique (une mesure tardive ou rejouee ne doit pas casser les fenetres glissantes).
  private insert(metric: StoredMetric) {
    const at = metric.capturedAt.getTime()
    let index = this.rows.length
    while (index > 0 && this.rows[index - 1].capturedAt.getTime() > at) index--
    this.rows.splice(index, 0, metric)
    if (at > (this.seen.get(metric.host) ?? 0)) this.seen.set(metric.host, at)
  }

  async append(metric: StoredMetric): Promise<void> {
    await this.load()
    this.insert(metric)
    await mkdir(this.dir, { recursive: true })
    await appendFile(this.file, serialize(metric) + String.fromCharCode(10), 'utf8')
    if (this.now() - this.lastCompaction > COMPACT_EVERY_MS) {
      await this.compact()
    }
  }

  // Mesures depuis `sinceMs`, de la plus ancienne a la plus recente.
  async since(sinceMs: number): Promise<StoredMetric[]> {
    await this.load()
    return this.rows.filter((row) => row.capturedAt.getTime() >= sinceMs)
  }

  // Derniere mesure connue de chaque machine (sur les 48 h conservees) : sert a declarer un agent silencieux.
  async lastSeen(): Promise<{ host: string; at: number }[]> {
    await this.load()
    return [...this.seen.entries()].map(([host, at]) => ({ host, at }))
  }

  // Reecrit le fichier sans les lignes de plus de 48 h (temporaire + renommage).
  async compact(): Promise<void> {
    await this.load()
    this.lastCompaction = this.now()
    const limit = this.now() - KEEP_MS
    this.rows = this.rows.filter((row) => row.capturedAt.getTime() >= limit)
    for (const [host, at] of [...this.seen]) {
      if (at < limit) this.seen.delete(host)
    }
    await mkdir(this.dir, { recursive: true })
    const temporary = `${this.file}.tmp`
    await writeFile(temporary, this.rows.map(serialize).join(String.fromCharCode(10)) + (this.rows.length ? String.fromCharCode(10) : ''), 'utf8')
    await rename(temporary, this.file)
  }
}

function serialize(metric: StoredMetric): string {
  const line: Line = { h: metric.host, t: metric.capturedAt.getTime(), c: metric.cpuPct, m: metric.memPct, d: metric.diskPct, n: metric.netOutMbps }
  if (metric.payload) line.p = metric.payload.processes
  return JSON.stringify(line)
}

export function parseLine(raw: string): StoredMetric | null {
  if (!raw.trim()) return null
  try {
    const line = JSON.parse(raw) as Partial<Line>
    if (typeof line.h !== 'string' || typeof line.t !== 'number' || !Number.isFinite(line.t)) return null
    const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null)
    return {
      host: line.h,
      capturedAt: new Date(line.t),
      cpuPct: num(line.c),
      memPct: num(line.m),
      diskPct: num(line.d),
      netOutMbps: num(line.n),
      payload: Array.isArray(line.p) ? { processes: line.p } : null
    }
  } catch {
    return null // ligne tronquee (arret en cours d'ecriture) ou illisible
  }
}

// Un seul magasin par processus. Dossier : PILOTAGE_DATA_DIR, sinon ./data (non versionne : voir .gitignore).
const holder = globalThis as unknown as { __opsMetricStore?: MetricStore }
export function getMetricStore(): MetricStore {
  holder.__opsMetricStore ??= new MetricStore(process.env.PILOTAGE_DATA_DIR || join(process.cwd(), 'data'))
  return holder.__opsMetricStore
}
