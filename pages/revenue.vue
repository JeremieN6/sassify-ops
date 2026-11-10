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
      </template>
    </template>
  </div>
</template>
