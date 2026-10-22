<script setup lang="ts">
type Line = { key: string; name?: string; variable: number; fixed: number; total: number; events: number; units: number }
type Summary = {
  totals: { variable: number; fixed: number; total: number }
  unpriced: number
  byProject: Line[]
  byProvider: Line[]
  daily: { day: string; total: number }[]
  recent: {
    id: string
    project: string
    provider: string
    endpoint: string | null
    units: number | null
    unitLabel: string | null
    amountEur: number
    occurredAt: string
  }[]
}

const ranges = [
  { value: '7d', label: '7 jours' },
  { value: '30d', label: '30 jours' },
  { value: '90d', label: '90 jours' },
  { value: 'month', label: 'Ce mois' },
  { value: 'lastmonth', label: 'Mois dernier' }
]

const range = ref('30d')
const { data, pending, error } = await useFetch<Summary>('/api/costs/summary', { query: { range }, watch: [range] })
const { eur, eurPrecise, num, dateTime } = useFormat()

const maxDaily = computed(() => Math.max(0.0001, ...(data.value?.daily.map((day) => day.total) ?? [0])))
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap gap-1">
      <button
        v-for="item in ranges"
        :key="item.value"
        class="rounded-lg px-3 py-1.5 text-sm"
        :class="range === item.value ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'"
        @click="range = item.value"
      >
        {{ item.label }}
      </button>
    </div>

    <p v-if="error" class="text-sm text-red-600">Impossible de charger les donnees.</p>

    <template v-if="data">
      <p
        v-if="data.unpriced > 0"
        class="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
      >
        {{ num(data.unpriced) }} appel(s) LLM sans tarif connu sont comptes a 0 : les totaux sont sous-estimes. Ajoute le modele dans <code>server/utils/pricing.ts</code>.
      </p>

      <div class="grid gap-4 sm:grid-cols-3" :class="{ 'opacity-60': pending }">
        <div class="card">
          <p class="text-sm text-slate-500">Total</p>
          <p class="mt-1 text-2xl font-semibold">{{ eur(data.totals.total) }}</p>
        </div>
        <div class="card">
          <p class="text-sm text-slate-500">Appels API (variable)</p>
          <p class="mt-1 text-2xl font-semibold">{{ eur(data.totals.variable) }}</p>
        </div>
        <div class="card">
          <p class="text-sm text-slate-500">Couts fixes (proratises)</p>
          <p class="mt-1 text-2xl font-semibold">{{ eur(data.totals.fixed) }}</p>
        </div>
      </div>

      <div class="card">
        <h2 class="mb-4 text-sm font-medium text-slate-500">Depenses variables par jour</h2>
        <p v-if="data.daily.length === 0" class="text-sm text-slate-500">Aucun appel enregistre sur cette periode.</p>
        <div v-else class="flex h-40 items-end gap-1">
          <div
            v-for="day in data.daily"
            :key="day.day"
            class="group relative min-w-[3px] flex-1 rounded-t bg-indigo-500 hover:bg-indigo-400"
            :style="{ height: `${Math.max(2, (day.total / maxDaily) * 100)}%` }"
          >
            <span class="pointer-events-none absolute -top-8 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-xs text-white group-hover:block">
              {{ day.day }} : {{ eurPrecise(day.total) }}
            </span>
          </div>
        </div>
      </div>

      <div class="grid gap-6 lg:grid-cols-2">
        <div class="card">
          <h2 class="mb-3 text-sm font-medium text-slate-500">Par projet</h2>
          <table class="w-full text-sm">
            <thead class="text-left text-xs text-slate-500">
              <tr><th class="pb-2">Projet</th><th class="pb-2 text-right">Variable</th><th class="pb-2 text-right">Fixe</th><th class="pb-2 text-right">Total</th></tr>
            </thead>
            <tbody>
              <tr v-for="line in data.byProject" :key="line.key" class="border-t border-slate-100 dark:border-slate-800">
                <td class="py-2">{{ line.name || line.key }}</td>
                <td class="py-2 text-right">{{ eur(line.variable) }}</td>
                <td class="py-2 text-right">{{ eur(line.fixed) }}</td>
                <td class="py-2 text-right font-medium">{{ eur(line.total) }}</td>
              </tr>
              <tr v-if="data.byProject.length === 0"><td colspan="4" class="py-3 text-slate-500">Aucune donnee.</td></tr>
            </tbody>
          </table>
        </div>

        <div class="card">
          <h2 class="mb-3 text-sm font-medium text-slate-500">Par API / fournisseur</h2>
          <table class="w-full text-sm">
            <thead class="text-left text-xs text-slate-500">
              <tr><th class="pb-2">Fournisseur</th><th class="pb-2 text-right">Appels</th><th class="pb-2 text-right">Variable</th><th class="pb-2 text-right">Total</th></tr>
            </thead>
            <tbody>
              <tr v-for="line in data.byProvider" :key="line.key" class="border-t border-slate-100 dark:border-slate-800">
                <td class="py-2">{{ line.key }}</td>
                <td class="py-2 text-right">{{ num(line.events) }}</td>
                <td class="py-2 text-right">{{ eur(line.variable) }}</td>
                <td class="py-2 text-right font-medium">{{ eur(line.total) }}</td>
              </tr>
              <tr v-if="data.byProvider.length === 0"><td colspan="4" class="py-3 text-slate-500">Aucune donnee.</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <h2 class="mb-3 text-sm font-medium text-slate-500">Derniers appels</h2>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="text-left text-xs text-slate-500">
              <tr><th class="pb-2">Date</th><th class="pb-2">Projet</th><th class="pb-2">Fournisseur</th><th class="pb-2">Endpoint</th><th class="pb-2 text-right">Unites</th><th class="pb-2 text-right">Cout</th></tr>
            </thead>
            <tbody>
              <tr v-for="item in data.recent" :key="item.id" class="border-t border-slate-100 dark:border-slate-800">
                <td class="py-2 whitespace-nowrap">{{ dateTime(item.occurredAt) }}</td>
                <td class="py-2">{{ item.project }}</td>
                <td class="py-2">{{ item.provider }}</td>
                <td class="py-2 text-slate-500">{{ item.endpoint || '-' }}</td>
                <td class="py-2 text-right">{{ item.units != null ? `${num(item.units)} ${item.unitLabel || ''}` : '-' }}</td>
                <td class="py-2 text-right">{{ eurPrecise(item.amountEur) }}</td>
              </tr>
              <tr v-if="data.recent.length === 0"><td colspan="6" class="py-3 text-slate-500">Aucun appel.</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>
