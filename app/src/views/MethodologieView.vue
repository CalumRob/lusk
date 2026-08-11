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
      class="methodologie__onglets"
      :themes="[]"
      :selected="onglet"
      libelle-premier="Sources"
      premier-slug="sources"
      :icone-premier="Database"
      :onglets-supplementaires="ongletsExterieurs"
      aria-label="Onglets de la page Méthodes"
      @select="choisirOnglet"
    />

    <div
      v-if="onglet === 'sources'"
      id="panneau-sources"
      class="methodologie__onglet"
      role="tabpanel"
      aria-labelledby="onglet-sources"
    >
      <ThemeTabs
        class="methodologie__onglets-interieurs"
        :themes="THEMES_CANONIQUES"
        :selected="section"
        libelle-premier="À propos"
        premier-slug="apropos"
        :onglets-supplementaires="ongletsInterieurs"
        aria-label="Sections des sources"
        @select="choisirSection"
      />

      <div
        class="methodologie__panneau"
        role="tabpanel"
        :id="idPanneau(section)"
        :aria-labelledby="idOnglet(section)"
      >
        <MethodesSourcesApropos v-if="section === 'apropos'" />
        <MethodesProgrammesSources v-else-if="section === 'programmes'" />
        <MethodesSources v-else :themes="[section]" />
      </div>
    </div>

    <div
      v-else
      id="panneau-methodes"
      class="methodologie__onglet"
      role="tabpanel"
      aria-labelledby="onglet-methodes"
    >
      <ThemeTabs
        class="methodologie__onglets-interieurs"
        :themes="THEMES_CANONIQUES"
        :selected="section"
        libelle-premier="À propos"
        premier-slug="apropos"
        :onglets-supplementaires="ongletsInterieurs"
        aria-label="Sections des indicateurs"
        @select="choisirSection"
      />

      <div
        class="methodologie__panneau"
        role="tabpanel"
        :id="idPanneau(section)"
        :aria-labelledby="idOnglet(section)"
      >
        <MethodesIndicateursApropos v-if="section === 'apropos'" />
        <MethodesProgrammes v-else-if="section === 'programmes'" />
        <MethodesIndicateurs v-else :themes="[section]" />
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
/**
 * /methodologie — Sources & Méthodes (site-map.md, layouts.md §5, CONTEXT.md →
 * Méthodes, issue #128). L'intro factuelle (ce qu'est Lusk, le pipeline, la
 * reproductibilité) reste le bloc d'orientation permanent au-dessus du shell
 * à deux niveaux (#332) : les onglets Sources | Méthodes (le composant
 * ThemeTabs du site, premier onglet « Sources » renommé + un onglet
 * supplémentaire), chacun avec sa barre intérieure — À propos | Programmes et
 * subventions | les cinq thèmes construits (la même grammaire d'onglets que
 * la fiche, l'Aperçu remplacé par « Programmes et subventions »).
 *
 * Le contenu : Sources porte la table des sources du registre (filtrée par
 * thème — une source multi-thèmes apparaît sous chacun de ses thèmes, jamais
 * d'onglet « Tous »), la table des sources de l'élément Programmes et
 * subventions, et la prose du registre ; Méthodes porte les blocs
 * d'indicateurs par thème, l'éditorial de l'élément Programmes et
 * subventions, et la prose du registre des indicateurs. La table des sources
 * reste plate à ce stade — la granularité jeu de données est un ticket
 * séparé (#333).
 *
 * L'état est l'URL, la convention du site (fiche ?theme=, carte ?onglet=/
 * ?theme=) : ?onglet=sources|methodes sélectionne l'onglet,
 * ?section=apropos|programmes|<theme> l'onglet intérieur (défauts : sources ·
 * apropos). Les valeurs inconnues sont normalisées comme la carte (ADR-0019) :
 * retirées, jamais un état cassé. Les clics d'onglet écrivent l'URL en
 * replace (pas de spam d'historique) ; le hash est l'ancre de scroll dans
 * l'onglet (#334) : le hash d'arrivée (#indicateur-<clef>, #source-<slug>)
 * défile une fois le panneau rendu (les onglets résolus — et, pour la table
 * des sources, la fin du chargement du payload). Pas de bannière de
 * construction (principles.md §1) : la page énonce ce qui est, jamais ce qui
 * viendra.
 */
