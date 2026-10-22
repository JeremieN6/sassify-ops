<script setup lang="ts">
type Proc = { name: string; cpu?: number; memMb?: number; restarts?: number; uptime?: string; status?: string }
type Host = {
  host: string
  capturedAt: string
  cpuPct: number | null
  memPct: number | null
  diskPct: number | null
  netOutMbps: number | null
  processes: Proc[]
  series: { at: string; cpu: number | null; mem: number | null; net: number | null }[]
}
type Payload = { configured: boolean; hosts: Host[] }

useHead({ title: 'Serveurs · Sassify Ops' })

const f = useFormat()
const now = useNow()
const { data } = await useFetch<Payload>('/api/servers')

const level = (pct: number | null) => (pct === null ? 'muted' : pct >= 85 ? 'crit' : pct >= 70 ? 'warn' : 'ok')
const LEVEL_LABEL = { ok: 'Opérationnel', warn: 'Chargé', crit: 'Saturé', muted: 'Inconnu' } as const
const worst = (host: Host) => Math.max(host.cpuPct ?? 0, host.memPct ?? 0, host.diskPct ?? 0)
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader title="Serveurs" subtitle="CPU, mémoire, disque et processus des machines suivies" />

    <template v-if="data">
      <UiPanel v-if="!data.configured" label="Serveurs">
        <UiEmpty icon="server" title="Aucune mesure reçue pour l'instant">
          <p class="m-0">
            Cet écran affichera le CPU, la mémoire, le disque, le réseau et les processus PM2 de ton VPS dès qu'une source enverra ses mesures.
            Le schéma de stockage est prêt ; il reste à brancher un petit agent en lecture seule, installé sur le VPS, qui envoie ses mesures à Sassify Ops.
          </p>
          <p class="mb-0 mt-3">
            En attendant, la disponibilité de chaque site (latence, certificat SSL) est déjà suivie depuis la
            <NuxtLink to="/" class="text-accent">Vue d'ensemble</NuxtLink>.
          </p>
        </UiEmpty>
      </UiPanel>

      <template v-else>
        <article v-for="host in data.hosts" :key="host.host" class="flex flex-col gap-6">
          <UiPanel :title="host.host" :subtitle="`Dernière mesure ${f.ago(host.capturedAt, now)}`" :label="host.host">
            <template #actions>
              <UiPill :tone="level(worst(host)) as 'ok' | 'warn' | 'crit' | 'muted'" :label="LEVEL_LABEL[level(worst(host))]" />
            </template>
            <div class="grid gap-5 sm:grid-cols-3">
              <UiGauge v-if="host.cpuPct !== null" label="CPU" :pct="host.cpuPct" />
              <UiGauge v-if="host.memPct !== null" label="Mémoire" :pct="host.memPct" />
              <UiGauge v-if="host.diskPct !== null" label="Disque" :pct="host.diskPct" />
            </div>
          </UiPanel>

          <section :aria-label="`Historique de ${host.host} sur 24 heures`" class="grid gap-6 lg:grid-cols-3">
            <UiPanel title="CPU" subtitle="24 heures"><UiArea :values="host.series.map((s) => s.cpu)" label="Utilisation CPU sur 24 heures" /></UiPanel>
            <UiPanel title="Mémoire" subtitle="24 heures"><UiArea :values="host.series.map((s) => s.mem)" label="Utilisation mémoire sur 24 heures" /></UiPanel>
            <UiPanel title="Réseau sortant" subtitle="24 heures · Mb/s"><UiArea :values="host.series.map((s) => s.net)" :max="Math.max(8, ...host.series.map((s) => s.net ?? 0))" label="Débit sortant sur 24 heures" /></UiPanel>
          </section>

          <UiPanel v-if="host.processes.length" :title="`Processus sur ${host.host}`" flush>
            <div class="relative overflow-x-auto">
              <table class="w-full min-w-[560px] text-body">
                <thead>
                  <tr class="eyebrow border-b border-line text-left">
                    <th class="px-2 py-2 font-normal">Processus</th>
                    <th class="px-2 py-2 text-right font-normal">CPU</th>
                    <th class="px-2 py-2 text-right font-normal">Mémoire</th>
                    <th class="px-2 py-2 text-right font-normal">Redémarrages</th>
                    <th class="px-2 py-2 text-right font-normal">Actif depuis</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="proc in host.processes" :key="proc.name" class="row-hover border-b border-line">
                    <td class="px-2 py-3 font-medium">{{ proc.name }}</td>
                    <td class="px-2 py-3 text-right font-mono text-small">{{ proc.cpu != null ? f.pct(proc.cpu, 1) : '—' }}</td>
                    <td class="px-2 py-3 text-right font-mono text-small">{{ proc.memMb != null ? `${f.num(proc.memMb)} Mo` : '—' }}</td>
                    <td class="px-2 py-3 text-right font-mono text-small" :class="(proc.restarts ?? 0) > 3 ? 'text-warn' : ''">{{ proc.restarts ?? '—' }}</td>
                    <td class="px-2 py-3 text-right text-small text-ink-muted">{{ proc.uptime ?? '—' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </UiPanel>
        </article>
      </template>
    </template>
  </div>
</template>
