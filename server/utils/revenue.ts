// Calcul de l'ecran "Revenus" a partir des instantanes quotidiens de MRR (table MrrSnapshot, un par projet et par jour)
// et de l'etat des abonnements (table Subscription, sans donnee personnelle).
// Fonctions PURES (aucun acces base ni Nuxt) : testables seules.
//
// Regles :
//   - le MRR actuel d'un projet = son instantane le plus recent ;
//   - "il y a 30 jours" = le dernier instantane au plus tard 30 jours avant la date de reference ; absent -> variation inconnue (null),
//     jamais devinee (l'historique se construit jour apres jour, la synchro Stripe n'existe que depuis le 2026-11-09) ;
//   - historique mensuel = dernier instantane de chaque mois, reporte vers l'avant apres le premier instantane connu ;
//   - mouvements (nouveau / expansion / contraction / perte) = somme des mouvements comptes chaque jour sur les 30 derniers jours ;
//   - la date de reference est celle du dernier instantane (pas "maintenant") : l'ecran reste coherent si la synchro est en retard.

export type SnapshotRow = {
  projectId: string | null
  capturedOn: Date
  mrrEur: number
  subscribers: number
  // Mouvements comptes ce jour-la (calcules par la synchro Stripe) ; absents = 0
  newEur?: number
  expansionEur?: number
  contractionEur?: number
  churnEur?: number
}
export type SubscriptionRow = {
  projectId: string
  status: string
  plan: string
  mrrEur: number
  quantity: number
  cancelAtPeriodEnd: boolean
  currentPeriodEnd: Date | null
  createdAt?: Date
  customerLabel?: string | null
}
export type ProjectRef = { id: string; slug: string; name: string }

export type MovementTotals = { newEur: number; expansionEur: number; contractionEur: number; churnEur: number }
export type PlanLine = { name: string; subscribers: number; priceEur: number; mrrEur: number }
export type RecentSubscription = {
  client: string | null // nom du client ou e-mail masque ; null = non identifie (droit Stripe "Customers : lecture" absent)
  projectSlug: string
  projectName: string
  color: string
  plan: string
  amountEur: number
  createdOn: string // YYYY-MM-DD
  status: string
  statusLabel: string
  tone: 'ok' | 'warn' | 'crit' | 'muted'
}
export type WatchItem = { kind: 'crit' | 'warn'; title: string; projectSlug: string; projectName: string; color: string; desc: string }

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
  movements: MovementTotals // 30 derniers jours
  plans: PlanLine[] // plans ayant des abonnes comptes, tries par MRR decroissant
}

