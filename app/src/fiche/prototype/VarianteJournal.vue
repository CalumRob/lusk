<script setup lang="ts">
/**
 * [PROTOTYPE #499 — JETABLE] Variante A — « Le journal ».
 *
 * L'anatomie éditoriale SANS AUCUNE CARTE : la grille de cartes est rejetée
 * frontalement. Chaque sous-groupe est une SECTION de rapport — numérotée,
 * séparée par un filet — et tout le reste est typographie :
 *
 * - la lecture porte la voix récit à taille display, suivie de SON nombre en
 *   héros (~56 px) puis de la figure élargie (~300 px) — la réponse directe
 *   au « figures feel too small » de l'audit figures (#448/PR#451) ;
 * - les indicateurs deviennent un REGISTRE typographique (pointillés de
 *   conduite entre libellé et valeur, rang en puce après la valeur) ;
 * - les passarelles « Explorer » sont des liens de texte en fin de ligne —
 *   jamais des boutons ;
 * - la provenance est hybride : appel de note superscript près de chaque
 *   nombre, registre complet consolidé UNE FOIS en bas de thème
 *   (#480/PR#491 : compact-local + consolidated-bottom) ; l'estampille
 *   snapshot Mobilité ne se répète plus ×7 — elle paraît une seule fois.
 */
import { computed } from 'vue'

import NoeudLecture from '@/components/fiche/NoeudLecture.vue'
import PassarelleExploration from '@/components/fiche/PassarelleExploration.vue'
import PuceRang from '@/components/fiche/PuceRang.vue'
import type { Payload, Theme } from '@/payload/types'

import LectureFigureProto from './LectureFigureProto.vue'
import { matiereTheme } from './matiere'
import type { MatiereTheme, SousGroupeMatiere, ValeurIndicateur } from './matiere'

const props = defineProps<{
  theme: Theme
  payload: Payload
  territoire: string
}>()

const matiere = computed<MatiereTheme>(() =>
  matiereTheme(props.payload, props.theme, props.territoire),
)

const labelsLq = computed(() => {
  const pl = props.payload.themeMetadata?.[props.theme]?.param_labels ?? {}
  return {
    rang: pl.rang ?? 'Rang',
    activite: pl.activity_label ?? 'Activité',
    lq: pl.lq ?? 'LQ',
  }
})

/** Le numéro d'appel d'une preuve (l'ordre du registre consolidé). */
function numeroPreuve(id: string | null | undefined): number | null {
  if (!id) return null
  const index = matiere.value.preuves.findIndex((p) => p.id === id)
  return index === -1 ? null : index + 1
}

/** Le premier appel resolvable d'une lecture à citations exhaustives. */
function numeroPreuveLecture(ids: readonly string[]): number | null {
  for (const id of ids) {
    const numero = numeroPreuve(id)
    if (numero !== null) return numero
  }
  return null
}

/** Toutes les valeurs d'un groupe — la principale d'abord, jamais doublée. */
function valeursDuGroupe(groupe: SousGroupeMatiere): ValeurIndicateur[] {
  return [groupe.valeurPrincipale, ...groupe.valeurs].filter(
    (v): v is ValeurIndicateur => v !== null,
  )
}

function numeroGroupe(index: number): string {
  return String(index + 1).padStart(2, '0')
}
</script>

