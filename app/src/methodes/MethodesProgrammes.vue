<script setup lang="ts">
/**
 * La section « Programmes & financements » de /methodologie (issue #180,
 * layouts.md §5, CONTEXT.md → Programmes & financements) : la documentation
 * éditoriale de l'élément du même nom de la fiche — le vocabulaire des badges
 * (sigle → nom), les trois sortes de couverture, la règle du badge ORT, la
 * ligne « jamais les résultats », puis la table des SIX sources (URL, format,
 * licence, fraîcheur — les faits que le pipeline ingère réellement, jamais
 * inventés). Le registre (programmes.ts) est statique et typé — la section ne
 * dépend pas du payload. Pas de bannière de construction (principles.md §1) :
 * la page énonce ce qui est.
 */
import { ExternalLink } from 'lucide-vue-next'

import AppIcon from '@/components/AppIcon.vue'
import { ancreSource } from '@/methodes/sources'
import {
  COUVERTURES_PROGRAMMES,
  LIGNE_JAMAIS_RESULTATS,
  REGLE_BADGE_ORT,
  SOURCES_PROGRAMMES,
  VOCABULAIRE_PROGRAMMES,
} from '@/methodes/programmes'

const sources = Object.entries(SOURCES_PROGRAMMES).map(([id, source]) => ({ id, ...source }))

/** Le libellé complet d'un sigle — « ACV — Action Cœur de Ville ». */
function libelleSigle(sigle: string): string {
  const nom = VOCABULAIRE_PROGRAMMES[sigle as keyof typeof VOCABULAIRE_PROGRAMMES]
  return nom && nom !== sigle ? `${sigle} — ${nom}` : sigle
}
</script>

<template>
  <section id="programmes" class="programmes">
    <h2 class="programmes__titre">Programmes &amp; financements</h2>

    <p class="programmes__intro">
      La fiche d’identité montre les programmes d’État et régionaux qui couvrent le territoire —
      les badges d’adhésion (ACV, PVD, CRTE, Territoires d’industrie), l’outil ORT là où il
      ajoute de l’information, et les subventions attribuées par la Région — avec une estampille
      de fraîcheur sur chaque élément. Un territoire sans couverture affiche un état vide honnête,
      jamais une promesse.
    </p>

    <p class="programmes__jamais-resultats" data-fait="jamais-resultats">
      {{ LIGNE_JAMAIS_RESULTATS }}
    </p>

    <div class="programmes__groupe">
      <h3 class="groupe-titre">Le vocabulaire des badges</h3>
      <dl class="vocabulaire">
        <div
          v-for="(nom, sigle) in VOCABULAIRE_PROGRAMMES"
          :key="sigle"
          class="vocabulaire-ligne"
        >
          <dt class="vocabulaire-sigle">{{ sigle }}</dt>
          <dd class="vocabulaire-nom">{{ nom }}</dd>
        </div>
      </dl>
    </div>

    <div class="programmes__groupe">
      <h3 class="groupe-titre">Trois sortes de couverture</h3>
      <ol class="couvertures">
        <li v-for="couverture in COUVERTURES_PROGRAMMES" :key="couverture.titre" class="couverture">
          <p class="couverture-titre">
            {{ couverture.titre }}
            <span class="couverture-sigles">{{ couverture.sigles.map(libelleSigle).join(' · ') }}</span>
          </p>
          <p class="couverture-texte">{{ couverture.texte }}</p>
        </li>
      </ol>
    </div>

    <div class="programmes__groupe">
      <h3 class="groupe-titre">Le badge ORT</h3>
      <p class="regle-ort">{{ REGLE_BADGE_ORT }}</p>
    </div>

    <div class="programmes__groupe">
      <h3 class="groupe-titre">Les sources</h3>
      <table class="sources-tableau">
        <caption class="visuellement-cache">Les sources de l'élément Programmes &amp; financements</caption>
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
    </div>
  </section>
</template>

<style scoped>
.programmes {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
}

.programmes__titre {
  margin: 0;
  font: 600 1.5rem/1.3 var(--font-serif);
  letter-spacing: -0.01em;
  color: var(--text-primary);
}

.programmes__intro {
  margin: 0;
  color: var(--text-secondary);
  font: var(--text-body-lg);
}

/* ---- La ligne « jamais les résultats » — le fait éditorial de l'élément ---- */
.programmes__jamais-resultats {
  margin: 0;
  padding: var(--space-4) var(--space-5);
  border-left: 3px solid var(--brand-500);
  border-radius: 0 var(--radius-md) var(--radius-md) 0;
  background: var(--surface-tertiary);
  color: var(--text-primary);
  font: 600 1rem/1.5 var(--font-serif);
}

.programmes__groupe {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.groupe-titre {
  margin: 0;
  font: 600 1.1875rem/1.4 var(--font-serif);
  color: var(--text-primary);
}

/* ---- Le vocabulaire des badges ---- */
.vocabulaire {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
}

.vocabulaire-ligne {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-3);
  align-items: baseline;
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-primary);
}

.vocabulaire-sigle {
  margin: 0;
  font: var(--text-body-sm);
  font-weight: 700;
  color: var(--accent-primary);
}

.vocabulaire-nom {
  margin: 0;
  color: var(--text-secondary);
  font: var(--text-body-sm);
}

/* ---- Les trois sortes de couverture ---- */
.couvertures {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

.couverture {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-4) var(--space-5);
  border-left: 3px solid var(--border-default);
  border-radius: 0 var(--radius-md) var(--radius-md) 0;
  background: var(--surface-primary);
}

.couverture-titre {
  margin: 0;
  font: 600 1rem/1.5 var(--font-serif);
  color: var(--text-primary);
}

.couverture-sigles {
  margin-left: var(--space-2);
  color: var(--text-tertiary);
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
  text-transform: uppercase;
}

.couverture-texte {
  margin: 0;
  color: var(--text-secondary);
  font: var(--text-body-sm);
}

/* ---- La règle du badge ORT ---- */
.regle-ort {
  margin: 0;
  color: var(--text-secondary);
  font: var(--text-body-sm);
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
