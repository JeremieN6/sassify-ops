<script setup lang="ts">
// Jauge horizontale : accent normal, orange à partir de 70 %, rouge à partir de 85 %.
const props = defineProps<{ label: string; pct: number; value?: string }>()
const tone = computed(() => (props.pct >= 85 ? 'bg-crit' : props.pct >= 70 ? 'bg-warn' : 'bg-accent'))
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <div class="flex items-baseline justify-between text-small">
      <span class="text-ink-muted">{{ label }}</span>
      <span class="font-mono text-ink">{{ value ?? `${Math.round(pct)} %` }}</span>
    </div>
    <div class="h-1.5 overflow-hidden rounded-full bg-line" role="meter" :aria-label="label" :aria-valuenow="Math.round(pct)" aria-valuemin="0" aria-valuemax="100">
      <div class="h-full rounded-full" :class="tone" :style="{ width: `${Math.min(100, Math.max(0, pct))}%` }" />
    </div>
  </div>
</template>
