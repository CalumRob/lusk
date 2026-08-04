<script setup lang="ts">
/**
 * Les EPCI (/epcis) — the EPCI link directory (site-map.md §Data lists,
 * layouts.md §4): nom | code | département | actions, searchable, with the
 * département chips (each EPCI row carries its département in the payload).
 * The shared ListeTerritoires renders it from this config — no KPI columns,
 * no computation (decision 2026-08-03).
 */
import ListeTerritoires from '@/components/ListeTerritoires.vue'
import type { ConfigListe } from '@/listes/listes'

const config: ConfigListe = {
  type: 'epci',
  titre: 'Les EPCI',
  placeholderRecherche: 'Rechercher un EPCI',
  colonnes: [
    { cle: 'nom', libelle: 'Nom', triable: true },
    { cle: 'code', libelle: 'Code', triable: true },
    { cle: 'departement', libelle: 'Département', triable: true },
  ],
  libelleVide: 'Aucun EPCI.',
  filtreDepartement: true,
  filtreEpci: false,
}
</script>

<template>
  <ListeTerritoires :config="config" />
</template>
