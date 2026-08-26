<script setup lang="ts">
/**
 * [PROTOTYPE #499 — JETABLE] Variante C — « Le fil ».
 *
 * La structure est NAVIGATIONNELLE, pas spatiale : un sommaire collant de
 * puces-ancre donne au sous-groupe une propriété par SAUT (pas par boîte),
 * puis chaque sous-groupe devient UN moment prioritaire du fil :
 *
 * - LE nombre du moment en très grand (~72 px) — la lecture d'abord, son
 *   chiffre comme titre de section ; les groupes sans lecture héritent du
 *   nombre de leur figure compacte déclarée ;
 * - la phrase récit puis la figure élargie (~360 px) ;
 * - un BANDEAU horizontal de chiffres (densité anti-carte : valeurs 30 px,
 *   unités attachées, rangs en superscript, filets verticaux, défilement
 *   latéral mobile) — chaque DÉTAIL d'un multi-détails y a sa colonne avec
 *   SON propre rang ;
 * - la provenance presque entièrement consolidée (#480/PR#491) : un
 *   <details> « Preuves & détails » par moment porte vintages complets et
 *   liens Explorer ; le registre exhaustif (éditeur · licence · fraîcheur)
 *   paraît UNE fois en bas ; l'estampille snapshot aussi.
 */
import { computed } from 'vue'

import NoeudLecture from '@/components/fiche/NoeudLecture.vue'
import PassarelleExploration from '@/components/fiche/PassarelleExploration.vue'
import PuceRang from '@/components/fiche/PuceRang.vue'
import type { Payload, Theme } from '@/payload/types'
import type { RouteLocationRaw } from 'vue-router'

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

/** Une colonne du bandeau de chiffres. */
interface ItemBandeau {
  clef: string
  texte: string
  unite: string
  libelle: string
  rang: { glyphe: string; rang: string; phrase: string } | null
}

/** Le héros du moment : le 1er nombre-clé de la lecture, sinon la figure
 *  compacte déclarée du groupe — sa première tranche quand elle est
 *  multi-détails (un moment garde toujours SON nombre dominant). */
function herosDuGroupe(groupe: SousGroupeMatiere): {
  texte: string
  unite: string | null
  libelle: string
} | null {
  const premiere = groupe.lecture?.valeursCles[0]
  if (premiere) return { texte: premiere.texte, unite: premiere.unite, libelle: premiere.libelle }
  const principale = groupe.valeurPrincipale
  if (!principale || !principale.valeurTexte) return null
  if (!principale.multi) {
    return {
      texte: principale.valeurTexte,
      unite: principale.unite || null,
      libelle: principale.libelle,
    }
  }
  const tranche = principale.tranches[0]
  return tranche
    ? { texte: tranche.texte, unite: tranche.unite || null, libelle: tranche.libelle || principale.libelle }
    : null
}

/** Le bandeau — les autres nombres du moment, détails dépliés. */
function itemsBandeau(groupe: SousGroupeMatiere): ItemBandeau[] {
  const items: ItemBandeau[] = []
  for (const cle of groupe.lecture?.valeursCles.slice(1) ?? []) {
    items.push({
      clef: `lecture-${cle.clef}`,
      texte: cle.texte,
      unite: cle.unite ?? '',
      libelle: cle.libelle,
      rang: null,
    })
  }

  // La figure compacte ne revient PAS si elle est déjà le héros (entière
  // pour un scalaire, première tranche seulement pour un multi-détails).
  const herosEstPrincipale =
    !groupe.lecture?.valeursCles.length && groupe.valeurPrincipale !== null

  for (const [vi, valeur] of [
    groupe.valeurPrincipale,
    ...groupe.valeurs,
  ].entries()) {
    if (valeur === null) continue
    if (herosEstPrincipale && vi === 0 && !valeur.multi) continue
    if (!valeur.multi) {
      items.push({
        clef: valeur.clef,
        texte: valeur.valeurTexte ?? '—',
        unite: valeur.unite,
        libelle: valeur.libelle,
        rang: valeur.rang
          ? { glyphe: valeur.rang.glyphe, rang: valeur.rang.rang, phrase: valeur.rang.phrase }
          : null,
      })
      continue
    }
    valeur.tranches.forEach((tranche, ti) => {
      if (herosEstPrincipale && vi === 0 && ti === 0) return
      items.push({
        clef: `${valeur.clef}-${ti}`,
        texte: tranche.texte,
        unite: tranche.unite,
        libelle: tranche.libelle || valeur.libelle,
        rang: tranche.rang
          ? { glyphe: tranche.rang.glyphe, rang: tranche.rang.rang, phrase: tranche.rang.phrase }
          : null,
      })
    })
  }
  return items
}