<template>
  <article
    class="journal"
    :style="{
      '--couleur-strong': `var(--theme-${theme}-strong)`,
      '--couleur-soft': `var(--theme-${theme}-soft)`,
      '--couleur-line': `var(--theme-${theme}-line)`,
      '--couleur-nuage': `var(--theme-${theme})`,
    }"
  >
    <header class="journal-entete">
      <p class="journal-overline">{{ matiere.nomTheme }}</p>
      <span class="journal-tag-proto">variante A · jetable (#499)</span>
    </header>

    <section
      v-for="(groupe, index) in matiere.groupes"
      :key="groupe.key"
      class="journal-section"
      :data-groupe="groupe.key"
    >
      <header class="journal-section-tete">
        <span class="journal-numero" aria-hidden="true">{{ numeroGroupe(index) }}</span>
        <div class="journal-section-titre">
          <h3>{{ groupe.label }}</h3>
          <p class="journal-cadrage">{{ groupe.framing }}</p>
        </div>
      </header>

      <!-- La lecture — récit display, héros numéroté, figure élargie. -->
      <div v-if="groupe.lecture" class="journal-lecture">
        <p class="journal-recit voix-recit">
          <template v-for="(noeud, i) in groupe.lecture.template" :key="i">
            <NoeudLecture
              :noeud="noeud"
              :parametres="groupe.lecture.parametres"
              :nom-territoire="matiere.nomTerritoire"
            />
          </template>
        </p>

        <div v-if="groupe.lecture.valeursCles.length > 0" class="journal-heros">
          <span class="heros-valeur">{{ groupe.lecture.valeursCles[0].texte }}</span>
          <span v-if="groupe.lecture.valeursCles[0].unite" class="heros-unite">{{
            groupe.lecture.valeursCles[0].unite
          }}</span>
          <span class="heros-libelle">{{ groupe.lecture.valeursCles[0].libelle }}</span>
          <a
            v-if="numeroPreuveLecture(groupe.lecture.sourceIds)"
            class="journal-appel"
            href="#proto-preuves"
            :aria-label="`Preuve n° ${numeroPreuveLecture(groupe.lecture.sourceIds)} en bas de thème`"
            >{{ numeroPreuveLecture(groupe.lecture.sourceIds) }}</a
          >
        </div>

        <ul v-if="groupe.lecture.valeursCles.length > 1" class="journal-aux">
          <li v-for="cle in groupe.lecture.valeursCles.slice(1)" :key="cle.clef">
            <span class="aux-valeur">{{ cle.texte }}</span>
            <span v-if="cle.unite" class="aux-unite">{{ cle.unite }}</span>
            <span class="aux-libelle">{{ cle.libelle }}</span>
          </li>
        </ul>

        <div
          v-if="groupe.lecture.figure || groupe.lecture.lignesLQ.length"
          class="journal-canvas"
        >
          <LectureFigureProto
            :lecture="groupe.lecture"
            :nuage="matiere.nuage"
            :labels-lq="labelsLq"
          />
        </div>

        <nav
          v-if="groupe.lecture.passarelles.length > 0"
          class="journal-explorations"
          aria-label="Explorer les indicateurs de cette lecture"
        >
          <span class="journal-explorations-etiquette">Explorer</span>
          <PassarelleExploration
            v-for="passarelle in groupe.lecture.passarelles"
            :key="passarelle.clef"
            :to="passarelle.to"
            :libelle="passarelle.libelle"
          />
        </nav>
      </div>
      <p v-else-if="groupe.lectureIndisponible" class="journal-absente" role="note">
        La lecture de ce sous-groupe n’est pas disponible pour ce territoire.
      </p>

      <!-- Le registre — les indicateurs en lignes typographiques, jamais en cartes. -->
      <dl v-if="valeursDuGroupe(groupe).length > 0" class="journal-registre">
        <template v-for="valeur in valeursDuGroupe(groupe)" :key="valeur.clef">
          <div v-if="!valeur.multi" class="registre-ligne" :data-clef="valeur.clef">
            <dt class="registre-libelle">
              {{ valeur.libelle }}
              <span class="registre-conducteur" aria-hidden="true" />
            </dt>
            <dd class="registre-valeur-bloc">
              <span v-if="valeur.rang" class="registre-rang">
                <PuceRang :puce="valeur.rang" />
              </span>
              <span class="registre-nombre">{{ valeur.valeurTexte ?? '—' }}</span>
              <span v-if="valeur.unite && valeur.valeurTexte" class="registre-unite">{{
                valeur.unite
              }}</span>
              <a
                v-if="numeroPreuve(valeur.sourceId)"
                class="journal-appel"
                href="#proto-preuves"
                :aria-label="`Preuve n° ${numeroPreuve(valeur.sourceId)} en bas de thème`"
                >{{ numeroPreuve(valeur.sourceId) }}</a
              >
              <PassarelleExploration
                v-if="valeur.passarelle"
                :to="valeur.passarelle"
              />
            </dd>
          </div>

          <!-- Multi-détails : le libellé devient titre de paquet, chaque
               détail sa ligne avec SON rang (jamais celui de la 1ʳᵉ ligne). -->
          <div v-else class="registre-paquet" :data-clef="valeur.clef">
            <p class="registre-paquet-titre">
              {{ valeur.libelle }}
              <a
                v-if="numeroPreuve(valeur.sourceId)"
                class="journal-appel"
                href="#proto-preuves"
                :aria-label="`Preuve n° ${numeroPreuve(valeur.sourceId)} en bas de thème`"
                >{{ numeroPreuve(valeur.sourceId) }}</a
              >
              <PassarelleExploration v-if="valeur.passarelle" :to="valeur.passarelle" />
            </p>
            <div
              v-for="(tranche, ti) in valeur.tranches"
              :key="`${valeur.clef}-${ti}`"
              class="registre-ligne registre-ligne--detail"
            >
              <dt class="registre-libelle">
                {{ tranche.libelle }}
                <span class="registre-conducteur" aria-hidden="true" />
              </dt>
              <dd class="registre-valeur-bloc">
                <span v-if="tranche.rang" class="registre-rang">
                  <PuceRang :puce="tranche.rang" />
                </span>
                <span class="registre-nombre">{{ tranche.texte }}</span>
                <span v-if="tranche.unite" class="registre-unite">{{ tranche.unite }}</span>
              </dd>
            </div>
          </div>
        </template>
      </dl>
    </section>

    <!-- La consolidation des preuves — une seule fois par thème (#480). -->
    <footer id="proto-preuves" class="journal-preuves">
      <h4 class="preuves-titre">Sources de ce thème</h4>
      <ol class="preuves-liste">
        <li v-for="(preuve, pi) in matiere.preuves" :key="preuve.id">
          <span class="preuves-marqueur">{{ pi + 1 }}</span>
          <span class="preuves-corps">
            <strong>{{ preuve.dataset }}</strong>
            <span v-if="preuve.editeur" class="preuves-detail"> — {{ preuve.editeur }}</span>
            <span v-if="preuve.licence" class="preuves-detail"> · {{ preuve.licence }}</span>
            <span v-if="preuve.fraicheur" class="preuves-detail"> · {{ preuve.fraicheur }}</span>
            <span class="preuves-usage">cité{{ preuve.usages > 1 ? 'e' : '' }} ×{{ preuve.usages }}</span>
          </span>
        </li>
      </ol>
      <p v-if="matiere.estampille" class="preuves-estampille">{{ matiere.estampille }}</p>
      <p class="preuves-lien"><RouterLink to="/sources">Tous les jeux de données sur Sources</RouterLink></p>
    </footer>
  </article>
</template>

<style scoped>
.journal {
  max-width: 52rem;
  margin-inline: auto;
}

.journal-entete {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-4);
}

.journal-overline {
  margin: 0;
  font: var(--text-overline);
  letter-spacing: var(--text-overline-tracking);
  text-transform: uppercase;
  color: var(--couleur-strong);
}

.journal-tag-proto {
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
  color: var(--text-tertiary);
}

/* Une section de sous-groupe — un filet, un numéro, pas une boîte. */
.journal-section {
  margin-top: var(--space-10);
  padding-top: var(--space-6);
  border-top: 1px solid var(--border-default);
}

.journal-section-tete {
  display: flex;
  align-items: flex-start;
  gap: var(--space-4);
}

.journal-numero {
  font-family: var(--font-serif);
  font-size: 2rem;
  line-height: 1;
  color: var(--couleur-line);
  font-variant-numeric: tabular-nums;
}

.journal-section-titre h3 {
  margin: 0;
  font: 600 1.375rem/1.35 var(--font-serif);
  color: var(--couleur-strong);
}

.journal-cadrage {
  margin: var(--space-1) 0 0;
  font: var(--text-body-sm);
  color: var(--text-secondary);
}

/* La lecture — display serif, héros, figure large. */
.journal-lecture {
  margin-top: var(--space-5);
}

.journal-recit {
  margin: 0;
  font-size: clamp(1.25rem, 2.4vw, 1.55rem);
  line-height: 1.45;
  color: var(--text-primary);
}

.journal-recit :deep(.noeud-gras) {
  color: var(--couleur-strong);
}

.journal-recit :deep(.noeud-lien) {
  color: var(--couleur-strong);
  font-weight: 600;
}

/* LE nombre de la lecture — la hiérarchie que la grille aplatie (#448). */
.journal-heros {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-2) var(--space-3);
  margin-top: var(--space-5);
}

