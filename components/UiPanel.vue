<script setup lang="ts">
// Panneau standard : titre de section, sous-titre, zone d'actions à droite.
withDefaults(defineProps<{ title?: string; subtitle?: string; flush?: boolean; label?: string }>(), { flush: false })
</script>

<template>
  <section class="panel flex min-w-0 flex-col gap-3 p-5" :class="flush ? 'pb-2' : ''" :aria-label="label || title">
    <div v-if="title || $slots.actions" class="flex flex-wrap items-start justify-between gap-3">
      <div v-if="title">
        <h2 class="m-0 text-section text-ink">{{ title }}</h2>
        <p v-if="subtitle" class="mb-0 mt-0.5 text-small text-ink-muted">{{ subtitle }}</p>
      </div>
      <div v-if="$slots.actions"><slot name="actions" /></div>
    </div>
    <slot />
  </section>
</template>
