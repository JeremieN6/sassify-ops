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

const { data: items, refresh } = await useFetch<FixedCost[]>('/api/fixed-costs')
const { data: projects } = await useFetch<{ id: string; slug: string; name: string }[]>('/api/projects')
const { eur } = useFormat()

const today = new Date().toISOString().slice(0, 10)
const form = reactive({
  label: '',
  provider: '',
  projectSlug: '',
  amount: 0,
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
    form.label = ''
    form.provider = ''
    form.amount = 0
    form.endsOn = ''
    await refresh()
  } catch (err: any) {
    error.value = err?.statusMessage || err?.data?.statusMessage || 'Enregistrement impossible'
  } finally {
    saving.value = false
  }
}

async function remove(id: string) {
  if (!confirm('Supprimer ce cout fixe ?')) {
    return
  }
  await $fetch(`/api/fixed-costs/${id}`, { method: 'DELETE' })
  await refresh()
}
</script>

<template>
  <div class="space-y-6">
    <form class="card grid gap-3 sm:grid-cols-4" @submit.prevent="add">
      <input v-model="form.label" class="input sm:col-span-2" placeholder="Libelle (ex: VPS Hostinger)" required />
      <input v-model="form.provider" class="input" placeholder="Fournisseur (ex: hostinger)" required />
      <select v-model="form.projectSlug" class="input">
        <option value="">Infrastructure partagee</option>
        <option v-for="project in projects" :key="project.id" :value="project.slug">{{ project.slug }}</option>
      </select>
      <input v-model.number="form.amount" type="number" min="0" step="0.01" class="input" placeholder="Montant" required />
      <select v-model="form.currency" class="input"><option>EUR</option><option>USD</option></select>
      <select v-model="form.period" class="input">
        <option value="MONTHLY">Mensuel</option>
        <option value="YEARLY">Annuel</option>
      </select>
      <div class="flex gap-2">
        <input v-model="form.startsOn" type="date" class="input" required title="Debut" />
        <input v-model="form.endsOn" type="date" class="input" title="Fin (optionnel)" />
      </div>
      <button class="btn sm:col-span-4" :disabled="saving">Ajouter</button>
      <p v-if="error" class="text-sm text-red-600 sm:col-span-4">{{ error }}</p>
    </form>

    <div class="card overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="text-left text-xs text-slate-500">
          <tr>
            <th class="pb-2">Libelle</th><th class="pb-2">Fournisseur</th><th class="pb-2">Projet</th>
            <th class="pb-2 text-right">Montant</th><th class="pb-2">Periode</th><th class="pb-2">Du</th><th class="pb-2">Au</th><th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in items" :key="item.id" class="border-t border-slate-100 dark:border-slate-800">
            <td class="py-2">{{ item.label }}</td>
            <td class="py-2">{{ item.provider }}</td>
            <td class="py-2 text-slate-500">{{ item.project || 'infrastructure' }}</td>
            <td class="py-2 text-right">
              {{ item.amount }} {{ item.currency }}
              <span v-if="item.currency !== 'EUR'" class="text-xs text-slate-500">({{ eur(item.amountEur) }})</span>
            </td>
            <td class="py-2">{{ item.period === 'MONTHLY' ? 'mensuel' : 'annuel' }}</td>
            <td class="py-2">{{ item.startsOn }}</td>
            <td class="py-2">{{ item.endsOn || '-' }}</td>
            <td class="py-2 text-right"><button class="btn-ghost" @click="remove(item.id)">Supprimer</button></td>
          </tr>
          <tr v-if="!items?.length"><td colspan="8" class="py-3 text-slate-500">Aucun cout fixe.</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