.heros-valeur {
  font-family: var(--font-sans);
  font-size: clamp(3rem, 6vw, 3.75rem);
  font-weight: var(--text-numeric-weight);
  font-variant-numeric: var(--text-numeric-variant);
  line-height: 1;
  letter-spacing: -0.02em;
  color: var(--couleur-strong);
}

.heros-unite {
  font: var(--text-body-lg);
  color: var(--text-secondary);
}

.heros-libelle {
  flex-basis: 100%;
  font: var(--text-body-sm);
  color: var(--text-secondary);
}

.journal-appel {
  padding: 0 var(--space-1);
  border-radius: var(--radius-sm);
  background: var(--couleur-soft);
  color: var(--couleur-strong);
  font: 600 var(--text-caption)/1.4 var(--font-sans);
  vertical-align: super;
}

.journal-appel:hover {
  background: var(--couleur-line);
  color: var(--surface-primary);
}

.journal-aux {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-6);
  margin: var(--space-4) 0 0;
  padding: 0;
  list-style: none;
}

.aux-valeur {
  font-weight: var(--text-numeric-weight);
  font-variant-numeric: var(--text-numeric-variant);
  font-size: 1.125rem;
  color: var(--text-primary);
}

.aux-unite {
  margin-left: 0.2em;
  font: var(--text-caption);
  color: var(--text-secondary);
}

