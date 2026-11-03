<script setup lang="ts">
/**
 * BoutonComparaison — le contrôle de comparaison de la fiche, assis dans le
 * page-heading collant du Cahier (juste à gauche du titre « {thème} ·
 * {territoire} », #860 ruling propriétaire 2026-11-03) : face laconique
 * « Comparaison » ; la portée active ne se lit que dans le nom accessible
 * (aria-label), jamais en prose visible. « Sélection » reste du vocabulaire
 * de glossaire, jamais du copy UI.
 *
 * Le menu ne porte AUCUNE entrée « Par défaut » : quand le paramètre d'URL est
 * absent (état défaut), le preset niveau-natif (l'EPCI d'une commune ; le même
 * niveau Bretagne sur EPCI/département) apparaît comme l'entrée cochée ;
 * les entrées sont les presets + « Aucune comparaison ». Choisir le preset du
 * défaut écrit le preset explicite dans l'URL. Le constructeur de membres
 * tapés (recherche, gestion) est la tranche #861.
 *
 * Visuel natif du Cahier (grammaire papier) : libellé en petites capitales
 * --font-ui comme le sommaire mobile, bouton carré sans chrome de pilule,
 * menu papier bordé --red-soft comme le dialog du Cahier.
 *
 * A11y : bouton aria-haspopup="menu" + aria-expanded + nom accessible complet,
 * menu role="menu" en menuitemradio avec aria-checked, navigation clavier
 * (flèches/Home/End/Échap, Entrée/Espace), cibles tactiles 44px au pointeur
 * grossier.
 */
import { ChevronDown } from 'lucide-vue-next'
import { computed, nextTick, onBeforeUnmount, onBeforeUpdate, onMounted, ref, useId } from 'vue'
import type { ComponentPublicInstance } from 'vue'

import AppIcon from '@/components/AppIcon.vue'
import type {
  PresetComparaison,
  PresetComparaisonOption,
  SelectionComparaison,
} from '@/fiche/comparisonContext'
import { serialiserSelection } from '@/fiche/comparisonContext'

const props = defineProps<{
  selection: SelectionComparaison
  /** Libellé de la portée active — porté par le nom accessible, pas en prose visible. */
  libelleActif: string | null
  /** Preset niveau-natif (coché quand le paramètre est absent). */
  presetDefaut: PresetComparaison | null
  /** Presets proposés (déjà filtrés : résolution réelle garantie pour ce territoire). */
  presets: readonly PresetComparaisonOption[]
}>()

const emit = defineEmits<{
  /** La sélection choisie, typée — la vue la sérialise dans ?comparaison=. */
  (e: 'choisir', selection: SelectionComparaison): void
}>()

interface EntreeMenu {
  selection: SelectionComparaison
  label: string
  description: string | null
  actif: boolean
}

