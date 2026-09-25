<script setup lang="ts">
import {
  computed,
  inject,
  nextTick,
  onBeforeUnmount,
  onBeforeUpdate,
  onMounted,
  ref,
  useId,
} from 'vue'
import type { ComponentPublicInstance } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import {
  libelleOptionComparaison,
  OPTIONS_COMPARAISON_KEY,
  PARAM_COMPARAISON,
} from '@/fiche/comparisonContext'
import type { PrésentationPortéeComparaison } from '@/fiche/comparisonContext'
import type { TerritoryComparisonMode } from '@/payload/territoryReadModel'
import { buildingScopeParts } from '@/fiche/content/comparisonWording'

const props = withDefaults(defineProps<{
  label: string | null
  scopeKind?: PrésentationPortéeComparaison
}>(), {
  scopeKind: 'territoires',
})

const options = inject(OPTIONS_COMPARAISON_KEY, computed(() => []))
const route = useRoute()
const router = useRouter()
const ouvert = ref(false)
const noteId = useId()
const rootRef = ref<HTMLElement | null>(null)
const triggerRef = ref<HTMLButtonElement | null>(null)
const optionRefs: HTMLButtonElement[] = []

const optionDansLeLibelle = computed(() =>
  options.value.find((option) => props.label?.endsWith(libelleOptionComparaison(option, props.scopeKind))) ?? null,
)

const optionSelectionnee = computed(() => {
  const demande = route.query[PARAM_COMPARAISON]
  const optionDemandee = typeof demande === 'string'
    ? options.value.find((option) => option.mode === demande)
    : null
  return optionDansLeLibelle.value ?? optionDemandee ?? options.value[0] ?? null
})

const optionsDisponibles = computed(() =>
  options.value.filter((option) => option.mode !== optionSelectionnee.value?.mode),
)

const libelleDecoupe = computed(() => {
  if (!props.label) return null
  const option = optionDansLeLibelle.value ?? optionSelectionnee.value
  const scopeLibelle = option ? libelleOptionComparaison(option, props.scopeKind) : null
  if (!scopeLibelle || !props.label.endsWith(scopeLibelle)) {
    return { phrase: props.label, fixed: null, scope: null }
  }
  const parts = props.scopeKind === 'bâtiments' && option
    ? buildingScopeParts(option.label)
    : null
  return {
    phrase: props.label.slice(0, -scopeLibelle.length).trimEnd(),
    fixed: parts?.fixed ?? null,
    scope: parts?.scope ?? option?.label ?? null,
  }
})

async function ouvrir(focusIndex: number | null = null): Promise<void> {
  ouvert.value = true
  if (focusIndex === null) return
  await nextTick()
  optionRefs[focusIndex]?.focus()
}

function basculer(): void {
  if (ouvert.value) {
    fermer()
    return
  }
  void ouvrir()
}

function fermer(): void {
  ouvert.value = false
  void nextTick(() => triggerRef.value?.focus())
}

function handleDocumentPointerdown(event: PointerEvent): void {
  if (ouvert.value && !rootRef.value?.contains(event.target as Node)) {
    ouvert.value = false
  }
}

function enregistrerOption(element: Element | ComponentPublicInstance | null): void {
  if (element && 'focus' in element && typeof element.focus === 'function') {
    optionRefs.push(element as HTMLButtonElement)
  }
}

function deplacerOption(index: number, delta: number): void {
  const count = optionRefs.length
  if (count === 0) return
  optionRefs[(index + delta + count) % count]?.focus()
}

onBeforeUpdate(() => { optionRefs.length = 0 })

onMounted(() => document.addEventListener('pointerdown', handleDocumentPointerdown))
onBeforeUnmount(() => document.removeEventListener('pointerdown', handleDocumentPointerdown))

async function choisir(mode: TerritoryComparisonMode): Promise<void> {
  ouvert.value = false
  await router.replace({
    query: { ...route.query, [PARAM_COMPARAISON]: mode },
  })
  await nextTick()
  await nextTick()
  triggerRef.value?.focus()
}
</script>

