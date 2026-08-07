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
 * A payload with no programmes (404 → null) or no rows renders the honest
 * empty state — never « under construction » (principles.md §1).
 */
import { computed } from 'vue'
import { ExternalLink } from 'lucide-vue-next'

import AppIcon from '@/components/AppIcon.vue'
import {
  LIEN_SUBVENTIONS,
  formaterMontant,
  formaterValeurApercu,
  libelleApercu,
  libelleBadge,
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
          <ul v-if="element.subventions.axes" class="subvention-axes">
            <li v-for="axe in element.subventions.axes" :key="axe.libelle" class="subvention-axe">
              <span class="subvention-axe-montant">{{ formaterMontant(axe.montant) }}</span>
              <span class="subvention-axe-libelle">{{ axe.libelle }}</span>
            </li>
          </ul>
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
   split on commune fiches (the pipeline's precomputed top-N + « autres »). */
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
