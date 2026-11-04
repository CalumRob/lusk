<script setup lang="ts">
/**
 * BoutonComparaison — le contrôle de comparaison de la fiche, assis dans le
 * page-heading collant du Cahier (juste à gauche du titre « {thème} ·
 * {territoire} », #860 ruling propriétaire 2026-11-03, seconde passe) :
 * identité « Comparaison » + type ou nombre de membres, même fermé ;
 * la portée active ne se lit que dans le nom accessible
 * (aria-label) et dans la seconde ligne du preset. « Sélection » reste du vocabulaire
 * de glossaire, jamais du copy UI.
 *
 * Le menu ne porte AUCUNE entrée « Par défaut » : quand le paramètre d'URL est
 * absent (état défaut), le preset niveau-natif (l'EPCI d'une commune ; le même
 * niveau Bretagne sur EPCI/département) apparaît comme l'entrée cochée ;
 * les entrées sont les presets + « Aucune comparaison ». Choisir le preset du
 * défaut écrit le preset explicite dans l'URL. Le constructeur #861 transforme
 * un preset en membres visibles avant édition ; aucun focal n'est caché.
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
import { computed, nextTick, onBeforeUnmount, onBeforeUpdate, onMounted, ref, useId, watch } from 'vue'
import type { ComponentPublicInstance } from 'vue'

import AppIcon from '@/components/AppIcon.vue'
import MembresComparaison from './MembresComparaison.vue'
import type { Territoire } from '@/payload/types'
import { membresConstructeur } from '@/fiche/selectionBuilder'
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
  focal?: Territoire
  territoires?: readonly Territoire[]
}>()

// Titres éditoriaux des types ; les portées factuelles restent celles des presets.
const typeLabels: Record<PresetComparaison, string> = {
  epci: 'EPCI', bretagne: 'Bretagne', densite: 'Densité INSEE',
}
const typeActif = computed(() => {
  const selection = props.selection
  if (selection.etat === 'vide') return 'Aucune'
  if (selection.etat === 'membres') return `${selection.membres.length} membre${selection.membres.length === 1 ? '' : 's'}`
  const preset = selection.etat === 'preset' ? selection.preset : props.presetDefaut
  return preset ? typeLabels[preset] : 'Aucune'
})

const emit = defineEmits<{
  /** La sélection choisie, typée — la vue la sérialise dans ?comparaison=. */
  (e: 'choisir', selection: SelectionComparaison): void
}>()

interface EntreeMenu {
  selection: SelectionComparaison
  label: string
  description: string | null
  scope: string | null
  actif: boolean
}

const entrees = computed<readonly EntreeMenu[]>(() => [
  ...props.presets.map((preset) => ({
    selection: { etat: 'preset', preset: preset.preset } as SelectionComparaison,
    label: typeLabels[preset.preset],
    scope: preset.label,
    description: preset.description,
    actif: props.selection.etat === 'preset'
      ? props.selection.preset === preset.preset
      : props.selection.etat === 'defaut' && props.presetDefaut === preset.preset,
  })),
  {
    selection: { etat: 'vide' },
    label: 'Aucune comparaison',
    description: null,
    scope: null,
    actif: props.selection.etat === 'vide',
  },
])

const ouvert = ref(false)
const panneauMobile = ref(false)
const positionPanneau = ref({ top: 0, right: 0 })
const edition = ref(false)
const membres = computed(() => props.focal
  ? membresConstructeur(props.selection, props.focal, props.territoires ?? []) : [])
function personnaliser(): void {
  edition.value = true
  if (props.selection.etat === 'defaut' || props.selection.etat === 'preset') {
    emit('choisir', membres.value.length ? { etat: 'membres', membres: membres.value } : { etat: 'vide' })
  }
}
let ancienOverflow: string | null = null
watch(ouvert, (value) => {
  if (value && props.focal && window.matchMedia('(max-width: 639px)').matches) {
    ancienOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  } else if (!value && ancienOverflow !== null) {
    document.body.style.overflow = ancienOverflow
    ancienOverflow = null
  }
})
function garderFocus(event: KeyboardEvent): void {
  const elements = [...(rootRef.value?.querySelectorAll<HTMLElement>('button, input') ?? [])]
  const premier = elements[1] // le déclencheur reste hors du panneau
  const dernier = elements.at(-1)
  if (event.shiftKey && (document.activeElement === premier || document.activeElement === triggerRef.value)) {
    event.preventDefault(); dernier?.focus()
  } else if (!event.shiftKey && document.activeElement === dernier) {
    event.preventDefault(); premier?.focus()
  }
}
const menuId = useId()
const rootRef = ref<HTMLElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
const fondRef = ref<HTMLElement | null>(null)
let panelObserver: ResizeObserver | null = null
function positionnerPanneau(): void {
  if (!ouvert.value || panneauMobile.value) return
  const anchor = rootRef.value?.getBoundingClientRect()
  const panel = panelRef.value?.getBoundingClientRect()
  if (!anchor || !panel) return
  const top = anchor.bottom + panel.height + 12 <= window.innerHeight ? anchor.bottom + 4
    : anchor.top - panel.height - 4 >= 8 ? anchor.top - panel.height - 4
      : Math.max(8, window.innerHeight - panel.height - 8)
  positionPanneau.value = { top, right: Math.max(8, window.innerWidth - anchor.right) }
}
const triggerRef = ref<HTMLButtonElement | null>(null)
const optionRefs: HTMLButtonElement[] = []

