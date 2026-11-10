// Calcul de l'ecran "Revenus" a partir des instantanes quotidiens de MRR (table MrrSnapshot, un par projet et par jour).
// Fonctions PURES (aucun acces base ni Nuxt) : testables seules.
//
// Regles :
//   - le MRR actuel d'un projet = son instantane le plus recent ;
//   - "il y a 30 jours" = le dernier instantane au plus tard 30 jours avant la date de reference ; absent -> variation inconnue (null),
//     jamais devinee (l'historique se construit jour apres jour, la synchro Stripe n'existe que depuis le 2026-11-09) ;
//   - historique mensuel = dernier instantane de chaque mois, reporte vers l'avant apres le premier instantane connu ;
//   - la date de reference est celle du dernier instantane (pas "maintenant") : l'ecran reste coherent si la synchro est en retard.

export type SnapshotRow = { projectId: string | null; capturedOn: Date; mrrEur: number; subscribers: number }
export type ProjectRef = { id: string; slug: string; name: string }

export type ProjectRevenue = {
  slug: string
  name: string
  color: string
  mrrEur: number
  subscribers: number
  arpuEur: number | null
  prevMrrEur: number | null
  deltaEur: number | null
  deltaPct: number | null
  spark: number[] // 30 derniers jours, vide tant qu'il y a moins de 2 jours d'historique
  monthly: number[] // 12 mois, du plus ancien au plus recent
}

export type RevenuePayload = {
  configured: boolean
  updatedOn: string | null // date du dernier instantane (YYYY-MM-DD)
  historyDays: number
  months: string[] // 12 mois (YYYY-MM), alignes sur `monthly`
  projects: ProjectRevenue[]
  totals: {
    mrrEur: number
    arrEur: number
    subscribers: number
    arpuEur: number | null
    prevMrrEur: number | null
    deltaEur: number | null
    deltaPct: number | null
  }
}

// Couleurs fixes par projet (reprises de la maquette) ; le reste recoit une teinte neutre.
export const PROJECT_COLORS: Record<string, string> = {
  skinalyze: '#4FC3E6',
  tifo: '#F08BCB',
  flysmart: '#F2A66B',
  csvtoppt: '#7C84FF',
  clippeak: '#9AA5BC',
  stellara: '#7BD6A1'
}
const FALLBACK_COLORS = ['#E5C46B', '#B79CED', '#6BC9C0', '#E58C8C']

export function projectColor(slug: string, index = 0) {
  return PROJECT_COLORS[slug] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length]
}

const DAY = 86_400_000
const dayKey = (date: Date) => date.toISOString().slice(0, 10)
const monthKey = (date: Date) => date.toISOString().slice(0, 7)
const round2 = (value: number) => Math.round(value * 100) / 100

// 12 mois se terminant au mois de `end`, du plus ancien au plus recent.
export function lastTwelveMonths(end: Date): string[] {
  const months: string[] = []
  for (let offset = 11; offset >= 0; offset--) {
    months.push(monthKey(new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - offset, 1))))
  }
  return months
}

type Series = { rows: SnapshotRow[] } // tries par date croissante

// Dernier instantane dont la date est <= `limit` (null si aucun).
function valueAt(series: Series, limit: Date): SnapshotRow | null {
  let found: SnapshotRow | null = null
  for (const row of series.rows) {
    if (row.capturedOn.getTime() <= limit.getTime()) {
      found = row
    } else {
      break
    }
  }
  return found
}

