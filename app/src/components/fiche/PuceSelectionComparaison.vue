<script setup lang="ts">
/**
 * PuceSelectionComparaison — le contrôle de la Sélection de comparaison assis
 * dans la rangée collante de l’en-tête de la fiche (#768/#860) : une puce
 * « Sélection : <portée> » qui ouvre un menu rapide (défaut niveau-natif,
 * presets, aucune comparaison). La Région n’a aucun contrôle. Le constructeur
 * complet (recherche, gestion des membres tapés) est la tranche #861 — ici la
 * puce + les presets seulement. La puce émet la valeur d’URL à écrire dans
 * `?comparaison=` ; la vue propriétaire applique la navigation.
 *
 * A11y : bouton avec aria-haspopup="menu" + aria-expanded, nom accessible complet
 * (« Sélection de comparaison active : … »), menu role="menu" en
 * menuitemradio avec aria-checked, navigation clavier (flèches/Home/End/Échap,
 * Entrée/Espace), cibles tactiles 44px au pointeur grossier.
 */
import { ChevronDown } from 'lucide-vue-next'
import { computed, nextTick, onBeforeUnmount, onBeforeUpdate, onMounted, ref, useId } from 'vue'
import type { ComponentPublicInstance } from 'vue'

import AppIcon from '@/components/AppIcon.vue'
import type {
  PresetComparaisonOption,
  SelectionComparaison,
} from '@/fiche/comparisonContext'

const props = defineProps<{
  selection: SelectionComparaison
  /** Libellé de la portée active (défaut/preset : portée résolue ; membres : compte ; vide : « Aucune comparaison »). */
  libelleActif: string | null
  /** Libellé du contexte par défaut niveau-natif (entrée « Par défaut » du menu). */
  libelleDefaut: string | null
  /** Presets proposés par le menu rapide (déjà filtrés au niveau du territoire). */
  presets: readonly PresetComparaisonOption[]
}>()

const emit = defineEmits<{
  /** Valeur d’URL à écrire dans ?comparaison= — undefined retire le paramètre (défaut). */
  (e: 'choisir', valeur: string | undefined): void
}>()

interface EntreeMenu {
  valeur: string | undefined
  label: string
  description: string | null
  actif: boolean
}

const entrees = computed<readonly EntreeMenu[]>(() => [
  {
    valeur: undefined,
    label: props.libelleDefaut ? `Par défaut : ${props.libelleDefaut}` : 'Contexte par défaut',
    description: null,
    actif: props.selection.etat === 'defaut',
  },
  ...props.presets.map((preset) => ({
    valeur: preset.preset as string,
    label: preset.label,
    description: preset.description,
    actif: props.selection.etat === 'preset' && props.selection.preset === preset.preset,
  })),
  {
    valeur: '',
    label: 'Aucune comparaison',
    description: null,
    actif: props.selection.etat === 'vide',
  },
])

const ouvert = ref(false)
const menuId = useId()
const rootRef = ref<HTMLElement | null>(null)
const triggerRef = ref<HTMLButtonElement | null>(null)
const optionRefs: HTMLButtonElement[] = []

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

function choisir(entree: EntreeMenu): void {
  ouvert.value = false
  emit('choisir', entree.valeur)
  void nextTick(() => triggerRef.value?.focus())
}
</script>

