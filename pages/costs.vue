<script setup lang="ts">
type Line = { key: string; name?: string; variable: number; fixed: number; total: number; events: number; units: number }
type Summary = {
  from: string
  to: string
  totals: { variable: number; fixed: number; total: number }
  previousTotal: number
  deltaPct: number | null
  budgetEur: number | null
  unpriced: number
  byProject: Line[]
  byProvider: Line[]
  daily: { day: string; total: number }[]
  recent: { id: string; project: string; provider: string; endpoint: string | null; units: number | null; unitLabel: string | null; amountEur: number; occurredAt: string }[]
}

useHead({ title: 'Coûts · Sassify Ops' })

const f = useFormat()
const PERIODS = [
  { id: '7d', label: '7 jours' },
  { id: '30d', label: '30 jours' },
  { id: '90d', label: '90 jours' },
  { id: 'month', label: 'Ce mois' },
  { id: 'lastmonth', label: 'Mois dernier' }
]
const range = ref('30d')
const { data, pending, error } = await useFetch<Summary>('/api/costs/summary', { query: { range }, watch: [range] })

const days = computed(() => (data.value ? fillDays(data.value.daily, data.value.from, data.value.to) : []))
const peak = computed(() => days.value.reduce((best, row) => (row.total > best.total ? row : best), { day: '', total: 0 }))
const items = computed(() =>
  days.value.map((row) => ({ value: row.total, tip: `${f.dayMonth(row.day)} · ${f.eur(row.total)}`, highlight: peak.value.total > 0 && row.day === peak.value.day }))
)
const xLabels = computed(() =>
  days.value.length > 2 ? [f.dayMonth(days.value[0].day), f.dayMonth(days.value[Math.floor(days.value.length / 2)].day), f.dayMonth(days.value[days.value.length - 1].day)] : []
)
const maxProject = computed(() => Math.max(0.0001, ...(data.value?.byProject.map((line) => line.total) ?? [0])))
const calls = computed(() => data.value?.byProvider.reduce((sum, line) => sum + line.events, 0) ?? 0)
const dash = (value: number) => (value > 0 ? f.eur(value) : '—')
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader title="Coûts" subtitle="Appels API et coûts fixes, par projet et par fournisseur">
      <UiChips v-model="range" :options="PERIODS" variant="solid" label="Période" />
    </PageHeader>

    <p v-if="error" class="panel border-crit/40 p-4 text-crit" role="alert">Impossible de charger les coûts.</p>

    <template v-if="data">
      <p
        v-if="data.unpriced > 0"
        class="m-0 rounded-xl border border-warn/35 bg-warn/6 px-4 py-3 text-warn"
        role="status"
      >
        {{ f.num(data.unpriced) }} appel(s) LLM sans tarif connu sont comptés à 0 : les totaux sont sous-estimés. Ajoute le modèle dans <code class="font-mono">server/utils/pricing.ts</code>.
      </p>

      <section aria-label="Totaux" class="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(240px,100%),1fr))]" :class="pending ? 'opacity-60' : ''">
        <UiKpi label="Total" :value="f.eur(data.totals.total)">
          <span v-if="data.deltaPct !== null" class="text-small text-ink-muted">{{ f.signedPct(data.deltaPct) }} vs période précédente ({{ f.eur(data.previousTotal) }})</span>
        </UiKpi>
        <UiKpi label="Appels API (variable)" :value="f.eur(data.totals.variable)">
          <span class="text-small text-ink-muted">{{ f.num(calls) }} appel{{ calls > 1 ? 's' : '' }}</span>
        </UiKpi>
        <UiKpi label="Coûts fixes (proratisés)" :value="f.eur(data.totals.fixed)">
          <NuxtLink to="/fixed-costs" class="text-small text-accent">Gérer les coûts fixes</NuxtLink>
        </UiKpi>
      </section>

      <UiPanel
        title="Dépenses variables par jour"
        :subtitle="peak.total > 0 ? `Pic le ${f.dayMonth(peak.day)} à ${f.eur(peak.total)}` : 'Appels API enregistrés par les SaaS'"
        class="!gap-5"
      >
        <UiBars v-if="peak.total > 0" :items="items" :format="f.eurAxis" :x-labels="xLabels" />
        <p v-else class="m-0 py-6 text-ink-muted">Aucun appel enregistré sur cette période.</p>
      </UiPanel>

      <div class="grid items-start gap-6 xl:grid-cols-2">
        <UiPanel title="Par projet" subtitle="Variable en couleur d'accent, fixe en bleu-gris" flush>
          <div class="relative overflow-x-auto">
            <table class="w-full min-w-[520px] text-body">
              <thead>
                <tr class="eyebrow border-b border-line text-left">
                  <th class="px-2 py-2 font-normal">Projet</th>
                  <th class="px-2 py-2 font-normal"><span class="sr-only">Répartition</span></th>
                  <th class="px-2 py-2 text-right font-normal">Variable</th>
                  <th class="px-2 py-2 text-right font-normal">Fixe</th>
                  <th class="px-2 py-2 text-right font-normal">Total</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="line in data.byProject" :key="line.key" class="row-hover border-b border-line">
                  <td class="px-2 py-3 font-medium">{{ line.name || line.key }}</td>
                  <td class="w-[28%] px-2 py-3">
                    <div class="flex h-2 overflow-hidden rounded-full bg-line" :style="{ width: `${(line.total / maxProject) * 100}%` }" role="img" :aria-label="`${f.eur(line.variable)} variable, ${f.eur(line.fixed)} fixe`">
                      <div class="h-full bg-accent" :style="{ width: `${line.total ? (line.variable / line.total) * 100 : 0}%` }" />
                      <div class="h-full bg-series-fixed" :style="{ width: `${line.total ? (line.fixed / line.total) * 100 : 0}%` }" />
                    </div>
                  </td>
                  <td class="px-2 py-3 text-right font-mono text-small">{{ dash(line.variable) }}</td>
                  <td class="px-2 py-3 text-right font-mono text-small">{{ dash(line.fixed) }}</td>
                  <td class="px-2 py-3 text-right font-mono text-small font-medium">{{ f.eur(line.total) }}</td>
                </tr>
                <tr v-if="data.byProject.length === 0"><td colspan="5" class="px-2 py-4 text-ink-muted">Aucune donnée sur cette période.</td></tr>
              </tbody>
            </table>
          </div>
        </UiPanel>

        <UiPanel title="Par API / fournisseur" flush>
          <div class="relative overflow-x-auto">
            <table class="w-full min-w-[460px] text-body">
              <thead>
                <tr class="eyebrow border-b border-line text-left">
                  <th class="px-2 py-2 font-normal">Fournisseur</th>
                  <th class="px-2 py-2 text-right font-normal">Appels</th>
                  <th class="px-2 py-2 text-right font-normal">Variable</th>
                  <th class="px-2 py-2 text-right font-normal">Fixe</th>
                  <th class="px-2 py-2 text-right font-normal">Total</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="line in data.byProvider" :key="line.key" class="row-hover border-b border-line">
                  <td class="px-2 py-3 font-medium">{{ line.key }}</td>
                  <td class="px-2 py-3 text-right font-mono text-small">{{ line.events ? f.num(line.events) : '—' }}</td>
                  <td class="px-2 py-3 text-right font-mono text-small">{{ dash(line.variable) }}</td>
                  <td class="px-2 py-3 text-right font-mono text-small">{{ dash(line.fixed) }}</td>
                  <td class="px-2 py-3 text-right font-mono text-small font-medium">{{ f.eur(line.total) }}</td>
                </tr>
                <tr v-if="data.byProvider.length === 0"><td colspan="5" class="px-2 py-4 text-ink-muted">Aucune donnée sur cette période.</td></tr>
              </tbody>
            </table>
          </div>
        </UiPanel>
      </div>

      <UiPanel title="Derniers appels" flush>
        <div class="relative overflow-x-auto">
          <table class="w-full min-w-[720px] text-body">
            <thead>
              <tr class="eyebrow border-b border-line text-left">
                <th class="px-2 py-2 font-normal">Date</th>
                <th class="px-2 py-2 font-normal">Projet</th>
                <th class="px-2 py-2 font-normal">Fournisseur</th>
                <th class="px-2 py-2 font-normal">Endpoint</th>
                <th class="px-2 py-2 text-right font-normal">Unités</th>
                <th class="px-2 py-2 text-right font-normal">Coût</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="call in data.recent" :key="call.id" class="row-hover border-b border-line">
                <td class="whitespace-nowrap px-2 py-3 text-small text-ink-muted">{{ f.dateTime(call.occurredAt) }}</td>
                <td class="px-2 py-3">{{ call.project }}</td>
                <td class="px-2 py-3">{{ call.provider }}</td>
                <td class="max-w-[260px] truncate px-2 py-3 font-mono text-label text-ink-muted" :title="call.endpoint || ''">{{ call.endpoint || '—' }}</td>
                <td class="whitespace-nowrap px-2 py-3 text-right font-mono text-small">{{ call.units != null ? `${f.num(call.units)} ${call.unitLabel || ''}` : '—' }}</td>
                <td class="px-2 py-3 text-right font-mono text-small">{{ f.eurPrecise(call.amountEur) }}</td>
              </tr>
              <tr v-if="data.recent.length === 0"><td colspan="6" class="px-2 py-4 text-ink-muted">Aucun appel sur cette période.</td></tr>
            </tbody>
          </table>
        </div>
      </UiPanel>
    </template>
  </div>
</template>
