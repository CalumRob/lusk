<script setup lang="ts">
/**
 * OngletTheme — one theme's tab content (ui-elements.md §ThemeBlock): the
 * theme overline (-strong) → the standard indicator figures (contract order)
 * → one story angle (serif one-liner + one shape) → "comment lire" + Méthodes
 * link. The block wears the theme's ramp — Démographie wears indigo; the page
 * background -wash is the shell's (TerritoireView).
 *
 * The block consumes the payload selectors only — never raw JSON. The Story
 * copy is keyed per theme by the pipeline's readings: storyDemographie (the
 * rate-quadrant) and storyEconomie (issue #121 — the top-5 specialisations,
 * or the région's top-5 by presence). A territory without a story renders the
 * standard block and no invented one-liner. The Démographie story renders its
 * solde chart; the Économie story renders its specialisation list.
 */
import { computed } from 'vue'
import { RouterLink } from 'vue-router'

import GraphiqueDistributionMobilite from '@/components/fiche/GraphiqueDistributionMobilite.vue'
import GraphiqueSoldes from '@/components/fiche/GraphiqueSoldes.vue'
import IndicatorFigure from '@/components/fiche/IndicatorFigure.vue'
import {
  NOMS_DETAILS_RESEAUX,
  NOMS_DETAILS_VOITURES_MENAGE,
  NOMS_INDICATEURS,
  NOMS_TRANCHES_AGE,
} from '@/fiche/indicateurs'
import { NOMS_THEMES } from '@/fiche/onglets'
import { storyDemographie } from '@/fiche/storyDemographie'
import { storyEconomie } from '@/fiche/storyEconomie'
import { storyMobilite } from '@/fiche/storyMobilite'
import {
  descriptionNuage,
  estampilleSnapshot,
  histoirePourTerritoire,
  histoiresEconomiePourTerritoire,
  histoiresMobilitePourTerritoire,
  indicateursGroupeesPourTerritoire,
  nuageComparaison,
  nuageMobilite,
  trouverTerritoire,
} from '@/payload/selectors'
import type { GroupeIndicateur } from '@/payload/selectors'
import type { Payload, Theme } from '@/payload/types'

const props = defineProps<{
  theme: Theme
  payload: Payload
  territoire: string
}>()

const nomTheme = computed(() => NOMS_THEMES[props.theme])

const groupes = computed(() =>
  indicateursGroupeesPourTerritoire(props.payload, props.theme, props.territoire),
)

const histoire = computed(() =>
  histoirePourTerritoire(props.payload, props.theme, props.territoire),
)

// The solde chart is the Démographie story's shape only; the block guards on
// the theme before touching the theme-specific fields of the Histoire union.
const histoireDemographie = computed(() =>
  histoire.value?.theme === 'demographie' ? histoire.value : null,
)

const story = computed(() => {
  const histoire = histoireDemographie.value
  if (!histoire) return null
  return storyDemographie(
    histoire.classification,
    histoire.taux_solde_naturel,
    histoire.taux_solde_migratoire,
    histoire.periode,
  )
})

// The Économie Story (issue #121): the LQ is the Story — the block's top-5
// specialisations (or the région's top-5 by presence), precomputed by the
// pipeline. Multi-line: one Histoire row per rang; the mapper builds the copy.
// Gated on the theme like the Démographie story — a territory carries BOTH
// stories in the payload (Rennes has its trajectoire AND its top-5), and each
// block must read its own.
const storyEconomieAngle = computed(() => {
  if (props.theme !== 'economie') return null
  const lignes = histoiresEconomiePourTerritoire(props.payload, props.territoire)
  if (!lignes) return null
  return storyEconomie(lignes, nomTerritoire.value)
})

const nuage = computed(() => nuageComparaison(props.payload, props.territoire) ?? [])

// What the chart compares: the subtitle names the current territory and its
// comparison group (same scale as the nuage), with the container (EPCI /
// département / région) clickable to its own fiche.
const descriptionNuageComputed = computed(() =>
  descriptionNuage(props.payload, props.territoire),
)