<template>
  <div ref="rootRef" class="puce-selection">
    <button
      type="button"
      class="puce-selection__trigger"
      ref="triggerRef"
      aria-haspopup="menu"
      :aria-label="`Sélection de comparaison active : ${libelleActif ?? 'aucune'}`"
      :aria-controls="menuId"
      :aria-expanded="ouvert ? 'true' : 'false'"
      @click="basculer"
      @keydown.enter.prevent="basculer"
      @keydown.space.prevent="basculer"
      @keydown.arrow-down.prevent="ouvrir(0)"
      @keydown.arrow-up.prevent="ouvrir(entrees.length - 1)"
      @keydown.esc.stop="fermer"
    >
      <span class="puce-selection__titre">Sélection</span>
      <span class="puce-selection__portee">{{ libelleActif ?? '—' }}</span>
      <AppIcon :icone="ChevronDown" :taille="14" class="puce-selection__fleche" :class="{ 'is-open': ouvert }" aria-hidden="true" />
    </button>
    <div
      v-if="ouvert"
      :id="menuId"
      class="puce-selection__menu"
      role="menu"
      aria-label="Sélection de comparaison"
    >
      <button
        v-for="(entree, index) in entrees"
        :key="entree.valeur ?? 'defaut'"
        :ref="enregistrerOption"
        type="button"
        role="menuitemradio"
        class="puce-selection__option"
        :aria-checked="entree.actif ? 'true' : 'false'"
        :aria-describedby="entree.description ? `${menuId}-${entree.valeur ?? 'defaut'}-help` : undefined"
        :title="entree.description ?? undefined"
        @click="choisir(entree)"
        @keydown.enter.prevent="choisir(entree)"
        @keydown.space.prevent="choisir(entree)"
        @keydown.arrow-down.prevent="deplacerOption(index, 1)"
        @keydown.arrow-up.prevent="deplacerOption(index, -1)"
        @keydown.home.prevent="optionRefs[0]?.focus()"
        @keydown.end.prevent="optionRefs[optionRefs.length - 1]?.focus()"
        @keydown.esc.stop="fermer"
      >
        <span class="puce-selection__option-coche" aria-hidden="true">{{ entree.actif ? '✓' : '' }}</span>
        <span class="puce-selection__option-label">{{ entree.label }}</span>
        <span
          v-if="entree.description"
          :id="`${menuId}-${entree.valeur ?? 'defaut'}-help`"
          class="puce-selection__option-help"
        >{{ entree.description }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.puce-selection {
  position: relative;
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.puce-selection__trigger {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-block-size: 44px;
  padding: 0 var(--space-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-full);
  background: var(--surface-tertiary);
  color: var(--text-primary);
  font: var(--text-body-sm);
  cursor: pointer;
  white-space: nowrap;
}

.puce-selection__trigger:hover {
  background: var(--surface-primary);
  border-color: var(--brand-500);
}

.puce-selection__trigger:focus-visible,
.puce-selection__option:focus-visible {
  outline: 2px solid var(--brand-500);
  outline-offset: 2px;
}

.puce-selection__titre {
  color: var(--text-tertiary);
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
  text-transform: uppercase;
}

.puce-selection__portee {
  font-weight: 600;
  overflow-wrap: anywhere;
  white-space: normal;
}

.puce-selection__fleche {
  flex-shrink: 0;
  color: var(--text-tertiary);
  transition: transform 150ms ease;
}

.puce-selection__fleche.is-open {
  transform: rotate(180deg);
}

.puce-selection__menu {
  position: absolute;
  top: calc(100% + var(--space-1));
  inset-inline-end: 0;
  z-index: var(--z-popover);
  display: flex;
  flex-direction: column;
  min-inline-size: 16rem;
  max-inline-size: min(22rem, calc(100vw - 2 * var(--grid-margin-mobile)));
  padding: var(--space-1);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--surface-primary);
  box-shadow: var(--shadow-subtle);
}

.puce-selection__option {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  min-block-size: 44px;
  padding: var(--space-2) var(--space-3);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-primary);
  font: var(--text-body-sm);
  text-align: start;
  cursor: pointer;
  overflow-wrap: anywhere;
}

.puce-selection__option:hover {
  background: var(--surface-tertiary);
}

.puce-selection__option[aria-checked='true'] {
  font-weight: 600;
}

.puce-selection__option-coche {
  flex-shrink: 0;
  inline-size: 1em;
  color: var(--brand-700);
}

.puce-selection__option-help {
  display: none;
  flex-basis: 100%;
  color: var(--text-tertiary);
  font: var(--text-caption);
  line-height: 1.35;
}

.puce-selection__option:hover .puce-selection__option-help,
.puce-selection__option:focus-visible .puce-selection__option-help {
  display: block;
}

@media (pointer: coarse) {
  .puce-selection__trigger,
  .puce-selection__option {
    min-block-size: 44px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .puce-selection__fleche {
    transition: none;
  }
}
</style>
