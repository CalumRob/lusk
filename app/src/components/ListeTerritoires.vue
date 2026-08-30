<script setup lang="ts">
/**
 * ListeTerritoires — the shared data-list view (layouts.md §4,
 * ui-elements.md §Table). One component, three pages: each view passes its
 * ConfigListe (type, titre, colonnes, filtres) and the payload renders
 * payload.territoires filtered to that type, sorted by name, as a link
 * directory to the fiches — no KPI columns, no computation (decision
 * 2026-08-03).
 *
 * The reference-only wait-set (issue #301, PRD #296 « la page d'abord ») :
 * these are pure reference directories — names, codes, EPCI/département
 * columns — so the page blocks on territories alone and never waits on theme
 * data, apercu, programmes or the run report (which keep loading in the
 * background, one fetch per session, and simply never gate this render).
 *
 * The département chips and the EPCI filter live in the URL query
 * (?departement=, ?epci= — shareable, back-button friendly, like ?theme= on
 * the fiche); the name search is local state (typing must not pollute the
 * URL). The sort is local too. States match the shell (TerritoireView):
 * skeleton while the payload loads, typed PayloadError with a Retry button,
 * honest empty state. Below 768px the table becomes stacked cards — the same
 * data, both rendered, CSS decides which is visible (display:none removes the
 * hidden one from the accessibility tree too).
 */
import { AlertCircle, ArrowUpDown, ChevronDown, ChevronRight, ChevronUp, SearchX } from 'lucide-vue-next'
import type { Component } from 'vue'
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import AppIcon from '@/components/AppIcon.vue'
import { lienFiche } from '@/fiche/contratExploration'
import type { CleColonne, ConfigListe } from '@/listes/listes'
import {
  TRI_PAR_DEFAUT,
  correspondAuNom,
  departementsPresent,
  epcisPourDepartement,
  filtrerParDepartement,
  filtrerParEpci,
  nomsEpci,
  territoiresDeType,
  trierTerritoires,
  valeurColonne,
} from '@/listes/listes'
import type { Territoire } from '@/payload/types'
import { usePayload } from '@/payload/usePayload'

const props = defineProps<{ config: ConfigListe }>()

const route = useRoute()
const router = useRouter()

// Le wait-set minimal : la page n'attend que la table de référence (#301).
const { payload, erreur, chargement, recharger } = usePayload({ attendre: ['territoires'] })

/** The name search — local state, deliberately not in the URL. */
const requete = ref('')

/** The active sort — local state, starts by name ascending (the contract). */
const tri = ref(TRI_PAR_DEFAUT)

/** The filters — the URL is the source of truth (shareable). */
const departementActif = computed(() =>
  typeof route.query.departement === 'string' ? route.query.departement : null,
)
const epciActif = computed(() =>
  typeof route.query.epci === 'string' ? route.query.epci : null,
)

/** The rows of this page's type — the payload seam is the only data source. */
const territoires = computed(() =>
  payload.value ? territoiresDeType(payload.value.territoires, props.config.type) : [],
)

const nomsEpciMap = computed(() =>
  payload.value ? nomsEpci(payload.value.territoires) : new Map<string, string>(),
)

/** The département chips, derived from the rows (22 · 29 · 35 · 56). */
const departements = computed(() => departementsPresent(territoires.value))

/** The EPCI filter's options — restricted to the selected département. */
const optionsEpci = computed(() => {
  const codes = epcisPourDepartement(territoires.value, departementActif.value)
  return codes
    .map((code) => ({ code, nom: nomsEpciMap.value.get(code) ?? code }))
    .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'))
})

/** The chain: type → département → EPCI → search. */
const apresFiltres = computed(() => {
  let lignes = filtrerParDepartement(territoires.value, departementActif.value)
  lignes = filtrerParEpci(lignes, epciActif.value)
  const requeteNettoyee = requete.value.trim()
  if (requeteNettoyee !== '') lignes = lignes.filter((t) => correspondAuNom(t, requeteNettoyee))
  return lignes
})

const lignes = computed(() => trierTerritoires(apresFiltres.value, tri.value, nomsEpciMap.value))

const aDesFiltres = computed(
  () =>
    departementActif.value !== null ||
    epciActif.value !== null ||
    requete.value.trim() !== '',
)

