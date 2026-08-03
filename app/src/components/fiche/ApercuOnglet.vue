<script setup lang="ts">
/**
 * ApercuOnglet — the Aperçu tab, the fiche's default landing view (ADR-0007,
 * layouts.md §2, CONTEXT.md §Aperçu). Deliberately not a theme block: it
 * holds the territory's basic stats, rendered from the pipeline's `apercu`
 * table via apercuPourTerritoire (never client-derived), and the Programmes &
 * financements element. Runs on the general brand ramp — no theme -wash, no
 * theme colors (the shell already keeps the page on the brand background).
 *
 * The programmes payload seam does not exist yet (C2 builds the element's
 * PRESENTATION): the typed `programmes` prop defaults to empty, the section
 * shows its real design with an honest empty state — never « under
 * construction » (principles.md §1). When the pipeline publishes a programmes
 * table, the parent passes it here and the badge chips render.
 *
 * States: the tab receives the already-loaded payload from the parent; the
 * territory-without-stats edge (no apercu rows) shows an honest one-liner.
 */
import { computed } from 'vue'
import { ExternalLink } from 'lucide-vue-next'

import AppIcon from '@/components/AppIcon.vue'
import {
  LIEN_SUBVENTIONS,
  formaterValeurApercu,
  libelleApercu,
  libelleProgramme,
} from '@/fiche/apercu'
import type { Programme } from '@/fiche/apercu'
import { apercuPourTerritoire } from '@/payload/selectors'
import type { Payload } from '@/payload/types'

const props = withDefaults(
  defineProps<{
    payload: Payload
    territoire: string
    programmes?: Programme[]
  }>(),
  { programmes: () => [] },
)

const lignes = computed(() => apercuPourTerritoire(props.payload, props.territoire))
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

      <ul v-if="programmes.length > 0" class="programmes-badges">
        <li
          v-for="programme in programmes"
          :key="programme.sigle"
          class="puce-programme"
          :aria-label="libelleProgramme(programme)"
          :title="programme.nom"
        >
          {{ programme.sigle }}
        </li>
      </ul>
      <p v-else class="programmes-vide">Aucun programme référencé.</p>

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

/* Programmes & financements — badge chips + the Région subventions link. */
.apercu-programmes {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.programmes-badges {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.puce-programme {
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-full);
  background: var(--brand-50);
  color: var(--brand-700);
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
}

.programmes-vide {
  margin: 0;
  font: var(--text-body-sm);
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
