<script setup lang="ts">
/**
 * La table des SIX sources de l'élément « Programmes et subventions »
 * (issue #180, layouts.md §5) — l'onglet Sources · Programmes et subventions
 * du shell à onglets (#332) : URL, format, licence, fraîcheur — les faits que
 * le pipeline ingère réellement, jamais inventés. Extraite de l'ancienne
 * section « Programmes & financements » quand le shell l'a répartie entre
 * l'onglet Méthodes (l'éditorial, MethodesProgrammes) et l'onglet Sources
 * (cette table). Le registre (programmes.ts) est statique et typé — la
 * section ne dépend pas du payload. Les lignes gardent leur ancre
 * (#source-<id>, ancreSource) : les liens profonds existants continuent de
 * résoudre.
 */
import { ExternalLink } from 'lucide-vue-next'

import AppIcon from '@/components/AppIcon.vue'
import { ancreSource } from '@/methodes/sources'
import { SOURCES_PROGRAMMES } from '@/methodes/programmes'

const sources = Object.entries(SOURCES_PROGRAMMES).map(([id, source]) => ({ id, ...source }))
</script>

<template>
  <section id="programmes-sources" class="programmes-sources">
    <h2 class="programmes-sources__titre">Les sources</h2>

    <table class="sources-tableau">
      <caption class="visuellement-cache">Les sources de l'élément Programmes et subventions</caption>
      <thead>
        <tr>
          <th scope="col">Source</th>
          <th scope="col">Éditeur</th>
          <th scope="col">Format</th>
          <th scope="col">Version</th>
          <th scope="col">Date de référence</th>
          <th scope="col">Date de publication</th>
          <th scope="col">Licence</th>
          <th scope="col">Fraîcheur</th>
          <th scope="col" class="colonne-lien">
            <span class="visuellement-cache">Lien vers le jeu de données</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="source in sources" :id="ancreSource(source.id)" :key="source.id">
          <td data-label="Source" class="cellule-source">
            <a
              :href="source.url"
              target="_blank"
              rel="noopener noreferrer"
              class="lien-source"
            >{{ source.nom }}</a>
          </td>
          <td data-label="Éditeur" class="cellule-editeur">{{ source.editeur }}</td>
          <td data-label="Format" class="cellule-fraicheur">{{ source.format }}</td>
          <td data-label="Version" class="cellule-fraicheur">{{ source.version }}</td>
          <td data-label="Date de référence" class="cellule-fraicheur">
            {{ source.dateReference ?? '—' }}
          </td>
          <td data-label="Date de publication" class="cellule-fraicheur">
            {{ source.datePublication ?? '—' }}
          </td>
          <td data-label="Licence" class="cellule-fraicheur">{{ source.licence }}</td>
          <td data-label="Fraîcheur" class="cellule-fraicheur">{{ source.fraicheur }}</td>
          <td data-label="Lien" class="colonne-lien">
            <a
              :href="source.url"
              target="_blank"
              rel="noopener noreferrer"
              class="lien-donnees"
              :aria-label="`Ouvrir le jeu de données ${source.nom}`"
            >
              <AppIcon :icone="ExternalLink" :taille="16" aria-hidden="true" />
            </a>
          </td>
        </tr>
      </tbody>
    </table>
    <p class="sources-note">
      Les fraîcheurs de l'ORT sont portées par chaque convention (colonne « Dernière
      actualisation » du classeur) — jamais par la métadonnée de page, périmée. Les
      subventions sont rafraîchies chaque semaine.
    </p>
  </section>
</template>

<style scoped>
.programmes-sources {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.programmes-sources__titre {
  margin: 0;
  font: 600 1.5rem/1.3 var(--font-serif);
  letter-spacing: -0.01em;
  color: var(--text-primary);
}

/* ---- La table des sources (ui-elements.md §Table, la même forme que MethodesSources) ---- */
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

.cellule-source {
  min-width: 280px;
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

.sources-note {
  margin: 0;
  color: var(--text-tertiary);
  font: var(--text-body-sm);
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

  .cellule-source {
    min-width: 0;
  }

  .cellule-source,
  .cellule-editeur {
    text-align: left;
    white-space: normal;
  }

  .cellule-source::before,
  .cellule-editeur::before {
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