<template>
  <p
    v-if="label"
    ref="rootRef"
    class="cahier-comparison-note"
    role="note"
  >
    <strong class="cahier-comparison-note__label">Groupe comparé</strong> :
    <template v-if="libelleDecoupe?.scope && optionSelectionnee && options.length > 1">
      <span class="cahier-comparison-note__phrase">{{ libelleDecoupe.phrase }}{{ ' ' }}</span>
      <span v-if="libelleDecoupe.fixed" class="cahier-comparison-note__fixed">{{ libelleDecoupe.fixed }}</span>
      <button
        type="button"
        class="cahier-comparison-note__trigger"
        ref="triggerRef"
        aria-haspopup="listbox"
        :aria-label="`Contexte de comparaison sélectionné : ${libelleDecoupe.scope}`"
        :aria-controls="`${noteId}-options`"
        :aria-expanded="ouvert ? 'true' : 'false'"
        aria-current="true"
        @click="basculer"
        @keydown.enter.prevent="basculer"
        @keydown.space.prevent="basculer"
        @keydown.arrow-down.prevent="ouvrir(0)"
        @keydown.arrow-up.prevent="ouvrir(optionsDisponibles.length - 1)"
        @keydown.esc.stop="fermer"
      >
        <span class="cahier-comparison-note__scope">{{ libelleDecoupe.scope }}</span>
        <span class="cahier-comparison-note__arrow" :class="{ 'is-open': ouvert }" aria-hidden="true">←</span>
      </button>
      <span
        v-if="ouvert"
        :id="`${noteId}-options`"
        class="cahier-comparison-note__options"
        role="listbox"
        aria-label="Autres contextes de comparaison"
      >
        <span
          v-if="optionSelectionnee"
          class="cahier-comparison-note__selected-option"
          role="option"
          aria-selected="true"
          aria-disabled="true"
        >
          {{ libelleOptionComparaison(optionSelectionnee, scopeKind) }}
        </span>
        <template v-for="(option, index) in optionsDisponibles" :key="option.mode">
          <button
            type="button"
            :ref="enregistrerOption"
            role="option"
            class="cahier-comparison-note__option"
            aria-selected="false"
            :aria-describedby="option.description ? `${noteId}-${option.mode}-help` : undefined"
            :title="option.description ?? undefined"
            @click="choisir(option.mode)"
            @keydown.enter.prevent="choisir(option.mode)"
            @keydown.space.prevent="choisir(option.mode)"
            @keydown.arrow-down.prevent="deplacerOption(index, 1)"
            @keydown.arrow-up.prevent="deplacerOption(index, -1)"
            @keydown.home.prevent="optionRefs[0]?.focus()"
            @keydown.end.prevent="optionRefs[optionRefs.length - 1]?.focus()"
            @keydown.esc.stop="fermer"
          >
            <span class="cahier-comparison-note__option-label">
              {{ libelleOptionComparaison(option, scopeKind) }}
            </span>
            <span
              v-if="option.description"
              :id="`${noteId}-${option.mode}-help`"
              class="cahier-comparison-note__option-help"
            >
              {{ option.description }}
            </span>
          </button>
        </template>
      </span>
    </template>
    <template v-else>{{ label }}</template>
  </p>
</template>

<style scoped>
.cahier-comparison-note {
  max-width: 42rem;
  margin: var(--space-2) auto 0;
  color: var(--cahier-default);
  font: var(--type-figure-comparison);
  line-height: 1.3;
  letter-spacing: normal;
  text-align: center;
  overflow-wrap: anywhere;
}

.cahier-comparison-note__label {
  color: var(--cahier-region-emphasis);
}

.cahier-comparison-note__trigger {
  display: inline-flex;
  align-items: center;
  gap: 0.25em;
  max-width: 100%;
  min-block-size: 36px;
  padding: 0 var(--space-3);
  border: 0;
  color: inherit;
  font: inherit;
  text-align: inherit;
  background: transparent;
  cursor: pointer;
}

.cahier-comparison-note__trigger:hover,
.cahier-comparison-note__trigger:active,
.cahier-comparison-note__option:hover,
.cahier-comparison-note__option:active {
  color: var(--cahier-theme-strong);
}

.cahier-comparison-note__scope {
  overflow-wrap: anywhere;
  text-decoration: underline;
  text-decoration-thickness: 0.08em;
  text-underline-offset: 0.15em;
}

.cahier-comparison-note__arrow {
  display: inline-block;
  transition: transform 150ms ease;
}

.cahier-comparison-note__arrow.is-open {
  transform: rotate(-90deg);
}

.cahier-comparison-note__trigger:focus-visible,
.cahier-comparison-note__option:focus-visible {
  outline: 2px solid var(--cahier-theme-strong);
  outline-offset: 4px;
}

.cahier-comparison-note__options {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin-top: var(--space-1);
}

.cahier-comparison-note__selected-option {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  border: 0;
  white-space: nowrap;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
}

.cahier-comparison-note__option {
  min-block-size: 36px;
  padding: 0 var(--space-3);
  border: 0;
  color: inherit;
  font: inherit;
  background: transparent;
  cursor: pointer;
  overflow-wrap: anywhere;
  white-space: normal;
}

@media (pointer: coarse) {
  .cahier-comparison-note__trigger,
  .cahier-comparison-note__option {
    min-block-size: 44px;
  }
}

.cahier-comparison-note__option-help {
  display: none;
  max-width: 34rem;
  margin: 0 auto var(--space-1);
  color: var(--cahier-default);
  font-size: 0.9em;
  line-height: 1.35;
}

.cahier-comparison-note__option:hover .cahier-comparison-note__option-help,
.cahier-comparison-note__option:focus-visible .cahier-comparison-note__option-help {
  display: block;
}

@media (prefers-reduced-motion: reduce) {
  .cahier-comparison-note__arrow {
    transition: none;
  }
}
</style>
