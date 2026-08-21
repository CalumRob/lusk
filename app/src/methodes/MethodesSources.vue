<script setup lang="ts">
/**
 * La table des sources de /methodologie (layouts.md §5, issue #128): une
 * ligne par jeu de données du registre Méthodes — l'en-tête porte les faits
 * éditoriaux (nom, éditeur, thèmes, URL), les lignes vintage imbriquées
 * portent le libellé éditorial et les faits de fraîcheur (version, licence,
 * dates) rejoints en direct à la table vintages (sourcesMethodes, le seam du
 * payload) — la granularité jeu de données d'ADR-0022. Un jeu dont les lignes
 * vintage partagent la même fraîcheur de publication se replie sur son
 * en-tête seul (DVF : 20 lignes, une publication) ; des faits distincts
 * (OCS-GE : les millésimes par département) restent des lignes visibles —
 * les replier mentirait sur la donnée. Ordre du registre = ordre de la
 * table. Le shell à onglets (#332) filtre via la prop `themes` — l'onglet
 * Sources · <thème> montre les jeux qui alimentent ce thème (un jeu
 * multi-thèmes apparaît sous chacun de ses thèmes, jamais d'onglet « Tous »).
 * Chaque en-tête de jeu porte la matrice indicateur ↔ source (issue #336) :
 * les indicateurs qui consomment le jeu, liés à leur documentation
 * (#indicateur-<clef>) — filtrés par l'onglet de thème (un onglet ne montre
 * que les indicateurs de SON thème), et un jeu sans consommateur documenté
 * dit « Aucun indicateur ne cite ce jeu » — jamais une liste inventée.
 * Au-dessous de 768px la table se superpose en lignes empilées (mêmes
 * cellules, CSS seul — la table partagée SourcesTable).
 *
 * États (ui-elements.md): squelette pendant le chargement, erreur typée avec
 * Réessayer, état vide honnête quand vintages.json est absent (404) — la page
 * ne casse jamais. Un jeu sans ligne vintages en direct rend ses faits
 * éditoriaux et un tiret pour la fraîcheur, jamais une date inventée.
 */
import { AlertCircle } from 'lucide-vue-next'
import { computed } from 'vue'

import AppIcon from '@/components/AppIcon.vue'
import { NOMS_THEMES } from '@/fiche/onglets'
import { ancreIndicateur } from '@/methodes/indicateurs'
import type { IndicateurConsommateur } from '@/methodes/indicateurs'
import { ancreSource } from '@/methodes/sources'
import SourcesTable from '@/methodes/SourcesTable.vue'
import type { ColonneTableSources, LigneTableSources } from '@/methodes/SourcesTable.vue'
import { sourceRecords, sourcesMethodes } from '@/payload/selectors'
import type { Theme } from '@/payload/types'
import { usePayload } from '@/payload/usePayload'

const props = defineProps<{
  /** Les thèmes dont les sources sont à montrer — le filtre de l'onglet
   *  Sources · <thème> ; absent = tout le registre. */
  themes?: readonly Theme[]
}>()

const { payload, erreur, chargement, recharger } = usePayload()

const table = computed(() => (payload.value ? sourcesMethodes(payload.value) : null))

const jeux = computed(() => {
  const tous = table.value?.jeux ?? []
  const filtre = props.themes
  return filtre ? tous.filter((jeu) => jeu.themes.some((t) => filtre.includes(t))) : tous
})

/** La matrice dataset → indicateurs (issue #336) — la jointure inverse du lien « Source ». */
const authority = computed(() => payload.value ? sourceRecords(payload.value, { includeUnpublished: true }) : [])

/** Les indicateurs du jeu — filtrés par l'onglet de thème (un onglet ne montre
 *  que les indicateurs de SON thème, jamais ceux des autres). */
function indicateursDuJeu(idJeu: string): readonly IndicateurConsommateur[] | null {
  const consommateurs = authority.value.find((record) => record.id === idJeu)?.consumers ?? []
  const filtre = props.themes
  const visibles = filtre ? consommateurs.filter((c) => filtre.includes(c.theme)) : consommateurs
  return visibles.map((consumer) => ({ clef: consumer.key, label: consumer.label, theme: consumer.theme }))
}

const vintagesAbsents = computed(() => table.value?.vintagesAbsents ?? false)

const colonnes: ColonneTableSources[] = [
  { cle: 'source', libelle: 'Source' },
  { cle: 'editeur', libelle: 'Éditeur' },
  { cle: 'themes', libelle: 'Thèmes utilisés' },
  { cle: 'indicateurs', libelle: 'Indicateurs' },
  { cle: 'version', libelle: 'Version' },
  { cle: 'date_reference', libelle: 'Date de référence' },
  { cle: 'date_publication', libelle: 'Date de publication' },
  { cle: 'licence', libelle: 'Licence' },
  { cle: 'lien', libelle: 'Lien vers le jeu de données', labelEmpile: 'Lien', classe: 'colonne-lien', cache: true },
]

