<script setup lang="ts">
/**
 * MapSidebar — the map's side panel (layouts.md §3): 360px, collapsible;
 * mobile → bottom sheet (transform-only, the `.bottom-sheet` recipe). Holds
 * the search (GlobalSearchBar — territoires prop), the mask-level controls
 * (synced with the map — a level without geometry is disabled, honest) and —
 * ADR-0019 — the LAYER SELECTOR: the active theme's full layer set
 * (couchesDuTheme's entrees, story scalar first, the multi-detail keys and
 * story-pool siblings as expandable groups). Clicking a layer emits
 * `couche-change`; the view owns the theme + level state.
 */
import { ChevronDown, Layers, SlidersHorizontal, X } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'

import AppIcon from '@/components/AppIcon.vue'
import GlobalSearchBar from '@/components/GlobalSearchBar.vue'
import MapLegend from '@/components/carte/MapLegend.vue'
import { useMediaQuery } from '@/composables/useMediaQuery'
import type { CoucheCarte, EntreeCouches } from '@/carte/coucheModel'
import type { NiveauMasque } from '@/geo/types'
import { NOMS_NIVEAUX } from '@/geo/types'
import type { Territoire } from '@/payload/types'

const props = defineProps<{
  territoires: Territoire[]
  niveau: NiveauMasque
  niveauxDisponibles: NiveauMasque[]
  /** The active tab's layer entries — the theme's layer set (couchesDuTheme)
   *  or the programmes layers (couchesProgrammes, #282). */
  entrees: EntreeCouches[]
  /** The active layer — null in Aperçu / neutral state. */
  coucheActive: CoucheCarte | null
  couleurs: string[]
  seuils: number[]
  estDivergente: boolean
  unite: string
  estPourcentage: boolean
  /** The map's neutral fill + outline — forwarded to the legend (issue #68). */
  couleurVide: string
  couleurContour: string
  /** The membership highlight — forwarded to the legend (#282). */
  couleurMembre: string
}>()

const emit = defineEmits<{
  (e: 'niveau-change', niveau: NiveauMasque): void
  (e: 'couche-change', couche: CoucheCarte): void
  /** La recherche a sélectionné un territoire — la carte zoome dessus et
   *  ouvre son popup (ADR-0019, #283) au lieu de naviguer vers la fiche. */
  (e: 'recherche-territoire', territoire: Territoire): void
}>()

const estMobile = useMediaQuery('(max-width: 768px)')
const ouverte = ref(!estMobile.value)

const fermee = computed(() => !ouverte.value)

/** The collapsed group indexes — the groups are open by default (the whole
 *  layer set is visible; the chevron folds a group). Reset when the theme
 *  changes (a new entrees array). */
const groupesReplies = ref<number[]>([])
watch(
  () => props.entrees,
  () => {
    groupesReplies.value = []
  },
)

function groupeReplie(index: number): boolean {
  return groupesReplies.value.includes(index)
}

function basculerGroupe(index: number): void {
  const position = groupesReplies.value.indexOf(index)
  if (position === -1) groupesReplies.value.push(index)
  else groupesReplies.value.splice(position, 1)
}

function estActive(couche: CoucheCarte): boolean {
  const active = props.coucheActive
  if (active === null || couche.source !== active.source) return false
  if (couche.source === 'membre') {
    return active.source === 'membre' && couche.sigle === active.sigle && couche.niveau === active.niveau
  }
  if (couche.source === 'subvention') return active.source === 'subvention'
  if (active.source === 'indicateur' || active.source === 'histoire') {
    return active.clef === couche.clef && active.detail === couche.detail
  }
  return false
}

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

function choisirCouche(couche: CoucheCarte): void {
  emit('couche-change', couche)
  if (estMobile.value) fermer()
}

/** La recherche (#283) : remonte le territoire sélectionné — la vue zoome la
 *  carte dessus. Même règle que les niveaux/couches : la feuille mobile se
 *  ferme, le panneau bureau reste pour continuer à interagir. */