// The story's data sources, exhaustive: the série historique (the rates the
// reading crosses) and the base des EPCI (the nuage's comparison groups).
// Cited from the payload's vintages table — never invented, never a theme
// stamp. Absent table → no source line (honest, nothing to cite).
const sourceHistoire = computed(() => {
  const vintages = props.payload.vintages
  if (!vintages) return null
  const ids = new Set(['serie_historique', 'epci'])
  const citees = vintages.filter((v) => ids.has(v.id))
  if (citees.length === 0) return null
  return citees.map((v) => `${v.source} · ${v.version}`).join(' · ')
})

const nomTerritoire = computed(
  () => trouverTerritoire(props.payload, props.territoire)?.nom ?? props.territoire,
)

// The Mobilité block (issue #142, ADR-0012) : la « Taille » → la grille
// d'isolation (les 5 parts) → l'étage demande/réseaux → le sous-bloc
// « L'offre de mobilité alternative ». Les sections découpent l'ordre du
// contrat (ORDRE_INDICATEURS.mobilite) — chaque groupe reste dans SA section.
const CLEFS_SOUS_BLOC_MOBILITE = ['offre_tc', 'bornes_recharge', 'places_stationnement_velo_1000']
const CLEFS_GRILLE_MOBILITE = [
  'iso_alimentation',
  'iso_sante',
  'iso_administration',
  'iso_ecole',
  'iso_banque',
]

function groupesMobilite(cles: readonly string[]) {
  return groupes.value.filter((g) => cles.includes(g.key))
}

const groupesMobiliteTaille = computed(() => groupesMobilite(['nb_buildings']))
const groupesMobiliteGrille = computed(() => groupesMobilite(CLEFS_GRILLE_MOBILITE))
const groupesMobiliteDemandeReseaux = computed(() =>
  groupesMobilite(['voitures_menage', 'reseaux']),
)
const groupesMobiliteSousBloc = computed(() => groupesMobilite(CLEFS_SOUS_BLOC_MOBILITE))

/** The snapshot stamp — the flagship's honest freshness claim (ADR-0012). */
const estampille = computed(() =>
  props.theme === 'mobilite' ? estampilleSnapshot(props.payload) : null,
)

// The Mobilité Story (issue #142) : the salience rule of ADR-0002 — the vélo
// reading replaces the default when the payload carries it (classification
// « saillant »). A territory carries at most two mobilite rows; the mapper
// picks the reading.
const storyMobiliteAngle = computed(() => {
  if (props.theme !== 'mobilite') return null
  const lignes = histoiresMobilitePourTerritoire(props.payload, props.territoire)
  if (!lignes) return null
  return storyMobilite(lignes)
})

// The Mobilité story chart's context cloud (ADR-0011) — the peers' div_loss_t
// at the same scale, clickable like the Démographie nuage.
const nuageMobiliteComputed = computed(() =>
  props.theme === 'mobilite' ? nuageMobilite(props.payload, props.territoire) ?? [] : [],
)

function labelsDetailPour(clef: string): Record<string, string> | undefined {
  if (clef === 'reseaux') return NOMS_DETAILS_RESEAUX
  if (clef === 'voitures_menage') return NOMS_DETAILS_VOITURES_MENAGE
  return undefined
}

/** The Mobilité block's sections — the Taille, the isolation grid, the demand/network tier and the labelled sub-block. */
interface SectionMobilite {
  titre: string | null
  isolation?: boolean
  groupes: GroupeIndicateur[]
}

const sectionsMobilite = computed<SectionMobilite[]>(() => [
  { titre: null, groupes: groupesMobiliteTaille.value },
  { titre: null, isolation: true, groupes: groupesMobiliteGrille.value },
  { titre: null, groupes: groupesMobiliteDemandeReseaux.value },
  { titre: 'L’offre de mobilité alternative', groupes: groupesMobiliteSousBloc.value },
])

