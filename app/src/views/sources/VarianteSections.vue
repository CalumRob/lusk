<script setup lang="ts">
/**
 * ⚠️ PROTOTYPE JETABLE (#500) — VARIANTE C « Sections par thème ».
 *
 * La troisième structure : le registre est GROUPÉ par thème produit
 * (Démographie → … → Programmes et subventions), chaque section portant des
 * lignes ultra-denses. L'hypothèse testée : le visiteur arrive par son thème ;
 * la comparaison de fraîcheur se fait À L'INTÉRIEUR d'une section, pas entre
 * colonnes globales.
 *
 * Trade-off assumé et démontré : un jeu multi-thèmes APPARAÎT DANS CHACUNE de
 * ses sections (série historique → Démographie ET Milieux — l'autorité
 * d'ADR-0014 rendue littéralement, au prix d'une répétition).
 *
 * Bornages propres : nom sur une ligne (clamp + title), fraîcheur compacte à
 * chasse tabulaire tronquée honnêtement (title), millésimes distincts derrière
 * un divulgateur local, consommateurs en flux en ligne borné à deux lignes +
 * « +N ». Les jeux sans consommateur forment une section finale visible
 * (« Référentiels & jeux non consommés », #478 §F3).
 */
import { computed, ref } from 'vue'

import { ancreSource } from '@/methodes/sources'
import { formaterDateFrancaise } from '@/payload/selectors'
import { THEMES_CANONIQUES, type Payload, type Theme } from '@/payload/types'
import {
  fondTheme,
  jeuxPrototype,
  libelleTheme,
  texteTheme,
  type JeuPrototype,
} from './prototype'

const props = defineProps<{ payload: Payload }>()

const jeux = computed(() => jeuxPrototype(props.payload))

interface SectionTheme {
  id: string
  titre: string
  theme: Theme | null
  jeux: JeuPrototype[]
}

/** Adhésion littérale aux thèmes d'autorité : un jeu multi-thèmes se répète. */
const sections = computed<SectionTheme[]>(() => {
  const parTheme = THEMES_CANONIQUES.map((theme) => ({
    id: `theme-${theme}`,
    titre: libelleTheme(theme),
    theme,
    jeux: jeux.value.filter((jeu) => jeu.themes.includes(theme)),
  }))
  const horsTheme = jeux.value.filter((jeu) => !jeu.demo && jeu.themes.length === 0)
  const demo = jeux.value.filter((jeu) => jeu.demo)
  const fin = [] as SectionTheme[]
  if (horsTheme.length) {
    fin.push({ id: 'hors-theme', titre: 'Référentiels & jeux non consommés', theme: null, jeux: horsTheme })
  }
  if (demo.length) {
    fin.push({ id: 'demo', titre: 'Épreuve de bornage (prototype)', theme: null, jeux: demo })
  }
  return [...parTheme.filter((section) => section.jeux.length > 0), ...fin]
})

/** Consommateurs : flux en ligne borné à deux lignes, réversible par jeu. */
const deplies = ref(new Set<string>())
function basculer(jeu: JeuPrototype): void {
  const prochain = new Set(deplies.value)
  if (prochain.has(jeu.id)) prochain.delete(jeu.id)
  else prochain.add(jeu.id)
  deplies.value = prochain
}
const estDeplie = (jeu: JeuPrototype) => deplies.value.has(jeu.id)

/** La ligne de fraîcheur compacte — version(s) puis publication. */
function fraicheurCompacte(jeu: JeuPrototype): string {
  const morceaux = [jeu.etendueVersions ?? '—']
  if (jeu.etenduePublications) morceaux.push(`publ. ${jeu.etenduePublications}`)
  return morceaux.join(' · ')
}
</script>

