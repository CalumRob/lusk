<script setup lang="ts">
/**
 * Throwaway #400 prototype. This deliberately sits beside the existing fiche
 * header instead of changing the Aperçu contract: the real apercu payload is
 * only presented in three competing arrangements, selected by ?variant=.
 */
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { formaterValeurApercu, libelleApercu } from '@/fiche/apercu'
import { apercuPourTerritoire } from '@/payload/selectors'
import type { Payload } from '@/payload/types'

const props = defineProps<{ payload: Payload; territoire: string }>()
const route = useRoute()
const router = useRouter()
const development = import.meta.env.DEV

const VARIANTS = ['remove', 'anchors', 'compact'] as const
type HeaderVariant = (typeof VARIANTS)[number]

const variant = computed<HeaderVariant>(() => {
  const requested = route.query.variant
  return typeof requested === 'string' && (VARIANTS as readonly string[]).includes(requested)
    ? requested as HeaderVariant
    : 'anchors'
})

const facts = computed(() => apercuPourTerritoire(props.payload, props.territoire))
const population = computed(() => facts.value.find((fact) => fact.key === 'population'))
const densite = computed(() => facts.value.find((fact) => fact.key === 'densite'))
const territoire = computed(() => props.payload.territoires.find((item) => item.territoire === props.territoire))
const compositionRelationship = computed(() => {
  const current = territoire.value
  if (!current) return 'Composition indisponible'
  if (current.type === 'commune' && current.epci) {
    const parent = props.payload.territoires.find((item) => item.territoire === current.epci)
    const members = props.payload.territoires.filter((item) => item.type === 'commune' && item.epci === current.epci)
    return parent
      ? `Commune de ${parent.nom} · ${members.length} communes dans cet EPCI`
      : `Membre d’un EPCI · ${members.length} communes dans cet EPCI`
  }
  const members = props.payload.territoires.filter(
    (item) => item.type === 'commune' && (item.departement === current.territoire || item.epci === current.territoire),
  )
  return members.length > 0 ? `${members.length} communes rattachées` : 'Relation de composition indisponible'
})

const switcherLabels: Record<HeaderVariant, string> = {
  remove: 'Sans ancres',
  anchors: 'Ancres persistantes',
  compact: 'Compromis compact',
}

function selectVariant(next: HeaderVariant): void {
  router.replace({ query: { ...route.query, variant: next } })
}

function onSwitcherKeydown(event: KeyboardEvent): void {
  const target = document.activeElement as HTMLElement | null
  if (target?.matches('input, textarea, select, [contenteditable="true"]')) return
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  event.preventDefault()
  const index = VARIANTS.indexOf(variant.value)
  const step = event.key === 'ArrowRight' ? 1 : -1
  selectVariant(VARIANTS[(index + step + VARIANTS.length) % VARIANTS.length])
}

onMounted(() => window.addEventListener('keydown', onSwitcherKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onSwitcherKeydown))

function display(fact: typeof facts.value[number] | undefined): string {
  return fact ? formaterValeurApercu(fact) : '—'
}
</script>

<template>
  <template v-if="variant !== 'remove'">
    <section
      class="prototype-header"
      :class="`prototype-header--${variant}`"
      :data-header-variant="variant"
      aria-label="Prototype d’en-tête de fiche"
    >
      <template v-if="variant === 'anchors'">
        <p class="prototype-kicker">Repères du territoire</p>
        <dl class="prototype-anchors">
          <div v-for="fact in facts" :key="fact.key" class="prototype-anchor">
            <dt>{{ libelleApercu(fact.key) }}</dt>
            <dd>{{ formaterValeurApercu(fact) }}</dd>
          </div>
          <div class="prototype-anchor">
            <dt>Superficie</dt>
            <dd>Non publiée</dd>
          </div>
        </dl>
        <p class="prototype-note">Composition : {{ compositionRelationship }}.</p>
      </template>

      <template v-else-if="variant === 'compact'">
        <p class="prototype-compact-label">Identité</p>
        <p class="prototype-compact-line">
          <strong>{{ display(population) }}</strong>
          <span aria-hidden="true">·</span>
          <strong>{{ display(densite) }}</strong>
          <span aria-hidden="true">·</span>
          <strong>Superficie non publiée</strong>
        </p>
        <p class="prototype-note">{{ compositionRelationship }}.</p>
      </template>
    </section>
  </template>

  <div v-if="development" class="prototype-switcher">
      <span>Prototype</span>
      <button
        v-for="name in VARIANTS"
        :key="name"
        type="button"
        :aria-pressed="variant === name"
        :title="`${switcherLabels[name]} (← →)`"
        @click="selectVariant(name)"
      >{{ switcherLabels[name] }}</button>
  </div>
</template>

<style scoped>
.prototype-header { position: relative; margin-top: var(--space-6); padding: var(--space-5); border: 1px solid var(--border-default); border-radius: var(--radius-lg); background: var(--surface-secondary); text-align: left; }
.prototype-kicker, .prototype-compact-label { margin: 0 0 var(--space-3); color: var(--brand-500); font: var(--text-overline); letter-spacing: var(--text-overline-tracking); text-transform: uppercase; }
.prototype-anchors { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-4); margin: 0; }
.prototype-anchor { display: flex; flex-direction: column-reverse; gap: var(--space-1); }
.prototype-anchor dt, .prototype-note { margin: 0; color: var(--text-secondary); font: var(--text-body-sm); }
.prototype-anchor dd { margin: 0; color: var(--text-primary); font: var(--text-h3); font-variant-numeric: tabular-nums; }
.prototype-note { margin-top: var(--space-4); font-size: 0.75rem; }
.prototype-compact-line { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-2); margin: 0; color: var(--text-primary); font: var(--text-body-lg); }
.prototype-removal-note { padding-block: var(--space-2); }
.prototype-switcher { position: fixed; right: var(--space-4); bottom: var(--space-4); z-index: var(--z-toast); display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1); max-width: min(95vw, 440px); padding: var(--space-2); border: 1px solid var(--border-default); border-radius: var(--radius-md); background: var(--surface-primary); box-shadow: var(--shadow-subtle); font: var(--text-caption); }
.prototype-switcher span { padding-inline: var(--space-2); color: var(--text-tertiary); }
.prototype-switcher button { border: 1px solid var(--border-default); border-radius: var(--radius-sm); background: transparent; color: var(--text-secondary); padding: var(--space-1) var(--space-2); cursor: pointer; font: inherit; }
.prototype-switcher button[aria-pressed='true'] { border-color: var(--brand-500); background: var(--brand-500); color: white; }
@media (max-width: 600px) { .prototype-anchors { grid-template-columns: 1fr; } }
</style>