function libelleIndicateur(clef: string): string {
  return NOMS_INDICATEURS[props.theme]?.[clef] ?? clef
}
</script>

<template>
  <article
    class="onglet-theme"
    :class="`onglet-theme--${theme}`"
    :style="{
      '--couleur-strong': `var(--theme-${theme}-strong)`,
      '--couleur-soft': `var(--theme-${theme}-soft)`,
      '--couleur-line': `var(--theme-${theme}-line)`,
      '--couleur-nuage': `var(--theme-${theme})`,
    }"
  >
    <p class="onglet-theme-overline">{{ nomTheme }}</p>

    <!-- The Mobilité block (issue #142, ADR-0012) : la « Taille » → la grille
         d'isolation (les 5 parts, cadrage « sans accès ») → l'étage
         demande/réseaux → le sous-bloc sous son libellé, puis l'estampille
         snapshot — jamais le langage des chips hebdomadaires. -->
    <template v-if="theme === 'mobilite'">
      <template v-for="(section, i) in sectionsMobilite" :key="i">
        <p v-if="section.titre" class="sous-bloc-mobilite-libelle">{{ section.titre }}</p>
        <div
          class="grille-indicateurs"
          :class="{ 'grille-isolation': section.isolation }"
        >
          <IndicatorFigure
            v-for="groupe in section.groupes"
            :key="groupe.key"
            :clef="groupe.key"
            :lignes="groupe.lignes"
            :libelle="libelleIndicateur(groupe.key)"
            :labels-detail="labelsDetailPour(groupe.key)"
            :large="groupe.key === 'reseaux'"
          />
        </div>
      </template>
      <p v-if="estampille" class="estampille-snapshot">{{ estampille }}</p>
    </template>

    <div v-else class="grille-indicateurs">
      <IndicatorFigure
        v-for="groupe in groupes"
        :key="groupe.key"
        :clef="groupe.key"
        :lignes="groupe.lignes"
        :libelle="libelleIndicateur(groupe.key)"
        :labels-detail="NOMS_TRANCHES_AGE"
        :signe="groupe.key === 'evolution_1968'"
        :large="groupe.key === 'structure_age'"
      />
    </div>

    <section v-if="storyMobiliteAngle || story || storyEconomieAngle" class="angle-story">
      <!-- The Mobilité Story (issue #142, ADR-0012) : the flagship's headline.
           The default « Vingt minutes sans voiture » renders its distribution
           chart (density signature, median marked) against the same-scale
           cloud; the salience « Ce que le vélo préserve » replaces it where the
           payload carries it (the delta reading, no distribution — honest). -->
      <template v-if="storyMobiliteAngle">
        <p class="angle-story-une-ligne">{{ storyMobiliteAngle.uneLigne }}</p>
        <p class="angle-story-titre">
          {{ storyMobiliteAngle.titre }}
          <template v-if="descriptionNuageComputed">
            {{ descriptionNuageComputed.prepositionCourant }}
            <span class="angle-story-courant">{{ descriptionNuageComputed.nomCourant }}</span>
            et {{ descriptionNuageComputed.groupe }}
            <RouterLink
              v-if="descriptionNuageComputed.conteneur"
              class="angle-story-conteneur"
              :to="{
                name: 'territoire',
                params: {
                  type: descriptionNuageComputed.conteneur.type,
                  id: descriptionNuageComputed.conteneur.code,
                },
              }"
            >
              {{ descriptionNuageComputed.conteneur.nom }}
            </RouterLink>
          </template>
        </p>
        <GraphiqueDistributionMobilite
          v-if="storyMobiliteAngle.distribution"
          :distribution="storyMobiliteAngle.distribution"
          :mediane="storyMobiliteAngle.divLossT"
          :nom="nomTerritoire"
          :nuage="nuageMobiliteComputed"
        />
        <p class="angle-story-comment-lire">
          <span class="angle-story-etiquette">Comment lire</span>
          {{ storyMobiliteAngle.commentLire }}
        </p>
        <p class="angle-story-source">
          <span class="angle-story-etiquette">Source</span>
          {{ storyMobiliteAngle.vintage }}
        </p>
        <RouterLink class="angle-story-methodes" to="/methodologie">Méthodes</RouterLink>
      </template>

      <!-- The Économie Story (issue #121) : la LQ EST la Story — la liste des
           top-5 spécialisations (ou, pour la région, la top-5 par présence),
           jamais un indicateur du bloc. La lecture tient dans la liste ; le
           vintage est celui des lignes elles-mêmes (issue #74). -->
      <template v-if="storyEconomieAngle">
        <p class="angle-story-une-ligne">{{ storyEconomieAngle.uneLigne }}</p>
        <p class="angle-story-titre">{{ storyEconomieAngle.titre }}</p>
        <p v-if="storyEconomieAngle.precision" class="angle-story-precision">
          {{ storyEconomieAngle.precision }}
        </p>
        <ol class="liste-specialisations">
          <li
            v-for="ligne in storyEconomieAngle.lignes"
            :key="ligne.rang"
            class="specialisation"
            :data-rang="ligne.rang"
          >
            <span class="specialisation-rang">{{ ligne.rang }}</span>
            <span class="specialisation-label">{{ ligne.label }}</span>
            <span class="specialisation-mesure">{{ ligne.mesure }}</span>
          </li>
        </ol>
        <p class="angle-story-comment-lire">
          <span class="angle-story-etiquette">Comment lire</span>
          {{ storyEconomieAngle.commentLire }}
        </p>
        <p class="angle-story-source">
          <span class="angle-story-etiquette">Source</span>
          {{ storyEconomieAngle.vintage }}
        </p>
        <RouterLink class="angle-story-methodes" to="/methodologie">Méthodes</RouterLink>
      </template>

      <!-- The Démographie story (ADR-0011) : the quadrant reading + its chart. -->
      <template v-else-if="story">
        <p class="angle-story-une-ligne">{{ story.uneLigne }}</p>
        <p class="angle-story-titre">
          {{ story.titre }}
          <template v-if="descriptionNuageComputed">
            {{ descriptionNuageComputed.prepositionCourant }}
            <span class="angle-story-courant">{{ descriptionNuageComputed.nomCourant }}</span>
            et {{ descriptionNuageComputed.groupe }}
            <RouterLink
              v-if="descriptionNuageComputed.conteneur"
              class="angle-story-conteneur"
              :to="{
                name: 'territoire',
                params: {
                  type: descriptionNuageComputed.conteneur.type,
                  id: descriptionNuageComputed.conteneur.code,
                },
              }"
            >
              {{ descriptionNuageComputed.conteneur.nom }}
            </RouterLink>
          </template>
        </p>
        <GraphiqueSoldes
          v-if="histoireDemographie"
          :taux-naturel="histoireDemographie.taux_solde_naturel"
          :taux-migratoire="histoireDemographie.taux_solde_migratoire"
          :classification="histoireDemographie.classification"
          :nom="nomTerritoire"
          :nuage="nuage"
        />
        <p class="angle-story-comment-lire">
          <span class="angle-story-etiquette">Comment lire</span>
          {{ story.commentLire }}
        </p>
        <p v-if="sourceHistoire" class="angle-story-source">
          <span class="angle-story-etiquette">Source</span>
          {{ sourceHistoire }}
        </p>
        <RouterLink class="angle-story-methodes" to="/methodologie">Méthodes</RouterLink>
      </template>
    </section>
  </article>
</template>

<style scoped>
.onglet-theme {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
  animation: entree-bloc 450ms cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes entree-bloc {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .onglet-theme {
    animation: none;
  }
}

.onglet-theme-overline {
  margin: 0;
  font: var(--text-overline);
  letter-spacing: var(--text-overline-tracking);
  text-transform: uppercase;
  color: var(--couleur-strong);
}

.grille-indicateurs {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-6) var(--space-8);
}

@media (max-width: 1024px) {
  .grille-indicateurs {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 640px) {
  .grille-indicateurs {
    grid-template-columns: 1fr;
  }
}

/* The Mobilité isolation grid (issue #142, ADR-0012) — the flagship's 5 parts
   read as ONE grid: five columns on wide screens, the fiche contract's grid
   below. The « sans accès » framing lives in the figure labels. */
.grille-isolation {
  grid-template-columns: repeat(5, 1fr);
}

@media (max-width: 1024px) {
  .grille-isolation {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 640px) {
  .grille-isolation {
    grid-template-columns: 1fr;
  }
}

/* The sub-block's label (issue #142) — « L'offre de mobilité alternative »,
   the one labelled tier of the Mobilité block. */
.sous-bloc-mobilite-libelle {
  margin: 0;
  font: var(--text-overline);
  letter-spacing: var(--text-overline-tracking);
  text-transform: uppercase;
  color: var(--couleur-strong);
}

/* The flagship's snapshot stamp (ADR-0012) — the honest freshness claim,
   visually distinct from the light themes' weekly vintage chips. */
.estampille-snapshot {
  margin: 0;
  padding: var(--space-3) var(--space-4);
  border: 1px dashed var(--couleur-line);
  border-radius: var(--radius-lg);
  background: var(--couleur-soft);
  color: var(--couleur-strong);
  font: var(--text-body-sm);
  font-weight: 600;
}

.angle-story {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-8);
  border: 1px solid var(--couleur-line);
  border-radius: var(--radius-lg);
  background: var(--surface-primary);
  box-shadow: var(--shadow-subtle);
}

.angle-story-titre {
  margin: 0;
  font: 600 1.1875rem/1.4 var(--font-serif);
  color: var(--couleur-strong);
}

/* The small label naming the matière, next to the Économie Story's title
   (issues #153 + #156): « Spécialisation des établissements actifs ». The
   title stays fabric-neutral; the precision carries the establishment
   reading. The région's presence Story carries none — nothing renders. */
.angle-story-precision {
  margin: 0;
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
  color: var(--text-secondary);
}

/* The subtitle names the two colors of the plot: the current territory wears
   the highlighted dot's color, the comparison container the cloud's. */
.angle-story-courant {
  color: var(--couleur-strong);
}

.angle-story-conteneur {
  color: var(--couleur-nuage);
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.angle-story-conteneur:hover {
  color: var(--couleur-strong);
}

.angle-story-une-ligne {
  margin: 0;
  font: var(--text-display);
  letter-spacing: var(--text-display-tracking);
  color: var(--text-primary);
}

/* The Économie Story's shape (issue #121) — the top-5 specialisations as a
   list: rank, activity label, and the measure (LQ + n, or n + part du parc
   for the région). The reading lives in the list, not in a chart. */
.liste-specialisations {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
  border-top: 1px solid var(--border-subtle);
}

.specialisation {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: var(--space-4);
  align-items: baseline;
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--border-subtle);
}

.specialisation:last-child {
  border-bottom: none;
}

.specialisation-rang {
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
  color: var(--couleur-strong);
  font-weight: 600;
}

.specialisation-label {
  font: var(--text-body-sm);
  font-weight: 600;
  color: var(--text-primary);
}

.specialisation-mesure {
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
  color: var(--text-secondary);
  white-space: nowrap;
}

@media (max-width: 640px) {
  .specialisation {
    grid-template-columns: auto 1fr;
  }

  .specialisation-mesure {
    grid-column: 2;
    white-space: normal;
  }
}

.angle-story-comment-lire {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: 0;
  font: var(--text-body-sm);
  color: var(--text-secondary);
}

.angle-story-source {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: 0;
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
  color: var(--text-tertiary);
}

.angle-story-etiquette {
  font: var(--text-overline);
  letter-spacing: var(--text-overline-tracking);
  text-transform: uppercase;
  color: var(--couleur-strong);
}

.angle-story-methodes {
  align-self: flex-start;
  font: var(--text-body-sm);
  font-weight: 600;
  color: var(--couleur-strong);
  text-underline-offset: 3px;
}
</style>
