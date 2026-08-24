<script setup lang="ts">
/**
 * BlocProgrammes — le bloc du SIXIÈME thème (#408), l'onglet premier et par
 * défaut de la fiche : « Programmes et subventions ». La migration de
 * l'ancien élément d'Aperçu (supprimé — verdict #400 : les ancres d'identité
 * disparaissent complètement, la fiche passe de ses contrôles d'identité au
 * premier thème) vers l'anatomie des thèmes, avec SA présentation propre :
 * les faits d'action publique ne sont ni une courbe ni un classement.
 *
 * Le bloc lit SES fichiers hermétiques uniquement (#408) :
 *   - theme_programmes.json — les labels/cadrages des sous-groupes (jamais un
 *     vocabulaire app-side) ;
 *   - indicateurs_programmes.json — les faits, via programmesPourTerritoire
 *     (la dérivation en échelle : jointure relationnelle + voix honnêtes,
 *     ADR-0013 ; le total poolé est calculé côté pipeline) ;
 *   - histoires_programmes.json — vide : le thème sans lecture n'en invente
 *     jamais une.
 *
 * Les états : un territoire sans aucun fait rend l'état vide honnête (« Aucun
 * programme référencé » / silence sur les subventions) — jamais « under
 * construction » (principles.md §1). Le top-5 des domaines est listé, le
 * reste derrière une révélation accessible (aria-expanded, #305).
 */
import { computed, ref, watch } from 'vue'
import { ExternalLink } from 'lucide-vue-next'

import AppIcon from '@/components/AppIcon.vue'
import { LIBELLE_HANDOFF, handoffExploration } from '@/fiche/explorationHandoff'
import {
  LIEN_SUBVENTIONS,
  formaterMontant,
  formaterPartContexte,
  libelleBadge,
  libellePartContexte,
  libelleProvenance,
  phraseVoix,
} from '@/fiche/programmesAffichage'
import { programmesPourTerritoire, trouverTerritoire } from '@/payload/selectors'
import type { Payload } from '@/payload/types'

const props = defineProps<{
  payload: Payload
  territoire: string
}>()

// Les labels du bloc viennent de la métadonnée publiée (theme_programmes.json)
// — l'overline du thème et les titres/cadrages des sous-groupes, jamais une
// seconde liste app-side (le contrat #318/#314, validerThemeMetadata garantit
// la forme ; un thème rendu implique sa métadonnée, #313).
const metadata = computed(() => props.payload.themeMetadata?.programmes ?? null)

function groupe(key: string): { label: string; framing: string } {
  const g = metadata.value?.subgroups.find((sousGroupe) => sousGroupe.key === key)
  if (!g) throw new Error(`Sous-groupe « ${key} » absent des métadonnées « programmes »`)
  return { label: g.label, framing: g.framing }
}

const element = computed(() => programmesPourTerritoire(props.payload, props.territoire))

/**
 * La passarelle « Explorer cet indicateur » (#409) : le total annuel publié
 * (`subventions_annuelles` a SA Page d'indicateur) emporte le territoire et
 * son niveau. Les autres faits du bloc (couverture_programmes,
 * subventions_par_domaine) n'ont pas de page — aucune passarelle, jamais un
 * lien mort.
 */
const passarelleSubventions = computed(() =>
  handoffExploration(
    metadata.value ?? undefined,
    'subventions_annuelles',
    trouverTerritoire(props.payload, props.territoire),
  ),
)
const libelleHandoff = LIBELLE_HANDOFF
const elementVide = computed(
  () => element.value.badges.length === 0 && element.value.subventions === null,
)

/** Le top-5 + la révélation (issue #305) : le sélecteur renvoie TOUS les axes
 * triés, ce composant plie l'affichage — les cinq premiers toujours listés,
 * le reste derrière un bouton accessible (aria-expanded). */
const axes = computed(() => element.value.subventions?.axes ?? [])
const axesTete = computed(() => axes.value.slice(0, 5))
const axesReste = computed(() => axes.value.slice(5))
const revele = ref(false)
// un changement de fiche (la route réutilise l'instance sur un param-only
// nav) referme la révélation — l'état ne fuit jamais vers le territoire suivant
watch(() => props.territoire, () => {
  revele.value = false
})

const partContexte = computed(() => element.value.subventions?.partContexte ?? null)
const partContexteTexte = computed(() =>
  partContexte.value === null ? null : formaterPartContexte(partContexte.value.part),
)

