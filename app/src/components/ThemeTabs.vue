<script setup lang="ts">
/**
 * ThemeTabs — the payload-driven theme subheader (ADR-0007 + ui-elements.md
 * §ThemeTabs). The bar renders exactly the themes present in the payload
 * (themesPresent) in the order the caller passes them; the selected tab wears
 * its theme ramp (-strong text + -line underline; hover -soft). A leading
 * pseudo-tab (Aperçu on the legacy fiche, the carte's renamed first tab,
 * Méthodes' Sources) is rendered unless `masquerOngletInitial` — since #408
 * the fiche hides it: « Programmes et subventions » is a REAL theme, passed
 * first by the view. The view owns the URL state (?theme= / ?onglet= /
 * ?section=); this component only emits the chosen slug.
 *
 * A11y: role="tablist" / role="tab" with aria-selected and aria-controls
 * pointing at the active panel, roving tabindex + arrow-key navigation
 * (Left/Right wrap, Home/End), 44px touch targets, horizontal scroll on
 * mobile. The tab row is centered in the bar (free-space spacers that give
 * way to the horizontal scroll when the tabs overflow). Sticky below the
 * header (DESIGN.md §4 z-index).
 */
import { computed, ref } from 'vue'
import type { Component } from 'vue'

import AppIcon from '@/components/AppIcon.vue'
import {
  ICONE_APERCU,
  ICONES_THEMES,
  NOMS_THEMES,
  idOnglet,
  idPanneau,
} from '@/fiche/onglets'
import type { SlugOnglet } from '@/fiche/onglets'
import { THEMES_CANONIQUES } from '@/payload/types'
import type { Theme } from '@/payload/types'

/** Un onglet supplémentaire entre le premier onglet et les thèmes — le shell
 *  Méthodes (Sources | Indicateurs | Programmes, #332). */
export interface OngletSupplementaire {
  slug: SlugOnglet
  nom: string
  icone: Component
}

const props = withDefaults(
  defineProps<{
    themes: readonly Theme[]
    /** The selected tab — a theme, null for the fiche's Aperçu, 'programmes'
     *  for the carte's renamed first tab (ADR-0019, #282), or the Méthodes
     *  sections 'sources' / 'indicateurs' (issue #332). */
    selected: SlugOnglet
    /** The first tab's French label — defaults to « Aperçu » (fiche); the carte
     *  overrides it to « Programmes & financements » (ADR-0019, #282), Méthodes
     *  to « Sources » (#332). */
    libellePremier?: string
    /** The first tab's slug — null on the fiche (Aperçu emits null), 'programmes'
     *  on the carte (its ?onglet= state, #282), 'sources' on Méthodes (#332). */
    premierSlug?: SlugOnglet
    /** The first tab's icon — defaults to the Aperçu icon; the Méthodes shell
     *  swaps it for the Sources database icon (#332). */
    iconePremier?: Component
    /** Extra tabs between the first tab and the themes — the Méthodes shell's
     *  Indicateurs / Programmes sections (#332). */
    ongletsSupplementaires?: OngletSupplementaire[]
    /** The tablist's accessible name — defaults to « Thèmes de la fiche »
     *  (fiche); the carte/Méthodes bars name their own tablist. */
    ariaLabel?: string
    /** #408 : masquer le premier pseudo-onglet (Aperçu / renommé). La fiche
     *  n'en a plus — « Programmes et subventions » est un VRAI thème, rendu
     *  premier par l'ordre des thèmes passés ; la carte et les Méthodes
     *  conservent leur premier onglet renommé. */
    masquerOngletInitial?: boolean
  }>(),
  { ariaLabel: 'Thèmes de la fiche' },
)

const emit = defineEmits<{
  (e: 'select', slug: SlugOnglet): void
}>()

const onglets = computed(() => [
  // #408 : le fiche masque le pseudo-onglet initial — ses thèmes commencent
  // à « Programmes et subventions », premier thème canonique de la barre.
  ...(props.masquerOngletInitial
    ? []
    : [
        {
          slug: props.premierSlug ?? null,
          nom: props.libellePremier ?? 'Aperçu',
          icone: props.iconePremier ?? ICONE_APERCU,
        },
      ]),
  ...(props.ongletsSupplementaires ?? []),
  ...props.themes.map((theme) => ({
    slug: theme,
    nom: NOMS_THEMES[theme],
    icone: ICONES_THEMES[theme],
  })),
])

