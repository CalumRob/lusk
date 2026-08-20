<script setup lang="ts">
/**
 * La fiche d'identité — the shell (site-map.md §Fiche + layouts.md §2).
 *
 * The shell's job: the payload-driven tab bar (Aperçu default, then exactly
 * the themes present in the payload), the ?theme= URL state, correct
 * switching, correct theming (the page bg wears the selected theme's -wash),
 * the breadcrumb + H1 with the territory's real name (trouverTerritoire),
 * the type chip and the context switcher. The Aperçu tab (C2) renders the
 * territory's basic stats + Programmes & financements from the payload it
 * receives here; C3 builds the theme blocks' content.
 *
 * States: skeleton while the payload loads; typed PayloadError with a Retry
 * button (ui-elements.md §Loading/empty/error — never a raw error string);
 * honest empty state when the territory (or its type) is unknown.
 */
import { AlertCircle, ChevronRight, SearchX } from 'lucide-vue-next'
import { computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import AppIcon from '@/components/AppIcon.vue'
import ApercuOnglet from '@/components/fiche/ApercuOnglet.vue'
import ContexteSwitcher from '@/components/fiche/ContexteSwitcher.vue'
import FicheHeaderPrototype from '@/components/fiche/FicheHeaderPrototype.vue'
import FiligraneFiche from '@/components/fiche/FiligraneFiche.vue'
import OngletTheme from '@/components/fiche/OngletTheme.vue'
import ThemeTabs from '@/components/ThemeTabs.vue'
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

/**
 * Le wait-set de la fiche, dérivé de l'URL au montage (PRD #296 — la table par
 * route, ticket #302) : ?theme=X → territoires + run-report + la paire du
 * thème demandé (indicateurs_X + histoires_X — les thèmes hermétiques,
 * ADR-0020) + la métadonnée du thème (theme_X — le bloc est piloté par le
 * contrat theme_<theme>.json depuis #314, un thème présent la REQUIERT,
 * #313) ; sans ?theme → territoires + run-report + apercu + programmes +
 * vintages (l'Aperçu par défaut). Le magasin récupère TOUS les fichiers en
 * parallèle dès le premier chargement — ce tableau n'est que la porte de
 * rendu du premier affichage, jamais un déclencheur de fetch. Un thème non
 * canonique ne peut jamais rendre (themesPresent n'en sait rien) : il retombe
 * sur le set de l'Aperçu, et la normalisation d'URL nettoiera le paramètre.
 */
function attendreDeUrl(theme: unknown): Fichier[] {
  if (typeof theme === 'string' && (THEMES_CANONIQUES as readonly string[]).includes(theme)) {
    const demande = theme as Theme
    return [
      'territoires',
      'run-report',
      `indicateurs_${demande}`,
      `histoires_${demande}`,
      `theme_${demande}`,
    ]
  }
  return ['territoires', 'run-report', 'apercu', 'programmes', 'vintages']
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

const selection = computed<Theme | null>(() => {
  const demande = route.query.theme
  if (
    payload.value &&
    typeof demande === 'string' &&
    (themes.value as string[]).includes(demande)
  ) {
    return demande as Theme
  }
  return null
})

const echelons = computed(() =>
  payload.value ? echelleContexte(payload.value, String(route.params.id)) : [],
)

/** The active theme's block needs the payload — narrowed together (both are
 *  non-null exactly when a theme is selected). */
const ongletTheme = computed<{ theme: Theme; payload: Payload } | null>(() =>
  selection.value && payload.value
    ? { theme: selection.value, payload: payload.value }
    : null,
)

const classesFond = computed(() =>
  selection.value ? `fiche--theme-${selection.value}` : 'fiche--theme-apercu',
)

function choisirOnglet(slug: SlugOnglet): void {
  // 'programmes' n'existe que sur la carte (le premier onglet renommé, #282) —
  // la fiche n'émet jamais ce slug, la garde garde la jointure de type.
  if (slug === 'programmes') return
  router.replace({ query: slug ? { theme: slug } : {} })
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
  <section class="fiche" :class="classesFond" :aria-busy="chargement ? 'true' : 'false'">
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
          <FicheHeaderPrototype
            v-if="payload"
            :payload="payload"
            :territoire="String(route.params.id)"
          />
        </div>
      </template>
      </div>
      <ThemeTabs
        v-if="typeValide"
        :themes="themes"
        :selected="selection"
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
          <FiligraneFiche :key="selection ?? 'apercu'" :theme="selection" />
          <div
            class="fiche-contenu"
            role="tabpanel"
            :id="idPanneau(selection)"
            :aria-labelledby="idOnglet(selection)"
          >
            <ApercuOnglet
              v-if="payload && selection === null"
              :payload="payload"
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
</style>
