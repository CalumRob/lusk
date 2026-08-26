<script setup lang="ts">
/**
 * ⚠️ PROTOTYPE JETABLE (#500) — VARIANTE A « Registre colonnes ».
 *
 * Le descendant direct de la table de l'onglet Méthodes · Sources
 * (ADR-0022) : une seule table à colonnes fixes, un en-tête par jeu de
 * données, ses lignes vintages imbriquées quand leur fraîcheur diffère
 * (OCS-GE : 11 enfants visibles), l'étendue en en-tête quand elle est
 * identique (DVF : 20 lignes → une cellule « 2021 – 2025 »).
 *
 * Bornage (les trois défauts D3 de l'ancienne table ne reviennent pas) :
 * - consommateurs : puces enroulées plafonnées à 6 + divulgateur « +N »
 *   (la cellule ne croît plus avec le nombre d'indicateurs) ;
 * - horizontal : table-layout fixed + minmax logique via pourcentages,
 *   piste `overflow-x: auto` en garde honnête (dépasser = scrollable,
 *   jamais clippé) ;
 * - noms : rendus tels que publiés (le bornage des noms-prose est un suivi
 *   #478, pas un geste de prototype).
 */
import { computed, ref } from 'vue'

import { ancreSource } from '@/methodes/sources'
import { formaterDateFrancaise as formaterCourte } from '@/payload/selectors'
import type { Payload } from '@/payload/types'
import {
  fondTheme,
  jeuxPrototype,
  libelleTheme,
  texteTheme,
  type JeuPrototype,
} from './prototype'

const props = defineProps<{ payload: Payload }>()

const jeux = computed(() => jeuxPrototype(props.payload))

/** Le plafond de puces visibles avant divulgateur (par jeu, réversible). */
const PLAFOND_PUCES = 6
const deplies = ref(new Set<string>())
function basculer(jeu: JeuPrototype): void {
  const prochain = new Set(deplies.value)
  if (prochain.has(jeu.id)) prochain.delete(jeu.id)
  else prochain.add(jeu.id)
  deplies.value = prochain
}
function pucesVisibles(jeu: JeuPrototype) {
  const toutDeplie = deplies.value.has(jeu.id)
  return toutDeplie ? jeu.consommateurs : jeu.consommateurs.slice(0, PLAFOND_PUCES)
}
function nombreMasque(jeu: JeuPrototype): number {
  return Math.max(0, jeu.consommateurs.length - PLAFOND_PUCES)
}
</script>

