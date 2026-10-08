<script setup lang="ts">
/**
 * ⚠️ PROTOTYPE JETABLE (#500) — VARIANTE B « Dossiers dépliables ».
 *
 * La structure opposée à A : des lignes maîtresses volontairement courtes
 * (une ligne par jeu — nom borné sur une ligne, compteurs plutôt que listes),
 * et TOUT le détail (millésimes, horloges, limites, consommateurs complets)
 * dans un panneau de détail dépliable en pleine largeur sous la ligne.
 *
 * L'hypothèse testée : la scanabilité vient de la hauteur constante des
 * lignes maîtres ; la complétude n'est qu'un geste de plus loin (un clic /
 * Entrée). Divulgation progressive contre densité immédiate de A.
 *
 * Bornage : rien ne croît avec les données tant que le dossier est fermé ;
 * ouvert, le panneau enveloppe (flex-wrap) — jamais une seule cellule qui
 * enfle. Piste overflow-x : auto en garde honnête, comme A.
 */
import { computed, ref } from 'vue'

import { ancreSource } from '@/methodes/sources'
import { formaterDateFrancaise } from '@/payload/selectors'
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

const ouverts = ref(new Set<string>())
function basculer(jeu: JeuPrototype): void {
  const prochain = new Set(ouverts.value)
  if (prochain.has(jeu.id)) prochain.delete(jeu.id)
  else prochain.add(jeu.id)
  ouverts.value = prochain
}
const idDetail = (jeu: JeuPrototype) => `detail-${jeu.id}`
</script>