const provenance = computed(() => element.value.subventions?.provenance ?? null)
// le RouterLink est gardé par `v-if="provenance"` — la route de repli ne se
// rend jamais, elle ne sert qu'à tenir le type (to n'accepte pas null)
const lienProvenance = computed(() => {
  const p = provenance.value
  if (p === null) return { name: 'communes' }
  return p.niveau === 'epci'
    ? { name: 'communes', query: { epci: p.code } }
    : p.niveau === 'departement'
      ? { name: 'communes', query: { departement: p.code } }
      : { name: 'communes' }
})
</script>

<template>
  <!-- Le bloc ne rend qu'avec sa métadonnée publiée (le loader la garantit
       pour un thème présent, #313 ; dans le chargement progressif du magasin,
       les faits peuvent atterrir un instant avant elle — on attend, jamais un
       titre inventé ni un crash de rendu). -->
  <article v-if="metadata" class="onglet-theme onglet-theme--programmes bloc-programmes">
    <p class="onglet-theme-overline">{{ metadata?.label ?? '' }}</p>

    <template v-if="elementVide">
      <section class="sous-groupe" data-groupe="couverture">
        <h3 class="sous-groupe-titre">{{ groupe('couverture').label }}</h3>
        <p class="sous-groupe-cadrage">{{ groupe('couverture').framing }}</p>
        <p class="programmes-vide">Aucun programme référencé.</p>
      </section>
    </template>
    <template v-else>
      <!-- Le sous-groupe couverture : les badges à leurs trois voix (lauréate /
           couverte / porte / compte / ort), la liste nommée complète et
           scrollable, le rider « convention valant ORT », l'estampille de SA
           source par badge. -->
      <section
        v-if="element.badges.length > 0"
        class="sous-groupe"
        data-groupe="couverture"
      >
        <h3 class="sous-groupe-titre">{{ groupe('couverture').label }}</h3>
        <p class="sous-groupe-cadrage">{{ groupe('couverture').framing }}</p>

        <ul class="programmes-badges">
          <li v-for="badge in element.badges" :key="badge.sigle" class="programme-badge">
            <span class="puce-programme" :aria-label="libelleBadge(badge)" :title="badge.sigle">
              {{ badge.sigle }}
            </span>
            <p class="programme-voix">{{ phraseVoix(badge) }}</p>
            <ul
              v-if="badge.noms.length > 0"
              class="programme-noms programme-noms--scrollable"
            >
              <li v-for="nom in badge.noms" :key="nom" class="programme-nom">{{ nom }}</li>
            </ul>
            <p v-if="badge.conventionValantOrt" class="programme-rider">
              convention valant ORT
            </p>
            <p class="programme-vintage">{{ badge.vintage }}</p>
          </li>
        </ul>
      </section>

      <!-- Le sous-groupe subventions : le total annuel (calculé côté pipeline),
           la ventilation communale pliée top-5 + révélation, la part de
           contexte, la provenance, l'estampille hebdomadaire et le lien
           portail Région. Un territoire sans fait reste silencieux — jamais un
           zéro inventé, jamais une figure vide. -->
      <section
        v-if="element.subventions"
        class="sous-groupe"
        data-groupe="subventions"
      >
        <h3 class="sous-groupe-titre">{{ groupe('subventions').label }}</h3>
        <p class="sous-groupe-cadrage">{{ groupe('subventions').framing }}</p>

        <div class="programme-subventions">
          <p class="subvention-total">
            {{ formaterMontant(element.subventions.total) }}
            <span class="subvention-annee">en {{ element.subventions.annee }}</span>
          </p>
          <template v-if="element.subventions.axes">
            <ul class="subvention-axes">
              <li v-for="axe in axesTete" :key="axe.libelle" class="subvention-axe">
                <span class="subvention-axe-montant">{{ formaterMontant(axe.montant) }}</span>
                <span class="subvention-axe-libelle">{{ axe.libelle }}</span>
              </li>
            </ul>
            <button
              v-if="axesReste.length > 0"
              type="button"
              class="subvention-reveler"
              :aria-expanded="revele"
              @click="revele = !revele"
            >
              {{ revele ? 'Masquer' : `Voir les ${axesReste.length} autres domaines` }}
            </button>
            <ul v-if="revele" class="subvention-axes subvention-axes--reste">
              <li v-for="axe in axesReste" :key="axe.libelle" class="subvention-axe">
                <span class="subvention-axe-montant">{{ formaterMontant(axe.montant) }}</span>
                <span class="subvention-axe-libelle">{{ axe.libelle }}</span>
              </li>
            </ul>
          </template>
          <p v-if="partContexte" class="subvention-contexte">
            {{ partContexteTexte }} {{ libellePartContexte(partContexte.parent) }}
          </p>
          <p v-if="provenance" class="subvention-provenance">
            Somme des subventions attribuées aux
            <RouterLink :to="lienProvenance" class="subvention-provenance-lien">
              {{ libelleProvenance(provenance.niveau) }}
            </RouterLink>
          </p>
          <p class="subvention-vintage">{{ element.subventions.vintage }}</p>
        </div>

        <!-- #409 : la passarelle vers la Page d'indicateur du total annuel. -->
        <RouterLink
          v-if="passarelleSubventions"
          class="passarelle-exploration"
          :to="passarelleSubventions"
        >{{ libelleHandoff }}</RouterLink>

        <a
          class="programmes-lien"
          :href="LIEN_SUBVENTIONS.href"
          target="_blank"
          rel="noopener noreferrer"
        >
          {{ LIEN_SUBVENTIONS.libelle }}
          <AppIcon :icone="ExternalLink" :taille="14" class="programmes-lien-icone" aria-hidden="true" />
        </a>
      </section>
    </template>
  </article>
