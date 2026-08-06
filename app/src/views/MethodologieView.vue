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

    <MethodesSources />

    <MethodesIndicateurs />
  </section>
</template>

<script setup lang="ts">
/**
 * /methodologie — Sources & Méthodes (site-map.md, layouts.md §5, CONTEXT.md →
 * Méthodes, issue #128). L'intro factuelle (ce qu'est Lusk, le pipeline,
 * la reproductibilité) puis la section « les sources » (MethodesSources) et
 * la section « les indicateurs » (MethodesIndicateurs, issue #129) : les
 * indicateurs et les Stories de chaque thème construit. Layout éditorial
 * resserré à 900px (layouts.md §5) — voix de rapport (Newsreader) pour les
 * titres de section, Manrope pour le corps. Pas de bannière de construction
 * (principles.md §1) : la page énonce ce qui est, jamais ce qui viendra.
 */
import MethodesIndicateurs from '@/methodes/MethodesIndicateurs.vue'
import MethodesSources from '@/methodes/MethodesSources.vue'
</script>

<style scoped>
.methodologie {
  max-width: 900px;
}

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
  font: var(--text-body-lg);
}

.lien-depot {
  color: var(--accent-primary);
  font-weight: 600;
}

.lien-depot:hover {
  color: var(--accent-hover);
}
</style>
