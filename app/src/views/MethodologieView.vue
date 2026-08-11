<template>
  <section class="page methodologie">
    <h1 class="methodologie__titre">Sources &amp; Méthodes</h1>

    <div class="methodologie__intro">
      <p>
        Lusk est un observatoire ouvert des territoires bretons : pour chaque commune, EPCI,
        département et pour la région, une fiche d'identité rassemble les chiffres qui décrivent
        le territoire — population, logement, emploi — chacun sourcé, daté et rapporté à son
        contexte.
      </p>
      <p>
        Les fiches ne sont pas recopiées : elles sont calculées. Un pipeline télécharge les
        données publiques des producteurs (INSEE, data.gouv.fr, data.bretagne.bzh…), les filtre
        à la Bretagne, calcule chaque indicateur et ses rangs, puis publie le résultat.
      </p>
      <p>
        Tout est reproductible : le code du pipeline comme celui de l'application est public sur
        <a
          href="https://github.com/CalumRob/lusk"
          target="_blank"
          rel="noopener noreferrer"
          class="lien-depot"
        >github.com/CalumRob/lusk</a>.
      </p>
    </div>

    <ThemeTabs
      class="methodologie__onglets-sections"
      :themes="[]"
      :selected="section"
      libelle-premier="Sources"
      premier-slug="sources"
      :icone-premier="Database"
      :onglets-supplementaires="ongletsSections"
      aria-label="Sections de la page Méthodes"
      @select="choisirSection"
    />

    <div
      v-if="section === 'sources'"
      id="panneau-sources"
      class="methodologie__panneau"
      role="tabpanel"
      aria-labelledby="onglet-sources"
    >
      <MethodesSources />
    </div>

    <div
      v-else-if="section === 'indicateurs'"
      id="panneau-indicateurs"
      class="methodologie__panneau"
      role="tabpanel"
      aria-labelledby="onglet-indicateurs"
    >
      <div class="methodologie__onglets-themes">
        <ThemeTabs
          :themes="THEMES_CONSTRUITS"
          :selected="themeSelectionne"
          libelle-premier="Tous"
          aria-label="Thèmes des indicateurs"
          @select="choisirTheme"
        />
      </div>

      <div
        class="methodologie__panneau-theme"
        role="tabpanel"
        :id="idPanneau(themeSelectionne)"
        :aria-labelledby="idOnglet(themeSelectionne)"
      >
        <MethodesIndicateurs :themes="themesAffiches" />
      </div>
    </div>

    <div
      v-else
      id="panneau-programmes"
      class="methodologie__panneau"
      role="tabpanel"
      aria-labelledby="onglet-programmes"
    >
      <MethodesProgrammes />
    </div>
  </section>
</template>

<script setup lang="ts">
/**
 * /methodologie — Sources & Méthodes (site-map.md, layouts.md §5, CONTEXT.md →
 * Méthodes, issue #128). L'intro factuelle (ce qu'est Lusk, le pipeline, la
 * reproductibilité) reste le bloc d'orientation permanent au-dessus du shell
 * à onglets (#332) : Sources | Indicateurs | Programmes — le composant
 * ThemeTabs du site, premier onglet renommé « Sources » (le défaut, la même
 * convention que /carte) et deux onglets supplémentaires. Les trois sections
 * existantes (MethodesSources, MethodesIndicateurs, MethodesProgrammes)
 * rendent inchangées dans leur onglet ; l'onglet Indicateurs porte en plus le
 * sélecteur de thème (« Tous » + les thèmes construits) qui filtre ses blocs.
 *
 * L'état est l'URL, la convention du site (fiche ?theme=, carte ?onglet=/
 * ?theme=) : ?onglet=sources|indicateurs|programmes sélectionne la section,
 * ?theme=<slug> compose à l'intérieur (un thème dans Indicateurs — les
 * sources l'utiliseront quand leurs onglets de thème atterriront, #335). Les
 * valeurs inconnues sont normalisées comme la carte (ADR-0019) : retirées,
 * jamais un état cassé — un thème hors de sa section n'est pas un état. Les
 * clics d'onglet écrivent l'URL en replace (pas de spam d'historique) ; le
 * hash reste réservé aux ancres de scroll dans l'onglet (#334). Pas de
 * bannière de construction (principles.md §1) : la page énonce ce qui est,
 * jamais ce qui viendra.
 */
