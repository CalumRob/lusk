<script setup lang="ts">
/**
 * Les blocs d'indicateurs de /methodologie (layouts.md §5, issue #129) : pour
 * chaque thème construit, un bloc d'ancre (#demographie, #habitat, #economie)
 * qui porte la rampe du thème (overline/labels en -strong, fond en -wash,
 * accent -line — le langage visuel des blocs de thème de la fiche), les
 * définitions éditoriales de ses indicateurs (label, définition, unité,
 * source) puis la documentation de ses Stories (ce qu'elles lisent, leurs
 * lectures). Le registre (indicateurs.ts) est statique et typé — la section
 * ne dépend pas du payload. Pas de bannière de construction (principles.md
 * §1) : la page énonce ce qui est.
 *
 * Le shell à onglets (#332) restreint la liste via la prop `themes` — l'onglet
 * Méthodes · <thème> montre le bloc de ce thème seul (défaut : tous les
 * construits). La prose du registre vit dans l'onglet Méthodes · À propos
 * (MethodesIndicateursApropos), jamais ici.
 */
import { computed } from 'vue'

import { NOMS_THEMES } from '@/fiche/onglets'
import { ancreSource } from '@/methodes/sources'
import { THEMES_CONSTRUITS, THEMES_METHODES } from '@/methodes/indicateurs'
import type { ThemeConstruit } from '@/methodes/indicateurs'

const props = defineProps<{
  /** Les thèmes à documenter — le filtre du shell à onglets (défaut : tous). */
  themes?: readonly ThemeConstruit[]
}>()

const themesAffiches = computed(() => props.themes ?? THEMES_CONSTRUITS)

/** La rampe du thème en variables CSS — les trois tons du bloc (strong/wash/line). */
function styleTheme(theme: ThemeConstruit): Record<string, string> {
  return {
    '--bloc-strong': `var(--theme-${theme}-strong)`,
    '--bloc-wash': `var(--theme-${theme}-wash)`,
    '--bloc-line': `var(--theme-${theme}-line)`,
  }
}

/** L'unité d'affichage — une unité vide (rapport sans unité, LQ) rend « sans unité ». */
function uniteAffichage(unite: string): string {
  return unite || 'sans unité'
}
</script>

<template>
  <section id="indicateurs" class="indicateurs">
    <article
      v-for="theme in themesAffiches"
      :id="theme"
      :key="theme"
      class="bloc-theme"
      :class="`bloc-theme--${theme}`"
      :style="styleTheme(theme)"
    >
      <p class="bloc-theme-overline">{{ NOMS_THEMES[theme] }}</p>

      <div class="groupe-indicateurs">
        <h3 class="groupe-titre">Les indicateurs</h3>
        <dl class="liste-indicateurs">
          <template v-for="(indicateur, clef) in THEMES_METHODES[theme].indicateurs" :key="clef">
            <div class="bloc-indicateur" :data-clef="clef">
              <dt class="bloc-indicateur-label">{{ indicateur.label }}</dt>
              <dd class="bloc-indicateur-definition">{{ indicateur.definition }}</dd>
              <dd class="bloc-indicateur-meta">
                <span class="meta-unite">
                  <span class="meta-etiquette">Unité</span>
                  {{ uniteAffichage(indicateur.unite) }}
                </span>
                <span class="meta-source">
                  <span class="meta-etiquette">Source</span>
                  <a
                    v-if="indicateur.sourceId"
                    :href="`#${ancreSource(indicateur.sourceId)}`"
                    class="meta-source-lien"
                  >{{ indicateur.source }}</a>
                  <span v-else>{{ indicateur.source }}</span>
                </span>
              </dd>
            </div>
          </template>
        </dl>
      </div>

      <div class="groupe-stories">
        <h3 class="groupe-titre">Les Stories</h3>
        <article
          v-for="story in THEMES_METHODES[theme].stories"
          :key="story.clef"
          class="bloc-story"
          :class="{ 'bloc-story--en-pause': story.statut === 'en-pause' }"
        >
          <p v-if="story.statut === 'en-pause'" class="bloc-story-pause">
            En pause — lecture analytique non publiée
          </p>
          <h4 class="bloc-story-titre">{{ story.titre }}</h4>
          <p class="bloc-story-definition">{{ story.definition }}</p>
          <ul v-if="story.lectures.length" class="liste-lectures">
            <li v-for="lecture in story.lectures" :key="lecture.clef" class="lecture">
              <span class="lecture-nom">{{ lecture.nom }}</span>
              <span class="lecture-texte">{{ lecture.lecture }}</span>
            </li>
          </ul>
        </article>
      </div>

      <div v-if="THEMES_METHODES[theme].horlogeLente" class="groupe-horloge">
        <h3 class="groupe-titre">L’horloge lente</h3>
        <p class="horloge-consommation">{{ THEMES_METHODES[theme].horlogeLente.consommation }}</p>
        <dl class="horloge-entrees">
          <div
            v-for="(entree, index) in THEMES_METHODES[theme].horlogeLente.entrees"
            :key="index"
            class="horloge-entree"
          >
            <dt class="horloge-donnee">{{ entree.donnee }}</dt>
            <dd class="horloge-frequence">{{ entree.frequence }}</dd>
            <dd class="horloge-reference">Référence : {{ entree.reference }}</dd>
          </div>
        </dl>
        <p class="horloge-declencheur">
          <span class="horloge-etiquette">Déclencheur de recalcul</span>
          {{ THEMES_METHODES[theme].horlogeLente.declencheur }}
        </p>
      </div>
      <div v-if="THEMES_METHODES[theme].deuxHorloges" class="groupe-horloge">
        <h3 class="groupe-titre">Les horloges du thème</h3>
        <p class="horloge-consommation">{{ THEMES_METHODES[theme].deuxHorloges.consommation }}</p>
        <dl class="horloge-entrees">
          <div
            v-for="(entree, index) in THEMES_METHODES[theme].deuxHorloges.entrees"
            :key="index"
            class="horloge-entree"
          >
            <dt class="horloge-donnee">{{ entree.donnee }}</dt>
            <dd class="horloge-frequence">{{ entree.frequence }}</dd>
            <dd class="horloge-reference">Référence : {{ entree.reference }}</dd>
          </div>
        </dl>
        <p class="horloge-declencheur">
          <span class="horloge-etiquette">Déclencheur de recalcul</span>
          {{ THEMES_METHODES[theme].deuxHorloges.declencheur }}
        </p>
      </div>
    </article>
  </section>
