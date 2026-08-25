<script setup lang="ts">
/**
 * GlobalSearchBar — the way into any fiche (ui-elements.md §Search).
 * A single, untitled search box (#64): the input + results dropdown, no tabs
 * row — the placeholder carries the affordance. It searches the territoires
 * reference table (payload.territoires) by name and opens
 * /territoire/:type/:id.
 *
 * States (ui-elements.md): rest / focus / typing (debounced) / loading
 * (spinner) / empty ("Aucun résultat trouvé.") / error (muted text + icon).
 * Keyboard: arrows move the active option (aria-activedescendant), Enter
 * opens it, Escape closes, Tab exits to the page (WAI-ARIA combobox pattern).
 *
 * Props: territoires (the reference table, from the host's loaded payload),
 * indicateurs (OPTIONAL — the catalogue entries, #409: when provided the
 * results are GROUPED « Territoires » + « Indicateurs » with one flat
 * keyboard list across both sections; absent — home hero and carte — the
 * search stays territory-only), chargement + erreur (optional host-driven
 * payload states). Emits: select with the opened Territoire, and
 * select-indicateur (#409) when a catalogue entry is activated (the host hook
 * closes the overlay/drawer). sansNavigation (#283): the carte's search — the
 * results are rows (buttons, not RouterLinks) and selecting emits select
 * WITHOUT navigating to the fiche; the host (CarteView) zooms the map on the
 * territory instead.
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { CircleAlert, Loader2, Search, SearchX, X } from 'lucide-vue-next'

import type { Territoire } from '../payload/types'
import GlobalSearchOptionRecherche from './GlobalSearchOptionRecherche.vue'
import {
  rechercherIndicateurs,
  rechercherTerritoires,
} from '../search/recherche'
import type { EntreeRechercheIndicateur } from '../search/recherche'

const props = withDefaults(
  defineProps<{
    territoires: Territoire[]
    /** Les entrées du catalogue (#409) — présentes ⇒ résultats groupés. */
    indicateurs?: EntreeRechercheIndicateur[]
    chargement?: boolean
    erreur?: string | null
    /** Mode sans navigation (#283) : les résultats émettent select sans
     *  router.push — la carte zoome sur l'entité au lieu d'ouvrir la fiche. */
    sansNavigation?: boolean
  }>(),
  { chargement: false, erreur: null, sansNavigation: false, indicateurs: undefined },
)

const emit = defineEmits<{
  select: [territoire: Territoire]
  'select-indicateur': [entree: EntreeRechercheIndicateur]
}>()

const router = useRouter()

const DUREE_DEBOUNCE = 250

const requete = ref('')
const debouncee = ref('')
const enAttente = ref(false)
const focusDansChamp = ref(false)
const actif = ref(-1)

let minuteur: ReturnType<typeof setTimeout> | null = null

const resultatsTerritoires = computed(() => rechercherTerritoires(props.territoires, debouncee.value))
const resultatsIndicateurs = computed(() =>
  props.indicateurs ? rechercherIndicateurs(props.indicateurs, debouncee.value) : [],
)
/** Le mode groupé (#409) : la prop indique que l'hôte veut les deux groupes. */
const groupee = computed(() => props.indicateurs !== undefined)
/** La liste PLATE des options — le clavier traverse les deux groupes. */
type Option =
  | { genre: 'territoire'; territoire: Territoire }
  | { genre: 'indicateur'; entree: EntreeRechercheIndicateur }
const resultats = computed<Option[]>(() => [
  ...resultatsTerritoires.value.map((territoire): Option => ({ genre: 'territoire', territoire })),
  ...resultatsIndicateurs.value.map((entree): Option => ({ genre: 'indicateur', entree })),
])
/** L'index global de la première option Indicateurs — la couture du clavier. */
const decalageIndicateurs = computed(() => resultatsTerritoires.value.length)
const chargementVisuel = computed(() => enAttente.value || props.chargement)
const ouvert = computed(
  () => focusDansChamp.value && (debouncee.value.trim() !== '' || props.erreur !== null),
)

watch(requete, (nouvelle) => {
  if (minuteur) clearTimeout(minuteur)
  actif.value = -1
  if (nouvelle === '') {
    enAttente.value = false
    debouncee.value = ''
    return
  }
  enAttente.value = true
  minuteur = setTimeout(() => {
    debouncee.value = nouvelle
    enAttente.value = false
  }, DUREE_DEBOUNCE)
})

