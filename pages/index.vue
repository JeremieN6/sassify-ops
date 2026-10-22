<script setup lang="ts">
type Health = 'up' | 'degraded' | 'down' | 'unknown'
type Service = {
  slug: string
  name: string
  host: string
  health: Health
  uptime30: number | null
  p95Ms: number | null
  spark: number[]
  lastStatus: number | null
  lastDeploy: { at: string; sha: string; environment: string } | null
}
type Overview = {
  monitoring: { enabled: boolean; started: boolean; lastCycleAt: number | null; services: number }
  summary: { total: number; up: number; degraded: number; down: number; unknown: number }
  services: Service[]
  kpis: {
    availability30: number | null
    costs30: number
    costsDeltaPct: number | null
    budgetEur: number | null
    deploys7d: number
    deploysFailed7d: number
    openAlerts: number
    openCritical: number
    openWarning: number
  }
  cost: { variable: number; events: number; daily: { day: string; total: number }[] }
  alerts: { id: string; title: string; severity: 'CRITICAL' | 'WARNING'; status: string; source: string | null; openedAt: string }[]
  deployments: { id: string; project: string; environment: string; status: 'RUNNING' | 'SUCCESS' | 'FAILED'; message: string | null; startedAt: string }[]
}

useHead({ title: "Vue d'ensemble · Sassify Ops" })

const f = useFormat()
const now = useNow()
const { data, refresh, error } = await useFetch<Overview>('/api/overview')
const fetchedAt = useState('overview-fetched-at', () => Date.now())

const refreshing = ref(false)
async function reload() {
  refreshing.value = true
  try {
    await refresh()
    fetchedAt.value = Date.now()
  } finally {
    refreshing.value = false
  }
}
onMounted(() => {
  const timer = setInterval(reload, 60_000)
  onBeforeUnmount(() => clearInterval(timer))
})