async function ouvrir(focusIndex: number | null = null): Promise<void> {
  panneauMobile.value = window.matchMedia('(max-width: 639px)').matches
  const anchor = rootRef.value?.getBoundingClientRect()
  if (anchor) positionPanneau.value = { top: anchor.bottom + 4, right: Math.max(0, window.innerWidth - anchor.right) }
  ouvert.value = true
  edition.value = props.selection.etat === 'membres' || props.selection.etat === 'vide'
  await nextTick()
  // Top layer : le heading du Cahier est dans un contexte d'empilement sous
  // les onglets collants. Le panneau garde ses tokens hérités sans y être piégé.
  fondRef.value?.showPopover?.()
  panelRef.value?.showPopover?.()
  positionnerPanneau()
  panelObserver?.disconnect()
  panelObserver = new ResizeObserver(positionnerPanneau)
  if (panelRef.value) panelObserver.observe(panelRef.value)
  if (focusIndex === null) {
    if (props.focal) {
      await nextTick()
      rootRef.value?.querySelector<HTMLButtonElement>('.bouton-comparaison__fermer')?.focus()
    }
    return
  }
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
  panelObserver?.disconnect()
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

onMounted(() => {
  document.addEventListener('pointerdown', handleDocumentPointerdown)
  window.addEventListener('resize', positionnerPanneau)
  document.addEventListener('scroll', positionnerPanneau, true)
})
onBeforeUnmount(() => {
  panelObserver?.disconnect()
  window.removeEventListener('resize', positionnerPanneau)
  document.removeEventListener('scroll', positionnerPanneau, true)
  document.removeEventListener('pointerdown', handleDocumentPointerdown)
  if (ancienOverflow !== null) document.body.style.overflow = ancienOverflow
})

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
      :aria-haspopup="focal ? 'dialog' : 'menu'"
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
      <span class="bouton-comparaison__type">{{ typeActif }}</span>
      <AppIcon :icone="ChevronDown" :taille="12" class="bouton-comparaison__fleche" :class="{ 'is-open': ouvert }" aria-hidden="true" />
    </button>
    <div v-if="ouvert && focal && panneauMobile" ref="fondRef" popover="manual" class="bouton-comparaison__fond" aria-hidden="true" @click="fermer" />
    <div
      v-if="ouvert"
      :id="menuId"
      ref="panelRef"
      popover="manual"
      :style="panneauMobile ? undefined : { top: `${positionPanneau.top}px`, right: `${positionPanneau.right}px` }"
      class="bouton-comparaison__menu"
      :role="focal ? 'dialog' : 'menu'"
      :aria-modal="focal && panneauMobile ? 'true' : undefined"
      aria-label="Portée de comparaison"
      @keydown.esc.stop="fermer"
      @keydown.tab="focal && garderFocus($event)"
    >
      <button v-if="focal" type="button" class="bouton-comparaison__option bouton-comparaison__fermer" aria-label="Fermer la comparaison" @click="fermer">Fermer</button>
      <div :role="focal ? 'menu' : undefined" :aria-label="focal ? 'Groupes de départ' : undefined">
      <button
        v-for="(entree, index) in entrees"
        :key="serialiserSelection(entree.selection) ?? 'defaut'"
        :ref="enregistrerOption"
        type="button"
        role="menuitemradio"
        class="bouton-comparaison__option"
        :aria-checked="entree.actif ? 'true' : 'false'"
        :aria-describedby="entree.scope ? `${menuId}-${serialiserSelection(entree.selection)}-help` : undefined"
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
        <span class="bouton-comparaison__option-copy">
          <span class="bouton-comparaison__option-label">{{ entree.label }}</span>
          <span
            v-if="entree.scope"
            :id="`${menuId}-${serialiserSelection(entree.selection)}-help`"
            class="bouton-comparaison__option-scope"
          >{{ entree.scope }}</span>
        </span>
      </button>
      </div>
      <template v-if="focal">
        <button v-if="!edition" type="button" class="bouton-comparaison__option" data-testid="personnaliser-comparaison" @click="personnaliser">
          <span aria-hidden="true">+</span><span class="bouton-comparaison__option-label">Personnaliser le groupe</span>
        </button>
        <MembresComparaison v-else :focal="focal" :territoires="territoires ?? []" :membres="membres" @choisir="emit('choisir', $event)" />
      </template>
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

/* Contrôle carré du Cahier. La bordure est incluse dans la hauteur de ligne
   existante : elle ne doit pas épaissir le heading au pointeur fin. */
.bouton-comparaison__declencheur {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  box-sizing: border-box;
  block-size: 1.3em;
  padding: 0 var(--space-1);
  border: 1px solid var(--red-soft, var(--border-subtle));
  border-radius: 2px;
  background: var(--paper, var(--surface-primary));
  color: var(--cahier-theme-strong, var(--red, var(--accent-primary)));
  font: inherit;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
  white-space: nowrap;
}

.bouton-comparaison__texte {
  color: var(--muted, var(--text-tertiary));
  font-size: 0.85em;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.bouton-comparaison__type { font-variant-numeric: tabular-nums; }

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
  position: fixed;
  margin: 0;
  inset: auto;
  top: calc(100% + 4px);
  inset-inline-end: 0;
  z-index: var(--z-popover);
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  box-sizing: border-box;
  inline-size: min(20rem, calc(100vw - 2 * var(--space-4)));
  padding: var(--space-2);
  border: 1px solid var(--red-soft, color-mix(in oklab, var(--cahier-default, var(--muted)) 18%, transparent));
  border-radius: 2px;
  background: var(--paper, var(--surface-primary));
  box-shadow: var(--shadow-default);
  /* Le heading est nowrap. Le panneau possède sa propre composition de texte,
     y compris les nœuds texte dont les boîtes seules masquaient le débordement. */
  white-space: normal;
  overflow-wrap: anywhere;
  max-block-size: min(36rem, calc(100dvh - var(--space-4)));
  overflow-y: auto;
  overscroll-behavior: contain;
}

.bouton-comparaison__fond { display: none; }
.bouton-comparaison__option.bouton-comparaison__fermer { display: block; text-align: end; font: 600 11px/1.3 var(--font-ui); letter-spacing: 0.06em; text-transform: uppercase; }

@media (max-width: 639px) {
  .bouton-comparaison__fond { display: block; position: fixed; inset: 0; inline-size: auto; block-size: auto; max-inline-size: none; max-block-size: none; margin: 0; padding: 0; border: 0; background: var(--surface-overlay, color-mix(in srgb, var(--ink, var(--text-primary)) 30%, transparent)); z-index: var(--z-overlay); }
  .bouton-comparaison__menu { position: fixed; inset: auto 0 0; inline-size: 100%; max-block-size: 85dvh; padding: var(--space-4); padding-block-end: max(var(--space-4), env(safe-area-inset-bottom)); }
  .bouton-comparaison__option { min-block-size: 44px; }
}

.bouton-comparaison__option {
  display: grid;
  grid-template-columns: 1rem minmax(0, 1fr);
  align-items: start;
  gap: var(--space-2);
  min-block-size: 36px;
  box-sizing: border-box;
  inline-size: 100%;
  min-inline-size: 0;
  padding: var(--space-3) var(--space-2);
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--ink, var(--text-primary));
  font: 400 13px/1.35 var(--font-ui);
  text-align: start;
  cursor: pointer;
  overflow-wrap: anywhere;
  white-space: normal;
}

.bouton-comparaison__option + .bouton-comparaison__option {
  border-top: 1px solid var(--red-soft, var(--border-subtle));
}

.bouton-comparaison__option-copy {
  display: grid;
  min-inline-size: 0;
  gap: var(--space-1);
}

.bouton-comparaison__option-label {
  font: 600 11px/1.3 var(--font-ui);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.bouton-comparaison__option-scope {
  color: var(--muted, var(--text-tertiary));
  font: 400 13px/1.4 var(--font-ui);
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
  inline-size: 1rem;
  line-height: 1.3;
  color: var(--red, var(--accent-primary));
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
