<script setup lang="ts">
import type { ProjectRevenue, RevenuePayload } from '../server/utils/revenue'

useHead({ title: 'Revenus · Sassify Ops' })

const f = useFormat()
const { data } = await useFetch<RevenuePayload>('/api/revenue')

const MONTH_NAMES = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
const monthLabel = (month: string) => MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? month

const sel = ref('all')
const projects = computed<ProjectRevenue[]>(() => data.value?.projects ?? [])
const selected = computed(() => (sel.value === 'all' ? null : projects.value.find((project) => project.slug === sel.value) ?? null))
const selName = computed(() => selected.value?.name ?? 'Tous les projets')
const accent = computed(() => selected.value?.color ?? '#8B93FF')

// Indicateurs de la sélection : totaux (tous les projets) ou ceux du projet choisi.
const figures = computed(() => {
  if (!data.value) return null
  const project = selected.value
  if (!project) return data.value.totals
  return {
    mrrEur: project.mrrEur,
    arrEur: Math.round(project.mrrEur * 12 * 100) / 100,
    subscribers: project.subscribers,
    arpuEur: project.arpuEur,
    prevMrrEur: project.prevMrrEur,
    deltaEur: project.deltaEur,
    deltaPct: project.deltaPct
  }
})

const withRevenue = computed(() => projects.value.filter((project) => project.mrrEur > 0))
const withoutRevenue = computed(() => projects.value.filter((project) => project.mrrEur <= 0))
const totalMrr = computed(() => data.value?.totals.mrrEur ?? 0)

const columns = computed(() => {
  if (!data.value) return []
  const scope = selected.value ? [selected.value] : projects.value
  return data.value.months.map((month, index) => {
    const segments = scope.map((project) => ({ value: project.monthly[index] ?? 0, color: project.color }))
    const sum = segments.reduce((total, segment) => total + segment.value, 0)
    return { label: monthLabel(month), tip: `${monthLabel(month)} ${month.slice(0, 4)} · ${f.eur(sum)}`, segments, highlight: index === data.value!.months.length - 1 }
  })
})
const hasChartData = computed(() => columns.value.some((column) => column.segments.some((segment) => segment.value > 0)))

const delta = (value: number | null) => (value === null ? '—' : f.signedPct(value))
const deltaColor = (value: number | null) => (value === null ? 'text-ink-muted' : value > 0 ? 'text-ok' : value < 0 ? 'text-crit' : 'text-ink-muted')
const share = (mrr: number) => (totalMrr.value > 0 ? (mrr / totalMrr.value) * 100 : 0)
const shortHistory = computed(() => (data.value?.historyDays ?? 0) < 30)

// Mouvements du MRR (nouveaux / expansion / contraction / perte) de la sélection, sur la période couverte (30 jours max).
const moveFigures = computed(() => {
  if (!data.value) return null
  const project = selected.value
  const moves = project ? project.movements : data.value.totals.movements
  const current = project ? project.mrrEur : data.value.totals.mrrEur
  const opening = Math.round((current - moves.newEur - moves.expansionEur + moves.contractionEur + moves.churnEur) * 100) / 100
  const lines = [
    { label: 'Nouveaux abonnements', value: moves.newEur, sign: '+', color: 'text-ok', bar: 'bg-ok' },
    { label: 'Expansion', value: moves.expansionEur, sign: '+', color: 'text-ok', bar: 'bg-ok' },
    { label: 'Contraction', value: moves.contractionEur, sign: '−', color: 'text-warn', bar: 'bg-warn' },
    { label: 'Pertes et annulations', value: moves.churnEur, sign: '−', color: 'text-crit', bar: 'bg-crit' }
  ]
  const peak = Math.max(0.0001, ...lines.map((line) => line.value))
  return { opening, current, none: lines.every((line) => line.value === 0), lines: lines.map((line) => ({ ...line, width: `${(line.value / peak) * 100}%` })) }
})
const movePeriod = computed(() => ((data.value?.movementDays ?? 0) >= 30 ? '30 derniers jours' : `${data.value?.movementDays ?? 0} jour${(data.value?.movementDays ?? 0) > 1 ? 's' : ''} enregistré${(data.value?.movementDays ?? 0) > 1 ? 's' : ''}`))

// Répartition par plan (projet choisi) et éléments à surveiller (sélection).
const plans = computed(() => selected.value?.plans ?? [])
const planTotal = computed(() => plans.value.reduce((sum, plan) => sum + plan.mrrEur, 0))
const watch = computed(() => (data.value?.watch ?? []).filter((item) => !selected.value || item.projectSlug === selected.value.slug))

