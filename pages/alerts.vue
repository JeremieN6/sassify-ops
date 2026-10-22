<script setup lang="ts">
type AlertRow = {
  id: string
  title: string
  description: string | null
  source: string | null
  severity: 'CRITICAL' | 'WARNING'
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED'
  openedAt: string
  resolvedAt: string | null
}
type Payload = {
  counts: { all: number; open: number; ack: number; done: number }
  rows: AlertRow[]
  rules: { key: string; label: string; severity: 'CRITICAL' | 'WARNING'; enabled: boolean }[]
  budgetEur: number | null
  telegramConfigured: boolean
}

useHead({ title: 'Alertes · Sassify Ops' })

const f = useFormat()
const now = useNow()
const status = ref('all')
const { data, refresh } = await useFetch<Payload>('/api/alerts', { query: { status }, watch: [status] })

const chips = computed(() => [
  { id: 'all', label: 'Toutes', count: data.value?.counts.all },
  { id: 'open', label: 'Ouvertes', count: data.value?.counts.open },
  { id: 'ack', label: 'Acquittées', count: data.value?.counts.ack },
  { id: 'done', label: 'Résolues', count: data.value?.counts.done }
])

const SEVERITY = {
  CRITICAL: { label: 'Critique', icon: 'bg-crit/14 text-crit', text: 'text-crit', tone: 'crit' },
  WARNING: { label: 'Avertissement', icon: 'bg-warn/14 text-warn', text: 'text-warn', tone: 'warn' }
} as const
const STATUS = {
  OPEN: { label: 'Ouverte', tone: 'neutral' },
  ACKNOWLEDGED: { label: 'Acquittée', tone: 'accent' },
  RESOLVED: { label: 'Résolue', tone: 'ok' }
} as const

async function acknowledge(alert: AlertRow) {
  await $fetch(`/api/alerts/${alert.id}/ack`, { method: 'POST' })
  await refresh()
  refreshNuxtData() // met aussi à jour la pastille du menu
}

async function toggleRule(rule: { key: string; enabled: boolean }) {
  await $fetch(`/api/alert-rules/${rule.key}`, { method: 'PATCH', body: { enabled: !rule.enabled } })
  await refresh()
}

// Message de test Telegram (action explicite de l'utilisateur : rien n'est envoyé automatiquement)
const testState = ref<'idle' | 'sending' | 'ok' | 'error'>('idle')
const testMessage = ref('')
async function sendTest() {
  testState.value = 'sending'
  testMessage.value = ''
  try {
    await $fetch('/api/alerts/test-notification', { method: 'POST' })
    testState.value = 'ok'
    testMessage.value = 'Message de test envoyé : vérifie ton chat Telegram.'
  } catch (err: any) {
    testState.value = 'error'
    testMessage.value = err?.statusMessage || err?.data?.statusMessage || 'Envoi impossible'
  }
}