</template>

<style scoped>
/* Les styles du bloc reprennent la grammaire visuelle de l'ancien élément
   (les badges, la ventilation pliée, le lien portail) sur la rampe du thème
   portée par .onglet-theme--programmes (OngletTheme). */
.bloc-programmes {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
}

.sous-groupe {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.sous-groupe-titre {
  margin: 0;
  font: 600 1.1875rem/1.4 var(--font-serif);
  color: var(--theme-programmes-strong);
}

.sous-groupe-cadrage {
  margin: 0;
  font: var(--text-body-sm);
  color: var(--text-secondary);
}

.programmes-vide {
  margin: 0;
  font: var(--text-body-sm);
  color: var(--text-secondary);
}

/* One .programme-badge per programme: the chip (sigle), the honest voice
   line, the full named list (scrollable — never truncated, PRD #162-7), the
   rider when the label carries it, the vintage stamp. */
.programmes-badges {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  margin: 0;
  padding: 0;
  list-style: none;
}

.programme-badge {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.puce-programme {
  align-self: flex-start;
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-full);
  background: var(--theme-programmes-soft);
  color: var(--theme-programmes-strong);
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
}

.programme-voix {
  margin: 0;
  font: var(--text-body-sm);
  font-weight: 600;
  color: var(--text-primary);
}

.programme-noms {
  margin: 0;
  padding-left: var(--space-5);
  font: var(--text-body-sm);
  color: var(--text-secondary);
}

.programme-noms--scrollable {
  max-height: 9rem;
  overflow-y: auto;
}

.programme-nom {
  margin: 0;
}

.programme-rider {
  margin: 0;
  font: var(--text-caption);
  color: var(--theme-programmes-strong);
}

.programme-vintage,
.subvention-vintage {
  margin: 0;
  font: var(--text-caption);
  color: var(--text-tertiary);
}

/* The subvention figure — the annual total (headline) + the by-policy-area
   split on commune fiches (the pipeline's full split, folded here: top-5
   always listed, the rest behind the reveal, issue #305) + the part de
   contexte + the provenance. */
.programme-subventions {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  border-left: 3px solid var(--theme-programmes-line);
  background: var(--theme-programmes-soft);
}

.subvention-total {
  margin: 0;
  font: var(--text-h3);
  font-variant-numeric: var(--text-numeric-variant);
  color: var(--theme-programmes-strong);
}

.subvention-annee {
  font: var(--text-body-sm);
  font-weight: 400;
  color: var(--text-secondary);
}

.subvention-axes {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.subvention-axe {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
  font: var(--text-body-sm);
}

.subvention-axe-montant {
  font-weight: 600;
  color: var(--text-primary);
}

.subvention-axe-libelle {
  text-align: right;
  color: var(--text-secondary);
}

.subvention-reveler {
  align-self: flex-start;
  padding: 0;
  border: 0;
  background: none;
  font: var(--text-body-sm);
  font-weight: 600;
  color: var(--theme-programmes-strong);
  cursor: pointer;
}

.subvention-reveler:hover {
  text-decoration: underline;
}

.subvention-axes--reste {
  border-top: 1px solid var(--border-subtle);
  padding-top: var(--space-2);
}

/* La passarelle « Explorer cet indicateur » (#409) — la rampe du thème. */
.passarelle-exploration {
  width: fit-content;
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
  font-weight: 600;
  color: var(--theme-programmes-strong);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.subvention-contexte,
.subvention-provenance {
  margin: 0;
  font: var(--text-body-sm);
  color: var(--text-secondary);
}

.subvention-provenance-lien {
  color: var(--theme-programmes-strong);
  font-weight: 600;
}

.programmes-lien {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  width: fit-content;
  font: var(--text-body-sm);
  font-weight: 600;
  transition: color 150ms ease-out;
}

.programmes-lien-icone {
  flex-shrink: 0;
}
</style>
