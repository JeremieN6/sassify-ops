<script setup lang="ts">
// Pastille d'état : la couleur ne porte jamais seule le sens (le libellé est toujours affiché).
const props = withDefaults(defineProps<{ tone?: 'ok' | 'warn' | 'crit' | 'accent' | 'neutral' | 'muted'; label: string; dot?: boolean }>(), {
  tone: 'neutral',
  dot: true
})

const TONES = {
  ok: 'bg-ok/12 text-ok',
  warn: 'bg-warn/14 text-warn',
  crit: 'bg-crit/14 text-crit',
  accent: 'bg-accent/16 text-accent-soft',
  neutral: 'bg-white/10 text-ink',
  muted: 'bg-white/5 text-ink-muted'
} as const
</script>

<template>
  <span class="inline-flex h-[26px] items-center gap-2 whitespace-nowrap rounded-full px-2.5 text-small font-medium" :class="TONES[props.tone]">
    <span v-if="dot" class="h-1.5 w-1.5 rounded-full bg-current" />
    {{ label }}
  </span>
</template>