// Plafond mensuel : alimente la règle "budget" et la jauge de la Vue d'ensemble
const budgetInput = ref<number | null>(data.value?.budgetEur ?? null)
const budgetMessage = ref('')
async function saveBudget() {
  budgetMessage.value = ''
  try {
    await $fetch('/api/settings/budget', { method: 'PUT', body: { monthlyBudgetEur: budgetInput.value || null } })
    budgetMessage.value = budgetInput.value ? 'Plafond enregistré.' : 'Plafond supprimé.'
    await refresh()
  } catch {
    budgetMessage.value = 'Montant invalide.'
  }
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader
      title="Alertes"
      :subtitle="data ? `${data.counts.open} ouverte${data.counts.open > 1 ? 's' : ''} · ${data.counts.ack} acquittée${data.counts.ack > 1 ? 's' : ''} · ${data.counts.done} résolue${data.counts.done > 1 ? 's' : ''} sur 7 jours` : ''"
    />

    <template v-if="data">
      <UiChips v-model="status" :options="chips" label="Filtrer par statut" />

      <div class="flex flex-wrap items-start gap-6">
        <UiPanel title="Historique sur 7 jours" class="flex-[2_1_560px]">
          <p v-if="data.rows.length === 0" class="m-0 py-6 text-ink-muted">
            {{ status === 'all' ? 'Aucune alerte sur les 7 derniers jours.' : 'Aucune alerte dans cette catégorie.' }}
          </p>
          <article v-for="alert in data.rows" :key="alert.id" class="flex gap-3 border-t border-line py-4" :class="alert.status === 'RESOLVED' ? 'opacity-70' : ''">
            <span class="grid h-8 w-8 flex-none place-items-center rounded-full" :class="SEVERITY[alert.severity].icon">
              <UiIcon :name="alert.status === 'RESOLVED' ? 'circleCheck' : 'warn'" :size="16" />
            </span>
            <div class="flex min-w-0 flex-1 flex-col gap-1.5">
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-medium">{{ alert.title }}</span>
                <UiPill :tone="STATUS[alert.status].tone" :label="STATUS[alert.status].label" :dot="false" />
              </div>
              <p v-if="alert.description" class="m-0 text-small text-ink-muted">{{ alert.description }}</p>
              <p class="m-0 text-small text-ink-muted">
                <span class="font-medium" :class="SEVERITY[alert.severity].text">{{ SEVERITY[alert.severity].label }}</span>
                · {{ alert.source }} · {{ f.ago(alert.openedAt, now) }}
                <template v-if="alert.resolvedAt"> · résolue {{ f.ago(alert.resolvedAt, now) }}</template>
              </p>
            </div>
            <button v-if="alert.status === 'OPEN'" type="button" class="btn-secondary h-9 self-start" @click="acknowledge(alert)">Acquitter</button>
          </article>
        </UiPanel>

        <div class="flex min-w-0 flex-[1_1_320px] flex-col gap-6">
          <UiPanel title="Règles d'alerte" subtitle="Évaluées en continu par les sondes">
            <ul class="m-0 flex list-none flex-col p-0">
              <li v-for="rule in data.rules" :key="rule.key" class="flex items-center gap-3 border-t border-line py-3">
                <input
                  :id="`rule-${rule.key}`"
                  type="checkbox"
                  class="h-4 w-4 flex-none accent-[#5B63F0]"
                  :checked="rule.enabled"
                  @change="toggleRule(rule)"
                />
                <label :for="`rule-${rule.key}`" class="min-w-0 flex-1 cursor-pointer">
                  <span class="block">{{ rule.label }}</span>
                  <span class="text-small font-medium" :class="SEVERITY[rule.severity].text">{{ SEVERITY[rule.severity].label }}</span>
                </label>
              </li>
            </ul>
          </UiPanel>

          <UiPanel id="budget" title="Plafond mensuel" subtitle="Déclenche l'alerte de budget et la jauge de la Vue d'ensemble">
            <form class="flex flex-wrap items-end gap-3" @submit.prevent="saveBudget">
              <div class="min-w-[140px] flex-1">
                <label class="field-label" for="budget">Montant en euros</label>
                <input id="budget" v-model.number="budgetInput" type="number" min="0" step="1" class="field font-mono" placeholder="ex : 250" />
              </div>
              <button class="btn">Enregistrer</button>
            </form>
            <p v-if="budgetMessage" class="m-0 text-small text-ink-muted" role="status">{{ budgetMessage }}</p>
            <p class="m-0 text-small text-ink-muted">Laisse vide pour supprimer le plafond.</p>
          </UiPanel>

          <UiPanel title="Notifications Telegram">
            <template v-if="data.telegramConfigured">
              <p class="m-0 flex items-center gap-2 text-ok"><UiIcon name="circleCheck" :size="16" />Activées : chaque ouverture et chaque résolution est envoyée.</p>
              <p class="m-0 text-small text-ink-muted">Les messages portent l'en-tête « SASSIFY OPS » et le mot-clé <code class="font-mono">#sassify_ops</code> pour les distinguer de tes autres notifications. Les résolutions sont silencieuses.</p>
              <div class="flex flex-wrap items-center gap-3">
                <button type="button" class="btn-secondary" :disabled="testState === 'sending'" @click="sendTest">{{ testState === 'sending' ? 'Envoi…' : 'Envoyer un message de test' }}</button>
                <span v-if="testMessage" class="text-small" :class="testState === 'ok' ? 'text-ok' : 'text-crit'" role="status">{{ testMessage }}</span>
              </div>
            </template>
            <p v-else class="m-0 text-ink-muted">
              Désactivées. Pour les activer, ajoute <code class="font-mono text-small">TELEGRAM_BOT_TOKEN</code> et <code class="font-mono text-small">TELEGRAM_CHAT_ID</code> (ou leurs versions <code class="font-mono text-small">NUXT_TELEGRAM_…</code>) au <code class="font-mono text-small">.env</code> ou au <code class="font-mono text-small">.env.local</code> du serveur, puis redémarre.
            </p>
          </UiPanel>
        </div>
      </div>
    </template>
  </div>
</template>