/** Le cluster « Explorer » du moment — toutes les passarelles dédupliquées. */
function passarellesDuMoment(groupe: SousGroupeMatiere): Array<{
  clef: string
  libelle: string
  to: RouteLocationRaw
}> {
  const vues = new Map<string, { clef: string; libelle: string; to: RouteLocationRaw }>()
  for (const passarelle of groupe.lecture?.passarelles ?? []) {
    vues.set(passarelle.clef, passarelle)
  }
  for (const valeur of [groupe.valeurPrincipale, ...groupe.valeurs]) {
    if (valeur === null || !valeur.passarelle) continue
    if (!vues.has(valeur.clef)) {
      vues.set(valeur.clef, { clef: valeur.clef, libelle: valeur.libelle, to: valeur.passarelle })
    }
  }
  return [...vues.values()]
}

function defilerVers(key: string): void {
  document.getElementById(`fil-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
</script>

<template>
  <article
    class="fil"
    :style="{
      '--couleur-strong': `var(--theme-${theme}-strong)`,
      '--couleur-soft': `var(--theme-${theme}-soft)`,
      '--couleur-line': `var(--theme-${theme}-line)`,
      '--couleur-nuage': `var(--theme-${theme})`,
    }"
  >
    <header class="fil-entete">
      <p class="fil-overline">{{ matiere.nomTheme }}</p>
      <span class="fil-tag-proto">variante C · jetable (#499)</span>
    </header>

    <!-- Le sommaire collant — la propriété des sous-groupes par saut. -->
    <nav class="fil-sommaire" aria-label="Sous-groupes du thème">
      <button
        v-for="groupe in matiere.groupes"
        :key="groupe.key"
        type="button"
        class="sommaire-puce"
        @click="defilerVers(groupe.key)"
      >
        {{ groupe.label }}
      </button>
    </nav>

    <section
      v-for="(groupe, gi) in matiere.groupes"
      :id="`fil-${groupe.key}`"
      :key="groupe.key"
      class="fil-moment"
      :data-groupe="groupe.key"
    >
      <header class="moment-tete">
        <span class="moment-numero" aria-hidden="true">{{ String(gi + 1).padStart(2, '0') }}</span>
        <div class="moment-titre">
          <h3>{{ groupe.label }}</h3>
          <p v-if="herosDuGroupe(groupe)" class="moment-heros">
            <span class="heros-nombre">{{ herosDuGroupe(groupe)!.texte }}</span>
            <span v-if="herosDuGroupe(groupe)!.unite" class="heros-unite">{{
              herosDuGroupe(groupe)!.unite
            }}</span>
            <span class="heros-libelle">{{ herosDuGroupe(groupe)!.libelle }}</span>
          </p>
        </div>
      </header>

      <p v-if="groupe.lecture" class="moment-recit voix-recit">
        <template v-for="(noeud, i) in groupe.lecture.template" :key="i">
          <NoeudLecture
            :noeud="noeud"
            :parametres="groupe.lecture.parametres"
            :nom-territoire="matiere.nomTerritoire"
          />
        </template>
      </p>
      <p v-else-if="groupe.lectureIndisponible" class="moment-absente" role="note">
        La lecture de ce sous-groupe n’est pas disponible pour ce territoire.
      </p>

      <div
        v-if="groupe.lecture && (groupe.lecture.figure || groupe.lecture.lignesLQ.length)"
        class="moment-canvas"
      >
        <LectureFigureProto
          :lecture="groupe.lecture"
          :nuage="matiere.nuage"
          :labels-lq="labelsLq"
        />
      </div>

      <!-- Le bandeau de chiffres — densité horizontale, aucun cadre. -->
      <div
        v-if="itemsBandeau(groupe).length > 0"
        class="moment-bandeau"
        role="list"
        :aria-label="`Les chiffres de ${groupe.label}`"
      >
        <div
          v-for="item in itemsBandeau(groupe)"
          :key="item.clef"
          class="bandeau-item"
          role="listitem"
        >
          <p
            v-if="item.rang"
            class="bandeau-rang"
            role="img"
            :aria-label="item.rang.phrase"
            :title="item.rang.phrase"
          >
            <span aria-hidden="true">{{ item.rang.glyphe }}</span> {{ item.rang.rang }}
          </p>
          <p class="bandeau-valeur">
            {{ item.texte }}<small v-if="item.unite">{{ item.unite }}</small>
          </p>
          <p class="bandeau-libelle">{{ item.libelle }}</p>
        </div>
      </div>

      <!-- Les preuves locales repliées — le compact le plus serré. -->
      <details v-if="itemsBandeau(groupe).length > 0" class="moment-preuves">
        <summary>Preuves &amp; détails</summary>
        <ul class="preuves-detail-liste">
          <template v-for="valeur in [groupe.valeurPrincipale, ...groupe.valeurs]" :key="valeur?.clef ?? 'aucune'">
            <li v-if="valeur && !valeur.multi" class="detail-ligne">
              <span class="detail-libelle">{{ valeur.libelle }}</span>
              <span class="detail-valeur"
                >{{ valeur.valeurTexte ?? '—'
                }}<small v-if="valeur.unite && valeur.valeurTexte">{{ valeur.unite }}</small></span
              >
              <PuceRang v-if="valeur.rang" :puce="valeur.rang" />
              <span v-if="valeur.vintageComplet" class="detail-vintage">{{
                valeur.vintageComplet
              }}</span>
              <PassarelleExploration v-if="valeur.passarelle" :to="valeur.passarelle" />
            </li>
            <li
              v-for="(tranche, ti) in valeur?.tranches ?? []"
              :key="`${valeur?.clef}-${ti}`"
              class="detail-ligne detail-ligne--sous"
            >
              <span class="detail-libelle">{{ tranche.libelle }}</span>
              <span class="detail-valeur"
                >{{ tranche.texte }}<small v-if="tranche.unite">{{ tranche.unite }}</small></span
              >
              <PuceRang v-if="tranche.rang" :puce="tranche.rang" />
            </li>
          </template>
          <li v-if="groupe.lecture?.sourceComplete" class="detail-ligne">
            <span class="detail-libelle">Lecture — source</span>
            <span class="detail-vintage detail-vintage--large">{{ groupe.lecture.sourceComplete }}</span>
          </li>
        </ul>
      </details>

      <!-- Le cluster Explorer du moment. -->
      <nav
        v-if="passarellesDuMoment(groupe).length > 0"
        class="moment-explorations"
        aria-label="Explorer sur les Pages d’indicateur"
      >
        <span class="explorations-etiquette">Explorer</span>
        <PassarelleExploration
          v-for="passarelle in passarellesDuMoment(groupe)"
          :key="passarelle.clef"
          :to="passarelle.to"
          :libelle="passarelle.libelle"
        />
      </nav>
    </section>

    <!-- Le registre exhaustif — une seule fois. -->
    <footer class="fil-registre">
      <h4 class="registre-titre">Registre des preuves</h4>
      <ol class="registre-liste">
        <li v-for="preuve in matiere.preuves" :key="preuve.id">
          <strong>{{ preuve.dataset }}</strong>
          <span v-if="preuve.editeur"> — {{ preuve.editeur }}</span>
          <span v-if="preuve.licence"> · {{ preuve.licence }}</span>
          <span v-if="preuve.fraicheur"> · {{ preuve.fraicheur }}</span>
          <span class="registre-usages">cité ×{{ preuve.usages }}</span>
        </li>
      </ol>
      <p v-if="matiere.estampille" class="registre-estampille">{{ matiere.estampille }}</p>
      <p class="registre-lien"><RouterLink to="/sources">Tous les jeux de données sur Sources</RouterLink></p>
    </footer>
  </article>
</template>

<style scoped>
.fil {
  max-width: 60rem;
  margin-inline: auto;
}

.fil-entete {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-4);
}

.fil-overline {
  margin: 0;
  font: var(--text-overline);
  letter-spacing: var(--text-overline-tracking);
  text-transform: uppercase;
  color: var(--couleur-strong);
}

.fil-tag-proto {
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
  color: var(--text-tertiary);
}

/* Le sommaire collant. */
.fil-sommaire {
  position: sticky;
  top: var(--header-height);
  z-index: var(--z-sticky);
  display: flex;
  gap: var(--space-2);
  overflow-x: auto;
  padding: var(--space-3) 0;
  margin-top: var(--space-4);
  background: inherit;
}

.sommaire-puce {
  flex: none;
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-full);
  background: var(--surface-primary);
  color: var(--text-secondary);
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
  cursor: pointer;
}

.sommaire-puce:hover {
  border-color: var(--couleur-strong);
  color: var(--couleur-strong);
}

/* Un moment du fil. */
.fil-moment {
  scroll-margin-top: calc(var(--header-height) + 64px);
  padding: var(--space-8) 0 var(--space-6);
  border-top: 1px solid var(--border-default);
}

.moment-tete {
  display: flex;
  align-items: flex-start;
  gap: var(--space-5);
}

.moment-numero {
  font-family: var(--font-serif);
  font-size: 1.75rem;
  line-height: 1;
  color: var(--couleur-line);
  font-variant-numeric: tabular-nums;
}

.moment-titre h3 {
  margin: 0;
  font: 600 1rem/1.4 var(--font-sans);
  text-transform: uppercase;
  letter-spacing: var(--text-overline-tracking);
  color: var(--text-secondary);
}

/* LE nombre du moment. */
.moment-heros {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  margin: var(--space-2) 0 0;
}

.heros-nombre {
  font-family: var(--font-sans);
  font-size: clamp(3.25rem, 7vw, 4.5rem);
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

.moment-recit {
  margin: var(--space-4) 0 0;
  max-width: 46rem;
  font-size: 1.25rem;
  line-height: 1.55;
  color: var(--text-primary);
}

.moment-recit :deep(.noeud-gras),
.moment-recit :deep(.noeud-lien) {
  color: var(--couleur-strong);
}

.moment-absente {
  margin: var(--space-4) 0 0;
  font: var(--text-body-sm);
  color: var(--text-secondary);
}

.moment-canvas {
  --figure-compact-height: 360px;
  --figure-compact-max-height: none;
  margin-top: var(--space-5);
}

/* Le bandeau — la densité sans cartes. */
.moment-bandeau {
  display: flex;
  overflow-x: auto;
  margin-top: var(--space-6);
  border-block: 1px solid var(--border-default);
}

.bandeau-item {
  flex: none;
  min-width: 150px;
  max-width: 240px;
  padding: var(--space-4) var(--space-5);
  border-right: 1px solid var(--border-subtle);
}

.bandeau-item:first-child {
  padding-left: 0;
}

.bandeau-item:last-child {
  border-right: none;
}

.bandeau-rang {
  margin: 0 0 var(--space-1);
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
  color: var(--couleur-strong);
}

.bandeau-valeur {
  margin: 0;
  font-size: 1.875rem;
  font-weight: var(--text-numeric-weight);
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
  color: var(--text-primary);
}

.bandeau-valeur small {
  margin-left: 0.25em;
  font-size: 0.6875rem;
  font-weight: 400;
  letter-spacing: var(--text-caption-tracking);
  color: var(--text-secondary);
}

.bandeau-libelle {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  margin: var(--space-1) 0 0;
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
  color: var(--text-tertiary);
}

/* Les preuves locales repliées. */
.moment-preuves {
  margin-top: var(--space-4);
}

.moment-preuves summary {
  width: fit-content;
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
  font-weight: 600;
  color: var(--text-secondary);
  cursor: pointer;
}

.moment-preuves summary:hover {
  color: var(--couleur-strong);
}

.preuves-detail-liste {
  display: grid;
  gap: var(--space-2);
  margin: var(--space-3) 0 0;
  padding: var(--space-3);
  border-left: 2px solid var(--couleur-line);
  background: var(--surface-primary);
  list-style: none;
}

.detail-ligne {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-2) var(--space-4);
  font: var(--text-body-sm);
  color: var(--text-primary);
}

.detail-ligne--sous .detail-libelle {
  color: var(--text-secondary);
}

.detail-libelle {
  flex: 1 1 auto;
  min-width: 40%;
}

.detail-valeur {
  font-weight: var(--text-numeric-weight);
  font-variant-numeric: tabular-nums;
}

.detail-valeur small {
  margin-left: 0.25em;
  font-weight: 400;
  color: var(--text-secondary);
}

.detail-vintage {
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
  color: var(--text-tertiary);
}

.detail-vintage--large {
  flex-basis: 100%;
}

/* Le cluster Explorer. */
.moment-explorations {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-2) var(--space-4);
  margin-top: var(--space-4);
}

.explorations-etiquette {
  font: var(--text-overline);
  letter-spacing: var(--text-overline-tracking);
  text-transform: uppercase;
  color: var(--couleur-strong);
}

/* Le registre exhaustif — une fois. */
.fil-registre {
  margin-top: var(--space-10);
  padding: var(--space-6);
  border-top: 2px solid var(--couleur-line);
  background: var(--surface-primary);
  border-radius: var(--radius-sm);
}

.registre-titre {
  margin: 0 0 var(--space-4);
  font: var(--text-overline);
  letter-spacing: var(--text-overline-tracking);
  text-transform: uppercase;
  color: var(--couleur-strong);
}

.registre-liste {
  display: grid;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
  font: var(--text-body-sm);
  color: var(--text-secondary);
}

.registre-liste strong {
  color: var(--text-primary);
  font-weight: 600;
}

.registre-usages {
  margin-left: var(--space-2);
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
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
</style>
