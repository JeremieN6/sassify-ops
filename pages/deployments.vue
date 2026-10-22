<script setup lang="ts">
type Row = {
  id: string
  project: string
  environment: string
  status: 'RUNNING' | 'SUCCESS' | 'FAILED'
  commit: string
  message: string | null
  branch: string | null
  durationSec: number | null
  startedAt: string
  runUrl: string | null
}
type Payload = {
  counts: { all: number; production: number; preview: number }
  summary: { total7d: number; failed7d: number; successRate: number | null; avgDurationSec: number | null }
  days: { label: string; total: number; failed: number }[]
  rows: Row[]
}

useHead({ title: 'Déploiements · Sassify Ops' })

const f = useFormat()
const now = useNow()
const env = ref('all')
const { data } = await useFetch<Payload>('/api/deployments', { query: { env }, watch: [env] })

const chips = computed(() => [
  { id: 'all', label: 'Tous', count: data.value?.counts.all },
  { id: 'production', label: 'Production', count: data.value?.counts.production },
  { id: 'preview', label: 'Preview', count: data.value?.counts.preview }
])

const STATUS = {
  SUCCESS: { label: 'Réussi', tone: 'ok' },
  FAILED: { label: 'Échec', tone: 'crit' },
  RUNNING: { label: 'En cours', tone: 'accent' }
} as const

const maxDay = computed(() => Math.max(1, ...(data.value?.days.map((day) => day.total) ?? [1])))

// Étape à coller en dernier dans chaque workflow de déploiement GitHub Actions.
// Les secrets OPS_URL et OPS_INGEST_KEY sont à créer dans le dépôt. "|| true" : une panne de Sassify Ops ne casse jamais un déploiement.
const snippet = `      - name: Notifier Sassify Ops
        if: always()
        run: |
          STATUS=$([ "\${{ job.status }}" = "success" ] && echo SUCCESS || echo FAILED)
          curl -fsS -X POST "\${{ secrets.OPS_URL }}/api/ingest/deploy" \\
            -H "x-ops-key: \${{ secrets.OPS_INGEST_KEY }}" -H "content-type: application/json" \\
            -d "$(jq -n --arg project "NOM-DU-PROJET" --arg runId "\${{ github.run_id }}" --arg status "$STATUS" \\
              --arg commit "\${{ github.sha }}" --arg message "$(git log -1 --pretty=%s | cut -c1-250)" \\
              --arg branch "\${{ github.ref_name }}" \\
              --arg runUrl "\${{ github.server_url }}/\${{ github.repository }}/actions/runs/\${{ github.run_id }}" \\
              '{project:$project,runId:$runId,environment:"production",status:$status,commit:$commit,message:$message,branch:$branch,runUrl:$runUrl}')" || true`

const copied = ref(false)
async function copySnippet() {
  try {
    await navigator.clipboard.writeText(snippet)
    copied.value = true
    setTimeout(() => (copied.value = false), 2000)
  } catch {
    // presse-papiers indisponible : l'utilisateur peut sélectionner le texte
  }
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader title="Déploiements" :subtitle="data ? `${data.summary.total7d} déploiement${data.summary.total7d > 1 ? 's' : ''} sur 7 jours` : ''" />

    <template v-if="data">
      <UiEmpty v-if="data.counts.all === 0" icon="deploy" title="Aucun déploiement reçu pour l'instant">
        <p class="m-0">
          Cet écran se remplit quand tes workflows GitHub Actions préviennent Sassify Ops. Ajoute l'étape ci-dessous en dernier dans chaque workflow
          de déploiement, après avoir créé les secrets <code class="font-mono text-small">OPS_URL</code> et <code class="font-mono text-small">OPS_INGEST_KEY</code> dans le dépôt.
        </p>
        <template #actions>
          <button type="button" class="btn-secondary" @click="copySnippet">{{ copied ? 'Copié' : "Copier l'étape" }}</button>
        </template>
      </UiEmpty>
      <UiPanel v-if="data.counts.all === 0" title="Étape GitHub Actions" subtitle="Remplace NOM-DU-PROJET par le slug du projet (tifo, plotline, skinalyze…)">
        <pre class="m-0 overflow-x-auto rounded-lg border border-line bg-field p-4 font-mono text-label leading-relaxed text-ink">{{ snippet }}</pre>
      </UiPanel>

      <template v-else>
        <UiChips v-model="env" :options="chips" label="Filtrer par environnement" />

        <section aria-label="Résumé" class="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr))]">
          <UiKpi label="Déploiements · 7 j" :value="String(data.summary.total7d)" />
          <UiKpi label="Taux de réussite" :value="data.summary.successRate === null ? '—' : `${Math.round(data.summary.successRate)} %`">
            <span class="text-small" :class="data.summary.failed7d ? 'text-crit' : 'text-ink-muted'">{{ data.summary.failed7d }} échec{{ data.summary.failed7d > 1 ? 's' : '' }}</span>
          </UiKpi>
          <UiKpi label="Durée moyenne" :value="f.duration(data.summary.avgDurationSec)" />
        </section>

        <UiPanel title="Déploiements par jour" subtitle="Réussis en couleur d'accent, échecs en rouge">
          <div class="flex h-[150px] items-end gap-3" role="img" aria-label="Nombre de déploiements par jour sur 7 jours">
            <div v-for="day in data.days" :key="day.label" class="flex h-full min-w-0 flex-1 flex-col justify-end gap-1.5" :title="`${day.label} · ${day.total} déploiement(s), ${day.failed} échec(s)`">
              <div class="flex flex-col justify-end overflow-hidden rounded-t-[4px]" :style="{ height: `${(day.total / maxDay) * 100}%` }">
                <div v-if="day.failed" class="bg-crit" :style="{ flex: day.failed }" />
                <div v-if="day.total - day.failed" class="bg-accent" :style="{ flex: day.total - day.failed }" />
              </div>
              <span class="text-center font-mono text-label text-ink-muted">{{ day.label }}</span>
            </div>
          </div>
        </UiPanel>

        <UiPanel title="Historique" flush>
          <ul class="m-0 flex list-none flex-col p-0">
            <li v-for="row in data.rows" :key="row.id" class="row-hover flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line px-2 py-3.5">
              <UiPill :tone="STATUS[row.status].tone" :label="STATUS[row.status].label" class="w-[96px] flex-none" />
              <div class="min-w-0 flex-[1_1_260px]">
                <div class="font-medium">{{ row.project }} <span class="text-small font-normal text-ink-muted">· {{ row.environment === 'production' ? 'Production' : 'Preview' }}</span></div>
                <div class="truncate text-small text-ink-muted">{{ row.message || 'Sans message' }}</div>
              </div>
              <div class="font-mono text-label text-ink-muted">{{ row.commit }}<span v-if="row.branch"> · {{ row.branch }}</span></div>
              <div class="w-[84px] text-right font-mono text-small">{{ f.duration(row.durationSec) }}</div>
              <div class="w-[104px] text-right text-small text-ink-muted">{{ f.ago(row.startedAt, now) }}</div>
              <a v-if="row.runUrl" :href="row.runUrl" target="_blank" rel="noopener noreferrer" class="btn-link" :aria-label="`Ouvrir le run GitHub de ${row.project}`"><UiIcon name="arrow" :size="16" /></a>
            </li>
          </ul>
        </UiPanel>
      </template>
    </template>
  </div>
</template>
