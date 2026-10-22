<script setup lang="ts">
type FixedCost = {
  id: string
  label: string
  provider: string
  project: string | null
  amount: number
  currency: 'EUR' | 'USD'
  amountEur: number
  period: 'MONTHLY' | 'YEARLY'
  startsOn: string
  endsOn: string | null
}
type Summary = { totals: { fixed: number }; byProject: { key: string; name?: string; fixed: number }[] }

useHead({ title: 'Coûts fixes · Sassify Ops' })

const f = useFormat()
const { data: items, refresh } = await useFetch<FixedCost[]>('/api/fixed-costs')
const { data: projects } = await useFetch<{ id: string; slug: string; name: string }[]>('/api/projects')
const { data: summary, refresh: refreshSummary } = await useFetch<Summary>('/api/costs/summary', { query: { range: '30d' } })

// Répartition du récurrent sur 30 jours (part de chaque projet dans le fixe)
const SHARE_COLORS = ['bg-accent', 'bg-series-fixed', 'bg-accent-soft', 'bg-ok', 'bg-warn', 'bg-crit']
const shares = computed(() => {
  const total = summary.value?.totals.fixed ?? 0
  return (summary.value?.byProject ?? [])
    .filter((line) => line.fixed > 0)
    .map((line, index) => ({
      name: line.name || line.key,
      value: line.fixed,
      pct: total ? (line.fixed / total) * 100 : 0,
      color: SHARE_COLORS[index % SHARE_COLORS.length]
    }))
})

const today = new Date().toISOString().slice(0, 10)
const form = reactive({
  label: '',
  provider: '',
  projectSlug: '',
  amount: null as number | null,
  currency: 'EUR' as 'EUR' | 'USD',
  period: 'MONTHLY' as 'MONTHLY' | 'YEARLY',
  startsOn: today,
  endsOn: ''
})
const error = ref('')
const saving = ref(false)

async function add() {
  error.value = ''
  saving.value = true
  try {
    await $fetch('/api/fixed-costs', {
      method: 'POST',
      body: {
        label: form.label,
        provider: form.provider,
        projectSlug: form.projectSlug || null,
        amount: Number(form.amount),
        currency: form.currency,
        period: form.period,
        startsOn: form.startsOn,
        endsOn: form.endsOn || null
      }
    })
    Object.assign(form, { label: '', provider: '', amount: null, endsOn: '' })
    await Promise.all([refresh(), refreshSummary()])
  } catch (err: any) {
    error.value = err?.statusMessage || err?.data?.statusMessage || 'Enregistrement impossible'
  } finally {
    saving.value = false
  }
}

async function remove(item: FixedCost) {
  if (!confirm(`Supprimer « ${item.label} » ?`)) return
  await $fetch(`/api/fixed-costs/${item.id}`, { method: 'DELETE' })
  await Promise.all([refresh(), refreshSummary()])
}

