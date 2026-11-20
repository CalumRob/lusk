<script setup lang="ts">
/** PROTOTYPE — throwaway variant switcher. Deliberately NOT part of the design. Hidden in production builds. */
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const VARIANTS = [
  { id: 'A', label: 'A — Cascade' },
  { id: 'B', label: 'B — Recherche' },
  { id: 'C', label: 'C — Phrase' },
] as const

/** Inside the modal dialog (the rest of the page is inert there), lifted above its footer. */
defineProps<{ lift?: boolean }>()

const route = useRoute()
const router = useRouter()
const visible = !import.meta.env.PROD

const index = computed(() => Math.max(0, VARIANTS.findIndex((v) => v.id === String(route.query.variant ?? 'A').toUpperCase())))

function go(step: number) {
  const next = VARIANTS[(index.value + step + VARIANTS.length) % VARIANTS.length]!
  void router.replace({ query: { ...route.query, variant: next.id } })
}

function onKey(event: KeyboardEvent) {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  if (event.metaKey || event.ctrlKey || event.altKey) return
  const el = document.activeElement as HTMLElement | null
  if (el && (el.matches('input, textarea, select, [contenteditable=""], [contenteditable="true"]') || el.isContentEditable)) return
  go(event.key === 'ArrowRight' ? 1 : -1)
}
onMounted(() => visible && window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div v-if="visible" class="proto-switcher" :class="{ 'proto-switcher--lift': lift }" role="group" aria-label="Variantes du prototype (hors design)">
    <button type="button" aria-label="Variante précédente" @click="go(-1)">←</button>
    <span aria-live="polite">{{ VARIANTS[index]!.label }}</span>
    <button type="button" aria-label="Variante suivante" @click="go(1)">→</button>
  </div>
</template>

<style scoped>
/* Intentionally generic and loud-ish: this is scaffolding, not Cahier. */
.proto-switcher {
  position: fixed;
  bottom: 12px;
  left: 50%;
  z-index: 1200; /* above the page, below the slot popovers (1300) */
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 10px;
  transform: translateX(-50%);
  border-radius: 999px;
  background: #111;
  color: #fff;
  font: 600 12px/1 ui-monospace, Menlo, monospace;
  box-shadow: 0 4px 16px rgb(0 0 0 / 35%);
}
.proto-switcher--lift { bottom: 84px; }
.proto-switcher button { width: 28px; height: 28px; border: 0; border-radius: 999px; background: #333; color: #fff; font: inherit; cursor: pointer; }
.proto-switcher button:hover { background: #555; }
.proto-switcher span { min-width: 112px; text-align: center; }
</style>