const HEALTH = {
  up: { label: 'Opérationnel', tone: 'ok', spark: '#4ADE9B' },
  degraded: { label: 'Dégradé', tone: 'warn', spark: '#F6B94C' },
  down: { label: 'Injoignable', tone: 'crit', spark: '#FF7A7A' },
  unknown: { label: 'En attente', tone: 'muted', spark: '#8B93FF' }
} as const

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`
const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

const banner = computed(() => {
  const d = data.value
  if (!d) return null
  const s = d.summary
  const parts = [
    s.down ? plural(s.down, 'service injoignable', 'services injoignables') : '',
    s.degraded ? plural(s.degraded, 'service dégradé', 'services dégradés') : '',
    s.up ? plural(s.up, 'opérationnel', 'opérationnels') : '',
    s.unknown ? `${s.unknown} en attente` : ''
  ].filter(Boolean)

  const worst = d.services.find((x) => x.health === 'down') ?? d.services.find((x) => x.health === 'degraded')
  let detail = ''
  if (worst?.health === 'down') {
    detail = `${worst.name} : aucune réponse valide (${worst.lastStatus ? `dernier code HTTP ${worst.lastStatus}` : 'aucune réponse'}).`
  } else if (worst?.health === 'degraded') {
    detail = `${worst.name} : latence p95 à ${f.ms(worst.p95Ms)}.`
  } else if (!d.monitoring.enabled) {
    detail = "Les sondes sont désactivées sur cette instance (elles s'activent en production)."
  } else if (s.unknown === s.total) {
    detail = 'Les premières mesures arrivent dans quelques minutes.'
  } else {
    detail = 'Tous les services répondent normalement.'
  }

  const tone = s.down ? 'crit' : s.degraded ? 'warn' : s.up > 0 && s.unknown === 0 ? 'ok' : 'neutral'
  return { tone, title: parts.join(' · ') || 'Aucun service suivi', detail, hasIssue: Boolean(worst) }
})

const BANNER = {
  crit: { box: 'border-crit/35 bg-crit/6', icon: 'bg-crit/16 text-crit', link: 'border-crit/40 text-crit', glyph: 'warn' },
  warn: { box: 'border-warn/35 bg-warn/6', icon: 'bg-warn/16 text-warn', link: 'border-warn/40 text-warn', glyph: 'warn' },
  ok: { box: 'border-ok/35 bg-ok/6', icon: 'bg-ok/16 text-ok', link: 'border-ok/40 text-ok', glyph: 'circleCheck' },
  neutral: { box: 'border-line bg-white/[0.03]', icon: 'bg-white/10 text-ink-muted', link: 'border-line-strong text-ink-muted', glyph: 'loader' }
} as const

const availability = computed(() => data.value?.kpis.availability30 ?? null)
const budgetPct = computed(() => {
  const k = data.value?.kpis
  return k?.budgetEur ? (k.costs30 / k.budgetEur) * 100 : null
})
const budgetBar = computed(() => (budgetPct.value === null ? '' : budgetPct.value >= 100 ? 'bg-crit' : budgetPct.value >= 85 ? 'bg-warn' : 'bg-accent'))

const successRate = computed(() => {
  const k = data.value?.kpis
  return k && k.deploys7d ? ((k.deploys7d - k.deploysFailed7d) / k.deploys7d) * 100 : null
})

// Série de coûts : 30 jours complets, jour du pic en surbrillance
const costDays = computed(() => {
  const d = data.value
  if (!d) return []
  const to = new Date()
  to.setUTCHours(0, 0, 0, 0)
  const end = new Date(to.getTime() + 86_400_000)
  return fillDays(d.cost.daily, new Date(end.getTime() - 30 * 86_400_000).toISOString(), end.toISOString())
})
const peak = computed(() => costDays.value.reduce((best, row) => (row.total > best.total ? row : best), { day: '', total: 0 }))
const costItems = computed(() =>
  costDays.value.map((row) => ({
    value: row.total,
    tip: `${f.dayMonth(row.day)} · ${f.eur(row.total)}`,
    highlight: peak.value.total > 0 && row.day === peak.value.day
  }))
)
const costLabels = computed(() => {
  const days = costDays.value
  return days.length ? [f.dayMonth(days[0].day), f.dayMonth(days[Math.floor(days.length / 2)].day), f.dayMonth(days[days.length - 1].day)] : []
})

const ALERT_TONE = {
  CRITICAL: { text: 'Critique', box: 'bg-crit/14 text-crit', color: 'text-crit' },
  WARNING: { text: 'Avertissement', box: 'bg-warn/14 text-warn', color: 'text-warn' }
} as const
const DEPLOY_TONE = {
  SUCCESS: { box: 'bg-ok/12 text-ok', icon: 'check', label: 'Réussi' },
  FAILED: { box: 'bg-crit/14 text-crit', icon: 'x', label: 'Échec' },
  RUNNING: { box: 'bg-accent/16 text-accent-soft', icon: 'loader', label: 'En cours' }
} as const
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader title="Vue d'ensemble" :subtitle="`${cap(f.longDate(now))} ·${plural(data?.summary.total ?? 0, 'service suivi', 'services suivis')}`">
      <span class="flex h-10 items-center gap-2.5 rounded-full border border-line px-3.5 text-small text-ink-muted">
        <span class="live-dot h-2 w-2 rounded-full bg-ok" aria-hidden="true" />
        En direct · actualisé {{ f.ago(fetchedAt, now) }}
      </span>
      <button type="button" class="btn-icon" aria-label="Actualiser" :disabled="refreshing" @click="reload">
        <UiIcon name="refresh" :size="16" :class="refreshing ? 'animate-spin' : ''" />
      </button>
    </PageHeader>

    <p v-if="error" class="panel border-crit/40 p-4 text-crit" role="alert">Impossible de charger les données. Réessaie dans un instant.</p>

    <template v-if="data && banner">
      <!-- Statut global -->
      <section aria-label="Statut global" class="flex flex-wrap items-center gap-x-5 gap-y-4 rounded-xl border px-5 py-[18px]" :class="BANNER[banner.tone as keyof typeof BANNER].box">
        <span class="grid h-10 w-10 flex-none place-items-center rounded-full" :class="BANNER[banner.tone as keyof typeof BANNER].icon">
          <UiIcon :name="BANNER[banner.tone as keyof typeof BANNER].glyph" :size="20" />
        </span>
        <div class="min-w-0 flex-[1_1_320px]">
          <div class="text-section">{{ banner.title }}</div>
          <div class="mt-0.5 text-ink-muted">{{ banner.detail }}</div>
        </div>
        <NuxtLink
          v-if="banner.hasIssue"
          to="/alerts"
          class="nav-link h-10 border px-4 hover:text-ink"
          :class="BANNER[banner.tone as keyof typeof BANNER].link"
        >
          Voir les alertes <UiIcon name="arrow" :size="16" />
        </NuxtLink>
      </section>

      <!-- Indicateurs clés -->
      <section aria-label="Indicateurs clés" class="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(240px,100%),1fr))]">
        <UiKpi label="Disponibilité · 30 j" :value="availability === null ? '—' : f.pct(availability)">
          <span v-if="availability === null" class="text-small text-ink-muted">En attente des premières mesures</span>
          <span v-else-if="availability >= 99.9" class="text-small text-ok">Au-dessus de l'objectif (99,9 %)</span>
          <span v-else class="text-small text-warn">Sous l'objectif (99,9 %)</span>
        </UiKpi>

        <UiKpi label="Coûts · 30 j" :value="f.eur(data.kpis.costs30)">
          <div v-if="budgetPct !== null" class="h-1.5 overflow-hidden rounded-[3px] bg-line" role="meter" aria-label="Part du budget mensuel" :aria-valuenow="Math.round(budgetPct)" aria-valuemin="0" aria-valuemax="100">
            <div class="h-full" :class="budgetBar" :style="{ width: `${Math.min(100, budgetPct)}%` }" />
          </div>
          <span class="text-small text-ink-muted">
            <template v-if="budgetPct !== null">{{ Math.round(budgetPct) }} % du budget de {{ f.eurShort(data.kpis.budgetEur as number) }}</template>
            <NuxtLink v-else to="/alerts#budget" class="text-accent">Définir un plafond mensuel</NuxtLink>
            <template v-if="data.kpis.costsDeltaPct !== null"> · {{ f.signedPct(data.kpis.costsDeltaPct) }} vs période précédente</template>
          </span>
        </UiKpi>

        <UiKpi label="Déploiements · 7 j" :value="String(data.kpis.deploys7d)">
          <span v-if="data.kpis.deploys7d === 0" class="text-small text-ink-muted">Aucun déploiement reçu</span>
          <span v-else class="text-small text-ink-muted">
            <span class="text-ok">{{ data.kpis.deploys7d - data.kpis.deploysFailed7d }} réussis</span> ·
            <span :class="data.kpis.deploysFailed7d ? 'text-crit' : ''">{{ plural(data.kpis.deploysFailed7d, 'échec', 'échecs') }}</span>
            <template v-if="successRate !== null"> · {{ Math.round(successRate) }} % de réussite</template>
          </span>
        </UiKpi>

        <UiKpi label="Alertes ouvertes" :value="String(data.kpis.openAlerts)">
          <span v-if="data.kpis.openAlerts === 0" class="text-small text-ok">Aucune alerte ouverte</span>
          <span v-else class="text-small text-ink-muted">
            <span class="text-crit">{{ data.kpis.openCritical }} critique{{ data.kpis.openCritical > 1 ? 's' : '' }}</span> ·
            <span class="text-warn">{{ plural(data.kpis.openWarning, 'avertissement', 'avertissements') }}</span>
          </span>
        </UiKpi>
      </section>

      <div class="flex flex-wrap items-stretch gap-6">
        <!-- Services -->
        <UiPanel title="Services" subtitle="Latence p95 et disponibilité sur 30 jours" flush class="flex-[2_1_560px]">
          <template #actions>
            <NuxtLink to="/servers" class="btn-link">Voir les serveurs <UiIcon name="arrow" :size="16" /></NuxtLink>
          </template>
          <div v-if="data.services.length === 0" class="py-6 text-ink-muted">Aucun service suivi pour l'instant.</div>
          <div v-else class="relative overflow-x-auto">
            <div class="min-w-[656px]">
              <div class="eyebrow grid items-center gap-3 border-b border-line px-2 py-2 [grid-template-columns:minmax(130px,1.5fr)_124px_96px_80px_78px_88px]">
                <span>Service</span><span>Statut</span><span>Latence</span><span class="text-right">Dispo.</span><span class="text-right">p95</span><span class="text-right">Déployé</span>
              </div>
              <div
                v-for="service in data.services"
                :key="service.slug"
                class="row-hover grid items-center gap-3 border-b border-line px-2 py-3.5 [grid-template-columns:minmax(130px,1.5fr)_124px_96px_80px_78px_88px]"
              >
                <div class="min-w-0">
                  <div class="font-medium">{{ service.name }}</div>
                  <div class="truncate font-mono text-label text-ink-muted">{{ service.host }}</div>
                </div>
                <UiPill :tone="HEALTH[service.health].tone" :label="HEALTH[service.health].label" class="justify-self-start" />
                <UiSpark :values="service.spark" :color="HEALTH[service.health].spark" :label="`Latence récente de ${service.name}`" />
                <span class="text-right font-mono text-small">{{ service.uptime30 === null ? '—' : f.pct(service.uptime30) }}</span>
                <span class="text-right font-mono text-small" :class="service.health === 'degraded' ? 'text-warn' : ''">{{ f.ms(service.p95Ms) }}</span>
                <span class="text-right text-small text-ink-muted">{{ service.lastDeploy ? f.ago(service.lastDeploy.at, now) : '—' }}</span>
              </div>
            </div>
          </div>
        </UiPanel>

        <!-- Alertes en cours -->
        <UiPanel title="Alertes en cours" class="flex-[1_1_320px]">
          <template #actions><NuxtLink to="/alerts" class="text-small font-medium text-accent">Tout voir</NuxtLink></template>
          <p v-if="data.alerts.length === 0" class="m-0 py-4 text-ink-muted">Aucune alerte en cours. Tout est calme.</p>
          <div v-for="alert in data.alerts" :key="alert.id" class="flex gap-3 border-t border-line py-3.5">
            <span class="grid h-8 w-8 flex-none place-items-center rounded-full" :class="ALERT_TONE[alert.severity].box"><UiIcon name="warn" :size="16" /></span>
            <div class="flex min-w-0 flex-col gap-1">
              <span class="font-medium">{{ alert.title }}</span>
              <span class="text-small text-ink-muted">
                <span class="font-medium" :class="ALERT_TONE[alert.severity].color">{{ ALERT_TONE[alert.severity].text }}{{ alert.status === 'ACKNOWLEDGED' ? ' · acquittée' : '' }}</span>
                · {{ alert.source }} · {{ f.ago(alert.openedAt, now) }}
              </span>
            </div>
          </div>
        </UiPanel>
      </div>

      <div class="flex flex-wrap items-stretch gap-6">
        <!-- Coûts par jour -->
        <UiPanel title="Dépenses variables par jour" :subtitle="`Appels API · ${costLabels[0] ?? ''} – ${costLabels[2] ?? ''}${peak.total > 0 ? ` · pic le ${f.dayMonth(peak.day)} à ${f.eur(peak.total)}` : ''}`" class="flex-[2_1_560px] !gap-5">
          <template #actions>
            <div class="text-right">
              <div class="font-mono text-[20px] font-medium">{{ f.eur(data.cost.variable) }}</div>
              <div class="text-small text-ink-muted">{{ f.num(data.cost.events) }} appels</div>
            </div>
          </template>
          <UiBars v-if="data.cost.events > 0" :items="costItems" :format="f.eurAxis" :x-labels="costLabels" />
          <p v-else class="m-0 py-6 text-ink-muted">Aucun appel enregistré sur 30 jours. Les coûts arrivent dès que tes SaaS envoient leurs appels à Sassify Ops.</p>
        </UiPanel>

        <!-- Derniers déploiements -->
        <UiPanel title="Derniers déploiements" class="flex-[1_1_320px]">
          <template #actions><NuxtLink to="/deployments" class="text-small font-medium text-accent">Tout voir</NuxtLink></template>
          <p v-if="data.deployments.length === 0" class="m-0 py-4 text-ink-muted">Aucun déploiement reçu. Ajoute l'étape de notification à tes workflows GitHub Actions.</p>
          <div v-for="deployment in data.deployments" :key="deployment.id" class="flex items-center gap-3 border-t border-line py-3">
            <span class="grid h-7 w-7 flex-none place-items-center rounded-full" :class="DEPLOY_TONE[deployment.status].box" :title="DEPLOY_TONE[deployment.status].label">
              <UiIcon :name="DEPLOY_TONE[deployment.status].icon" :size="14" />
            </span>
            <div class="flex min-w-0 flex-1 flex-col">
              <span class="font-medium">{{ deployment.project }} <span class="text-small font-normal text-ink-muted">· {{ deployment.environment === 'production' ? 'Production' : 'Preview' }}</span></span>
              <span class="truncate text-small text-ink-muted">{{ deployment.message || 'Sans message' }}</span>
            </div>
            <span class="whitespace-nowrap text-small text-ink-muted">{{ deployment.status === 'RUNNING' ? 'en cours' : f.ago(deployment.startedAt, now) }}</span>
          </div>
        </UiPanel>
      </div>
    </template>
  </div>
</template>
