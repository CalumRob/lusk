<script setup lang="ts">
/**
 * [PROTOTYPE #499 — JETABLE] Variante B — « Le cahier ».
 *
 * La propriété du sous-groupe est L'IDÉE STRUCTURANTE : chaque sous-groupe
 * devient une double-page pleine largeur — bordure de thème à gauche, lavis
 * alterné — qui POSSEDE visuellement tout son contenu :
 *
 * - un RAIL latéral collant porte le numéro, le titre, le cadrage, la
 *   lecture en voix récit et les passarelles « Explorer » empilées ;
 * - le tapis de droite pose des TUILES INÉGALES (la figure de lecture
 *   ~320 px pleine largeur, la figure compacte du groupe plus grande que
 *   les scalaires, les multi-détails en dalles) — des cartes, mais
 *   possédées par la bande et jamais alignées sur des rangées forcées,
 *   contrairement à la grille rigide (#445/PR#455 F4/F5) ;
 * - la présentation est RANG-D'ABORD : chaque tuile scalaire ouvre sur son
 *   classement (« ▲ 3e/41 de l'EPCI ») avant sa valeur — l'inverse de la
 *   coquille actuelle où la puce disparaît (#448/PR#451 F3) ;
 * - provenance hybride : micro-estampille dans le pied de chaque tuile +
 *   ligne « Preuves de la section », puis registre complet consolidé une
 *   fois en bas ; l'estampille snapshot ne paraît qu'une fois.
 */
import { computed } from 'vue'

import NoeudLecture from '@/components/fiche/NoeudLecture.vue'
import PassarelleExploration from '@/components/fiche/PassarelleExploration.vue'
import type { Payload, Theme } from '@/payload/types'
import type { ValeurIndicateur } from './matiere'

import LectureFigureProto from './LectureFigureProto.vue'
import { matiereTheme } from './matiere'
import type { MatiereTheme, SousGroupeMatiere } from './matiere'

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

/** Les clés multi-détails posées en dalle pleine largeur. */
function estDalle(valeur: ValeurIndicateur): boolean {
  return valeur.multi || valeur.clef === 'reseaux' || valeur.clef === 'structure_age'
}

function classeTuile(valeur: ValeurIndicateur, principale: boolean): string {
  if (estDalle(valeur)) return 'tuile--dalle'
  if (principale) return 'tuile--principale'
  return 'tuile--scalaire'
}

function valeursDuGroupe(groupe: SousGroupeMatiere): ValeurIndicateur[] {
  return [groupe.valeurPrincipale, ...groupe.valeurs].filter(
    (v): v is ValeurIndicateur => v !== null,
  )
}

/** Les micro-preuves uniques de la section (compact-local, dédupliqué). */
function preuvesDuGroupe(groupe: SousGroupeMatiere): string[] {
  const noms = new Set<string>()
  for (const valeur of valeursDuGroupe(groupe)) {
    if (valeur.sourceCourte) noms.add(valeur.sourceCourte)
  }
  if (groupe.lecture?.sourceCourte) noms.add(groupe.lecture.sourceCourte)
  return [...noms]
}
</script>