/** Which data columns this page's config carries (the mobile cards mirror them). */
const colonneEpci = computed(() => props.config.colonnes.some((c) => c.cle === 'epci'))
const colonneDepartement = computed(() => props.config.colonnes.some((c) => c.cle === 'departement'))

/** The display value of a cell — an empty column value renders as an em dash. */
function valeurCellule(t: Territoire, cle: CleColonne): string {
  const valeur = valeurColonne(t, cle, nomsEpciMap.value)
  return valeur === '' ? '—' : valeur
}

function basculerTri(cle: CleColonne): void {
  tri.value =
    tri.value.cle === cle
      ? { cle, sens: tri.value.sens === 'asc' ? 'desc' : 'asc' }
      : { cle, sens: 'asc' }
}

/** aria-sort: the ARIA values, not the internal short forms. */
function ariaSort(cle: CleColonne): 'none' | 'ascending' | 'descending' {
  if (tri.value.cle !== cle) return 'none'
  return tri.value.sens === 'asc' ? 'ascending' : 'descending'
}

/** The header icon: muted for inactive columns, the chevron for the active one. */
function iconeTri(cle: CleColonne): Component {
  if (tri.value.cle !== cle) return ArrowUpDown
  return tri.value.sens === 'asc' ? ChevronUp : ChevronDown
}

function choisirDepartement(code: string): void {
  const nouveau = departementActif.value === code ? null : code
  const query: Record<string, string> = {}
  for (const [cle, valeur] of Object.entries(route.query)) {
    if (typeof valeur === 'string') query[cle] = valeur
  }
  if (nouveau) query.departement = nouveau
  else delete query.departement
  // An EPCI that no commune of the new département contains would render an
  // empty list — a dead-end filter, so it is dropped rather than offered.
  if (query.epci && !epcisPourDepartement(territoires.value, nouveau).includes(query.epci)) {
    delete query.epci
  }
  router.replace({ query })
}

function choisirEpci(code: string): void {
  const query: Record<string, string> = {}
  for (const [cle, valeur] of Object.entries(route.query)) {
    if (typeof valeur === 'string') query[cle] = valeur
  }
  if (code) query.epci = code
  else delete query.epci
  router.replace({ query })
}
</script>