export function buildRevenue(rows: SnapshotRow[], projects: ProjectRef[]): RevenuePayload {
  if (rows.length === 0) {
    return {
      configured: false,
      updatedOn: null,
      historyDays: 0,
      months: [],
      projects: [],
      totals: { mrrEur: 0, arrEur: 0, subscribers: 0, arpuEur: null, prevMrrEur: null, deltaEur: null, deltaPct: null }
    }
  }

  const refs = new Map(projects.map((project) => [project.id, project]))
  const groups = new Map<string, { slug: string; name: string; series: Series }>()
  for (const row of [...rows].sort((a, b) => a.capturedOn.getTime() - b.capturedOn.getTime())) {
    const ref = row.projectId ? refs.get(row.projectId) : undefined
    const key = ref ? ref.id : 'unattributed'
    const group = groups.get(key) ?? { slug: ref?.slug ?? 'non-attribue', name: ref?.name ?? 'Non attribué', series: { rows: [] } }
    group.series.rows.push({ ...row, mrrEur: Number(row.mrrEur) })
    groups.set(key, group)
  }

  const end = new Date(Math.max(...rows.map((row) => row.capturedOn.getTime())))
  const start = new Date(Math.min(...rows.map((row) => row.capturedOn.getTime())))
  const historyDays = Math.round((end.getTime() - start.getTime()) / DAY) + 1
  const monthsList = lastTwelveMonths(end)
  const thirtyDaysAgo = new Date(end.getTime() - 30 * DAY)
  const longEnough = start.getTime() <= thirtyDaysAgo.getTime()

  let colorIndex = 0
  const list: ProjectRevenue[] = [...groups.values()].map((group) => {
    const last = group.series.rows[group.series.rows.length - 1]
    const mrr = round2(last.mrrEur)
    const prevRow = valueAt(group.series, thirtyDaysAgo)
    const prev = prevRow ? round2(prevRow.mrrEur) : null

    // Courbe des 30 derniers jours (report vers l'avant) ; vide s'il y a moins de 2 jours d'instantanes.
    const distinctDays = new Set(group.series.rows.map((row) => dayKey(row.capturedOn))).size
    const spark: number[] = []
    if (distinctDays >= 2) {
      for (let offset = 29; offset >= 0; offset--) {
        spark.push(round2(valueAt(group.series, new Date(end.getTime() - offset * DAY))?.mrrEur ?? 0))
      }
    }

    // Dernier instantane de chaque mois ; mois sans instantane = valeur precedente apres le premier instantane connu.
    const firstMonth = monthKey(group.series.rows[0].capturedOn)
    let carry = 0
    const monthly = monthsList.map((month) => {
      const inMonth = group.series.rows.filter((row) => monthKey(row.capturedOn) === month)
      if (inMonth.length > 0) {
        carry = round2(inMonth[inMonth.length - 1].mrrEur)
        return carry
      }
      return month > firstMonth ? carry : 0
    })

    return {
      slug: group.slug,
      name: group.name,
      color: projectColor(group.slug, colorIndex++),
      mrrEur: mrr,
      subscribers: last.subscribers,
      arpuEur: last.subscribers > 0 ? round2(mrr / last.subscribers) : null,
      prevMrrEur: prev,
      deltaEur: prev === null ? null : round2(mrr - prev),
      deltaPct: prev !== null && prev > 0 ? round2(((mrr - prev) / prev) * 100) : null,
      spark,
      monthly
    }
  })

  list.sort((a, b) => b.mrrEur - a.mrrEur || a.name.localeCompare(b.name, 'fr'))

  const mrrEur = round2(list.reduce((sum, project) => sum + project.mrrEur, 0))
  const subscribers = list.reduce((sum, project) => sum + project.subscribers, 0)
  // Total d'il y a 30 jours : seulement si l'historique couvre assez de jours ; un projet absent a l'epoque compte pour 0 (nouveau).
  const prevMrrEur = longEnough ? round2(list.reduce((sum, project) => sum + (project.prevMrrEur ?? 0), 0)) : null

  return {
    configured: true,
    updatedOn: dayKey(end),
    historyDays,
    months: monthsList,
    projects: list,
    totals: {
      mrrEur,
      arrEur: round2(mrrEur * 12),
      subscribers,
      arpuEur: subscribers > 0 ? round2(mrrEur / subscribers) : null,
      prevMrrEur,
      deltaEur: prevMrrEur === null ? null : round2(mrrEur - prevMrrEur),
      deltaPct: prevMrrEur !== null && prevMrrEur > 0 ? round2(((mrrEur - prevMrrEur) / prevMrrEur) * 100) : null
    }
  }
}
