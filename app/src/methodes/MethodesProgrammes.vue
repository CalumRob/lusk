<script setup lang="ts">
/**
 * La documentation éditoriale de l'élément « Programmes et subventions » de
 * /methodologie (issue #180, layouts.md §5, CONTEXT.md → Programmes &
 * financements) — l'onglet Méthodes · Programmes et subventions du shell à
 * onglets (#332) : le vocabulaire des badges (sigle → nom), les trois sortes
 * de couverture, la règle du badge ORT, la ligne « jamais les résultats ».
 * La table des SIX sources de l'élément vit dans son propre composant
 * (MethodesProgrammesSources), dans l'onglet Sources · Programmes et
 * subventions. Le registre (programmes.ts) est statique et typé — la section
 * ne dépend pas du payload. Pas de bannière de construction (principles.md
 * §1) : la page énonce ce qui est.
 */
import {
  COUVERTURES_PROGRAMMES,
  LIGNE_JAMAIS_RESULTATS,
  REGLE_BADGE_ORT,
  VOCABULAIRE_PROGRAMMES,
} from '@/methodes/programmes'

/** Le libellé complet d'un sigle — « ACV — Action Cœur de Ville ». */
function libelleSigle(sigle: string): string {
  const nom = VOCABULAIRE_PROGRAMMES[sigle as keyof typeof VOCABULAIRE_PROGRAMMES]
  return nom && nom !== sigle ? `${sigle} — ${nom}` : sigle
}
</script>

<template>
  <section id="programmes" class="programmes">
    <h2 class="programmes__titre">Programmes et subventions</h2>

    <p class="programmes__intro">
      La fiche d’identité montre les programmes d’État et régionaux qui couvrent le territoire —
      les badges d’adhésion (ACV, PVD, CRTE, Territoires d’industrie), l’outil ORT là où il
      ajoute de l’information, et les subventions attribuées par la Région — avec une estampille
      de fraîcheur sur chaque élément. Un territoire sans couverture affiche un état vide honnête,
      jamais une promesse.
    </p>

    <p class="programmes__jamais-resultats" data-fait="jamais-resultats">
      {{ LIGNE_JAMAIS_RESULTATS }}
    </p>

    <div class="programmes__groupe">
      <h3 class="groupe-titre">Le vocabulaire des badges</h3>
      <dl class="vocabulaire">
        <div
          v-for="(nom, sigle) in VOCABULAIRE_PROGRAMMES"
          :key="sigle"
          class="vocabulaire-ligne"
        >
          <dt class="vocabulaire-sigle">{{ sigle }}</dt>
          <dd class="vocabulaire-nom">{{ nom }}</dd>
        </div>
      </dl>
    </div>

    <div class="programmes__groupe">
      <h3 class="groupe-titre">Trois sortes de couverture</h3>
      <ol class="couvertures">
        <li v-for="couverture in COUVERTURES_PROGRAMMES" :key="couverture.titre" class="couverture">
          <p class="couverture-titre">
            {{ couverture.titre }}
            <span class="couverture-sigles">{{ couverture.sigles.map(libelleSigle).join(' · ') }}</span>
          </p>
          <p class="couverture-texte">{{ couverture.texte }}</p>
        </li>
      </ol>
    </div>

    <div class="programmes__groupe">
      <h3 class="groupe-titre">Le badge ORT</h3>
      <p class="regle-ort">{{ REGLE_BADGE_ORT }}</p>
    </div>
  </section>
</template>

<style scoped>
.programmes {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
}

.programmes__titre {
  margin: 0;
  font: 600 1.5rem/1.3 var(--font-serif);
  letter-spacing: -0.01em;
  color: var(--text-primary);
}

.programmes__intro {
  margin: 0;
  color: var(--text-secondary);
  font: var(--text-body-lg);
}

/* ---- La ligne « jamais les résultats » — le fait éditorial de l'élément ---- */
.programmes__jamais-resultats {
  margin: 0;
  padding: var(--space-4) var(--space-5);
  border-left: 3px solid var(--brand-500);
  border-radius: 0 var(--radius-md) var(--radius-md) 0;
  background: var(--surface-tertiary);
  color: var(--text-primary);
  font: 600 1rem/1.5 var(--font-serif);
}

.programmes__groupe {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.groupe-titre {
  margin: 0;
  font: 600 1.1875rem/1.4 var(--font-serif);
  color: var(--text-primary);
}

/* ---- Le vocabulaire des badges ---- */
.vocabulaire {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
}

.vocabulaire-ligne {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-3);
  align-items: baseline;
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-primary);
}

.vocabulaire-sigle {
  margin: 0;
  font: var(--text-body-sm);
  font-weight: 700;
  color: var(--accent-primary);
}

.vocabulaire-nom {
  margin: 0;
  color: var(--text-secondary);
  font: var(--text-body-sm);
}

/* ---- Les trois sortes de couverture ---- */
.couvertures {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

.couverture {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-4) var(--space-5);
  border-left: 3px solid var(--border-default);
  border-radius: 0 var(--radius-md) var(--radius-md) 0;
  background: var(--surface-primary);
}

.couverture-titre {
  margin: 0;
  font: 600 1rem/1.5 var(--font-serif);
  color: var(--text-primary);
}

.couverture-sigles {
  margin-left: var(--space-2);
  color: var(--text-tertiary);
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
  text-transform: uppercase;
}

.couverture-texte {
  margin: 0;
  color: var(--text-secondary);
  font: var(--text-body-sm);
}

/* ---- La règle du badge ORT ---- */
.regle-ort {
  margin: 0;
  color: var(--text-secondary);
  font: var(--text-body-sm);
}
</style>