const entrees = computed<readonly EntreeMenu[]>(() => [
  ...props.presets.map((preset) => ({
    selection: { etat: 'preset', preset: preset.preset } as SelectionComparaison,
    label: preset.label,
    description: preset.description,
    actif: props.selection.etat === 'preset'
      ? props.selection.preset === preset.preset
      : props.selection.etat === 'defaut' && props.presetDefaut === preset.preset,
  })),
  {
    selection: { etat: 'vide' },
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
  emit('choisir', entree.selection)
  void nextTick(() => triggerRef.value?.focus())
}
</script>

<template>
  <div ref="rootRef" class="bouton-comparaison">
    <button
      type="button"
      class="bouton-comparaison__declencheur"
      ref="triggerRef"
      aria-haspopup="menu"
      :aria-label="`Comparaison : ${libelleActif ?? 'aucune portée active'}`"
      :aria-controls="menuId"
      :aria-expanded="ouvert ? 'true' : 'false'"
      @click="basculer"
      @keydown.enter.prevent="basculer"
      @keydown.space.prevent="basculer"
      @keydown.arrow-down.prevent="ouvrir(0)"
      @keydown.arrow-up.prevent="ouvrir(entrees.length - 1)"
      @keydown.esc.stop="fermer"
    >
      <span class="bouton-comparaison__texte">Comparaison</span>
      <AppIcon :icone="ChevronDown" :taille="12" class="bouton-comparaison__fleche" :class="{ 'is-open': ouvert }" aria-hidden="true" />
    </button>
    <div
      v-if="ouvert"
      :id="menuId"
      class="bouton-comparaison__menu"
      role="menu"
      aria-label="Portée de comparaison"
    >
      <button
        v-for="(entree, index) in entrees"
        :key="serialiserSelection(entree.selection) ?? 'defaut'"
        :ref="enregistrerOption"
        type="button"
        role="menuitemradio"
        class="bouton-comparaison__option"
        :aria-checked="entree.actif ? 'true' : 'false'"
        :aria-describedby="entree.description ? `${menuId}-${serialiserSelection(entree.selection)}-help` : undefined"
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
        <span class="bouton-comparaison__coche" aria-hidden="true">{{ entree.actif ? '✓' : '' }}</span>
        <span class="bouton-comparaison__option-label">{{ entree.label }}</span>
        <span
          v-if="entree.description"
          :id="`${menuId}-${serialiserSelection(entree.selection)}-help`"
          class="bouton-comparaison__option-help"
        >{{ entree.description }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.bouton-comparaison {
  position: relative;
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

/* Face laconique en petites capitales, comme le sommaire mobile du Cahier. */
.bouton-comparaison__declencheur {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--cahier-theme-strong, var(--red, var(--accent-primary)));
  font: inherit;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  cursor: pointer;
  white-space: nowrap;
}

.bouton-comparaison__declencheur:hover {
  color: var(--red, var(--accent-primary));
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 3px;
}

.bouton-comparaison__declencheur:focus-visible,
.bouton-comparaison__option:focus-visible {
  outline: 2px solid var(--red, var(--accent-primary));
  outline-offset: 2px;
}

.bouton-comparaison__fleche {
  flex-shrink: 0;
  transition: transform 150ms ease;
}

.bouton-comparaison__fleche.is-open {
  transform: rotate(180deg);
}

/* Menu papier, bordé comme le dialog du Cahier — pas de chrome générique. */
.bouton-comparaison__menu {
  position: absolute;
  top: calc(100% + 4px);
  inset-inline-end: 0;
  z-index: var(--z-popover);
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  inline-size: min(20rem, calc(100vw - 2 * var(--space-4)));
  padding: var(--space-1);
  border: 1px solid var(--red-soft, color-mix(in oklab, var(--cahier-default, var(--muted)) 18%, transparent));
  border-radius: 2px;
  background: var(--paper, var(--surface-primary));
  box-shadow: 0 10px 30px rgb(18 28 27 / 16%);
}

.bouton-comparaison__option {
  display: grid;
  grid-template-columns: 1em minmax(0, 1fr);
  align-items: baseline;
  gap: var(--space-2);
  min-block-size: 36px;
  padding: var(--space-2) var(--space-3);
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--ink, var(--text-primary));
  font: 400 13px/1.35 var(--font-ui);
  text-align: start;
  cursor: pointer;
  overflow-wrap: anywhere;
}

.bouton-comparaison__option:hover {
  background: color-mix(in srgb, var(--cahier-theme, var(--brand-500)) 8%, transparent);
}

.bouton-comparaison__declencheur:active,
.bouton-comparaison__option:active {
  color: var(--red, var(--accent-primary));
  background: color-mix(in srgb, var(--cahier-theme, var(--brand-500)) 16%, transparent);
}

.bouton-comparaison__option[aria-checked='true'] {
  font-weight: 700;
}

.bouton-comparaison__coche {
  flex-shrink: 0;
  inline-size: 1em;
  color: var(--red, var(--accent-primary));
}

.bouton-comparaison__option-help {
  display: none;
  grid-column: 2;
  color: var(--muted, var(--text-tertiary));
  font: var(--text-caption);
  line-height: 1.35;
}

.bouton-comparaison__option:hover .bouton-comparaison__option-help,
.bouton-comparaison__option:focus-visible .bouton-comparaison__option-help {
  display: block;
}

@media (pointer: coarse) {
  .bouton-comparaison__declencheur,
  .bouton-comparaison__option {
    min-block-size: 44px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .bouton-comparaison__fleche {
    transition: none;
  }
}
</style>