</template>

<style scoped>
.indicateurs {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--space-10);
}

/* ---- Le bloc de thème (le langage visuel des blocs de la fiche) ---- */
.bloc-theme {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
  padding: var(--space-8);
  border: 1px solid var(--bloc-line);
  border-left-width: 4px;
  border-radius: var(--radius-lg);
  background: var(--bloc-wash);
  scroll-margin-top: calc(var(--header-height) + 12px);
}

.bloc-theme-overline {
  margin: 0;
  font: var(--text-overline);
  letter-spacing: var(--text-overline-tracking);
  text-transform: uppercase;
  color: var(--bloc-strong);
}

.groupe-titre {
  margin: 0 0 var(--space-4);
  font: 600 1.1875rem/1.4 var(--font-serif);
  color: var(--bloc-strong);
}

/* ---- Les indicateurs ---- */
.liste-indicateurs {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  margin: 0;
}

.bloc-indicateur {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-5);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-primary);
}

.bloc-indicateur-label {
  margin: 0;
  font: 600 1.0625rem/1.4 var(--font-serif);
  color: var(--bloc-strong);
}

.bloc-indicateur-definition {
  margin: 0;
  color: var(--text-secondary);
  font: var(--text-body-sm);
}

.bloc-indicateur-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-6);
  margin: 0;
  color: var(--text-tertiary);
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
}

.meta-etiquette {
  display: inline-block;
  margin-right: var(--space-1);
  font-weight: 600;
  color: var(--text-tertiary);
}

.meta-source-lien {
  color: var(--bloc-strong);
  font-weight: 600;
}

.meta-source-lien:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}

/* ---- Les Stories ---- */
.groupe-stories {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.bloc-story {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-6);
  border: 1px solid var(--bloc-line);
  border-radius: var(--radius-lg);
  background: var(--surface-primary);
}

.bloc-story--en-pause {
  border-style: dashed;
}

.bloc-story-pause {
  align-self: flex-start;
  margin: 0;
  padding: 2px var(--space-2);
  border-radius: var(--radius-full);
  background: var(--surface-tertiary);
  color: var(--text-tertiary);
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
  font-weight: 600;
  text-transform: uppercase;
}

.bloc-story-titre {
  margin: 0;
  font: 600 1.375rem/1.3 var(--font-serif);
  color: var(--bloc-strong);
}

.bloc-story-definition {
  margin: 0;
  color: var(--text-secondary);
  font: var(--text-body-sm);
}

.liste-lectures {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

.lecture {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-3) var(--space-4);
  border-left: 3px solid var(--bloc-line);
  background: var(--bloc-wash);
}

.lecture-nom {
  font-weight: 600;
  color: var(--bloc-strong);
}

.lecture-texte {
  color: var(--text-secondary);
  font: var(--text-body-sm);
}

/* ---- L'horloge lente (ADR-0012 — le fait de première classe de l'instantané) ---- */
.groupe-horloge {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.horloge-consommation,
.horloge-declencheur {
  margin: 0;
  color: var(--text-secondary);
  font: var(--text-body-sm);
}

.horloge-entrees {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin: 0;
}

.horloge-entree {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-3) var(--space-4);
  border-left: 3px solid var(--bloc-line);
  background: var(--surface-primary);
}

.horloge-donnee {
  margin: 0;
  font-weight: 600;
  color: var(--bloc-strong);
}

.horloge-frequence,
.horloge-reference {
  margin: 0;
  color: var(--text-secondary);
  font: var(--text-body-sm);
}

.horloge-reference {
  color: var(--text-tertiary);
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
}

.horloge-etiquette {
  display: inline-block;
  margin-right: var(--space-2);
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
  font-weight: 600;
  text-transform: uppercase;
  color: var(--bloc-strong);
}
</style>