<template>
  <section class="var-c" aria-label="Variante C — sections par thème">
    <p class="var-c__note">
      <strong>Variante C — « Sections par thème ».</strong> Le registre groupé par thème produit :
      lignes denses, fraîcheur compacte à chasse tabulaire, consommateurs en flux borné.
      Un jeu multi-thèmes apparaît dans chacune de ses sections (série historique →
      Démographie <em>et</em> Milieux) ; les jeux sans consommateur restent visibles en fin de page.
    </p>

    <section v-for="section in sections" :key="section.id" class="secteur" :aria-labelledby="`${section.id}-titre`">
      <h2 :id="`${section.id}-titre`" class="secteur__titre" :class="{ 'secteur__titre--neutre': !section.theme }">
        <span
          v-if="section.theme"
          class="secteur__pastille"
          :style="{ background: fondTheme(section.theme), color: texteTheme(section.theme) }"
          aria-hidden="true"
        ></span>
        {{ section.titre }}
        <span class="secteur__compte">{{ section.jeux.length }}</span>
      </h2>
      <div class="var-c__piste" tabindex="0" role="region" :aria-label="`Table ${section.titre} (variante C)`">
        <table class="dense">
          <thead>
            <tr>
              <th scope="col" class="col-jeu">Jeu de données</th>
              <th scope="col" class="col-fraicheur">Fraîcheur</th>
              <th scope="col" class="col-millesimes">Millésimes</th>
              <th scope="col" class="col-consos">Consommateurs publiés</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="jeu in section.jeux" :id="ancreSource(jeu.id)" :key="`${section.id}-${jeu.id}`" class="ligne" :class="{ 'ligne--demo': jeu.demo }">
              <td data-label="Jeu de données" class="cell-jeu">
                <p v-if="jeu.demo" class="bandeau-demo">Ligne de démonstration — prototype</p>
                <span class="nom" :title="jeu.nom">{{ jeu.nom }}</span>
                <span v-if="!jeu.demo" class="editeur">{{ jeu.editeur }}</span>
              </td>
              <td data-label="Fraîcheur" class="cell-fraicheur" :title="fraicheurCompacte(jeu)">
                {{ fraicheurCompacte(jeu) }}
              </td>
              <td data-label="Millésimes" class="cell-millesimes">
                <details v-if="!jeu.replie && jeu.vintages.length">
                  <summary>{{ jeu.vintages.length }}</summary>
                  <ul class="liste-vintages">
                    <li v-for="vintage in jeu.vintages" :key="vintage.id">
                      {{ vintage.label }} — {{ vintage.version ?? '—' }}
                      <template v-if="vintage.datePublication"> · publ. {{ formaterDateFrancaise(vintage.datePublication) }}</template>
                    </li>
                  </ul>
                </details>
                <span v-else class="vide" aria-label="Millésime unique replié dans la fraîcheur">—</span>
              </td>
              <td data-label="Consommateurs publiés" class="cell-consos">
                <p v-if="!jeu.consommateurs.length" class="vide-consos">
                  Aucun indicateur publié ne cite ce jeu.
                </p>
                <template v-else>
                  <p class="flux-consos" :class="{ 'flux-consos--borne': !estDeplie(jeu) }">
                    <template v-for="(consommateur, index) in jeu.consommateurs" :key="`${consommateur.theme}-${consommateur.key}`">
                      <RouterLink
                        v-if="!jeu.demo"
                        :to="{ name: 'indicateur', params: { theme: consommateur.theme, indicator: consommateur.key } }"
                      >{{ consommateur.label }}</RouterLink><span v-else class="puce-demo">{{ consommateur.label }}</span><span v-if="index < jeu.consommateurs.length - 1" class="separateur" aria-hidden="true"> · </span>
                    </template>
                  </p>
                  <button
                    type="button"
                    class="divulgateur"
                    :aria-expanded="estDeplie(jeu)"
                    @click="basculer(jeu)"
                  >
                    {{ estDeplie(jeu) ? 'Replier' : `+ ${Math.max(0, jeu.consommateurs.length - 4)} autres` }}
                  </button>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </section>
</template>

