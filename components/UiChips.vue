<script setup lang="ts">
// Groupe de filtres (un seul actif). Variante "solid" pour les périodes, "tint" pour les statuts.
const props = withDefaults(
  defineProps<{
    modelValue: string
    options: { id: string; label: string; count?: number }[]
    variant?: 'tint' | 'solid'
    label: string
  }>(),
  { variant: 'tint' }
)
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

function classes(id: string) {
  const active = props.modelValue === id
  if (props.variant === 'solid') {
    return active ? 'bg-accent-fill text-white' : 'text-ink-muted hover:bg-white/5'
  }
  return active ? 'bg-accent/16 text-accent-soft' : 'text-ink-muted hover:bg-white/5'
}
</script>

<template>
  <div class="flex flex-wrap gap-1" role="group" :aria-label="label">
    <button
      v-for="option in options"
      :key="option.id"
      type="button"
      :aria-pressed="modelValue === option.id"
      class="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-body font-medium transition-colors"
      :class="classes(option.id)"
      @click="emit('update:modelValue', option.id)"
    >
      {{ option.label }}
      <span v-if="option.count !== undefined" class="font-mono text-small opacity-80">{{ option.count }}</span>
    </button>
  </div>
</template>