<template>
  <section class="var-b" aria-label="Variante B — dossiers dépliables">
    <p class="var-b__note">
      <strong>Variante B — « Dossiers dépliables ».</strong> Des lignes maîtresses d'une ligne :
      nom borné, compteurs au lieu des listes. Le détail complet — millésimes, horloges,
      limites, tous les consommateurs — s'ouvre en panneau sous la ligne (clic ou Entrée).
      <em>Hypothèse : scanner d'abord la hauteur constante, creuser ensuite.</em>
    </p>

    <div class="var-b__piste" tabindex="0" role="region" aria-label="Table des sources (variante B)">
      <table class="dossiers">
        <thead>
          <tr>
            <th scope="col" class="col-toggle"><span class="masque">Détail</span></th>
            <th scope="col" class="col-jeu">Jeu de données</th>
            <th scope="col" class="col-themes">Thèmes</th>
            <th scope="col" class="col-fraicheur">Fraîcheur</th>
            <th scope="col" class="col-compte">Consommateurs</th>
          </tr>
        </thead>
        <template v-for="jeu in jeux" :key="jeu.id">
          <tbody>
            <tr
              :id="ancreSource(jeu.id)"
              class="dossier"
              :class="{ 'dossier--demo': jeu.demo, 'dossier--ouvert': ouverts.has(jeu.id) }"
            >
              <td data-label="" class="cell-toggle">
                <button
                  type="button"
                  class="toggle"
                  :aria-expanded="ouverts.has(jeu.id)"
                  :aria-controls="idDetail(jeu)"
                  :aria-label="`Détail du jeu ${jeu.nom}`"
                  @click="basculer(jeu)"
                >
                  <span class="chevron" aria-hidden="true">{{ ouverts.has(jeu.id) ? '▾' : '▸' }}</span>
                </button>
              </td>
              <td data-label="Jeu de données" class="cell-jeu">
                <p v-if="jeu.demo" class="bandeau-demo">Ligne de démonstration — prototype</p>
                <button type="button" class="nom" :title="jeu.nom" @click="basculer(jeu)">
                  {{ jeu.nom }}
                </button>
                <span v-if="!jeu.demo" class="editeur">{{ jeu.editeur }}</span>
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
              </td>
              <td data-label="Consommateurs" class="cell-compte">
                <span class="compte">{{ jeu.consommateurs.length }}</span>
                <span class="compte-libelle">{{ jeu.consommateurs.length === 1 ? 'indicateur' : 'indicateurs' }}</span>
              </td>
            </tr>
          </tbody>
          <tbody v-if="ouverts.has(jeu.id)" :id="idDetail(jeu)" class="detail">
            <tr>
              <td colspan="5" class="cell-detail">
                <div class="panneau">
                  <div class="panneau__identite">
                    <h3>{{ jeu.nom }}</h3>
                    <dl>
                      <dt>Éditeur</dt>
                      <dd>{{ jeu.editeur }}</dd>
                      <dt>Licence</dt>
                      <dd>{{ jeu.licence ?? '—' }}</dd>
                      <template v-if="jeu.url">
                        <dt>Jeu de données</dt>
                        <dd>
                          <a :href="jeu.url" target="_blank" rel="noopener noreferrer">Voir la page source ↗</a>
                        </dd>
                      </template>
                      <template v-if="jeu.horloges.length">
                        <dt>Horloges de mise à jour</dt>
                        <dd>
                          <ul class="horloges">
                            <li v-for="horloge in jeu.horloges" :key="`${horloge.name}-${horloge.reference}`">
                              <strong>{{ horloge.name }}</strong> — {{ horloge.frequency }} · Référence :
                              {{ horloge.reference }}
                            </li>
                          </ul>
                        </dd>
                      </template>
                      <template v-if="jeu.caveat">
                        <dt>Limites</dt>
                        <dd>{{ jeu.caveat }}</dd>
                      </template>
                    </dl>
                  </div>
                  <div class="panneau__millésimes">
                    <h4>Millésimes et fraîcheur</h4>
                    <table v-if="jeu.vintages.length" class="mini-vintages">
                      <thead>
                        <tr>
                          <th scope="col">Millésime</th>
                          <th scope="col">Version</th>
                          <th scope="col">Référence</th>
                          <th scope="col">Publication</th>
                          <th scope="col">Licence</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="vintage in jeu.vintages" :key="vintage.id">
                          <td>{{ vintage.label }}</td>
                          <td>{{ vintage.version ?? '—' }}</td>
                          <td>{{ vintage.dateReference ? formaterDateFrancaise(vintage.dateReference) : '—' }}</td>
                          <td>{{ vintage.datePublication ? formaterDateFrancaise(vintage.datePublication) : '—' }}</td>
                          <td>{{ vintage.licence ?? '—' }}</td>
                        </tr>
                      </tbody>
                    </table>
                    <p v-else class="vide">Aucune ligne vintage publiée.</p>
                  </div>
                  <div class="panneau__consos">
                    <h4>Consommateurs publiés</h4>
                    <p v-if="!jeu.consommateurs.length" class="vide-consos">
                      Aucun indicateur publié ne cite ce jeu.
                    </p>
                    <ul v-else class="puces-consos">
                      <li v-for="consommateur in jeu.consommateurs" :key="`${consommateur.theme}-${consommateur.key}`">
                        <RouterLink
                          v-if="!jeu.demo"
                          :to="{ name: 'indicateur', params: { theme: consommateur.theme, indicator: consommateur.key } }"
                        >{{ consommateur.label }}</RouterLink>
                        <span v-else class="puce-demo">{{ consommateur.label }}</span>
                      </li>
                    </ul>
                  </div>
                </div>
              </td>
            </tr>
          </tbody>
        </template>
      </table>
    </div>
  </section>
</template>

<style scoped>
.var-b__note {
  max-width: 75ch;
  margin: 0 0 var(--space-5);
  padding: var(--space-3) var(--space-4);
  border: 1px dashed var(--brand-200);
  border-radius: var(--radius-md);
  background: var(--surface-primary);
  color: var(--text-secondary);
  font: var(--text-body-sm);
}
.var-b__note strong { color: var(--text-primary); }

.var-b__piste {
  max-width: 100%;
  overflow-x: auto;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  background: var(--surface-primary);
}

.dossiers {
  width: 100%;
  min-width: 720px;
  table-layout: fixed;
  border-collapse: collapse;
  font: var(--text-body-sm);
}
.col-toggle { width: 4%; }
.col-jeu { width: 40%; }
.col-themes { width: 16%; }
.col-fraicheur { width: 24%; }
.col-compte { width: 16%; }

.dossiers thead th {
  padding: var(--space-3) var(--space-4);
  background: var(--surface-tertiary);
  color: var(--text-secondary);
  font: var(--text-overline);
  letter-spacing: var(--text-overline-tracking);
  text-align: left;
  text-transform: uppercase;
}
.masque {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}