<style scoped>
.var-c__note {
  max-width: 75ch;
  margin: 0 0 var(--space-6);
  padding: var(--space-3) var(--space-4);
  border: 1px dashed var(--brand-200);
  border-radius: var(--radius-md);
  background: var(--surface-primary);
  color: var(--text-secondary);
  font: var(--text-body-sm);
}
.var-c__note strong { color: var(--text-primary); }

.secteur { margin-bottom: var(--space-8); }
.secteur__titre {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0 0 var(--space-3);
  font: var(--text-h3);
}
.secteur__titre--neutre { color: var(--text-secondary); }
.secteur__pastille {
  width: 0.9rem;
  height: 0.9rem;
  border-radius: var(--radius-sm);
}
.secteur__compte {
  padding: 0 var(--space-2);
  border-radius: var(--radius-full);
  background: var(--surface-tertiary);
  color: var(--text-secondary);
  font: var(--text-caption);
  font-variant-numeric: tabular-nums;
}

.var-c__piste {
  max-width: 100%;
  overflow-x: auto;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  background: var(--surface-primary);
}

.dense {
  width: 100%;
  min-width: 700px;
  table-layout: fixed;
  border-collapse: collapse;
  font: var(--text-body-sm);
}
.col-jeu { width: 36%; }
.col-fraicheur { width: 20%; }
.col-millesimes { width: 10%; }
.col-consos { width: 34%; }

.dense thead th {
  padding: var(--space-2) var(--space-4);
  background: var(--surface-tertiary);
  color: var(--text-secondary);
  font: var(--text-overline);
  letter-spacing: var(--text-overline-tracking);
  text-align: left;
  text-transform: uppercase;
}
.dense td {
  padding: var(--space-2) var(--space-4);
  vertical-align: top;
  border-top: 1px solid var(--border-subtle);
}

.cell-jeu { min-width: 0; }
.nom {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 1;
  line-clamp: 1;
  overflow: hidden;
  color: var(--text-primary);
  font-weight: 600;
  overflow-wrap: anywhere;
}
.editeur { display: block; color: var(--text-tertiary); font-size: 0.75rem; }

.cell-fraicheur {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-secondary);
}

.cell-millesimes { font-variant-numeric: tabular-nums; }
.cell-millesimes summary {
  color: var(--accent-primary);
  font-weight: 600;
  cursor: pointer;
}
.liste-vintages { margin: var(--space-2) 0 0; padding-left: var(--space-4); color: var(--text-secondary); }
.vide { color: var(--text-tertiary); }

.cell-consos { min-width: 0; }
.flux-consos {
  margin: 0;
  font-weight: 500;
  overflow-wrap: anywhere;
}
.flux-consos--borne {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
}
.separateur { color: var(--text-tertiary); }
.divulgateur {
  margin-top: var(--space-1);
  padding: 1px var(--space-2);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-full);
  background: var(--surface-tertiary);
  color: var(--text-secondary);
  font: var(--text-caption);
  cursor: pointer;
}
.divulgateur:hover { color: var(--text-primary); border-color: var(--brand-200); }
.vide-consos { margin: 0; color: var(--text-tertiary); font-style: italic; }
.puce-demo { color: var(--text-secondary); font-weight: 400; }

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
.ligne--demo { background: color-mix(in oklab, var(--status-warning) 5%, var(--surface-primary)); }

@media (max-width: 767.98px) {
  .dense { min-width: 0; }
  .dense thead { display: none; }
  .dense tr { display: block; padding: var(--space-2) 0; }
  .dense td { display: block; padding: 2px 0; border-top: none; }
  .dense td[data-label]::before {
    content: attr(data-label);
    display: block;
    margin-bottom: 2px;
    color: var(--text-tertiary);
    font: var(--text-caption);
    letter-spacing: var(--text-caption-tracking);
    text-transform: uppercase;
  }
  .cell-fraicheur { white-space: normal; }
}
</style>