<template>
  <article
    class="cahier"
    :style="{
      '--couleur-strong': `var(--theme-${theme}-strong)`,
      '--couleur-soft': `var(--theme-${theme}-soft)`,
      '--couleur-line': `var(--theme-${theme}-line)`,
      '--couleur-nuage': `var(--theme-${theme})`,
    }"
  >
    <header class="cahier-entete">
      <p class="cahier-overline">{{ matiere.nomTheme }}</p>
      <span class="cahier-tag-proto">variante B · jetable (#499)</span>
    </header>

    <section
      v-for="(groupe, gi) in matiere.groupes"
      :key="groupe.key"
      class="cahier-double"
      :class="{ 'cahier-double--alterne': gi % 2 === 1 }"
      :data-groupe="groupe.key"
    >
      <!-- Le rail possesseur — collant pendant la bande défile. -->
      <div class="cahier-rail">
        <span class="rail-numero" aria-hidden="true">{{ String(gi + 1).padStart(2, '0') }}</span>
        <h3 class="rail-titre">{{ groupe.label }}</h3>
        <p class="rail-cadrage">{{ groupe.framing }}</p>

        <template v-if="groupe.lecture">
          <p class="rail-recit voix-recit">
            <template v-for="(noeud, i) in groupe.lecture.template" :key="i">
              <NoeudLecture
                :noeud="noeud"
                :parametres="groupe.lecture.parametres"
                :nom-territoire="matiere.nomTerritoire"
              />
            </template>
          </p>

          <nav
            v-if="groupe.lecture.passarelles.length > 0"
            class="rail-explorations"
            aria-label="Explorer les indicateurs de cette lecture"
          >
            <PassarelleExploration
              v-for="passarelle in groupe.lecture.passarelles"
              :key="passarelle.clef"
              :to="passarelle.to"
              :libelle="passarelle.libelle"
            />
          </nav>
        </template>
        <p v-else-if="groupe.lectureIndisponible" class="rail-absente" role="note">
          Lecture non disponible pour ce territoire.
        </p>
      </div>

      <!-- Le tapis — des tuiles inégales possédées par la bande. -->
      <div class="cahier-tapis">
        <div
          v-if="groupe.lecture && (groupe.lecture.figure || groupe.lecture.lignesLQ.length)"
          class="tuile tuile--lecture"
        >
          <LectureFigureProto
            :lecture="groupe.lecture"
            :nuage="matiere.nuage"
            :labels-lq="labelsLq"
          />
          <footer class="tuile-pied">
            <span v-if="groupe.lecture.sourceCourte" class="tuile-stamp">{{
              groupe.lecture.sourceCourte
            }}</span>
            <PassarelleExploration
              v-for="passarelle in groupe.lecture.passarelles.slice(0, 2)"
              :key="passarelle.clef"
              :to="passarelle.to"
              :libelle="passarelle.libelle"
            />
          </footer>
        </div>

        <div
          v-for="(valeur, vi) in valeursDuGroupe(groupe)"
          :key="valeur.clef"
          class="tuile carte-figure"
          :class="classeTuile(valeur, !groupe.lecture && vi === 0)"
          :data-clef="valeur.clef"
        >
          <!-- RANG D'ABORD : le classement ouvre la tuile. -->
          <p
            v-if="valeur.rang && !valeur.multi"
            class="tuile-classement"
            role="img"
            :aria-label="valeur.rang.phrase"
            :title="valeur.rang.phrase"
          >
            <span class="classement-glyphe" aria-hidden="true">{{ valeur.rang.glyphe }}</span>
            <span class="classement-texte">{{ valeur.rang.rang }}</span>
          </p>

          <template v-if="!valeur.multi">
            <p class="tuile-valeur" :class="{ 'tuile-valeur--forte': vi === 0 }">
              {{ valeur.valeurTexte ?? '—' }}
              <span v-if="valeur.unite && valeur.valeurTexte" class="tuile-unite">{{
                valeur.unite
              }}</span>
            </p>
            <p class="tuile-libelle">{{ valeur.libelle }}</p>
            <p v-if="valeur.rider" class="tuile-rider">{{ valeur.rider }}</p>
          </template>

          <template v-else>
            <p class="tuile-libelle">{{ valeur.libelle }}</p>
            <ul class="tuile-tranches">
              <li v-for="(tranche, ti) in valeur.tranches" :key="`${valeur.clef}-${ti}`">
                <span class="tranche-libelle">{{ tranche.libelle }}</span>
                <span v-if="tranche.rang" class="tranche-rang"
                  ><span aria-hidden="true">{{ tranche.rang.glyphe }}</span>
                  {{ tranche.rang.rang }}</span
                >
                <span class="tranche-valeur">{{ tranche.texte }}<small>{{ tranche.unite }}</small></span>
              </li>
            </ul>
          </template>

          <footer class="tuile-pied">
            <span v-if="valeur.sourceCourte" class="tuile-stamp">{{ valeur.sourceCourte }}</span>
            <PassarelleExploration v-if="valeur.passarelle" :to="valeur.passarelle" />
          </footer>
        </div>

        <!-- La ligne de preuves de section — compacte, dédupliquée. -->
        <p v-if="preuvesDuGroupe(groupe).length > 0" class="cahier-preuves-bande">
          Preuves de la section — {{ preuvesDuGroupe(groupe).join(' · ') }}
        </p>
      </div>
    </section>

    <!-- La consolidation complète — une fois par thème. -->
    <footer class="cahier-registre">
      <h4 class="registre-titre">Sources de ce thème</h4>
      <dl class="registre-grille">
        <div v-for="preuve in matiere.preuves" :key="preuve.id" class="registre-entree">
          <dt>{{ preuve.dataset }}</dt>
          <dd>
            <span v-if="preuve.editeur">{{ preuve.editeur }}</span>
            <span v-if="preuve.licence"> · {{ preuve.licence }}</span>
            <span v-if="preuve.fraicheur"> · {{ preuve.fraicheur }}</span>
            <span class="registre-usages">×{{ preuve.usages }}</span>
          </dd>
        </div>
      </dl>
      <p v-if="matiere.estampille" class="registre-estampille">{{ matiere.estampille }}</p>
      <p class="registre-lien"><RouterLink to="/sources">Tous les jeux de données sur Sources</RouterLink></p>
    </footer>
  </article>
</template>

<style scoped>
.cahier {
  max-width: var(--content-max-width);
  margin-inline: auto;
}

.cahier-entete {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-4);
}