/** Les lignes de la table — un en-tête par jeu, ses lignes vintage quand il est déplié. */
const lignes = computed<LigneTableSources[]>(() => {
  const lignesTable: LigneTableSources[] = []
  for (const jeu of jeux.value) {
    lignesTable.push({
      id: ancreSource(jeu.id),
      classe: 'source-jeu',
      nom: jeu.nom,
      url: jeu.url,
      themes: jeu.themes,
      indicateurs: indicateursDuJeu(jeu.id),
      cellules: {
        editeur: jeu.editeur,
        // Un jeu replié porte sa fraîcheur sur l'en-tête ; un jeu déplié la
        // laisse à ses lignes vintage (les tirets, jamais une date inventée).
        version: jeu.replie ? jeu.version : null,
        date_reference: jeu.replie ? jeu.dateReference : null,
        date_publication: jeu.replie ? jeu.datePublication : null,
        licence: jeu.replie ? jeu.licence : null,
      },
    })
    if (!jeu.replie) {
      for (const vintage of jeu.vintages) {
        lignesTable.push({
          id: ancreSource(vintage.id),
          classe: 'source-vintage',
          nom: vintage.libelle,
          url: null,
          cellules: {
            editeur: null,
            version: vintage.version,
            date_reference: vintage.dateReference,
            date_publication: vintage.datePublication,
            licence: vintage.licence,
          },
        })
      }
    }
  }
  return lignesTable
})

/** La rampe du thème en variables CSS pour les puces « thèmes utilisés ». */
function styleTheme(theme: Theme): Record<string, string> {
  return {
    '--puce-soft': `var(--theme-${theme}-soft)`,
    '--puce-strong': `var(--theme-${theme}-strong)`,
  }
}

function libelleThemes(themes: readonly Theme[]): string {
  return themes.map((t) => NOMS_THEMES[t]).join(' · ')
}
</script>

<template>
  <section id="sources" class="sources" :aria-busy="chargement ? 'true' : 'false'">
    <h2 class="sources__titre">Les sources</h2>

    <div v-if="chargement" class="sources-chargement" role="status" aria-label="Chargement des sources">
      <div class="squelette squelette--titre" />
      <div class="squelette squelette--ligne" />
      <div class="squelette squelette--ligne" />
      <div class="squelette squelette--ligne" />
    </div>

    <div v-else-if="erreur" class="etat-erreur">
      <AppIcon :icone="AlertCircle" :taille="28" class="etat-icone" />
      <p class="etat-texte">Impossible de charger les données des sources.</p>
      <button type="button" class="bouton-reessayer" @click="recharger">Réessayer</button>
    </div>

    <template v-else>
      <p v-if="vintagesAbsents" class="sources__note-fraicheur">
        La version, la licence et les dates de publication apparaîtront lors de la prochaine
        actualisation des données.
      </p>

      <SourcesTable
        :colonnes="colonnes"
        :lignes="lignes"
        etiquette="Les sources des fiches Lusk"
      >
        <template #themes="{ ligne }">
          <ul
            v-if="ligne.themes && ligne.themes.length > 0"
            class="puce-themes"
            :aria-label="libelleThemes(ligne.themes)"
          >
            <li
              v-for="theme in ligne.themes"
              :key="theme"
              class="puce-theme"
              :style="styleTheme(theme)"
            >{{ NOMS_THEMES[theme] }}</li>
          </ul>
          <span v-else>—</span>
        </template>

        <template #indicateurs="{ ligne }">
          <ul
            v-if="ligne.indicateurs && ligne.indicateurs.length > 0"
            class="matrice-indicateurs"
          >
            <li
              v-for="indicateur in ligne.indicateurs"
              :key="indicateur.clef"
              class="matrice-indicateur"
            >
              <a
                :href="`#${ancreIndicateur(indicateur.clef)}`"
                class="matrice-indicateur-lien"
              >{{ indicateur.label }}</a>
            </li>
          </ul>
          <span v-else-if="ligne.classe === 'source-jeu'" class="matrice-vide">
            Aucun indicateur ne cite ce jeu
          </span>
          <span v-else>—</span>
        </template>
      </SourcesTable>
    </template>
  </section>
</template>

<style scoped>
.sources {
  width: 100%;
}

.sources__titre {
  margin: 0 0 var(--space-6);
  font: 600 1.5rem/1.3 var(--font-serif);
  letter-spacing: -0.01em;
  color: var(--text-primary);
}

.sources__note-fraicheur {
  margin: 0 0 var(--space-6);
  color: var(--text-tertiary);
  font: var(--text-body-sm);
}

/* ---- Les puces « thèmes utilisés » (les cellules riches du slot themes) ---- */
.puce-themes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.puce-theme {
  padding: 2px var(--space-2);
  border-radius: var(--radius-full);
  background: var(--puce-soft);
  color: var(--puce-strong);
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
}

/* ---- La matrice indicateur ↔ source (issue #336) — les consommateurs du
   jeu sur l'en-tête, chacun lié à sa documentation #indicateur-<clef> ---- */
.matrice-indicateurs {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.matrice-indicateur-lien {
  color: var(--accent-primary);
  font-weight: 600;
}

.matrice-indicateur-lien:hover {
  color: var(--accent-hover);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.matrice-vide {
  color: var(--text-tertiary);
  font-style: italic;
}

/* ---- Les états (ui-elements.md §Loading/empty/error) ---- */
.sources-chargement {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-4) 0;
}

.squelette--titre {
  width: 40%;
  height: 1.5rem;
}

.squelette--ligne {
  width: 100%;
  height: 1rem;
}

.etat-erreur {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-12) var(--space-6);
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
</style>
