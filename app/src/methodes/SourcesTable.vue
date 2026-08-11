<script setup lang="ts">
/**
 * La table des sources partagée (ui-elements.md §Table — la règle « utilisé
 * deux fois → composant ») : la table du registre Méthodes (MethodesSources,
 * la granularité jeu de données d'ADR-0022) et la table des sources de
 * l'élément Programmes et subventions (MethodesProgrammesSources) rendent la
 * même forme — table, colonnes déclaratives, lignes pilotées par un modèle
 * plat, cellules Source (lien vers le jeu) et Lien (l'icône externe), le CSS
 * responsif empilé <768px (les mêmes cellules, data-label) et la légende
 * visuellement cachée. L'extraction est le geste de #333 (la relecture #350
 * l'a exigée : les deux tables étaient dupliquées).
 *
 * Le composant possède le chrome ; les callers fournissent les colonnes et
 * les lignes (LigneTableSources), et passent par un slot nommé par clé de
 * colonne pour les cellules riches (les puces « thèmes utilisés » du
 * registre — le slot reçoit la ligne). Les clés réservées « source » et
 * « lien » sont rendues par le composant (le lien vers le jeu vit sur
 * l'en-tête, jamais répété par ligne vintage — ADR-0022). Une cellule texte
 * null rend « — » : jamais une donnée inventée.
 */
import { ExternalLink } from 'lucide-vue-next'

import AppIcon from '@/components/AppIcon.vue'
import type { Theme } from '@/payload/types'

/** Une colonne de la table — l'en-tête et le libellé empilé <768px. */
export interface ColonneTableSources {
  /** La clé — le data-label des cellules (le libellé empilé <768px). */
  cle: string
  /** L'en-tête de colonne. */
  libelle: string
  /** Le libellé empilé <768px — défaut : libelle. */
  labelEmpile?: string
  /** La classe de la colonne (colonne-lien). */
  classe?: string
  /** L'en-tête visuellement caché, gardé dans l'arbre a11y (la colonne Lien). */
  cache?: boolean
}

/** Une ligne de la table — un en-tête de jeu (.source-jeu) ou une ligne vintage (.source-vintage). */
export interface LigneTableSources {
  /** L'ancre de la ligne (#source-<slug>). */
  id: string
  /** La classe de la ligne — source-jeu (l'en-tête) ou source-vintage (l'enfant). */
  classe?: 'source-jeu' | 'source-vintage'
  /** Le nom affiché dans la cellule Source (le nom du jeu ou le libellé vintage). */
  nom: string
  /** L'URL du jeu — le lien de la cellule Source ET de la colonne Lien, jamais répétée par ligne vintage. */
  url: string | null
  /** Les thèmes du jeu — rendus par le slot « themes » (les puces), jamais par le composant. */
  themes?: readonly Theme[] | null
  /** Les cellules texte — clé → contenu (null = « — »). Les clés « source » et « lien » sont rendues par le composant. */
  cellules: Record<string, string | null>
}

defineProps<{
  /** Les colonnes, dans l'ordre d'affichage. */
  colonnes: readonly ColonneTableSources[]
  /** Les lignes, dans l'ordre du registre. */
  lignes: readonly LigneTableSources[]
  /** La légende visuellement cachée de la table. */
  etiquette: string
}>()

/** La classe de cellule — le traitement tabulaire des colonnes de fraîcheur, la licence qui se plie. */
function classeCellule(cle: string): string {
  switch (cle) {
    case 'source':
      return 'cellule-source'
    case 'editeur':
      return 'cellule-editeur'
    case 'licence':
      return 'cellule-licence'
    case 'version':
    case 'date_reference':
    case 'date_publication':
      return 'cellule-fraicheur'
    case 'lien':
      return 'colonne-lien'
    default:
      return ''
  }
}
</script>

<template>
  <table class="sources-tableau">
    <caption class="visuellement-cache">{{ etiquette }}</caption>
    <thead>
      <tr>
        <th
          v-for="colonne in colonnes"
          :key="colonne.cle"
          scope="col"
          :class="colonne.classe"
        >
          <span v-if="colonne.cache" class="visuellement-cache">{{ colonne.libelle }}</span>
          <template v-else>{{ colonne.libelle }}</template>
        </th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="ligne in lignes" :id="ligne.id" :key="ligne.id" :class="ligne.classe">
        <td
          v-for="colonne in colonnes"
          :key="colonne.cle"
          :data-label="colonne.labelEmpile ?? colonne.libelle"
          :class="classeCellule(colonne.cle)"
        >
          <slot v-if="colonne.cle === 'source'" name="source" :ligne="ligne">
            <a
              v-if="ligne.url"
              :href="ligne.url"
              target="_blank"
              rel="noopener noreferrer"
              class="lien-source"
            >{{ ligne.nom }}</a>
            <span v-else>{{ ligne.nom }}</span>
          </slot>
          <slot v-else-if="colonne.cle === 'lien'" name="lien" :ligne="ligne">
            <a
              v-if="ligne.url"
              :href="ligne.url"
              target="_blank"
              rel="noopener noreferrer"
              class="lien-donnees"
              :aria-label="`Ouvrir le jeu de données ${ligne.nom}`"
            >
              <AppIcon :icone="ExternalLink" :taille="16" aria-hidden="true" />
            </a>
            <span v-else>—</span>
          </slot>
          <slot v-else :name="colonne.cle" :ligne="ligne">
            {{ ligne.cellules[colonne.cle] ?? '—' }}
          </slot>
        </td>
      </tr>
    </tbody>
  </table>