.cahier-overline {
  margin: 0;
  font: var(--text-overline);
  letter-spacing: var(--text-overline-tracking);
  text-transform: uppercase;
  color: var(--couleur-strong);
}

.cahier-tag-proto {
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
  color: var(--text-tertiary);
}

/* La double-page — la bande qui POSSÈDE son contenu. */
.cahier-double {
  display: grid;
  grid-template-columns: minmax(240px, 280px) minmax(0, 1fr);
  gap: var(--space-8);
  margin-top: var(--space-10);
  padding: var(--space-6);
  border-left: 3px solid var(--couleur-strong);
  border-radius: var(--radius-sm);
  background: var(--surface-primary);
}

/* Le lavis alterné marque visuellement le changement de propriétaire. */
.cahier-double--alterne {
  background: color-mix(in oklab, var(--couleur-soft) 45%, var(--surface-primary));
}

.cahier-rail {
  position: sticky;
  top: calc(var(--header-height) + var(--space-4));
  align-self: start;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.rail-numero {
  font-family: var(--font-serif);
  font-size: 2.25rem;
  line-height: 1;
  color: var(--couleur-line);
  font-variant-numeric: tabular-nums;
}

.rail-titre {
  margin: 0;
  font: 600 1.1875rem/1.4 var(--font-serif);
  color: var(--couleur-strong);
}

.rail-cadrage {
  margin: 0;
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
  color: var(--text-secondary);
}

.rail-recit {
  margin: var(--space-2) 0 0;
  font-size: 1rem;
  line-height: 1.6;
  color: var(--text-primary);
}

.rail-recit :deep(.noeud-gras),
.rail-recit :deep(.noeud-lien) {
  color: var(--couleur-strong);
}

.rail-explorations {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-1);
  padding-top: var(--space-2);
  border-top: 1px solid var(--couleur-line);
}

.rail-absente {
  margin: var(--space-2) 0 0;
  font: var(--text-body-sm);
  color: var(--text-secondary);
}

/* Le tapis — tuiles inégales, aucune rangée forcée. */
.cahier-tapis {
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
  gap: var(--space-5);
}