<template>
  <section class="liste" :aria-busy="chargement ? 'true' : 'false'">
    <div class="liste-contenu">
      <div
        v-if="chargement"
        class="liste-chargement"
        role="status"
        aria-label="Chargement de la liste"
      >
        <div class="squelette squelette--titre" />
        <div class="squelette squelette--ligne" />
        <div class="squelette squelette--ligne" />
        <div class="squelette squelette--ligne" />
        <div class="squelette squelette--ligne" />
      </div>

      <div v-else-if="erreur" class="etat-erreur">
        <AppIcon :icone="AlertCircle" :taille="28" class="etat-icone" />
        <p class="etat-texte">Impossible de charger les données de la liste.</p>
        <button type="button" class="bouton-reessayer" @click="recharger">Réessayer</button>
      </div>

      <template v-else>
        <nav class="fil-ariane" aria-label="Fil d’ariane">
          <RouterLink to="/">Accueil</RouterLink>
          <AppIcon :icone="ChevronRight" :taille="14" class="fil-ariane-separateur" />
          <span aria-current="page">{{ config.titre }}</span>
        </nav>

        <h1 class="liste-titre">{{ config.titre }}</h1>

        <div class="liste-controles">
          <label class="recherche">
            <span class="controle-libelle">Rechercher</span>
            <input
              v-model="requete"
              type="search"
              class="recherche-champ"
              :placeholder="config.placeholderRecherche"
            />
          </label>

          <fieldset v-if="config.filtreDepartement" class="filtres-departement">
            <legend class="controle-libelle">Département</legend>
            <div class="filtres-puces">
              <button
                v-for="code in departements"
                :key="code"
                type="button"
                class="puce"
                :class="{ 'puce--active': departementActif === code }"
                :aria-pressed="departementActif === code ? 'true' : 'false'"
                @click="choisirDepartement(code)"
              >{{ code }}</button>
            </div>
          </fieldset>

          <label v-if="config.filtreEpci" class="filtre-epci">
            <span class="controle-libelle">EPCI</span>
            <select
              class="filtre-epci-select"
              :value="epciActif ?? ''"
              @change="choisirEpci(($event.target as HTMLSelectElement).value)"
            >
              <option value="">Tous les EPCI</option>
              <option v-for="opt in optionsEpci" :key="opt.code" :value="opt.code">
                {{ opt.nom }}
              </option>
            </select>
          </label>
        </div>

        <table v-if="lignes.length > 0" class="liste-tableau">
          <caption class="visuellement-cache">{{ config.titre }}</caption>
          <thead>
            <tr>
              <th
                v-for="col in config.colonnes"
                :key="col.cle"
                scope="col"
                :aria-sort="col.triable ? ariaSort(col.cle) : undefined"
              >
                <button
                  v-if="col.triable"
                  type="button"
                  class="entete-tri"
                  :class="{ 'entete-tri--actif': tri.cle === col.cle }"
                  :aria-label="`Trier par ${col.libelle}`"
                  @click="basculerTri(col.cle)"
                >
                  {{ col.libelle }}
                  <AppIcon :icone="iconeTri(col.cle)" :taille="14" class="entete-tri-icone" />
                </button>
                <span v-else>{{ col.libelle }}</span>
              </th>
              <th scope="col" class="colonne-actions">
                <span class="visuellement-cache">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in lignes" :key="t.territoire">
              <td v-for="col in config.colonnes" :key="col.cle" :class="'cellule-' + col.cle">
                <RouterLink v-if="col.cle === 'nom'" :to="lienFiche(t)" class="lien-fiche">
                  {{ t.nom }}
                </RouterLink>
                <template v-else>{{ valeurCellule(t, col.cle) }}</template>
              </td>
              <td class="colonne-actions">
                <!-- #410 : plus aucun lien « Explorer sur la carte » — la
                     carte reste routée (ruling PO 2026-08-26) mais sans lien
                     face-utilisateur ; l'exploration spatiale d'un indicateur
                     vit sur SA Page d'indicateur (vue Carte). -->
                <RouterLink :to="lienFiche(t)" class="action">Voir la fiche</RouterLink>
              </td>
            </tr>
          </tbody>
        </table>

        <ul v-if="lignes.length > 0" class="liste-cartes">
          <li v-for="t in lignes" :key="t.territoire" class="carte">
            <RouterLink :to="lienFiche(t)" class="carte-lien">
              <span class="carte-nom">{{ t.nom }}</span>
              <span class="carte-code">{{ t.territoire }}</span>
              <span v-if="colonneEpci" class="carte-epci">{{ valeurCellule(t, 'epci') }}</span>
              <span v-if="colonneDepartement" class="carte-departement">
                Département {{ valeurCellule(t, 'departement') }}
              </span>
            </RouterLink>
            <div class="carte-actions">
              <RouterLink :to="lienFiche(t)">Voir la fiche</RouterLink>
            </div>
          </li>
        </ul>

        <div v-else class="etat-vide">
          <AppIcon :icone="SearchX" :taille="28" class="etat-icone" />
          <p class="etat-texte">{{ config.libelleVide }}</p>
          <p v-if="aDesFiltres" class="etat-hint">Élargissez votre recherche ou retirez les filtres.</p>
        </div>
      </template>
    </div>
  </section>
</template>

<style scoped>
.liste {
  flex: 1;
  background: var(--surface-secondary);
}

.liste-contenu {
  width: 100%;
  max-width: var(--content-max-width);
  margin-inline: auto;
  padding: var(--space-8) var(--grid-margin-mobile) var(--space-12);
}

.fil-ariane {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-6);
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
  color: var(--text-tertiary);
}

.fil-ariane a {
  color: var(--text-secondary);
}

.fil-ariane [aria-current='page'] {
  color: var(--text-primary);
}

.fil-ariane-separateur {
  color: var(--text-tertiary);
}

.liste-titre {
  margin: 0 0 var(--space-6);
  font: var(--text-h1);
  letter-spacing: var(--text-h1-tracking);
}

.liste-controles {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--space-4) var(--space-6);
  margin-bottom: var(--space-6);
}

.controle-libelle {
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
  color: var(--text-secondary);
}

.recherche,
.filtres-departement,
.filtre-epci {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
}

.recherche {
  flex: 1 1 260px;
  max-width: 420px;
}

.filtres-departement {
  margin: 0;
  padding: 0;
  border: 0;
}

.filtres-puces {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.puce {
  min-width: 44px;
  height: 36px;
  padding: 0 var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-full);
  background: var(--surface-primary);
  color: var(--text-primary);
  font: var(--text-body-sm);
  font-weight: 600;
  cursor: pointer;
  transition:
    background-color 150ms ease-out,
    border-color 150ms ease-out;
}