</template>

<style scoped>
/* ---- Le tableau (ui-elements.md §Table) ---- */
.sources-tableau {
  width: 100%;
  border-collapse: collapse;
  background: var(--surface-primary);
  border: 1px solid var(--border-subtle);
}

.sources-tableau thead th {
  padding: var(--space-3) var(--space-4);
  background: var(--surface-tertiary);
  border-bottom: 1px solid var(--border-default);
  color: var(--text-primary);
  font: var(--text-body-sm);
  font-weight: 700;
  text-align: left;
  white-space: nowrap;
}

.sources-tableau tbody td {
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border-subtle);
  font: var(--text-body-sm);
  vertical-align: top;
}

.sources-tableau tbody tr {
  scroll-margin-top: calc(var(--header-height) + 12px);
  transition: background-color 100ms ease-out;
}

.sources-tableau tbody tr:hover {
  background: var(--surface-tertiary);
}

/* L'en-tête de jeu se détache de ses lignes vintage — fond teinté, les
   lignes enfants s'imbriquent dessous (la granularité jeu de données,
   ADR-0022). */
.source-jeu td {
  background: var(--surface-secondary);
}

.sources-tableau tbody tr:hover td {
  background: var(--surface-tertiary);
}

.source-vintage td.cellule-source {
  padding-left: calc(var(--space-4) + var(--space-8));
}

.cellule-source {
  min-width: 260px;
}

.lien-source {
  font-weight: 600;
  color: var(--accent-primary);
}

.lien-source:hover {
  color: var(--accent-hover);
}

.cellule-editeur {
  color: var(--text-secondary);
  white-space: nowrap;
}

.cellule-fraicheur {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

/* La licence se plie au lieu de déborder — la chaîne ODbL complète tient
   dans la colonne à n'importe quelle largeur (issue #331, item 49). */
.cellule-licence {
  white-space: normal;
}

.colonne-lien {
  text-align: right;
}

.lien-donnees {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  transition:
    color 150ms ease-out,
    background-color 150ms ease-out;
}

.lien-donnees:hover {
  color: var(--accent-hover);
  background: var(--surface-tertiary);
}

/* ---- <768px : lignes empilées (les mêmes cellules, CSS seul) ---- */
@media (max-width: 767.98px) {
  .sources-tableau,
  .sources-tableau tbody,
  .sources-tableau tr,
  .sources-tableau td {
    display: block;
    width: 100%;
  }

  .sources-tableau thead {
    display: none;
  }

  .sources-tableau tbody tr {
    margin-bottom: var(--space-4);
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-default);
  }

  .sources-tableau tbody tr:last-child {
    margin-bottom: 0;
  }

  .sources-tableau tbody td {
    display: flex;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-2) 0;
    border-bottom: 0;
    text-align: right;
  }

  .sources-tableau tbody td::before {
    content: attr(data-label);
    flex-shrink: 0;
    color: var(--text-tertiary);
    font: var(--text-caption);
    letter-spacing: var(--text-caption-tracking);
    font-weight: 600;
  }

  /* Les cartes empilées : l'en-tête de jeu et ses lignes vintage gardent leur
     hiérarchie — la ligne vintage s'imbrique sous la carte de son jeu. */
  .source-jeu td,
  .source-vintage td {
    background: transparent;
  }

  .source-vintage {
    width: calc(100% - var(--space-5));
    margin-left: var(--space-5);
    border-left: 3px solid var(--border-default);
  }

  .source-vintage td.cellule-source {
    padding-left: var(--space-2);
  }

  .cellule-source {
    min-width: 0;
  }

  .cellule-source,
  .cellule-editeur,
  .cellule-licence {
    text-align: left;
    white-space: normal;
  }

  .cellule-source::before,
  .cellule-editeur::before,
  .cellule-licence::before {
    align-self: flex-start;
  }

  .colonne-lien {
    justify-content: flex-end;
  }
}

/* Visually hidden, kept in the a11y tree (the caption and the Lien header). */
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
