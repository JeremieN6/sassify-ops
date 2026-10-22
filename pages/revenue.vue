<script setup lang="ts">
type Payload = { configured: boolean; months: { month: string; mrrEur: number }[] }

useHead({ title: 'Revenus · Sassify Ops' })

const f = useFormat()
const { data } = await useFetch<Payload>('/api/revenue')

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
const label = (month: string) => MONTHS[Number(month.slice(5, 7)) - 1] ?? month

const last = computed(() => data.value?.months[data.value.months.length - 1])
const previous = computed(() => data.value?.months[data.value.months.length - 2])
const growth = computed(() => (last.value && previous.value && previous.value.mrrEur > 0 ? ((last.value.mrrEur - previous.value.mrrEur) / previous.value.mrrEur) * 100 : null))
const items = computed(() =>
  (data.value?.months ?? []).map((m, i, all) => ({ value: m.mrrEur, tip: `${label(m.month)} · ${f.eur(m.mrrEur)}`, highlight: i === all.length - 1 }))
)
const xLabels = computed(() => {
  const months = data.value?.months ?? []
  return months.length > 2 ? [label(months[0].month), label(months[Math.floor(months.length / 2)].month), label(months[months.length - 1].month)] : []
})
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader title="Revenus" subtitle="MRR, abonnés et mouvements par produit" />

    <template v-if="data">
      <UiPanel v-if="!data.configured" label="Revenus">
        <UiEmpty icon="trend" title="Aucune donnée de revenus pour l'instant">
          <p class="m-0">
            Cet écran affichera le MRR sur 12 mois, ses mouvements (nouveaux abonnements, changements de plan, churn) et la répartition par produit.
            Le schéma de stockage est prêt ; il reste à brancher la synchronisation Stripe, avec une clé en lecture seule, qui remplira les instantanés quotidiens du MRR.
          </p>
        </UiEmpty>
      </UiPanel>

      <template v-else>
        <section aria-label="Indicateurs clés" class="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(240px,100%),1fr))]">
          <UiKpi label="MRR actuel" :value="last ? f.eur(last.mrrEur) : '—'">
            <span v-if="growth !== null" class="text-small" :class="growth >= 0 ? 'text-ok' : 'text-crit'">{{ f.signedPct(growth) }} vs mois précédent</span>
          </UiKpi>
          <UiKpi label="ARR estimé" :value="last ? f.eurShort(last.mrrEur * 12) : '—'" />
        </section>

        <UiPanel title="MRR sur 12 mois" class="!gap-5">
          <UiBars :items="items" :format="f.eurShort" :x-labels="xLabels" />
        </UiPanel>
      </template>
    </template>
  </div>
</template>