onBeforeUnmount(() => {
  if (minuteur) clearTimeout(minuteur)
})

function descendre() {
  if (resultats.value.length === 0) return
  actif.value = (actif.value + 1) % resultats.value.length
  faireDefiler(actif.value)
}

function monter() {
  if (resultats.value.length === 0) return
  if (actif.value < 0) {
    actif.value = resultats.value.length - 1
  } else {
    actif.value = (actif.value - 1 + resultats.value.length) % resultats.value.length
  }
  faireDefiler(actif.value)
}

function faireDefiler(index: number) {
  void nextTick(() => {
    document.getElementById(`gsb-option-${index}`)?.scrollIntoView({ block: 'nearest' })
  })
}

function surKeydown(e: KeyboardEvent) {
  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault()
      descendre()
      break
    case 'ArrowUp':
      e.preventDefault()
      monter()
      break
    case 'Enter':
      e.preventDefault()
      ouvrirActif()
      break
    case 'Escape':
      e.preventDefault()
      fermer()
      break
    case 'Tab':
      fermer()
      break
  }
}

function ouvrirActif() {
  if (resultats.value.length === 0) return
  const cible = actif.value >= 0 ? resultats.value[actif.value]! : resultats.value[0]!
  if (cible.genre === 'territoire') {
    activer(cible.territoire)
  } else {
    // Une entrée Indicateur (#409) : navigation vers SA page, l'hôte ferme
    // son overlay via select-indicateur.
    emit('select-indicateur', cible.entree)
    reinitialiser()
    if (!props.sansNavigation) {
      void router.push(cible.entree.href)
    }
  }
}

function surSelection(t: Territoire) {
  // RouterLink carries the navigation; the row action just hooks the host.
  emit('select', t)
  reinitialiser()
}

/** L'activation d'une entrée Indicateur (#409) — l'hôte ferme son overlay. */
function surSelectionIndicateur(entree: EntreeRechercheIndicateur) {
  emit('select-indicateur', entree)
  reinitialiser()
  if (!props.sansNavigation) {
    void router.push(entree.href)
  }
}

function activer(t: Territoire) {
  emit('select', t)
  reinitialiser()
  if (!props.sansNavigation) {
    void router.push({ name: 'territoire', params: { type: t.type, id: t.territoire } })
  }
}

function reinitialiser() {
  if (minuteur) clearTimeout(minuteur)
  minuteur = null
  requete.value = ''
  debouncee.value = ''
  enAttente.value = false
  actif.value = -1
  focusDansChamp.value = false
}

function effacer() {
  requete.value = ''
}

function fermer() {
  focusDansChamp.value = false
  actif.value = -1
}

function surFocusout(e: FocusEvent) {
  const cible = e.currentTarget as Node | null
  const prochain = e.relatedTarget as Node | null
  if (prochain === null || !cible?.contains(prochain)) fermer()
}
</script>