.aux-libelle {
  margin-left: var(--space-2);
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
  color: var(--text-tertiary);
}

.journal-canvas {
  /* La figure élargie — la variable hérite vers les graphiques ECharts. */
  --figure-compact-height: 300px;
  --figure-compact-max-height: 420px;
  margin-top: var(--space-5);
}

.journal-explorations {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-2) var(--space-4);
  margin-top: var(--space-4);
}

.journal-explorations-etiquette {
  font: var(--text-overline);
  letter-spacing: var(--text-overline-tracking);
  text-transform: uppercase;
  color: var(--couleur-strong);
}

.journal-absente {
  margin: var(--space-5) 0 0;
  padding: var(--space-3) var(--space-4);
  border-left: 3px solid var(--couleur-line);
  background: var(--surface-primary);
  font: var(--text-body-sm);
  color: var(--text-secondary);
}

/* Le registre — pointillés de conduite, aucune carte. */
.journal-registre {
  margin: var(--space-6) 0 0;
}

.registre-ligne {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  padding: var(--space-2) 0;
}

.registre-libelle {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  align-items: baseline;
  gap: var(--space-2);
  margin: 0;
  font: var(--text-body-sm);
  color: var(--text-primary);
}

.registre-conducteur {
  flex: 1 1 24px;
  min-width: 24px;
  border-bottom: 2px dotted var(--border-default);
  transform: translateY(-0.28em);
}

.registre-valeur-bloc {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  white-space: nowrap;
}

.registre-nombre {
  font-family: var(--font-sans);
  font-size: 1.375rem;
  font-weight: var(--text-numeric-weight);
  font-variant-numeric: var(--text-numeric-variant);
  line-height: 1.1;
  color: var(--text-primary);
}

.registre-unite {
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
  color: var(--text-secondary);
}

.registre-paquet {
  padding: var(--space-2) 0;
}

.registre-paquet-titre {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-2);
  margin: 0;
  font: 600 var(--text-body-sm);
  color: var(--text-primary);
}

.registre-ligne--detail .registre-libelle {
  padding-left: var(--space-6);
  color: var(--text-secondary);
}

.registre-ligne--detail .registre-nombre {
  font-size: 1.125rem;
}

/* Les preuves consolidées — une fois, en bas de thème. */
.journal-preuves {
  margin-top: var(--space-12);
  padding-top: var(--space-6);
  border-top: 2px solid var(--couleur-line);
}

.preuves-titre {
  margin: 0 0 var(--space-4);
  font: var(--text-overline);
  letter-spacing: var(--text-overline-tracking);
  text-transform: uppercase;
  color: var(--couleur-strong);
}

.preuves-liste {
  display: grid;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
  font: var(--text-body-sm);
  color: var(--text-secondary);
}

.preuves-liste li {
  display: flex;
  gap: var(--space-3);
  align-items: baseline;
}

.preuves-marqueur {
  flex: none;
  min-width: 1.4rem;
  font: 600 var(--text-caption)/1.6 var(--font-sans);
  color: var(--couleur-strong);
}

.preuves-corps strong {
  color: var(--text-primary);
  font-weight: 600;
}

.preuves-usage {
  margin-left: var(--space-2);
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
  color: var(--text-tertiary);
}

.preuves-estampille {
  margin: var(--space-5) 0 0;
  font: var(--text-body-sm);
  font-weight: 600;
  color: var(--couleur-strong);
}

.preuves-lien {
  margin: var(--space-2) 0 0;
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
}

@media (max-width: 640px) {
  .registre-ligne {
    flex-direction: column;
    gap: var(--space-1);
  }

  .registre-conducteur {
    display: none;
  }

  .registre-libelle {
    width: 100%;
  }

  .registre-valeur-bloc {
    flex-wrap: wrap;
    white-space: normal;
    padding-left: var(--space-6);
  }
}
</style>