export type RevenuePayload = {
  configured: boolean
  updatedOn: string | null // date du dernier instantane (YYYY-MM-DD)
  historyDays: number
  months: string[] // 12 mois (YYYY-MM), alignes sur `monthly`
  projects: ProjectRevenue[]
  watch: WatchItem[] // a surveiller : paiements en retard, annulations prevues
  recent: RecentSubscription[] // derniers abonnements (10 maximum)
  movementDays: number // duree reellement couverte par les mouvements (<= 30)
  totals: {
    mrrEur: number
    arrEur: number
    subscribers: number
    arpuEur: number | null
    prevMrrEur: number | null
    deltaEur: number | null
    deltaPct: number | null
    movements: MovementTotals
    openingMrrEur: number // MRR au debut de la periode des mouvements = aujourd'hui - nouveaux - expansion + contraction + perte
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
const emptyMovements = (): MovementTotals => ({ newEur: 0, expansionEur: 0, contractionEur: 0, churnEur: 0 })

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

export function buildRevenue(rows: SnapshotRow[], projects: ProjectRef[], subscriptions: SubscriptionRow[] = []): RevenuePayload {
  if (rows.length === 0) {
    return {
      configured: false,
      updatedOn: null,
      historyDays: 0,
      months: [],
      projects: [],
      watch: [],
      recent: [],
      movementDays: 0,
      totals: {
        mrrEur: 0,
        arrEur: 0,
        subscribers: 0,
        arpuEur: null,
        prevMrrEur: null,
        deltaEur: null,
        deltaPct: null,
        movements: emptyMovements(),
        openingMrrEur: 0
      }
    }
  }

  const refs = new Map(projects.map((project) => [project.id, project]))
  const groups = new Map<string, { id: string | null; slug: string; name: string; series: Series }>()
  for (const row of [...rows].sort((a, b) => a.capturedOn.getTime() - b.capturedOn.getTime())) {
    const ref = row.projectId ? refs.get(row.projectId) : undefined
    const key = ref ? ref.id : 'unattributed'
    const group = groups.get(key) ?? { id: ref?.id ?? null, slug: ref?.slug ?? 'non-attribue', name: ref?.name ?? 'Non attribué', series: { rows: [] } }
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

    // Mouvements des 30 derniers jours : somme des mouvements comptes chaque jour apres (date de reference - 30 j).
    const movements = emptyMovements()
    for (const row of group.series.rows) {
      if (row.capturedOn.getTime() > thirtyDaysAgo.getTime()) {
        movements.newEur += Number(row.newEur ?? 0)
        movements.expansionEur += Number(row.expansionEur ?? 0)
        movements.contractionEur += Number(row.contractionEur ?? 0)
        movements.churnEur += Number(row.churnEur ?? 0)
      }
    }
    for (const key of Object.keys(movements) as (keyof MovementTotals)[]) {
      movements[key] = round2(movements[key])
    }

    // Repartition par plan : abonnements comptes (contribution > 0) du projet.
    const planMap = new Map<string, { subscribers: number; mrrEur: number }>()
    for (const sub of subscriptions) {
      if (group.id !== null && sub.projectId === group.id && Number(sub.mrrEur) > 0) {
        const line = planMap.get(sub.plan) ?? { subscribers: 0, mrrEur: 0 }
        line.subscribers += 1
        line.mrrEur += Number(sub.mrrEur)
        planMap.set(sub.plan, line)
      }
    }
    const plans: PlanLine[] = [...planMap.entries()]
      .map(([name, line]) => ({ name, subscribers: line.subscribers, mrrEur: round2(line.mrrEur), priceEur: round2(line.mrrEur / line.subscribers) }))
      .sort((a, b) => b.mrrEur - a.mrrEur || a.name.localeCompare(b.name, 'fr'))

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
      monthly,
      movements,
      plans
    }
  })

  list.sort((a, b) => b.mrrEur - a.mrrEur || a.name.localeCompare(b.name, 'fr'))

  const mrrEur = round2(list.reduce((sum, project) => sum + project.mrrEur, 0))
  const subscribers = list.reduce((sum, project) => sum + project.subscribers, 0)
  // Total d'il y a 30 jours : seulement si l'historique couvre assez de jours ; un projet absent a l'epoque compte pour 0 (nouveau).
  const prevMrrEur = longEnough ? round2(list.reduce((sum, project) => sum + (project.prevMrrEur ?? 0), 0)) : null

  // A surveiller : paiements en retard (critique) et annulations prevues (avertissement).
  const projectById = new Map(projects.map((project) => [project.id, project]))
  const colorBySlug = new Map(list.map((project) => [project.slug, project.color]))
  const dateFr = (date: Date | null) => (date ? date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'Europe/Paris' }) : null)
  const euro = (value: number) => `${round2(value).toFixed(2).replace('.', ',')} €`
  const watch: WatchItem[] = []
  for (const sub of subscriptions) {
    const project = projectById.get(sub.projectId)
    if (!project) continue
    const common = { projectSlug: project.slug, projectName: project.name, color: colorBySlug.get(project.slug) ?? projectColor(project.slug) }
    const price = Number(sub.mrrEur) > 0 ? ` · ${euro(Number(sub.mrrEur))} / mois` : ''
    if (sub.status === 'past_due' || sub.status === 'unpaid') {
      watch.push({ kind: 'crit', title: sub.status === 'unpaid' ? 'Abonnement impayé' : 'Paiement en retard', desc: `${sub.plan}${price}`, ...common })
    } else if (sub.status === 'active' && sub.cancelAtPeriodEnd) {
      const when = dateFr(sub.currentPeriodEnd)
      watch.push({ kind: 'warn', title: 'Annulation prévue', desc: `${sub.plan}${when ? ` · fin de période le ${when}` : ''}${price}`, ...common })
    }
  }
  watch.sort((a, b) => (a.kind === b.kind ? a.projectName.localeCompare(b.projectName, 'fr') : a.kind === 'crit' ? -1 : 1))

  // Derniers abonnements : hors tentatives abandonnees (incomplete / incomplete_expired), les plus recents d'abord.
  const STATUS: Record<string, { label: string; tone: RecentSubscription['tone'] }> = {
    active: { label: 'Actif', tone: 'ok' },
    trialing: { label: 'Essai', tone: 'muted' },
    past_due: { label: 'Paiement en retard', tone: 'crit' },
    unpaid: { label: 'Impayé', tone: 'crit' },
    canceled: { label: 'Annulé', tone: 'muted' },
    paused: { label: 'En pause', tone: 'muted' }
  }
  const recent: RecentSubscription[] = subscriptions
    .filter((sub) => sub.createdAt && STATUS[sub.status] && projectById.has(sub.projectId))
    .sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime())
    .slice(0, 10)
    .map((sub) => {
      const project = projectById.get(sub.projectId) as ProjectRef
      const status = STATUS[sub.status]
      return {
        client: sub.customerLabel ?? null,
        projectSlug: project.slug,
        projectName: project.name,
        color: colorBySlug.get(project.slug) ?? projectColor(project.slug),
        plan: sub.plan,
        amountEur: round2(Number(sub.mrrEur)),
        createdOn: dayKey(sub.createdAt as Date),
        status: sub.status,
        statusLabel: status.label,
        tone: status.tone
      }
    })

  const movementTotals = emptyMovements()
  for (const project of list) {
    for (const key of Object.keys(movementTotals) as (keyof MovementTotals)[]) {
      movementTotals[key] += project.movements[key]
    }
  }
  for (const key of Object.keys(movementTotals) as (keyof MovementTotals)[]) {
    movementTotals[key] = round2(movementTotals[key])
  }

  return {
    configured: true,
    updatedOn: dayKey(end),
    historyDays,
    months: monthsList,
    projects: list,
    watch: watch.slice(0, 20),
    recent,
    movementDays: Math.min(30, historyDays),
    totals: {
      mrrEur,
      arrEur: round2(mrrEur * 12),
      subscribers,
      arpuEur: subscribers > 0 ? round2(mrrEur / subscribers) : null,
      prevMrrEur,
      deltaEur: prevMrrEur === null ? null : round2(mrrEur - prevMrrEur),
      deltaPct: prevMrrEur !== null && prevMrrEur > 0 ? round2(((mrrEur - prevMrrEur) / prevMrrEur) * 100) : null,
      movements: movementTotals,
      openingMrrEur: round2(mrrEur - movementTotals.newEur - movementTotals.expansionEur + movementTotals.contractionEur + movementTotals.churnEur)
    }
  }
}