const isEnded = (item: FixedCost) => item.endsOn !== null && item.endsOn < today
const frDate = (iso: string) => iso.split('-').reverse().join('/')
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader title="Coûts fixes" subtitle="Abonnements et frais récurrents, proratisés au jour" />

    <UiPanel title="Récurrent sur 30 jours" subtitle="Part de chaque projet dans les coûts fixes" class="!gap-4">
      <div class="font-mono text-kpi">{{ f.eur(summary?.totals.fixed ?? 0) }}</div>
      <template v-if="shares.length">
        <div class="flex h-3 overflow-hidden rounded-full bg-line" role="img" :aria-label="shares.map((s) => `${s.name} ${Math.round(s.pct)} %`).join(', ')">
          <div v-for="share in shares" :key="share.name" class="h-full" :class="share.color" :style="{ width: `${share.pct}%` }" :title="`${share.name} · ${f.eur(share.value)}`" />
        </div>
        <ul class="m-0 flex list-none flex-wrap gap-x-6 gap-y-2 p-0 text-small">
          <li v-for="share in shares" :key="share.name" class="flex items-center gap-2">
            <span class="h-2.5 w-2.5 rounded-sm" :class="share.color" />
            <span>{{ share.name }}</span>
            <span class="font-mono text-ink-muted">{{ Math.round(share.pct) }} %</span>
          </li>
        </ul>
      </template>
      <p v-else class="m-0 text-ink-muted">Aucun coût fixe actif. Ajoute le VPS, le domaine ou tes abonnements ci-dessous.</p>
    </UiPanel>

    <UiPanel title="Ajouter un coût fixe">
      <form class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" @submit.prevent="add">
        <div class="sm:col-span-2">
          <label class="field-label" for="fc-label">Libellé</label>
          <input id="fc-label" v-model="form.label" class="field" placeholder="ex : VPS Hostinger" required />
        </div>
        <div>
          <label class="field-label" for="fc-provider">Fournisseur</label>
          <input id="fc-provider" v-model="form.provider" class="field" placeholder="ex : hostinger" required />
        </div>
        <div>
          <label class="field-label" for="fc-project">Projet</label>
          <select id="fc-project" v-model="form.projectSlug" class="field">
            <option value="">Infrastructure partagée</option>
            <option v-for="project in projects" :key="project.id" :value="project.slug">{{ project.name }}</option>
          </select>
        </div>
        <div>
          <label class="field-label" for="fc-amount">Montant</label>
          <input id="fc-amount" v-model.number="form.amount" type="number" min="0" step="0.01" class="field font-mono" placeholder="0,00" required />
        </div>
        <div>
          <label class="field-label" for="fc-currency">Devise</label>
          <select id="fc-currency" v-model="form.currency" class="field"><option>EUR</option><option>USD</option></select>
        </div>
        <div>
          <label class="field-label" for="fc-period">Récurrence</label>
          <select id="fc-period" v-model="form.period" class="field">
            <option value="MONTHLY">Mensuelle</option>
            <option value="YEARLY">Annuelle</option>
          </select>
        </div>
        <div>
          <label class="field-label" for="fc-start">Début</label>
          <input id="fc-start" v-model="form.startsOn" type="date" class="field" required />
        </div>
        <div>
          <label class="field-label" for="fc-end">Fin (optionnelle)</label>
          <input id="fc-end" v-model="form.endsOn" type="date" class="field" />
        </div>
        <div class="flex items-end sm:col-span-2 lg:col-span-3">
          <button class="btn" :disabled="saving"><UiIcon name="plus" :size="16" />Ajouter le coût</button>
        </div>
        <p v-if="error" class="m-0 text-crit sm:col-span-2 lg:col-span-4" role="alert">{{ error }}</p>
      </form>
    </UiPanel>

    <UiPanel title="Coûts actifs" flush>
      <div class="relative overflow-x-auto">
        <table class="w-full min-w-[760px] text-body">
          <thead>
            <tr class="eyebrow border-b border-line text-left">
              <th class="px-2 py-2 font-normal">Libellé</th>
              <th class="px-2 py-2 font-normal">Fournisseur</th>
              <th class="px-2 py-2 font-normal">Projet</th>
              <th class="px-2 py-2 text-right font-normal">Montant</th>
              <th class="px-2 py-2 font-normal">Récurrence</th>
              <th class="px-2 py-2 font-normal">Début</th>
              <th class="px-2 py-2 font-normal">Fin</th>
              <th class="px-2 py-2"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in items" :key="item.id" class="row-hover border-b border-line" :class="isEnded(item) ? 'opacity-60' : ''">
              <td class="px-2 py-3 font-medium">{{ item.label }}</td>
              <td class="px-2 py-3">{{ item.provider }}</td>
              <td class="px-2 py-3 text-ink-muted">{{ item.project || 'Infrastructure partagée' }}</td>
              <td class="whitespace-nowrap px-2 py-3 text-right font-mono text-small">
                {{ f.eur(item.amount) }}<span v-if="item.currency !== 'EUR'" class="text-ink-muted"> ({{ item.currency }})</span>
              </td>
              <td class="px-2 py-3">{{ item.period === 'MONTHLY' ? 'Mensuelle' : 'Annuelle' }}</td>
              <td class="whitespace-nowrap px-2 py-3 font-mono text-small text-ink-muted">{{ frDate(item.startsOn) }}</td>
              <td class="whitespace-nowrap px-2 py-3 font-mono text-small text-ink-muted">{{ item.endsOn ? frDate(item.endsOn) : '—' }}</td>
              <td class="px-2 py-3 text-right">
                <button type="button" class="btn-link text-crit" :aria-label="`Supprimer ${item.label}`" @click="remove(item)"><UiIcon name="trash" :size="16" /></button>
              </td>
            </tr>
            <tr v-if="!items?.length"><td colspan="8" class="px-2 py-4 text-ink-muted">Aucun coût fixe pour l'instant.</td></tr>
          </tbody>
        </table>
      </div>
    </UiPanel>
  </div>
</template>