import { Database, Gauge } from 'lucide-vue-next'
import { computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import ThemeTabs from '@/components/ThemeTabs.vue'
import type { OngletSupplementaire } from '@/components/ThemeTabs.vue'
import { ICONE_APERCU, idOnglet, idPanneau } from '@/fiche/onglets'
import type { SlugOnglet } from '@/fiche/onglets'
import { THEMES_CONSTRUITS } from '@/methodes/indicateurs'
import type { ThemeConstruit } from '@/methodes/indicateurs'
import MethodesIndicateurs from '@/methodes/MethodesIndicateurs.vue'
import MethodesProgrammes from '@/methodes/MethodesProgrammes.vue'
import MethodesSources from '@/methodes/MethodesSources.vue'
import type { Theme } from '@/payload/types'

const route = useRoute()
const router = useRouter()

/** Les trois sections de la page — l'onglet du shell Méthodes (sources est le
 *  défaut, le premier onglet gagne comme sur /carte). */
type SectionMethodes = 'sources' | 'indicateurs' | 'programmes'

/** Les deux onglets après le premier — Indicateurs (Gauge) et Programmes
 *  (le même icône que l'onglet programmes de la carte, ADR-0019 #282). */
const ongletsSections: OngletSupplementaire[] = [
  { slug: 'indicateurs', nom: 'Indicateurs', icone: Gauge },
  { slug: 'programmes', nom: 'Programmes', icone: ICONE_APERCU },
]

/** La section active — ?onglet=sources|indicateurs|programmes, sinon sources. */
const section = computed<SectionMethodes>(() => {
  const demande = route.query.onglet
  return demande === 'sources' || demande === 'indicateurs' || demande === 'programmes'
    ? demande
    : 'sources'
})

/** Le thème sélectionné dans l'onglet indicateurs — ?theme=<slug> n'est un
 *  état que dans sa section (les sources l'utiliseront avec #335). */
const themeSelectionne = computed<Theme | null>(() => {
  if (section.value !== 'indicateurs') return null
  const demande = route.query.theme
  return typeof demande === 'string' && (THEMES_CONSTRUITS as readonly string[]).includes(demande)
    ? (demande as Theme)
    : null
})

/** Les blocs de l'onglet indicateurs — le thème demandé seul, sinon tous. */
const themesAffiches = computed<readonly ThemeConstruit[]>(() =>
  themeSelectionne.value ? [themeSelectionne.value as ThemeConstruit] : THEMES_CONSTRUITS,
)

function choisirSection(slug: SlugOnglet): void {
  if (slug === 'sources' || slug === 'indicateurs' || slug === 'programmes') {
    // Sources est l'état par défaut — sa forme canonique est l'URL nue.
    router.replace({ query: slug === 'sources' ? {} : { onglet: slug } })
  }
}

function choisirTheme(slug: SlugOnglet): void {
  // Le sélecteur intérieur n'émet que null (« Tous ») ou un thème construit.
  if (slug !== null && slug !== 'sources' && slug !== 'indicateurs' && slug !== 'programmes') {
    router.replace({ query: { onglet: 'indicateurs', theme: slug } })
    return
  }
  router.replace({ query: { onglet: 'indicateurs' } })
}

// Normalisation de l'URL (le pattern carte, ADR-0019) : un ?onglet= inconnu
// retombe sur l'état par défaut ({} → Sources) ; ?theme= n'est conservé que
// dans l'onglet qui le consomme (indicateurs) et seulement s'il est construit
// — un thème hors section, un thème inconnu : retirés, jamais un état cassé.
watch(
  () => [route.query.onglet, route.query.theme] as const,
  ([onglet, theme]) => {
    const ongletValide = onglet === 'sources' || onglet === 'indicateurs' || onglet === 'programmes'
    const themeValide =
      typeof theme === 'string' && (THEMES_CONSTRUITS as readonly string[]).includes(theme)
    const themeConsomme = onglet === 'indicateurs' && themeValide

    if (ongletValide) {
      if (theme !== undefined && !themeConsomme) {
        router.replace({ query: { onglet } })
      }
      return
    }
    if (onglet !== undefined || theme !== undefined) {
      router.replace({ query: {} })
    }
  },
  { immediate: true },
)
</script>

<style scoped>
.methodologie__titre {
  margin: 0 0 var(--space-4);
  font: var(--text-h1);
  letter-spacing: var(--text-h1-tracking);
}

.methodologie__intro {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  margin: 0 0 var(--space-12);
}

.methodologie__intro p {
  margin: 0;
  color: var(--text-secondary);
  font: var(--text-body);
}

.lien-depot {
  color: var(--accent-primary);
  font-weight: 600;
}

.lien-depot:hover {
  color: var(--accent-hover);
}

/* La barre des sections (ThemeTabs) colle sous le header ; la barre de thème
   intérieure, elle, reste dans le flux (jamais deux barres collantes). */
.methodologie__onglets-sections {
  margin: 0 0 var(--space-10);
}

.methodologie__onglets-themes :deep(.theme-tabs) {
  position: static;
}

.methodologie__onglets-themes {
  margin: 0 0 var(--space-8);
}

.methodologie__panneau {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
}

.methodologie__panneau-theme {
  display: flex;
  flex-direction: column;
  gap: var(--space-10);
}
</style>
