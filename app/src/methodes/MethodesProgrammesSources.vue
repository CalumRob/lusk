<script setup lang="ts">
/**
 * La table des SIX sources de l'élément « Programmes et subventions »
 * (issue #180, layouts.md §5) — l'onglet Sources · Programmes et subventions
 * du shell à onglets (#332) : URL, format, licence, fraîcheur — les faits que
 * le pipeline ingère réellement, jamais inventés. Extraite de l'ancienne
 * section « Programmes & financements » quand le shell l'a répartie entre
 * l'onglet Méthodes (l'éditorial, MethodesProgrammes) et l'onglet Sources
 * (cette table). Le registre (programmes.ts) est statique et typé — la
 * section ne dépend pas du payload. La table partagée (SourcesTable, la même
 * forme que le registre Méthodes — l'extraction de la duplication #350)
 * rend les six jeux : une source de l'élément est un jeu d'une ligne vintage.
 * Les lignes gardent leur ancre (#source-<id>, ancreSource) : les liens
 * profonds existants continuent de résoudre.
 */
import { ancreSource } from '@/methodes/sources'
import { SOURCES_PROGRAMMES } from '@/methodes/programmes'
import SourcesTable from '@/methodes/SourcesTable.vue'
import type { ColonneTableSources, LigneTableSources } from '@/methodes/SourcesTable.vue'

const colonnes: ColonneTableSources[] = [
  { cle: 'source', libelle: 'Source' },
  { cle: 'editeur', libelle: 'Éditeur' },
  { cle: 'format', libelle: 'Format' },
  { cle: 'version', libelle: 'Version' },
  { cle: 'date_reference', libelle: 'Date de référence' },
  { cle: 'date_publication', libelle: 'Date de publication' },
  { cle: 'licence', libelle: 'Licence' },
  { cle: 'fraicheur', libelle: 'Fraîcheur' },
  { cle: 'lien', libelle: 'Lien vers le jeu de données', labelEmpile: 'Lien', classe: 'colonne-lien', cache: true },
]

const lignes: LigneTableSources[] = Object.entries(SOURCES_PROGRAMMES).map(([id, source]) => ({
  id: ancreSource(id),
  classe: 'source-jeu',
  nom: source.nom,
  url: source.url,
  cellules: {
    editeur: source.editeur,
    format: source.format,
    version: source.version,
    date_reference: source.dateReference,
    date_publication: source.datePublication,
    licence: source.licence,
    fraicheur: source.fraicheur,
  },
}))
</script>

<template>
  <section id="programmes-sources" class="programmes-sources">
    <h2 class="programmes-sources__titre">Les sources</h2>

    <SourcesTable
      :colonnes="colonnes"
      :lignes="lignes"
      etiquette="Les sources de l'élément Programmes et subventions"
    />

    <p class="sources-note">
      Les fraîcheurs de l'ORT sont portées par chaque convention (colonne « Dernière
      actualisation » du classeur) — jamais par la métadonnée de page, périmée. Les
      subventions sont rafraîchies chaque semaine.
    </p>
  </section>
</template>

<style scoped>
.programmes-sources {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.programmes-sources__titre {
  margin: 0;
  font: 600 1.5rem/1.3 var(--font-serif);
  letter-spacing: -0.01em;
  color: var(--text-primary);
}

.sources-note {
  margin: 0;
  color: var(--text-tertiary);
  font: var(--text-body-sm);
}
</style>
