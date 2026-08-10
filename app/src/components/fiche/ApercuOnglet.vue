<script setup lang="ts">
/**
 * ApercuOnglet — the Aperçu tab, the fiche's default landing view (ADR-0007,
 * layouts.md §2, CONTEXT.md §Aperçu). Deliberately not a theme block: it
 * holds the territory's basic stats, rendered from the pipeline's `apercu`
 * table via apercuPourTerritoire (never client-derived), and the Programmes &
 * financements element. Runs on the general brand ramp — no theme -wash, no
 * theme colors (the shell already keeps the page on the brand background).
 *
 * The Programmes & financements element renders REAL data (issue #181): the
 * ladder derivation (programmesPourTerritoire, ADR-0013 — a relational join
 * over the payload's membership rows + the territoires reference, never a
 * computed stat) produces the per-fiche rendering — the three voices
 * (lauréate / couverte / porte / compte / ort), the named lists (full,
 * scrollable, never truncated), the « convention valant ORT » rider as the
 * accessible fact, the vintage stamp on every badge, and the subvention
 * figure (by-policy-area split on commune fiches, single annual total
 * elsewhere, with the Région portal link as drill-down). Badge vocabulary
 * (sigle → French nom) lives in fiche/apercu.ts.
 *
 * States: the tab receives the already-loaded payload from the parent; the
 * territory-without-stats edge (no apercu rows) shows an honest one-liner.
 * An absent apercu table (404 → null, issue #122 — the pipeline only
 * publishes it when a theme HAS an aperçu) reads as no rows and shows the
 * same honest one-liner. A payload with no programmes (404 → null) or no
 * rows renders the honest empty state — never « under construction »
 * (principles.md §1).
 */
import { computed, ref, watch } from 'vue'
import { ExternalLink } from 'lucide-vue-next'

import AppIcon from '@/components/AppIcon.vue'
import {
  LIEN_SUBVENTIONS,
  formaterMontant,
  formaterPartContexte,
  formaterValeurApercu,
  libelleApercu,
  libelleBadge,
  libellePartContexte,
  libelleProvenance,
  phraseVoix,
} from '@/fiche/apercu'
import { apercuPourTerritoire, programmesPourTerritoire } from '@/payload/selectors'
import type { Payload } from '@/payload/types'

const props = defineProps<{
  payload: Payload
  territoire: string
}>()

const lignes = computed(() => apercuPourTerritoire(props.payload, props.territoire))
const element = computed(() => programmesPourTerritoire(props.payload, props.territoire))
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
  <article class="apercu-onglet">
    <h2 class="apercu-titre">Aperçu</h2>

    <dl v-if="lignes.length > 0" class="apercu-stats">
      <div v-for="ligne in lignes" :key="ligne.key" class="kpi kpi--marque">
        <dt class="kpi-valeur">{{ formaterValeurApercu(ligne) }}</dt>
        <dd class="kpi-libelle">{{ libelleApercu(ligne.key) }}</dd>
      </div>
    </dl>
    <p v-else class="apercu-vide">Aucune donnée disponible pour ce territoire.</p>

    <section class="apercu-programmes" aria-labelledby="titre-programmes">
      <h2 class="apercu-titre" id="titre-programmes">Programmes &amp; financements</h2>

      <p v-if="elementVide" class="programmes-vide">Aucun programme référencé.</p>
      <template v-else>
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

        <div v-if="element.subventions" class="programme-subventions">
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
      </template>

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
  </article>
</template>

<style scoped>
.apercu-onglet {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
}

/* The section labels — the overline voice (DESIGN.md §3) on the brand ramp. */
.apercu-titre {
  margin: 0;
  font: var(--text-overline);
  letter-spacing: var(--text-overline-tracking);
  text-transform: uppercase;
  color: var(--brand-500);
}

/* The basic-stats strip — KPI figures (ui-elements.md §Indicator/KPI figure). */
.apercu-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--space-6) var(--space-8);
  margin: 0;
}

.kpi {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.kpi-valeur {
  margin: 0;
  font: var(--text-h2);
  font-variant-numeric: var(--text-numeric-variant);
  color: var(--brand-500);
}

.kpi-libelle {
  margin: 0;
  font: var(--text-body-sm);
  color: var(--text-secondary);
}

.apercu-vide {
  margin: 0;
  font: var(--text-body);
  color: var(--text-secondary);
}

/* Programmes & financements — badge chips + the subvention figure + the
   Région portal link. One .programme-badge per programme: the chip (sigle),
   the honest voice line, the full named list (scrollable — never truncated,
   PRD #162-7), the rider when the label carries it, the vintage stamp. */
.apercu-programmes {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

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
  background: var(--brand-50);
  color: var(--brand-700);
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
}

.programme-voix {
  margin: 0;
  font: var(--text-body-sm);
  font-weight: 600;
  color: var(--text-primary);
}

/* The full named list — scrollable, never truncated (PRD #162-7 / #162-11). */
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
  color: var(--brand-600);
}

.programme-vintage,
.subvention-vintage {
  margin: 0;
  font: var(--text-caption);
  color: var(--text-tertiary);
}

.programmes-vide {
  margin: 0;
  font: var(--text-body-sm);
  color: var(--text-secondary);
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
  border-left: 3px solid var(--brand-500);
  background: var(--brand-50);
}

.subvention-total {
  margin: 0;
  font: var(--text-h3);
  font-variant-numeric: var(--text-numeric-variant);
  color: var(--brand-700);
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
  color: var(--brand-600);
  cursor: pointer;
}

.subvention-reveler:hover {
  text-decoration: underline;
}

.subvention-axes--reste {
  border-top: 1px solid var(--border-subtle);
  padding-top: var(--space-2);
}

.subvention-contexte,
.subvention-provenance {
  margin: 0;
  font: var(--text-body-sm);
  color: var(--text-secondary);
}

.subvention-provenance-lien {
  color: var(--brand-600);
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
