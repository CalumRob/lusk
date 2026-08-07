<script setup lang="ts">
/**
 * MapSidebar — the map's side panel (layouts.md §3): 360px, collapsible;
 * mobile → bottom sheet (transform-only, the `.bottom-sheet` recipe). Holds
 * the search (GlobalSearchBar — territoires prop), the mask-level controls
 * (synced with the map — a level without geometry is disabled, honest) and
 * the legend. The theme state lives in the view (ThemeTabs + ?theme=); this
 * panel only emits the chosen mask level.
 */
import { Layers, SlidersHorizontal, X } from 'lucide-vue-next'
import { computed, ref } from 'vue'

import AppIcon from '@/components/AppIcon.vue'
import GlobalSearchBar from '@/components/GlobalSearchBar.vue'
import MapLegend from '@/components/carte/MapLegend.vue'
import { useMediaQuery } from '@/composables/useMediaQuery'
import type { ConfigCouche } from '@/carte/configCouche'
import type { NiveauMasque } from '@/geo/types'
import { NOMS_NIVEAUX } from '@/geo/types'
import type { Territoire } from '@/payload/types'

const props = defineProps<{
  territoires: Territoire[]
  niveau: NiveauMasque
  niveauxDisponibles: NiveauMasque[]
  config: ConfigCouche | null
  couleurs: string[]
  seuils: number[]
  unite: string
  estPourcentage: boolean
  /** The map's neutral fill + outline — forwarded to the legend (issue #68). */
  couleurVide: string
  couleurContour: string
}>()

const emit = defineEmits<{
  (e: 'niveau-change', niveau: NiveauMasque): void
}>()

const estMobile = useMediaQuery('(max-width: 768px)')
const ouverte = ref(!estMobile.value)

const fermee = computed(() => !ouverte.value)

function ouvrir(): void {
  ouverte.value = true
}

function fermer(): void {
  ouverte.value = false
}

function choisirNiveau(niveau: NiveauMasque): void {
  emit('niveau-change', niveau)
  if (estMobile.value) fermer()
}
</script>

<template>
  <button
    v-if="fermee"
    type="button"
    class="carte-sidebar-rouvrir"
    aria-label="Ouvrir les options de la carte"
    @click="ouvrir"
  >
    <AppIcon :icone="SlidersHorizontal" :taille="20" />
  </button>

  <div
    v-if="fermee && estMobile"
    class="carte-sidebar-fond"
    aria-hidden="true"
    @click="fermer"
  />

  <aside
    class="carte-sidebar"
    :class="{ 'carte-sidebar--ouverte': ouverte }"
    :aria-hidden="fermee ? 'true' : 'false'"
    :aria-label="'Options de la carte'"
  >
    <header class="carte-sidebar-entete">
      <h2 class="carte-sidebar-titre">
        <AppIcon :icone="Layers" :taille="18" class="carte-sidebar-icone" />
        Carte
      </h2>
      <button
        type="button"
        class="carte-sidebar-fermer"
        aria-label="Fermer les options de la carte"
        @click="fermer"
      >
        <AppIcon :icone="X" :taille="18" />
      </button>
    </header>

    <div class="carte-sidebar-corps">
      <GlobalSearchBar
        :territoires="territoires"
        :chargement="false"
        :erreur="null"
        class="carte-sidebar-recherche"
        @select="fermer"
      />

      <section class="carte-sidebar-section" aria-labelledby="carte-niveaux-titre">
        <h3 id="carte-niveaux-titre" class="carte-sidebar-section-titre">Niveau de masque</h3>
        <div class="carte-sidebar-niveaux" role="radiogroup" aria-label="Niveau de masque">
          <button
            v-for="niveau in niveauxDisponibles"
            :key="niveau"
            type="button"
            role="radio"
            class="carte-sidebar-niveau"
            :class="{ 'est-actif': niveau === props.niveau }"
            :aria-checked="niveau === props.niveau ? 'true' : 'false'"
            @click="choisirNiveau(niveau)"
          >
            {{ NOMS_NIVEAUX[niveau] }}
          </button>
        </div>
        <p
          v-if="niveauxDisponibles.length < 3"
          class="carte-sidebar-note"
        >
          Les niveaux sans géométrie sont indisponibles (fonds de carte à publier).
        </p>
      </section>

      <MapLegend
        :niveau="niveau"
        :config="config"
        :couleurs="couleurs"
        :seuils="seuils"
        :unite="unite"
        :est-pourcentage="estPourcentage"
        :couleur-vide="couleurVide"
        :couleur-contour="couleurContour"
      />
    </div>
  </aside>
</template>

<style scoped>
.carte-sidebar {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 360px;
  max-width: 100%;
  flex-shrink: 0;
  background: var(--surface-secondary);
  border-left: 1px solid var(--border-subtle);
  overflow-y: auto;
  transition: transform 300ms cubic-bezier(0.16, 1, 0.3, 1);
}

.carte-sidebar-entete {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-4);
  border-bottom: 1px solid var(--border-subtle);
  background: var(--surface-primary);
}

.carte-sidebar-titre {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  font: var(--text-h3);
}

.carte-sidebar-icone {
  color: var(--accent-primary);
}

.carte-sidebar-fermer {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.carte-sidebar-fermer:hover {
  background: var(--surface-tertiary);
  color: var(--text-primary);
}

.carte-sidebar-corps {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  padding: var(--space-4);
}

.carte-sidebar-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.carte-sidebar-section-titre {
  margin: 0;
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
  text-transform: uppercase;
  color: var(--text-secondary);
}

.carte-sidebar-niveaux {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.carte-sidebar-niveau {
  min-height: 36px;
  padding: var(--space-2) var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-full);
  background: var(--surface-primary);
  color: var(--text-secondary);
  font: var(--text-body-sm);
  cursor: pointer;
}

.carte-sidebar-niveau:hover {
  border-color: var(--brand-500);
}

.carte-sidebar-niveau.est-actif {
  background: var(--brand-50);
  border-color: var(--brand-500);
  color: var(--brand-900);
  font-weight: 600;
}

.carte-sidebar-note {
  margin: 0;
  font: var(--text-caption);
  color: var(--text-tertiary);
}

.carte-sidebar-rouvrir {
  position: absolute;
  z-index: var(--z-sticky);
  top: var(--space-4);
  right: var(--space-4);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--surface-primary);
  box-shadow: var(--shadow-default);
  color: var(--text-primary);
  cursor: pointer;
}

.carte-sidebar-fond {
  position: fixed;
  inset: 0;
  z-index: var(--z-overlay);
  background: rgba(0, 0, 0, 0.4);
}

/* Mobile → bottom sheet (transform-only, 300ms — ui-elements.md §Map shell). */
@media (max-width: 768px) {
  .carte-sidebar {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    top: auto;
    z-index: var(--z-drawer);
    width: 100%;
    max-height: 85vh;
    border-left: 0;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    background: var(--surface-primary);
    transform: translateY(100%);
    box-shadow: var(--shadow-prominent);
  }

  .carte-sidebar--ouverte {
    transform: translateY(0);
  }
}
</style>