const refsOnglets = ref<HTMLElement[]>([])

function estTheme(slug: SlugOnglet): slug is Theme {
  return slug !== null && (THEMES_CANONIQUES as readonly string[]).includes(slug)
}

/** The theme's derived ramp as CSS custom props — the first tab (Aperçu /
 *  Programmes & financements) falls back to brand. */
function styleTheme(theme: Theme): Record<`--${string}`, string> {
  return {
    '--couleur-strong': `var(--theme-${theme}-strong)`,
    '--couleur-line': `var(--theme-${theme}-line)`,
    '--couleur-soft': `var(--theme-${theme}-soft)`,
  }
}

function selectionner(index: number): void {
  const onglet = onglets.value[index]
  if (!onglet) return
  refsOnglets.value[index]?.focus()
  emit('select', onglet.slug)
}

function surTouche(ev: KeyboardEvent): void {
  if (ev.key === 'Home') {
    ev.preventDefault()
    selectionner(0)
    return
  }
  if (ev.key === 'End') {
    ev.preventDefault()
    selectionner(onglets.value.length - 1)
    return
  }
  const pas = { ArrowLeft: -1, ArrowRight: 1 }[ev.key]
  if (pas === undefined) return
  ev.preventDefault()
  const actuel = onglets.value.findIndex((o) => o.slug === props.selected)
  selectionner((actuel + pas + onglets.value.length) % onglets.value.length)
}
</script>

<template>
  <div
    class="theme-tabs"
    role="tablist"
    :aria-label="props.ariaLabel"
    @keydown="surTouche"
  >
    <button
      v-for="(onglet, index) in onglets"
      :id="idOnglet(onglet.slug)"
      :key="onglet.slug ?? 'apercu'"
      ref="refsOnglets"
      type="button"
      role="tab"
      class="onglet"
      :class="{ 'onglet--selectionne': onglet.slug === selected }"
      :style="estTheme(onglet.slug) ? styleTheme(onglet.slug) : undefined"
      :aria-selected="onglet.slug === selected ? 'true' : 'false'"
      :aria-controls="idPanneau(onglet.slug)"
      :tabindex="onglet.slug === selected ? 0 : -1"
      @click="selectionner(index)"
    >
      <AppIcon :icone="onglet.icone" :taille="18" class="onglet-icone" />
      <span>{{ onglet.nom }}</span>
    </button>
  </div>
</template>

<style scoped>
.theme-tabs {
  position: sticky;
  top: var(--header-height);
  z-index: var(--z-sticky);
  display: flex;
  gap: var(--space-1);
  align-items: stretch;
  overflow-x: auto;
  padding: 0 var(--grid-margin-mobile);
  background: var(--surface-primary);
  border-bottom: 1px solid var(--border-subtle);
}

/* #213 — the tab row is centered in the bar (the audit: « le bouton devrait
   être centré sur la page »). These zero-width spacers absorb the free space
   via auto inline margins — collapsing to zero when the tabs overflow, so the
   overflow-x scroll keeps the first tab reachable (a plain
   justify-content: center would clip it out of reach). */
.theme-tabs::before {
  content: '';
  margin-inline: auto;
}

.theme-tabs::after {
  content: '';
  margin-inline: auto;
}

.onglet {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 52px;
  padding: 0 var(--space-4);
  border: 0;
  background: transparent;
  color: var(--text-secondary);
  font: var(--text-body-sm);
  cursor: pointer;
  white-space: nowrap;
  transition:
    color 200ms ease-in-out,
    background-color 200ms ease-in-out;
}

.onglet-icone {
  flex-shrink: 0;
}

/* The 2px underline — animated via transform: scaleX, never layout
   (DESIGN.md §6 + ui-elements.md §ThemeTabs). */
.onglet::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 2px;
  background: var(--brand-500);
  transform: scaleX(0);
  transform-origin: left;
  transition: transform 200ms ease-in-out;
}

.onglet:hover {
  background: var(--couleur-soft, var(--brand-50));
}

.onglet--selectionne {
  color: var(--couleur-strong, var(--brand-900));
  font-weight: 600;
}

.onglet--selectionne::after {
  background: var(--couleur-line, var(--brand-500));
  transform: scaleX(1);
}
</style>