import { BookOpen, Database, Landmark } from 'lucide-vue-next'
import { computed, nextTick, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import ThemeTabs from '@/components/ThemeTabs.vue'
import type { OngletSupplementaire } from '@/components/ThemeTabs.vue'
import { idOnglet, idPanneau } from '@/fiche/onglets'
import type { SlugOnglet } from '@/fiche/onglets'
import MethodesIndicateurs from '@/methodes/MethodesIndicateurs.vue'
import MethodesIndicateursApropos from '@/methodes/MethodesIndicateursApropos.vue'
import MethodesProgrammes from '@/methodes/MethodesProgrammes.vue'
import MethodesProgrammesSources from '@/methodes/MethodesProgrammesSources.vue'
import MethodesSources from '@/methodes/MethodesSources.vue'
import MethodesSourcesApropos from '@/methodes/MethodesSourcesApropos.vue'
import { usePayload } from '@/payload/usePayload'
import type { Theme } from '@/payload/types'
import { THEMES_CANONIQUES } from '@/payload/types'

const route = useRoute()
const router = useRouter()

/** Les deux onglets de la page — sources est le défaut (le premier onglet gagne, la convention de /carte). */
type OngletMethodes = 'sources' | 'methodes'

/** Les onglets intérieurs — À propos (défaut), Programmes et subventions, ou un thème construit. */
type SectionInterieure = 'apropos' | 'programmes' | Theme

/** Le second onglet de la barre extérieure — Méthodes (BookOpen, la documentation). */
const ongletsExterieurs: OngletSupplementaire[] = [
  { slug: 'methodes', nom: 'Méthodes', icone: BookOpen },
]

/** L'onglet supplémentaire de la barre intérieure — Programmes et subventions (Landmark). */
const ongletsInterieurs: OngletSupplementaire[] = [
  { slug: 'programmes', nom: 'Programmes et subventions', icone: Landmark },
]

/** L'onglet actif — ?onglet=sources|methodes, sinon sources. */
const onglet = computed<OngletMethodes>(() => {
  const demande = route.query.onglet
  return demande === 'methodes' ? 'methodes' : 'sources'
})

/** L'onglet intérieur actif — ?section=apropos|programmes|<theme>, sinon apropos. */
const section = computed<SectionInterieure>(() => {
  const demande = route.query.section
  if (demande === 'programmes') return 'programmes'
  if (typeof demande === 'string' && (THEMES_CANONIQUES as readonly string[]).includes(demande)) {
    return demande as Theme
  }
  return 'apropos'
})

/** Un ?onglet= valide — sources ou methodes. */
function ongletValide(v: unknown): v is OngletMethodes {
  return v === 'sources' || v === 'methodes'
}

/** Une ?section= valide — apropos, programmes, ou un thème construit. */
function sectionValide(v: unknown): v is SectionInterieure {
  return (
    v === 'apropos' ||
    v === 'programmes' ||
    (typeof v === 'string' && (THEMES_CANONIQUES as readonly string[]).includes(v))
  )
}

/**
 * Le hash d'arrivée (#indicateur-<clef>, #source-<slug> — issue #334) : le
 * scroll ne part qu'une fois le panneau rendu, l'onglet et l'onglet intérieur
 * résolus (le hash ne précède jamais les onglets). La cible porte déjà
 * scroll-margin-top (le header sticky) — scrollIntoView la respecte, aucun
 * décalage codé en dur. usePayload n'est consommé ici que pour l'horloge de
 * chargement : la table des sources rend après le payload, le hash d'arrivée
 * vers une #source-<slug> attend sa fin de chargement.
 */
const { chargement } = usePayload()

/** Le hash déjà défilé — le retry du payload ne repart jamais deux fois. */
let ancreDefilee = ''

function defilerVersAncre(): void {
  if (!route.hash || route.hash === ancreDefilee) return
  const cible = document.getElementById(route.hash.slice(1))
  if (!cible) return
  cible.scrollIntoView()
  ancreDefilee = route.hash
}

// Le hash d'arrivée attend le rendu du panneau (le prochain tick après
// l'installation des onglets) ; sans hash, la cible défilée est oubliée.
watch(
  () => route.hash,
  () => {
    if (!route.hash) {
      ancreDefilee = ''
      return
    }
    void nextTick(defilerVersAncre)
  },
  { immediate: true },
)

// La table des sources rend après le payload : un second essai de scroll à la
// fin du chargement — jamais avant, et seulement si la cible n'a pas été vue.
watch(chargement, (chargementEnCours) => {
  if (!chargementEnCours && route.hash) void nextTick(defilerVersAncre)
})

/** Changer d'onglet préserve l'onglet intérieur (les deux niveaux sont indépendants). */
function choisirOnglet(slug: SlugOnglet): void {
  if (ongletValide(slug)) {
    router.replace({ query: { ...route.query, onglet: slug } })
  }
}

function choisirSection(slug: SlugOnglet): void {
  if (sectionValide(slug)) {
    router.replace({ query: { ...route.query, section: slug } })
  }
}

// Normalisation de l'URL (le pattern carte, ADR-0019) : un ?onglet= inconnu
// retombe sur sources, une ?section= inconnue sur apropos — les valeurs
// valides sont gardées, les invalides retirées, jamais un état cassé.
watch(
  () => [route.query.onglet, route.query.section] as const,
  ([ongletDemande, sectionDemande]) => {
    const ongletOK = ongletDemande === undefined || ongletValide(ongletDemande)
    const sectionOK = sectionDemande === undefined || sectionValide(sectionDemande)
    if (ongletOK && sectionOK) return
    router.replace({
      query: {
        ...(ongletValide(ongletDemande) ? { onglet: ongletDemande } : {}),
        ...(sectionValide(sectionDemande) ? { section: sectionDemande } : {}),
      },
    })
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

/* La barre des onglets (ThemeTabs) colle sous le header ; la barre intérieure,
   elle, reste dans le flux (jamais deux barres collantes). */
.methodologie__onglets {
  margin: 0 0 var(--space-8);
}

.methodologie__onglets-interieurs :deep(.theme-tabs) {
  position: static;
}

.methodologie__onglets-interieurs {
  margin: 0 0 var(--space-8);
}

.methodologie__onglet {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
}
</style>
