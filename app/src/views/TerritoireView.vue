<script setup lang="ts">
/**
 * La fiche d'identité — the shell (site-map.md §Fiche + layouts.md §2).
 *
 * Since #408 the shell's payload-driven tab bar opens on « Programmes et
 * subventions » — the SIXTH theme, first and selected by default — then the
 * other themes present in the payload; there is NO Aperçu tab anymore (the
 * #400 verdict: its identity anchors disappear completely, the fiche goes
 * from its identity/title controls straight into the first theme block). The
 * ?theme= URL state selects a tab; absent or invalid falls back to the
 * programmes default. Each theme block renders from ITS OWN hermetic pair;
 * the page bg wears the selected theme's -wash. The breadcrumb + H1 with the
 * territory's real name (trouverTerritoire), the type chip and the context
 * switcher form the fiche header.
 *
 * States: skeleton while the payload loads; typed PayloadError with a Retry
 * button (ui-elements.md §Loading/empty/error — never a raw error string);
 * honest empty state when the territory (or its type) is unknown.
 */
import { AlertCircle, ChevronRight, SearchX } from 'lucide-vue-next'
import { computed, toRaw, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import AppIcon from '@/components/AppIcon.vue'
import BlocProgrammes from '@/components/fiche/BlocProgrammes.vue'
import ContexteSwitcher from '@/components/fiche/ContexteSwitcher.vue'
import FiligraneFiche from '@/components/fiche/FiligraneFiche.vue'
import OngletTheme from '@/components/fiche/OngletTheme.vue'
import ThemeTabs from '@/components/ThemeTabs.vue'
// [PROTOTYPE #499 — JETABLE] le registre des variantes de lecture — dev seul.
import {
  CommutateurPrototype,
  varianteDeUrl,
} from '@/fiche/prototype/variantes'
import { cahierPaginationFor } from '@/fiche/prototype/cahierPagination'
import { lireAccesMobiliteTransitoire } from '@/fiche/content/mobiliteAccessSource'
import { resolveMobiliteThemeContent } from '@/fiche/content/themeContent'
import { territoryFactsFor } from '@/fiche/content/territoryFacts'
import type { ThemeContent } from '@/fiche/content/themeContent'
import { echelleContexte } from '@/fiche/echelleContexte'
import { LIENS_LISTES, NOMS_TYPES, idOnglet, idPanneau } from '@/fiche/onglets'
import type { SlugOnglet } from '@/fiche/onglets'
import type { Fichier } from '@/payload/loader'
import { themesPresent, trouverTerritoire } from '@/payload/selectors'
import { THEMES_CANONIQUES } from '@/payload/types'
import type { Payload, Theme } from '@/payload/types'
import { usePayload } from '@/payload/usePayload'

const route = useRoute()
const router = useRouter()

/** Le thème DÉFAUT de la fiche (#408) : « Programmes et subventions », le
 *  sixième thème du contrat canonique, présenté en premier et sélectionné par
 *  défaut — il remplace l'Aperçu retiré. */
const THEME_DEFAUT: Theme = 'programmes'

/**
 * Le wait-set de la fiche, dérivé de l'URL au montage (PRD #296 — la table par
 * route, ticket #302) : ?theme=X → territoires + run-report + la paire du
 * thème demandé (indicateurs_X + histoires_X — les thèmes hermétiques,
 * ADR-0020) + la métadonnée du thème (theme_X — le bloc est piloté par le
 * contrat theme_<theme>.json depuis #314, un thème présent la REQUIERT,
 * #313) ; sans ?theme → le set du thème DÉFAUT (#408 : Programmes et
 * subventions — sa paire hermétique, jamais l'ancien set apercu+programmes+
 * vintages de l'Aperçu retiré). Le magasin récupère TOUS les fichiers en
 * parallèle dès le premier chargement — ce tableau n'est que la porte de
 * rendu du premier affichage, jamais un déclencheur de fetch. Un thème non
 * canonique ne peut jamais rendre (themesPresent n'en sait rien) : il retombe
 * sur le set du défaut, et la normalisation d'URL nettoiera le paramètre.
 */
function attendreDeUrl(theme: unknown): Fichier[] {
  const demande =
    typeof theme === 'string' && (THEMES_CANONIQUES as readonly string[]).includes(theme)
      ? (theme as Theme)
      : THEME_DEFAUT
  return [
    'territoires',
    'run-report',
    `indicateurs_${demande}`,
    `histoires_${demande}`,
    `theme_${demande}`,
  ]
}

const { payload, erreur, chargement, recharger } = usePayload({
  attendre: attendreDeUrl(route.query.theme),
})

const territoire = computed(() =>
  payload.value ? trouverTerritoire(payload.value, String(route.params.id)) : null,
)

const typeValide = computed(
  () => territoire.value !== null && String(route.params.type) === territoire.value.type,
)

/**
 * L'identité de la fiche (fil d'ariane, H1, puce-type, contexte) est lisible
 * dès que la table de référence s'est réglée — avant le wait-set (AC #302) :
 * le header vit de territoires seul. L'échec du wait-set compte comme
 * « prêt » pour laisser la place à l'état d'erreur typé, jamais un squelette
 * éternel (territoires se règle toujours avant ses dépendants, l'ordre du
 * loader).
 */
const identitePret = computed(
  () => (payload.value?.territoires.length ?? 0) > 0 || erreur.value !== null,
)

const nomTerritoire = computed(() => territoire.value?.nom ?? '')
const nomType = computed(() => (territoire.value ? NOMS_TYPES[territoire.value.type] : ''))
const listeLien = computed(() =>
  territoire.value ? LIENS_LISTES[territoire.value.type] ?? null : null,
)

const themes = computed(() => (payload.value ? themesPresent(payload.value) : []))

/**
 * Les onglets de la fiche : « Programmes et subventions » PREMIER (#408),
 * puis les autres thèmes présents dans l'ordre canonique.
 */
const ongletsFiche = computed<Theme[]>(() => {
  if (!themes.value.includes(THEME_DEFAUT)) return themes.value
  return [THEME_DEFAUT, ...themes.value.filter((t) => t !== THEME_DEFAUT)]
})

const selection = computed<Theme | null>(() => {
  const demande = route.query.theme
  if (
    payload.value &&
    typeof demande === 'string' &&
    (themes.value as string[]).includes(demande)
  ) {
    return demande as Theme
  }
  // Le défaut (#408) : « Programmes et subventions » — tant qu'il est publié.
  // Un payload restreint sans lui retombe sur le premier thème présent (jamais
  // un bloc fantôme) ; aucun thème du tout → pas de panneau.
  if (themes.value.includes(THEME_DEFAUT)) return THEME_DEFAUT
  return themes.value[0] ?? null
})

const echelons = computed(() =>
  payload.value ? echelleContexte(payload.value, String(route.params.id)) : [],
)

/** The active theme's block needs the payload — narrowed together (both are
 *  non-null exactly when a published theme is selected). */
const ongletTheme = computed<{ theme: Theme; payload: Payload } | null>(() =>
  selection.value !== null && payload.value
    ? { theme: selection.value, payload: payload.value }
    : null,
)

const classesFond = computed(() =>
  selection.value ? `fiche--theme-${selection.value}` : '',
)

/**
 * [PROTOTYPE #499 — JETABLE] La variante de lecture demandée par
 * ?variant=A|B|C|D — null hors développement ou sans paramètre valide. Le
 * chargement et l'état restent CI-DESSUS : la variante reçoit le payload
 * déjà réglé et ne fetch jamais. L'onglet « Programmes et subventions »
 * garde SA présentation propre (BlocProgrammes) dans toutes les variantes —
 * le prototype explore les cinq thèmes éditoriaux.
 */
const variante = computed(() => varianteDeUrl(route.query.variant))
const prototypeActif = import.meta.env.DEV
/** [PROTOTYPE #531] D owns the editorial fiche surface for Mobilité only. */
const prototypeCahierMobilite = computed(
  () => prototypeActif && (variante.value?.clef === 'D' || variante.value?.clef === 'E') && selection.value === 'mobilite',
)
const contenuMobilite = computed<ThemeContent | null>(() => {
  if (
    !prototypeCahierMobilite.value ||
    chargement.value ||
    !payload.value ||
    !typeValide.value
  ) return null
  const facts = territoryFactsFor(
    toRaw(payload.value),
    String(route.params.id),
    lireAccesMobiliteTransitoire,
  )
  return facts ? resolveMobiliteThemeContent(facts) : null
})
const paginationCahier = computed(() =>
  payload.value && contenuMobilite.value
    ? cahierPaginationFor(payload.value, contenuMobilite.value)
    : null,
)
function choisirOnglet(slug: SlugOnglet): void {
  // La fiche n'émet que des slugs de thème (pas de pseudo-onglet depuis
  // #408) — la garde garde la jointure de type pour les autres shells.
  if (slug === null || !(THEMES_CANONIQUES as readonly string[]).includes(slug)) return
  // Les AUTRES paramètres de requête sont conservés (?variant= du prototype
  // #499 survit au changement d'onglet).
  router.replace({ query: { ...route.query, theme: slug } })
}

watch(
  () => [route.query.theme, payload.value, chargement.value, erreur.value] as const,
  ([theme, pl, busy, enErreur]) => {
    // Le payload grandit : la normalisation attend que le wait-set soit réglé
    // (dérivé de l'URL — le thème demandé compris) et que la fiche ne soit pas
    // en erreur — un échec du wait-set ne prouve pas l'absence du thème, il
    // ne faut pas réécrire l'URL avant que Retry ait pu refaire ses preuves.
    if (!pl || busy || enErreur) return
    if (typeof theme === 'string' && !(themesPresent(pl) as string[]).includes(theme)) {
      router.replace({ query: {} })
    }
  },
  { immediate: true },
)
</script>

<template>
  <section
    class="fiche"
    :class="[classesFond, { 'fiche--prototype': prototypeActif, 'fiche--prototype-d': prototypeCahierMobilite }]"
    :aria-busy="chargement ? 'true' : 'false'"
  >
    <div class="fiche-en-tete-surface">
      <div class="fiche-en-tete">
      <div
        v-if="!identitePret"
        class="fiche-chargement"
        role="status"
        aria-label="Chargement de la fiche"
      >
        <div class="squelette squelette--fil" />
        <div class="squelette squelette--titre" />
        <div class="squelette squelette--ligne" />
      </div>

      <div v-else-if="erreur" class="etat-erreur">
        <AppIcon :icone="AlertCircle" :taille="28" class="etat-icone" />
        <p class="etat-texte">Impossible de charger les données de la fiche.</p>
        <button type="button" class="bouton-reessayer" @click="recharger">Réessayer</button>
      </div>

      <div v-else-if="!typeValide" class="etat-vide">
        <AppIcon :icone="SearchX" :taille="28" class="etat-icone" />
        <p class="etat-texte">Territoire introuvable.</p>
        <RouterLink class="etat-action" to="/communes">Explorer les fiches</RouterLink>
      </div>

      <template v-else>
        <nav class="fil-ariane" aria-label="Fil d’ariane">
          <RouterLink to="/">Accueil</RouterLink>
          <AppIcon :icone="ChevronRight" :taille="14" class="fil-ariane-separateur" />
          <RouterLink
            v-if="listeLien"
            :to="listeLien.chemin"
            aria-current="page"
          >{{ listeLien.nom }}</RouterLink>
          <span v-else aria-current="page">Région</span>
        </nav>

        <div class="fiche-identite">
          <div class="fiche-titre">
            <h1>{{ nomTerritoire }}</h1>
          </div>
          <div class="fiche-actions">
            <span class="puce-type">{{ nomType }}</span>
            <ContexteSwitcher :echelons="echelons" />
          </div>
        </div>
      </template>
      </div>
      <ThemeTabs
        v-if="typeValide"
        :themes="ongletsFiche"
        :selected="selection"
        masquer-onglet-initial
        @select="choisirOnglet"
      />
    </div>

    <template v-if="typeValide && !erreur">
      <div class="fiche-corps">
        <!-- Le contenu attend SON wait-set (la porte de rendu, PRD #296) : le
             header vit de la référence seule (AC #302), mais la vue ne prétend
             jamais avoir ses données avant qu'elles ne soient réglées — le
             squelette honnête du corps pendant que le wait-set pend. -->
        <div
          v-if="chargement"
          class="fiche-chargement-contenu"
          role="status"
          aria-label="Chargement du contenu de la fiche"
        >
          <div class="squelette squelette--ligne" />
          <div class="squelette squelette--ligne" />
          <div class="squelette squelette--ligne" />
          <div class="squelette squelette--ligne" />
        </div>
        <!-- Le filigrane (DESIGN.md §7) : dessinable n'importe où dans la zone
             d'onglet (entre le sous-en-tête et le pied de page), re-tiré à
             chaque changement d'onglet (remount via :key), figé pour la durée
             du montage. -->
        <template v-else>
          <FiligraneFiche v-if="selection" :key="selection" :theme="selection" />
          <div
            v-if="selection"
            class="fiche-contenu"
            role="tabpanel"
            :id="idPanneau(selection)"
            :aria-labelledby="idOnglet(selection)"
          >
            <!-- [PROTOTYPE #531] D replaces only the Mobilité body; the fiche
                 identity header, theme tabs, background and tabpanel stay owned
                 by this shell. -->
            <component
              :is="variante.composant"
              v-if="prototypeCahierMobilite && contenuMobilite && paginationCahier && variante"
              :content="contenuMobilite"
              :pagination="paginationCahier"
            />
            <!-- #408 : le premier onglet (et le défaut) est le sixième thème —
                 sa présentation propre (badges à trois voix, ventilation
                 pliée) lit SA paire hermétique ; les autres thèmes passent
                 par la boucle partagée des sous-groupes. -->
            <BlocProgrammes
              v-else-if="selection === 'programmes' && payload"
              :payload="payload"
              :territoire="String(route.params.id)"
            />
            <!-- [PROTOTYPE #499] la variante remplace OngletTheme sur les
                 cinq thèmes éditoriaux — même props, zéro fetch propre. -->
            <component
              :is="variante.composant"
              v-else-if="ongletTheme && variante && variante.clef !== 'D'"
              :theme="ongletTheme.theme"
              :payload="ongletTheme.payload"
              :territoire="String(route.params.id)"
            />
            <OngletTheme
              v-else-if="ongletTheme"
              :theme="ongletTheme.theme"
              :payload="ongletTheme.payload"
              :territoire="String(route.params.id)"
            />
          </div>
        </template>
      </div>
    </template>

    <!-- [PROTOTYPE #499] le commutateur fixe du bas — dev uniquement. -->
    <CommutateurPrototype v-if="prototypeActif && CommutateurPrototype" />
  </section>
</template>

<style scoped>
.fiche {
  flex: 1;
  background: var(--surface-secondary);
  transition: background-color 300ms ease-in-out;
}

.fiche--theme-mobilite {
  background: var(--theme-mobilite-wash);
}

.fiche--theme-demographie {
  background: var(--theme-demographie-wash);
}

.fiche--theme-habitat {
  background: var(--theme-habitat-wash);
}

.fiche--theme-economie {
  background: var(--theme-economie-wash);
}

/* #408 : le sixième thème — l'onglet premier et par défaut de la fiche. */
.fiche--theme-programmes {
  background: var(--theme-programmes-wash);
}

.fiche-en-tete {
  width: 100%;
  max-width: var(--content-max-width);
  margin-inline: auto;
  padding: var(--space-8) var(--grid-margin-mobile) var(--space-6);
}

.fiche-en-tete-surface {
  background: var(--surface-primary);
}

.fil-ariane {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-6);
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
  color: var(--text-tertiary);
}

.fil-ariane a {
  color: var(--text-secondary);
}

.fil-ariane [aria-current='page'] {
  color: var(--text-primary);
}

.fil-ariane-separateur {
  color: var(--text-tertiary);
}

.fiche-identite {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-4);
  text-align: center;
}

.fiche-titre {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: var(--space-3) var(--space-4);
}

.fiche-titre h1 {
  margin: 0;
  font: var(--text-h1);
  letter-spacing: var(--text-h1-tracking);
}

.fiche-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: var(--space-3) var(--space-4);
}

.puce-type {
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-full);
  background: var(--surface-tertiary);
  color: var(--text-secondary);
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
  text-transform: uppercase;
}

.fiche-chargement {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-8) 0;
}

.fiche-chargement-contenu {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  max-width: var(--content-max-width);
  margin-inline: auto;
  padding: var(--space-8) var(--grid-margin-mobile) var(--space-12);
}

.squelette--fil {
  width: 40%;
  height: 0.875rem;
}

.squelette--titre {
  width: 60%;
  height: 2.25rem;
}

.squelette--ligne {
  width: 100%;
  height: 1rem;
}

.etat-erreur,
.etat-vide {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-16) var(--space-6);
  text-align: center;
}

.etat-icone {
  color: var(--text-tertiary);
}

.etat-texte {
  margin: 0;
  color: var(--text-secondary);
  font: var(--text-body-lg);
}

.etat-action {
  font: var(--text-body-sm);
  font-weight: 600;
}

.bouton-reessayer {
  height: 36px;
  padding: 0 var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--surface-primary);
  color: var(--text-primary);
  font: var(--text-body-sm);
  font-weight: 600;
  box-shadow: var(--shadow-subtle);
  cursor: pointer;
}

.bouton-reessayer:hover {
  background: var(--surface-tertiary);
  border-color: var(--brand-500);
}

.fiche-corps {
  position: relative;
  isolation: isolate;
  width: 100%;
}

.fiche-contenu {
  width: 100%;
  max-width: var(--content-max-width);
  margin-inline: auto;
  padding: var(--space-6) var(--grid-margin-mobile) var(--space-12);
}

/* [PROTOTYPE #499] la place du commutateur fixe du bas. */
.fiche--prototype {
  padding-bottom: 96px;
}

.fiche--prototype-d .fiche-contenu {
  max-width: 1640px;
}
</style>