<template>
  <section class="var-a" aria-label="Variante A — registre colonnes">
    <p class="var-a__note">
      <strong>Variante A — « Registre colonnes ».</strong> Le descendant direct de la table
      Méthodes · Sources (ADR-0022) : colonnes fixes comparables d'un coup d'œil, millésimes
      imbriqués sous chaque jeu, consommateurs bornés derrière un divulgateur.
      <em>Piste horizontale : si la table dépasse, elle défile — jamais clippée.</em>
    </p>

    <div class="var-a__piste" tabindex="0" role="region" aria-label="Table des sources (variante A)">
      <table class="registre">
        <thead>
          <tr>
            <th scope="col" class="col-jeu">Jeu de données</th>
            <th scope="col" class="col-themes">Thèmes</th>
            <th scope="col" class="col-fraicheur">Fraîcheur</th>
            <th scope="col" class="col-consos">Consommateurs publiés</th>
            <th scope="col" class="col-licence">Licence</th>
          </tr>
        </thead>
        <tbody v-for="jeu in jeux" :key="jeu.id" class="registre__jeu" :class="{ 'registre__jeu--demo': jeu.demo }">
          <tr :id="ancreSource(jeu.id)" class="registre__entete">
            <td data-label="Jeu de données" class="cell-jeu">
              <p v-if="jeu.demo" class="bandeau-demo">Ligne de démonstration — prototype</p>
              <span class="nom">{{ jeu.nom }}</span>
              <span class="editeur">{{ jeu.editeur }}</span>
              <a v-if="jeu.url" class="lien-externe" :href="jeu.url" target="_blank" rel="noopener noreferrer">
                Voir le jeu de données ↗
              </a>
              <details v-if="jeu.caveat" class="limite">
                <summary>Limites</summary>
                <p>{{ jeu.caveat }}</p>
              </details>
              <details v-if="jeu.horloges.length" class="horloges">
                <summary>Horloges de mise à jour ({{ jeu.horloges.length }})</summary>
                <dl>
                  <template v-for="horloge in jeu.horloges" :key="`${horloge.name}-${horloge.reference}`">
                    <dt>{{ horloge.name }}</dt>
                    <dd>{{ horloge.frequency }} · Référence : {{ horloge.reference }}</dd>
                  </template>
                </dl>
              </details>
            </td>
            <td data-label="Thèmes" class="cell-themes">
              <span v-if="!jeu.themes.length" class="vide">—</span>
              <span
                v-for="theme in jeu.themes"
                :key="theme"
                class="puce-theme"
                :style="{ background: fondTheme(theme), color: texteTheme(theme) }"
              >{{ libelleTheme(theme) }}</span>
            </td>
            <td data-label="Fraîcheur" class="cell-fraicheur">
              <span class="versions">{{ jeu.etendueVersions ?? '—' }}</span>
              <span v-if="jeu.etenduePublications" class="dates">publ. {{ jeu.etenduePublications }}</span>
              <span v-if="!jeu.replie && jeu.vintages.length" class="nb-vintages">
                {{ jeu.vintages.length }} millésimes ↓
              </span>
            </td>
            <td data-label="Consommateurs publiés" class="cell-consos">
              <p v-if="!jeu.consommateurs.length" class="vide-consos">
                Aucun indicateur publié ne cite ce jeu.
              </p>
              <template v-else>
                <ul class="puces-consos">
                  <li v-for="consommateur in pucesVisibles(jeu)" :key="`${consommateur.theme}-${consommateur.key}`">
                    <RouterLink
                      v-if="!jeu.demo"
                      :to="{ name: 'indicateur', params: { theme: consommateur.theme, indicator: consommateur.key } }"
                    >{{ consommateur.label }}</RouterLink>
                    <span v-else class="puce-demo">{{ consommateur.label }}</span>
                  </li>
                </ul>
                <button
                  v-if="nombreMasque(jeu) > 0 || deplies.has(jeu.id)"
                  type="button"
                  class="divulgateur"
                  :aria-expanded="deplies.has(jeu.id)"
                  @click="basculer(jeu)"
                >
                  {{ deplies.has(jeu.id) ? 'Replier' : `+ ${nombreMasque(jeu)} autres` }}
                </button>
              </template>
            </td>
            <td data-label="Licence" class="cell-licence">{{ jeu.licence ?? '—' }}</td>
          </tr>
          <tr v-for="vintage in jeu.replie ? [] : jeu.vintages" :key="vintage.id" class="registre__vintage">
            <td data-label="Millésime" class="cell-jeu cell-jeu--enfant">
              <span class="fleche" aria-hidden="true">↳</span> {{ vintage.label }}
            </td>
            <td data-label="" aria-hidden="true"></td>
            <td data-label="Version" class="cell-fraicheur">
              <span class="versions">{{ vintage.version ?? '—' }}</span>
              <span v-if="vintage.dateReference" class="dates">réf. {{ formaterCourte(vintage.dateReference) }}</span>
              <span v-if="vintage.datePublication" class="dates">publ. {{ formaterCourte(vintage.datePublication) }}</span>
            </td>
            <td data-label="" aria-hidden="true"></td>
            <td data-label="Licence" class="cell-licence">{{ vintage.licence ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.var-a__note {
  max-width: 75ch;
  margin: 0 0 var(--space-5);
  padding: var(--space-3) var(--space-4);
  border: 1px dashed var(--brand-200);
  border-radius: var(--radius-md);
  background: var(--surface-primary);
  color: var(--text-secondary);
  font: var(--text-body-sm);
}
.var-a__note strong { color: var(--text-primary); }

/* La garde horizontale honnête : dépasser = défiler, jamais clippé (#478 §6-2). */
.var-a__piste {
  max-width: 100%;
  overflow-x: auto;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  background: var(--surface-primary);
}

.registre {
  width: 100%;
  min-width: 760px;
  table-layout: fixed;
  border-collapse: collapse;
  font: var(--text-body-sm);
}
.col-jeu { width: 30%; }
.col-themes { width: 12%; }
.col-fraicheur { width: 16%; }
.col-consos { width: 32%; }
.col-licence { width: 10%; }

.registre thead th {
  position: sticky;
  top: calc(var(--header-height));
  z-index: 1;
  padding: var(--space-3) var(--space-4);
  background: var(--surface-tertiary);
  color: var(--text-secondary);
  font: var(--text-overline);
  letter-spacing: var(--text-overline-tracking);
  text-align: left;
  text-transform: uppercase;
}
/* Les tables n'héritent pas du clip de piste : les en-têtes collants restent
   dans la piste scrollable — le sticky s'applique au scroll vertical de page. */

.registre tbody + tbody { border-top: 2px solid var(--border-default); }
.registre td {
  padding: var(--space-3) var(--space-4);
  vertical-align: top;
  border-top: 1px solid var(--border-subtle);
}
.registre tbody .registre__vintage td { border-top: 1px dashed var(--border-subtle); }

.cell-jeu { overflow-wrap: anywhere; }
.nom { display: block; color: var(--text-primary); font-weight: 600; }
.editeur { display: block; margin-top: 2px; color: var(--text-secondary); }
.lien-externe { display: inline-block; margin-top: var(--space-2); font-weight: 600; }
.cell-jeu--enfant { color: var(--text-secondary); padding-left: var(--space-8); }
.fleche { color: var(--text-tertiary); }

.cell-themes { display: table-cell; }
.puce-theme {
  display: inline-block;
  margin: 1px 2px 1px 0;
  padding: 1px var(--space-2);
  border-radius: var(--radius-full);
  font: var(--text-caption);
  white-space: nowrap;
}
.vide { color: var(--text-tertiary); }

.cell-fraicheur { font-variant-numeric: tabular-nums; }
.versions { display: block; font-weight: 600; }
.dates { display: block; color: var(--text-secondary); }
.nb-vintages { display: block; margin-top: 2px; color: var(--text-tertiary); font-size: 0.75rem; }

.cell-consos { min-width: 0; }
.puces-consos {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
  margin: 0;
  padding: 0;
  list-style: none;
  font-weight: 600;
}
.divulgateur {
  margin-top: var(--space-2);
  padding: 2px var(--space-2);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-full);
  background: var(--surface-tertiary);
  color: var(--text-secondary);
  font: var(--text-caption);
  cursor: pointer;
}
.divulgateur:hover { color: var(--text-primary); border-color: var(--brand-200); }
.vide-consos { margin: 0; color: var(--text-tertiary); font-style: italic; }

.cell-licence { color: var(--text-secondary); overflow-wrap: anywhere; }

.limite summary, .horloges summary {
  margin-top: var(--space-2);
  color: var(--accent-primary);
  cursor: pointer;
  font-weight: 600;
}
.limite p { margin: var(--space-2) 0 0; color: var(--text-secondary); }
.horloges dl { margin: var(--space-2) 0 0; }
.horloges dt { font-weight: 600; }
.horloges dd { margin: 0 0 var(--space-2); color: var(--text-secondary); }

.bandeau-demo {
  display: inline-block;
  margin: 0 0 var(--space-1);
  padding: 1px var(--space-2);
  border-radius: var(--radius-sm);
  background: var(--status-warning);
  color: #fff;
  font: var(--text-caption);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.registre__jeu--demo { background: color-mix(in oklab, var(--status-warning) 5%, var(--surface-primary)); }
.puce-demo { color: var(--text-secondary); font-weight: 400; }

/* Empilement <768 px — le motif éprouvé de l'ancienne table : mêmes cellules,
   libellés portés par data-label. */
@media (max-width: 767.98px) {
  .registre { min-width: 0; }
  .registre thead { display: none; }
  .registre tr { display: block; padding: var(--space-3) 0; }
  .registre td {
    display: block;
    padding: 2px 0;
    border-top: none;
  }
  .registre td[data-label]::before {
    content: attr(data-label);
    display: block;
    margin-bottom: 2px;
    color: var(--text-tertiary);
    font: var(--text-caption);
    letter-spacing: var(--text-caption-tracking);
    text-transform: uppercase;
  }
  .registre td[aria-hidden] { display: none; }
  .cell-jeu--enfant { padding-left: var(--space-6); }
}
</style>