function selectionnerTerritoire(territoire: Territoire): void {
  emit('recherche-territoire', territoire)
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
        sans-navigation
        class="carte-sidebar-recherche"
        @select="selectionnerTerritoire"
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

      <section class="carte-sidebar-section" aria-labelledby="carte-couches-titre">
        <h3 id="carte-couches-titre" class="carte-sidebar-section-titre">Couches</h3>
        <div v-if="entrees.length > 0" class="carte-sidebar-couches">
          <template v-for="(entree, index) in entrees" :key="index">
            <button
              v-if="entree.type === 'couche'"
              type="button"
              class="carte-sidebar-couche"
              :class="{ 'est-actif': estActive(entree.couche) }"
              :aria-pressed="estActive(entree.couche) ? 'true' : 'false'"
              @click="choisirCouche(entree.couche)"
            >
              {{ entree.couche.libelle }}
            </button>
            <div v-else class="carte-sidebar-groupe">
              <button
                type="button"
                class="carte-sidebar-groupe-titre"
                :aria-expanded="!groupeReplie(index) ? 'true' : 'false'"
                @click="basculerGroupe(index)"
              >
                <span>{{ entree.groupe.libelle }}</span>
                <AppIcon
                  :icone="ChevronDown"
                  :taille="14"
                  class="carte-sidebar-groupe-chevron"
                  :class="{ 'est-replie': groupeReplie(index) }"
                />
              </button>
              <div v-show="!groupeReplie(index)" class="carte-sidebar-groupe-couches">
                <button
                  v-for="couche in entree.groupe.couches"
                  :key="`${couche.source}-${couche.clef}-${couche.detail ?? ''}`"
                  type="button"
                  class="carte-sidebar-couche carte-sidebar-couche--groupee"
                  :class="{ 'est-actif': estActive(couche) }"
                  :aria-pressed="estActive(couche) ? 'true' : 'false'"
                  @click="choisirCouche(couche)"
                >
                  {{ couche.libelle }}
                </button>
              </div>
            </div>
          </template>
        </div>
        <p v-else class="carte-sidebar-couches-vide">
          Aucune couche d'indicateurs — les masques seuls.
        </p>
      </section>

      <MapLegend
        :niveau="niveau"
        :couche="coucheActive"
        :couleurs="couleurs"
        :seuils="seuils"
        :est-divergente="estDivergente"
        :unite="unite"
        :est-pourcentage="estPourcentage"
        :couleur-vide="couleurVide"
        :couleur-contour="couleurContour"
        :couleur-membre="couleurMembre"
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

/* ADR-0019 — the layer selector: the pill recipe of the mask levels, applied
   to the theme's layers; the grouped layers indent under their expandable
   group header. */
.carte-sidebar-couches {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.carte-sidebar-couche {
  min-height: 36px;
  padding: var(--space-2) var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-full);
  background: var(--surface-primary);
  color: var(--text-secondary);
  font: var(--text-body-sm);
  text-align: start;
  cursor: pointer;
}

.carte-sidebar-couche:hover {
  border-color: var(--brand-500);
}

.carte-sidebar-couche.est-actif {
  background: var(--brand-50);
  border-color: var(--brand-500);
  color: var(--brand-900);
  font-weight: 600;
}

.carte-sidebar-couche--groupee {
  margin-left: var(--space-4);
  padding-left: var(--space-3);
}

.carte-sidebar-groupe {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.carte-sidebar-groupe-titre {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  min-height: 36px;
  padding: var(--space-2) var(--space-3);
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-primary);
  font: var(--text-body-sm);
  font-weight: 600;
  text-align: start;
  cursor: pointer;
}

.carte-sidebar-groupe-titre:hover {
  background: var(--surface-tertiary);
}

.carte-sidebar-groupe-chevron {
  color: var(--text-tertiary);
  transition: transform 200ms ease-in-out;
}

.carte-sidebar-groupe-chevron.est-replie {
  transform: rotate(-90deg);
}

.carte-sidebar-couches-vide {
  margin: 0;
  font: var(--text-body-sm);
  color: var(--text-secondary);
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