.dossiers tbody:first-of-type tr { border-top: none; }
.dossiers td {
  padding: var(--space-2) var(--space-4);
  vertical-align: middle;
}
tr.dossier { border-top: 1px solid var(--border-subtle); }
tr.dossier--ouvert { background: var(--surface-tertiary); }
tr.dossier--demo { background: color-mix(in oklab, var(--status-warning) 5%, var(--surface-primary)); }

.toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--accent-primary);
  cursor: pointer;
}
.toggle:hover { border-color: var(--border-default); background: var(--surface-primary); }
.chevron { font-size: 0.9rem; }

.cell-jeu { min-width: 0; }
.nom {
  max-width: 100%;
  padding: 0;
  border: none;
  background: none;
  color: var(--text-primary);
  font: inherit;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 1;
  line-clamp: 1;
  overflow-wrap: anywhere;
}
.nom:hover { color: var(--accent-hover); text-decoration: underline; }
.editeur { display: block; color: var(--text-tertiary); font-size: 0.75rem; }

.puce-theme {
  display: inline-block;
  margin: 1px 2px 1px 0;
  padding: 1px var(--space-2);
  border-radius: var(--radius-full);
  font: var(--text-caption);
  white-space: nowrap;
}

.cell-fraicheur { font-variant-numeric: tabular-nums; }
.versions { display: block; font-weight: 600; }
.dates { display: block; color: var(--text-secondary); }

.cell-compte { text-align: right; }
.compte {
  display: inline-block;
  min-width: 2rem;
  padding: 0 var(--space-2);
  border-radius: var(--radius-full);
  background: var(--brand-100);
  color: var(--brand-900);
  font-weight: var(--text-numeric-weight);
  font-variant-numeric: tabular-nums;
  text-align: center;
}
.compte-libelle { display: block; color: var(--text-tertiary); font-size: 0.75rem; }

.cell-detail { padding: 0 var(--space-4) var(--space-5); }
.panneau {
  display: grid;
  grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
  gap: var(--space-6);
  padding: var(--space-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-primary);
}
.panneau h3 { margin: 0 0 var(--space-3); font: var(--text-h3); overflow-wrap: anywhere; }
.panneau h4 { margin: 0 0 var(--space-2); font: var(--text-overline); color: var(--text-secondary); text-transform: uppercase; }
.panneau dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: var(--space-1) var(--space-3); margin: 0; }
.panneau dt { color: var(--text-tertiary); font: var(--text-caption); text-transform: uppercase; }
.panneau dd { margin: 0; overflow-wrap: anywhere; }
.horloges { margin: 0; padding-left: var(--space-4); }
.horloges li { margin-bottom: var(--space-1); color: var(--text-secondary); }

.mini-vintages { width: 100%; border-collapse: collapse; font-size: 0.8125rem; }
.mini-vintages th, .mini-vintages td {
  padding: var(--space-1) var(--space-2);
  border-bottom: 1px solid var(--border-subtle);
  text-align: left;
  vertical-align: top;
}
.mini-vintages th { color: var(--text-tertiary); font-weight: 600; }
.mini-vintages td { font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }

.panneau__consos { min-width: 0; }
.puces-consos {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
  margin: 0;
  padding: 0;
  list-style: none;
  font-weight: 600;
}
.puce-demo { color: var(--text-secondary); font-weight: 400; }
.vide-consos { margin: 0; color: var(--text-tertiary); font-style: italic; }
.vide { color: var(--text-tertiary); }

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

/* Mobile : la ligne maîtresse garde ▸ nom · compteur ; thèmes et fraîcheur
   vivent dans le dossier (compromis assumé de la divulgation). */
@media (max-width: 767.98px) {
  .dossiers { min-width: 0; }
  .dossiers thead { display: none; }
  .col-themes, .col-fraicheur { width: 0; }
  .dossiers td[data-label='Thèmes'], .dossiers td[data-label='Fraîcheur'] { display: none; }
  .dossiers td { display: table-cell; }
  .panneau { grid-template-columns: minmax(0, 1fr); gap: var(--space-4); }
}
@media (min-width: 768px) {
  .dossiers td[data-label]::before { content: none; }
}
</style>