.puce:hover {
  background: var(--surface-tertiary);
  border-color: var(--brand-500);
}

.puce--active,
.puce--active:hover {
  background: var(--brand-600);
  border-color: var(--brand-600);
  color: #ffffff;
}

.recherche-champ,
.filtre-epci-select {
  height: 40px;
  padding: 0 var(--space-3);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--surface-primary);
  color: var(--text-primary);
  font: var(--text-body-sm);
}

.recherche-champ:focus-visible,
.filtre-epci-select:focus-visible {
  outline: var(--focus-ring);
  outline-offset: 2px;
}

.filtre-epci-select {
  min-width: 240px;
}

/* ---- Le tableau (ui-elements.md §Table) ---- */
.liste-tableau {
  width: 100%;
  border-collapse: collapse;
  background: var(--surface-primary);
  border: 1px solid var(--border-subtle);
}

.liste-tableau thead th {
  padding: var(--space-3) var(--space-4);
  background: var(--surface-tertiary);
  border-bottom: 1px solid var(--border-default);
  color: var(--text-primary);
  font: var(--text-body-sm);
  font-weight: 700;
  text-align: left;
}

.liste-tableau tbody td {
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border-subtle);
  font: var(--text-body-sm);
}

.liste-tableau tbody tr {
  transition: background-color 100ms ease-out;
}

.liste-tableau tbody tr:hover {
  background: var(--surface-tertiary);
}

.entete-tri {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.entete-tri:hover {
  color: var(--brand-600);
}

.entete-tri--actif {
  color: var(--text-primary);
}

.entete-tri-icone {
  color: var(--text-tertiary);
}

.entete-tri--actif .entete-tri-icone {
  color: var(--brand-500);
}

.cellule-code {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.cellule-epci,
.cellule-departement {
  color: var(--text-secondary);
}

.lien-fiche {
  font-weight: 600;
}

.colonne-actions {
  /* Une seule action par ligne depuis le retrait du lien carte (#410) :
     l'alignement à droite + nowrap suffisent, plus besoin de conteneur flex. */
  text-align: right;
  white-space: nowrap;
}

.action {
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
  font-weight: 600;
}

/* ---- Les cartes mobiles (<768px) — same data, stacked ---- */
.liste-cartes {
  display: none;
  margin: 0;
  padding: 0;
  list-style: none;
  flex-direction: column;
  gap: var(--space-4);
}

.carte {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  background: var(--surface-primary);
  box-shadow: var(--shadow-default);
}

.carte-lien {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  color: var(--text-primary);
}

.carte-nom {
  font: var(--text-body-lg);
  font-weight: 600;
}

.carte-code {
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}

.carte-epci,
.carte-departement {
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
  color: var(--text-secondary);
}

.carte-actions {
  display: flex;
  gap: var(--space-4);
  margin-top: var(--space-2);
}

.carte-actions a {
  font: var(--text-body-sm);
  font-weight: 600;
}

@media (max-width: 767.98px) {
  .liste-tableau {
    display: none;
  }

  .liste-cartes {
    display: flex;
  }
}

/* ---- Les états (ui-elements.md §Loading/empty/error) ---- */
.liste-chargement {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-8) 0;
}

.squelette--titre {
  width: 40%;
  height: 2.25rem;
}

.squelette--ligne {
  width: 100%;
  height: 1rem;
}

.etat-erreur,
.etat-vide {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-16) var(--space-6);
  text-align: center;
}

.etat-icone {
  color: var(--text-tertiary);
}

.etat-texte {
  margin: 0;
  color: var(--text-secondary);
  font: var(--text-body-lg);
}

.etat-hint {
  margin: 0;
  color: var(--text-tertiary);
  font: var(--text-body-sm);
}

.bouton-reessayer {
  height: 36px;
  padding: 0 var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--surface-primary);
  color: var(--text-primary);
  font: var(--text-body-sm);
  font-weight: 600;
  box-shadow: var(--shadow-subtle);
  cursor: pointer;
}

.bouton-reessayer:hover {
  background: var(--surface-tertiary);
  border-color: var(--brand-500);
}

/* Visually hidden, kept in the a11y tree (the Actions column label). */
.visuellement-cache {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
</style>