.tuile {
  --figure-compact-height: 260px;
  --figure-compact-max-height: none;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.tuile--lecture {
  --figure-compact-height: 320px;
  flex: 1 1 100%;
}

.tuile--principale {
  flex: 1 1 calc(55% - var(--space-5));
}

.tuile--scalaire {
  flex: 1 1 calc(33% - var(--space-5));
}

.tuile--dalle {
  flex: 1 1 100%;
}

.tuile-classement {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  margin: 0;
}

.classement-glyphe {
  font-size: 1.125rem;
  color: var(--couleur-strong);
}

.classement-texte {
  font-family: var(--font-sans);
  font-size: 1.25rem;
  font-weight: var(--text-numeric-weight);
  font-variant-numeric: var(--text-numeric-variant);
  color: var(--couleur-strong);
}

.tuile-valeur {
  margin: 0;
  font-family: var(--font-sans);
  font-size: 1.75rem;
  font-weight: var(--text-numeric-weight);
  font-variant-numeric: var(--text-numeric-variant);
  line-height: 1.15;
  color: var(--text-primary);
}

.tuile-valeur--forte {
  font-size: 2.25rem;
  color: var(--couleur-strong);
}

.tuile-unite {
  font: var(--text-body-sm);
  font-weight: 400;
  color: var(--text-secondary);
}

.tuile-libelle {
  margin: 0;
  font: var(--text-body-sm);
  font-weight: 600;
  color: var(--text-primary);
}

.tuile-rider {
  margin: 0;
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
  color: var(--text-secondary);
}

.tuile-tranches {
  display: grid;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.tuile-tranches li {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-2) var(--space-4);
}

.tranche-libelle {
  flex: 1 1 auto;
  min-width: 40%;
  font: var(--text-body-sm);
  color: var(--text-secondary);
}

.tranche-rang {
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
  color: var(--couleur-strong);
}

.tranche-valeur {
  font-weight: var(--text-numeric-weight);
  font-variant-numeric: var(--text-numeric-variant);
  color: var(--text-primary);
}

.tranche-valeur small {
  margin-left: 0.25em;
  font-weight: 400;
  color: var(--text-secondary);
}

.tuile-pied {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
  margin-top: auto;
  padding-top: var(--space-2);
  border-top: 1px solid var(--border-subtle);
}

.tuile-stamp {
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
  color: var(--text-tertiary);
}

.cahier-preuves-bande {
  flex: 1 1 100%;
  margin: 0;
  padding-top: var(--space-3);
  border-top: 1px dashed var(--couleur-line);
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
  color: var(--text-tertiary);
}

/* La consolidation complète — une fois. */
.cahier-registre {
  margin-top: var(--space-12);
  padding-top: var(--space-6);
  border-top: 2px solid var(--couleur-line);
}

.registre-titre {
  margin: 0 0 var(--space-4);
  font: var(--text-overline);
  letter-spacing: var(--text-overline-tracking);
  text-transform: uppercase;
  color: var(--couleur-strong);
}

.registre-grille {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: var(--space-3) var(--space-8);
  margin: 0;
}

.registre-entree dt {
  font: 600 var(--text-body-sm);
  color: var(--text-primary);
}

.registre-entree dd {
  margin: 0;
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
  color: var(--text-secondary);
}

.registre-usages {
  margin-left: var(--space-2);
  color: var(--text-tertiary);
}

.registre-estampille {
  margin: var(--space-5) 0 0;
  font: var(--text-body-sm);
  font-weight: 600;
  color: var(--couleur-strong);
}

.registre-lien {
  margin: var(--space-2) 0 0;
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
}

@media (max-width: 900px) {
  .cahier-double {
    grid-template-columns: 1fr;
    gap: var(--space-5);
  }

  .cahier-rail {
    position: static;
  }

  .tuile--scalaire,
  .tuile--principale {
    flex: 1 1 100%;
  }
}
</style>