<template>
  <div class="global-search" @focusout="surFocusout">
    <div class="global-search__bar">
      <Search class="global-search__icone" aria-hidden="true" />
      <input
        v-model="requete"
        class="global-search__champ"
        type="text"
        role="combobox"
        :aria-expanded="ouvert"
        aria-autocomplete="list"
        aria-controls="gsb-resultats"
        :aria-activedescendant="actif >= 0 ? `gsb-option-${actif}` : undefined"
        aria-label="Rechercher un territoire par son nom"
        placeholder="Rechercher un territoire…"
        @focus="focusDansChamp = true"
        @keydown="surKeydown"
      />
      <Loader2 v-if="chargementVisuel" class="global-search__spinner" aria-hidden="true" />
      <button
        v-else-if="requete"
        type="button"
        class="global-search__effacer"
        aria-label="Effacer la recherche"
        @click="effacer"
      >
        <X aria-hidden="true" />
      </button>
    </div>

    <div
      v-if="ouvert"
      id="gsb-panel"
      class="global-search__dropdown"
      @mousedown.prevent
    >
      <div
        v-if="resultats.length > 0"
        id="gsb-resultats"
        class="global-search__resultats"
        role="listbox"
        aria-label="Résultats"
      >
        <!-- Le mode groupé (#409) : « Territoires » puis « Indicateurs » — les
             ids d'options restent la LISTE PLATE (gsb-option-N) pour que le
             clavier traverse les deux groupes sans couture. -->
        <template v-if="groupee">
          <div
            v-if="resultatsTerritoires.length > 0"
            role="group"
            aria-label="Territoires"
          >
            <GlobalSearchOptionRecherche
              v-for="(resultat, i) in resultatsTerritoires"
              :id="`gsb-option-${i}`"
              :key="resultat.territoire"
              genre="territoire"
              :resultat="resultat"
              :actif="actif === i"
              :sans-navigation="props.sansNavigation"
              @click="surSelection(resultat)"
            />
          </div>
          <div
            v-if="resultatsIndicateurs.length > 0"
            role="group"
            aria-label="Indicateurs"
          >
            <GlobalSearchOptionRecherche
              v-for="(entree, j) in resultatsIndicateurs"
              :id="`gsb-option-${decalageIndicateurs + j}`"
              :key="entree.href"
              genre="indicateur"
              :entree="entree"
              :actif="actif === decalageIndicateurs + j"
              @click="surSelectionIndicateur(entree)"
            />
          </div>
        </template>

        <!-- Le mode territoire-only (héros de l'accueil, recherche de la
             carte #283) — le comportement historique, inchangé. -->
        <template v-else>
          <GlobalSearchOptionRecherche
            v-for="(resultat, i) in resultatsTerritoires"
            :id="`gsb-option-${i}`"
            :key="resultat.territoire"
            genre="territoire"
            :resultat="resultat"
            :actif="actif === i"
            :sans-navigation="props.sansNavigation"
            @click="surSelection(resultat)"
          />
        </template>
      </div>
      <p v-else-if="props.erreur" class="global-search__etat global-search__etat--erreur">
        <CircleAlert aria-hidden="true" />
        <span>{{ props.erreur }}</span>
      </p>
      <p v-else class="global-search__etat">
        <SearchX aria-hidden="true" />
        <span>Aucun résultat trouvé.</span>
      </p>
    </div>
  </div>
</template>

<style scoped>
.global-search {
  position: relative;
  width: 100%;
  max-width: 560px;
}

/* ---- Input bar ---- */
.global-search__bar {
  position: relative;
  display: flex;
  align-items: center;
  min-height: 48px;
  background: var(--surface-primary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-subtle);
  transition: border-color 120ms ease-out, box-shadow 120ms ease-out;
}

.global-search__bar:focus-within {
  border-color: var(--brand-500);
  box-shadow: 0 0 0 2px var(--brand-500);
}

.global-search__icone {
  width: 1.125rem;
  height: 1.125rem;
  margin-left: var(--space-3);
  color: var(--text-secondary);
  flex-shrink: 0;
}

.global-search__champ {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  font: var(--text-body);
  color: var(--text-primary);
  padding: var(--space-2) var(--space-3);
  outline: none;
}

.global-search__champ::placeholder {
  color: var(--text-tertiary);
}

.global-search__spinner {
  width: 1rem;
  height: 1rem;
  margin-inline: var(--space-3);
  color: var(--text-tertiary);
  flex-shrink: 0;
  animation: gsb-rotation 0.8s linear infinite;
}

@keyframes gsb-rotation {
  to {
    transform: rotate(360deg);
  }
}

.global-search__effacer {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  margin-inline: var(--space-2);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background-color 120ms ease-out, color 120ms ease-out;
}

.global-search__effacer:hover {
  background: var(--surface-tertiary);
  color: var(--text-primary);
}

.global-search__effacer svg {
  width: 1rem;
  height: 1rem;
}

/* ---- Dropdown ---- */
.global-search__dropdown {
  position: absolute;
  top: calc(100% + var(--space-2));
  left: 0;
  right: 0;
  z-index: var(--z-popover);
  background: var(--surface-elevated);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-prominent);
  max-height: 320px;
  overflow-y: auto;
  animation: gsb-apparition 200ms ease-in-out;
}

@keyframes gsb-apparition {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.global-search__resultats {
  padding: var(--space-1);
}

/* Les styles des lignes d'option voyagent avec le fragment partagé
   (GlobalSearchOptionRecherche) — aucun doublon ici. */

/* ---- Empty / error states ---- */
.global-search__etat {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  padding: var(--space-4);
  font: var(--text-body-sm);
  color: var(--text-secondary);
}

.global-search__etat--erreur {
  color: var(--status-error);
}

.global-search__etat svg {
  width: 1rem;
  height: 1rem;
  flex-shrink: 0;
}
</style>
