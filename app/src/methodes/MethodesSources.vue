<script setup lang="ts">
/**
 * La section « les sources » de /methodologie (layouts.md §5, issue #128):
 * la table des sources — une ligne par source du registre Méthodes, les faits
 * éditoriaux (éditeur, thèmes, URL) rejoints en direct aux faits de fraîcheur
 * (version, licence, dates) de la table vintages (sourcesMethodes, le seam du
 * payload). Ordre du registre = ordre de la table. Au-dessous de 768px la
 * table se superpose en lignes empilées (mêmes cellules, CSS seul).
 *
 * États (ui-elements.md): squelette pendant le chargement, erreur typée avec
 * Réessayer, état vide honnête quand vintages.json est absent (404) — la page
 * ne casse jamais. Une source sans ligne vintages en direct rend ses faits
 * éditoriaux et un tiret pour la fraîcheur, jamais une date inventée.
 */
import { AlertCircle, ExternalLink } from 'lucide-vue-next'
import { computed } from 'vue'

import AppIcon from '@/components/AppIcon.vue'
import { NOMS_THEMES } from '@/fiche/onglets'
import { ancreSource } from '@/methodes/sources'
import { sourcesMethodes } from '@/payload/selectors'
import type { Theme } from '@/payload/types'
import { usePayload } from '@/payload/usePayload'

const { payload, erreur, chargement, recharger } = usePayload()

const table = computed(() => (payload.value ? sourcesMethodes(payload.value) : null))

const sources = computed(() => table.value?.lignes ?? [])

const vintagesAbsents = computed(() => table.value?.vintagesAbsents ?? false)

/** La rampe du thème en variables CSS pour les puces « thèmes utilisés ». */
function styleTheme(theme: Theme): Record<string, string> {
  return {
    '--puce-soft': `var(--theme-${theme}-soft)`,
    '--puce-strong': `var(--theme-${theme}-strong)`,
  }
}

function libelleThemes(themes: Theme[]): string {
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

      <table class="sources-tableau">
        <caption class="visuellement-cache">Les sources des fiches Lusk</caption>
        <thead>
          <tr>
            <th scope="col">Source</th>
            <th scope="col">Éditeur</th>
            <th scope="col">Thèmes utilisés</th>
            <th scope="col">Version</th>
            <th scope="col">Date de référence</th>
            <th scope="col">Date de publication</th>
            <th scope="col">Licence</th>
            <th scope="col" class="colonne-lien">
              <span class="visuellement-cache">Lien vers le jeu de données</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="source in sources" :id="ancreSource(source.id)" :key="source.id">
            <td data-label="Source" class="cellule-source">
              <a
                v-if="source.url"
                :href="source.url"
                target="_blank"
                rel="noopener noreferrer"
                class="lien-source"
              >{{ source.nom }}</a>
              <span v-else>{{ source.nom }}</span>
            </td>
            <td data-label="Éditeur" class="cellule-editeur">{{ source.editeur }}</td>
            <td data-label="Thèmes utilisés">
              <ul class="puce-themes" :aria-label="libelleThemes(source.themes)">
                <li
                  v-for="theme in source.themes"
                  :key="theme"
                  class="puce-theme"
                  :style="styleTheme(theme)"
                >{{ NOMS_THEMES[theme] }}</li>
              </ul>
            </td>
            <td data-label="Version" class="cellule-fraicheur">{{ source.version ?? '—' }}</td>
            <td data-label="Date de référence" class="cellule-fraicheur">{{ source.dateReference ?? '—' }}</td>
            <td data-label="Date de publication" class="cellule-fraicheur">{{ source.datePublication ?? '—' }}</td>
            <td data-label="Licence" class="cellule-fraicheur">{{ source.licence ?? '—' }}</td>
            <td data-label="Lien" class="colonne-lien">
              <a
                v-if="source.url"
                :href="source.url"
                target="_blank"
                rel="noopener noreferrer"
                class="lien-donnees"
                :aria-label="`Ouvrir le jeu de données ${source.nom}`"
              >
                <AppIcon :icone="ExternalLink" :taille="16" aria-hidden="true" />
              </a>
              <span v-else>—</span>
            </td>
          </tr>
        </tbody>
      </table>
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