// Derniers abonnements (nom du client ou e-mail masqué : seule donnée personnelle stockée, voir server/utils/customerLabel.ts).
const recent = computed(() => (data.value?.recent ?? []).filter((item) => !selected.value || item.projectSlug === selected.value.slug))
const noClientNames = computed(() => recent.value.length > 0 && recent.value.every((item) => item.client === null))
const TONE = { ok: 'bg-ok/14 text-ok', warn: 'bg-warn/14 text-warn', crit: 'bg-crit/14 text-crit', muted: 'bg-line text-ink-muted' } as const
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader
      title="Revenus"
      :subtitle="data?.configured ? `${projects.length} projets suivis · ${withRevenue.length} avec des abonnements actifs` : 'MRR, abonnés et évolution par produit'"
    >
      <span v-if="data?.updatedOn" class="inline-flex h-10 items-center gap-2.5 rounded-full border border-line px-3.5 text-small text-ink-muted">
        <span class="h-2 w-2 rounded-full bg-ok" aria-hidden="true" />
        Données au {{ f.dayMonth(data.updatedOn) }}
      </span>
    </PageHeader>

    <template v-if="data">
      <UiPanel v-if="!data.configured" label="Revenus">
        <UiEmpty icon="trend" title="Aucune donnée de revenus pour l'instant">
          <p class="m-0">
            La synchronisation Stripe n'a pas encore enregistré d'instantané. Elle s'exécute au démarrage puis toutes les 6 heures ; dès le premier passage, le MRR de chaque projet apparaît ici.
          </p>
        </UiEmpty>
      </UiPanel>

      <template v-else-if="figures">
        <section aria-label="Choix du projet">
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              :aria-pressed="sel === 'all'"
              class="inline-flex h-11 items-center gap-2.5 rounded-xl border px-4 font-medium transition-colors"
              :class="sel === 'all' ? 'border-accent/60 bg-accent/14 text-accent-soft' : 'border-line text-ink-muted hover:border-line-strong'"
              @click="sel = 'all'"
            >
              <span class="h-2.5 w-2.5 rounded-full bg-accent" aria-hidden="true" />
              Tous
              <span class="font-mono text-small">{{ f.eurShort(totalMrr) }}</span>
            </button>
            <button
              v-for="project in projects"
              :key="project.slug"
              type="button"
              :aria-pressed="sel === project.slug"
              class="inline-flex h-11 items-center gap-2.5 rounded-xl border px-4 font-medium transition-colors"
              :class="sel === project.slug ? 'border-accent/60 bg-accent/14 text-accent-soft' : 'border-line text-ink-muted hover:border-line-strong'"
              @click="sel = project.slug"
            >
              <span class="h-2.5 w-2.5 rounded-full" :style="{ background: project.color }" aria-hidden="true" />
              {{ project.name }}
              <span class="font-mono text-small" :class="project.mrrEur > 0 ? 'text-ink' : 'text-ink-muted'">{{ project.mrrEur > 0 ? f.eurShort(project.mrrEur) : '—' }}</span>
            </button>
          </div>
        </section>

        <section aria-label="Indicateurs clés" class="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(200px,100%),1fr))]">
          <UiKpi label="MRR actuel" :value="f.eur(figures.mrrEur)">
            <span class="text-small text-ink-muted">{{ selName }}</span>
          </UiKpi>
          <UiKpi label="ARR estimé" :value="f.eurShort(figures.arrEur)">
            <span class="text-small text-ink-muted">MRR × 12</span>
          </UiKpi>
          <UiKpi label="Abonnés actifs" :value="f.num(figures.subscribers)">
            <span class="text-small text-ink-muted">payants et en retard de paiement</span>
          </UiKpi>
          <UiKpi label="Panier moyen" :value="figures.arpuEur === null ? '—' : f.eur(figures.arpuEur)">
            <span class="text-small text-ink-muted">par abonné et par mois</span>
          </UiKpi>
          <UiKpi label="Variation 30 jours" :value="figures.deltaPct === null ? '—' : f.signedPct(figures.deltaPct)">
            <span v-if="figures.deltaEur === 0" class="text-small text-ink-muted">stable vs il y a 30 j</span>
            <span v-else-if="figures.deltaEur !== null" class="text-small" :class="deltaColor(figures.deltaEur)">{{ figures.deltaEur > 0 ? '+' : '−' }}{{ f.eur(Math.abs(figures.deltaEur)) }} vs il y a 30 j</span>
            <span v-else class="text-small text-ink-muted">historique en construction</span>
          </UiKpi>
        </section>

        <div class="grid items-stretch gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
        <UiPanel :title="selected ? `MRR · ${selName}` : 'MRR par projet'" subtitle="Revenu mensuel récurrent en fin de mois · mois en cours inclus" class="!gap-5">
          <template v-if="!selected" #actions>
            <ul class="m-0 flex max-w-[420px] list-none flex-wrap justify-end gap-x-4 gap-y-1.5 p-0 text-small text-ink-muted">
              <li v-for="project in withRevenue" :key="project.slug" class="inline-flex items-center gap-2">
                <span class="h-2.5 w-2.5 rounded-[2px]" :style="{ background: project.color }" aria-hidden="true" />{{ project.name }}
              </li>
            </ul>
          </template>
          <UiStackedBars v-if="hasChartData" :columns="columns" :format="f.eurAxis" />
          <div v-else class="flex min-h-[220px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong p-6 text-center">
            <span class="font-semibold">Pas encore de revenu pour {{ selName }}</span>
            <span class="max-w-[420px] text-ink-muted">Aucun abonnement actif sur ce compte Stripe. Le MRR et l'historique apparaîtront dès le premier paiement récurrent.</span>
          </div>
          <p v-if="shortHistory" class="m-0 text-small text-ink-muted">
            Historique en construction : {{ data.historyDays }} jour{{ data.historyDays > 1 ? 's' : '' }} enregistré{{ data.historyDays > 1 ? 's' : '' }}. La courbe se remplit jour après jour, depuis le démarrage de la synchronisation Stripe.
          </p>
        </UiPanel>

        <UiPanel v-if="moveFigures" title="Mouvements du MRR" :subtitle="`${selName} · ${movePeriod}`" class="!gap-4">
          <div class="flex items-baseline justify-between border-b border-line pb-3">
            <span class="text-ink-muted">Début de période</span>
            <span class="font-mono">{{ f.eur(moveFigures.opening) }}</span>
          </div>
          <div v-for="line in moveFigures.lines" :key="line.label" class="flex flex-col gap-2">
            <div class="flex items-baseline justify-between">
              <span>{{ line.label }}</span>
              <span class="font-mono" :class="line.value > 0 ? line.color : 'text-ink-muted'">{{ line.value > 0 ? `${line.sign}${f.eur(line.value)}` : '—' }}</span>
            </div>
            <div class="h-1.5 overflow-hidden rounded-full bg-line" role="img" :aria-label="`${line.label} : ${f.eur(line.value)}`">
              <div class="h-full" :class="line.bar" :style="{ width: line.width }" />
            </div>
          </div>
          <p v-if="moveFigures.none" class="m-0 text-small text-ink-muted">Aucun mouvement enregistré sur la période. Les nouveaux abonnements, changements de plan et départs sont comptés à chaque synchronisation Stripe, à partir du 10 novembre.</p>
          <div class="mt-auto flex items-baseline justify-between border-t border-line pt-3.5">
            <span class="font-semibold">Aujourd'hui</span>
            <span class="font-mono text-section font-medium">{{ f.eur(moveFigures.current) }}</span>
          </div>
        </UiPanel>
        </div>

        <UiPanel v-if="!selected" title="Comparatif des projets" subtitle="Cliquez sur un projet pour le détailler" flush>
          <div class="relative overflow-x-auto">
            <table class="w-full min-w-[820px] text-body">
              <thead>
                <tr class="eyebrow border-b border-line text-left">
                  <th class="px-2 py-2 font-normal">Projet</th>
                  <th class="px-2 py-2 text-right font-normal">MRR</th>
                  <th class="px-2 py-2 font-normal">Part</th>
                  <th class="px-2 py-2 text-right font-normal">Abonnés</th>
                  <th class="px-2 py-2 text-right font-normal">Panier moyen</th>
                  <th class="px-2 py-2 text-right font-normal">Δ 30 j</th>
                  <th class="px-2 py-2 font-normal">Tendance</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="project in withRevenue" :key="project.slug" class="row-hover border-b border-line">
                  <td class="px-2 py-1.5">
                    <button type="button" class="flex min-h-[44px] items-center gap-2.5 border-0 bg-transparent p-0 font-medium text-ink" @click="sel = project.slug">
                      <span class="h-2.5 w-2.5 flex-none rounded-full" :style="{ background: project.color }" aria-hidden="true" />{{ project.name }}
                    </button>
                  </td>
                  <td class="px-2 py-3 text-right font-mono text-small font-medium">{{ f.eur(project.mrrEur) }}</td>
                  <td class="w-[22%] px-2 py-3">
                    <div class="flex items-center gap-2.5">
                      <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-line" role="img" :aria-label="`${f.pct(share(project.mrrEur), 1)} du MRR total`">
                        <div class="h-full" :style="{ width: `${share(project.mrrEur)}%`, background: project.color }" />
                      </div>
                      <span class="w-14 text-right font-mono text-small text-ink-muted">{{ f.pct(share(project.mrrEur), 1) }}</span>
                    </div>
                  </td>
                  <td class="px-2 py-3 text-right font-mono text-small">{{ f.num(project.subscribers) }}</td>
                  <td class="px-2 py-3 text-right font-mono text-small text-ink-muted">{{ project.arpuEur === null ? '—' : f.eur(project.arpuEur) }}</td>
                  <td class="px-2 py-3 text-right font-mono text-small" :class="deltaColor(project.deltaPct)">{{ delta(project.deltaPct) }}</td>
                  <td class="px-2 py-3"><UiSpark :values="project.spark" :color="project.color" :label="`Évolution du MRR de ${project.name} sur 30 jours`" /></td>
                </tr>
                <tr v-if="withRevenue.length === 0">
                  <td colspan="7" class="px-2 py-5 text-ink-muted">Aucun projet n'a de revenu récurrent pour l'instant.</td>
                </tr>
              </tbody>
              <tfoot v-if="withRevenue.length">
                <tr>
                  <td class="px-2 py-3.5 font-semibold">Total</td>
                  <td class="px-2 py-3.5 text-right font-mono text-small font-semibold">{{ f.eur(data.totals.mrrEur) }}</td>
                  <td />
                  <td class="px-2 py-3.5 text-right font-mono text-small font-semibold">{{ f.num(data.totals.subscribers) }}</td>
                  <td class="px-2 py-3.5 text-right font-mono text-small text-ink-muted">{{ data.totals.arpuEur === null ? '—' : f.eur(data.totals.arpuEur) }}</td>
                  <td class="px-2 py-3.5 text-right font-mono text-small" :class="deltaColor(data.totals.deltaPct)">{{ delta(data.totals.deltaPct) }}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
          <div v-if="withoutRevenue.length" class="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line px-2 pb-3 pt-3.5">
            <span class="font-medium">{{ withoutRevenue.length }} projet{{ withoutRevenue.length > 1 ? 's' : '' }} sans revenu</span>
            <span class="min-w-[240px] flex-1 text-small text-ink-muted">{{ withoutRevenue.map((project) => project.name).join(', ') }}</span>
          </div>
        </UiPanel>

        <UiPanel v-if="selected" title="Répartition par plan" :subtitle="selName" flush>
          <p v-if="plans.length === 0" class="m-0 px-2 pb-5 pt-1 text-ink-muted">Aucun plan facturé pour le moment.</p>
          <div v-else class="relative overflow-x-auto">
            <table class="w-full min-w-[560px] text-body">
              <thead>
                <tr class="eyebrow border-b border-line text-left">
                  <th class="px-2 py-2 font-normal">Plan</th>
                  <th class="px-2 py-2 text-right font-normal">Prix moyen</th>
                  <th class="px-2 py-2 text-right font-normal">Abonnés</th>
                  <th class="px-2 py-2 text-right font-normal">MRR</th>
                  <th class="px-2 py-2 font-normal">Part</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="plan in plans" :key="plan.name" class="row-hover border-b border-line">
                  <td class="px-2 py-3.5 font-medium">{{ plan.name }}</td>
                  <td class="px-2 py-3.5 text-right font-mono text-small">{{ f.eur(plan.priceEur) }}</td>
                  <td class="px-2 py-3.5 text-right font-mono text-small">{{ f.num(plan.subscribers) }}</td>
                  <td class="px-2 py-3.5 text-right font-mono text-small font-medium">{{ f.eur(plan.mrrEur) }}</td>
                  <td class="w-[26%] px-2 py-3.5">
                    <div class="flex items-center gap-2.5">
                      <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-line" role="img" :aria-label="`${f.pct(planTotal > 0 ? (plan.mrrEur / planTotal) * 100 : 0, 1)} du MRR de ${selName}`">
                        <div class="h-full" :style="{ width: `${planTotal > 0 ? (plan.mrrEur / planTotal) * 100 : 0}%`, background: accent }" />
                      </div>
                      <span class="w-14 text-right font-mono text-small text-ink-muted">{{ f.pct(planTotal > 0 ? (plan.mrrEur / planTotal) * 100 : 0, 1) }}</span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </UiPanel>

        <div class="grid items-start gap-6 xl:grid-cols-[minmax(320px,1fr)_minmax(0,2fr)]">
        <UiPanel title="À surveiller" :subtitle="`${selName} · paiements en retard et annulations prévues`">
          <p v-if="watch.length === 0" class="m-0 border-t border-line pt-3.5 text-ink-muted">Rien à signaler pour {{ selName }}.</p>
          <ul v-else class="m-0 flex list-none flex-col p-0">
            <li v-for="(item, index) in watch" :key="`${item.projectSlug}-${index}`" class="flex gap-3 border-t border-line py-3.5">
              <span
                class="grid h-8 w-8 flex-none place-items-center rounded-full"
                :class="item.kind === 'crit' ? 'bg-crit/14 text-crit' : 'bg-warn/14 text-warn'"
                role="img"
                :aria-label="item.kind === 'crit' ? 'Critique' : 'Avertissement'"
              >
                <UiIcon :name="item.kind === 'crit' ? 'circleAlert' : 'warn'" :size="16" />
              </span>
              <div class="flex min-w-0 flex-col gap-0.5">
                <span class="font-medium">{{ item.title }}</span>
                <span class="text-small text-ink-muted"><span class="font-medium" :style="{ color: item.color }">{{ item.projectName }}</span> · {{ item.desc }}</span>
              </div>
            </li>
          </ul>
        </UiPanel>

        <UiPanel title="Derniers abonnements" :subtitle="`${selName} · les plus récents d'abord`" flush>
          <p v-if="recent.length === 0" class="m-0 px-2 pb-5 pt-1 text-ink-muted">Aucun abonnement pour {{ selName }}.</p>
          <div v-else class="relative overflow-x-auto">
            <table class="w-full min-w-[700px] text-body">
              <thead>
                <tr class="eyebrow border-b border-line text-left">
                  <th class="px-2 py-2 font-normal">Client</th>
                  <th class="px-2 py-2 font-normal">Projet</th>
                  <th class="px-2 py-2 font-normal">Plan</th>
                  <th class="px-2 py-2 text-right font-normal">Montant</th>
                  <th class="px-2 py-2 font-normal">Date</th>
                  <th class="px-2 py-2 font-normal">Statut</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(item, index) in recent" :key="`${item.projectSlug}-${item.createdOn}-${index}`" class="row-hover border-b border-line">
                  <td class="px-2 py-3.5 font-medium" :class="item.client === null ? 'text-ink-muted' : ''">{{ item.client ?? 'Client non identifié' }}</td>
                  <td class="px-2 py-3.5">
                    <span class="inline-flex items-center gap-2"><span class="h-2 w-2 flex-none rounded-full" :style="{ background: item.color }" aria-hidden="true" />{{ item.projectName }}</span>
                  </td>
                  <td class="px-2 py-3.5 text-ink-muted">{{ item.plan }}</td>
                  <td class="px-2 py-3.5 text-right font-mono text-small">{{ item.amountEur > 0 ? f.eur(item.amountEur) : '—' }} <span v-if="item.amountEur > 0" class="text-ink-muted">/ mois</span></td>
                  <td class="px-2 py-3.5 text-small text-ink-muted">{{ f.dayMonth(item.createdOn) }}</td>
                  <td class="px-2 py-3.5">
                    <span class="inline-flex h-[26px] items-center gap-2 rounded-full px-2.5 text-small font-medium" :class="TONE[item.tone]">
                      <span class="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />{{ item.statusLabel }}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="noClientNames" class="m-0 border-t border-line px-2 pb-3 pt-3 text-small text-ink-muted">
            Les noms des clients apparaîtront dès que la clé Stripe de pilotage aura le droit « Customers : lecture » (Stripe → Développeurs → Clés API → modifier la clé d'organisation).
          </p>
        </UiPanel>
        </div>
      </template>
    </template>
  </div>
</template>
