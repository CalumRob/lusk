<template>
  <section class="page">
    <h1>Accueil</h1>
    <GlobalSearchBar
      class="accueil__recherche"
      :territoires="territoires"
      :chargement="chargement"
      :erreur="erreur"
    />
    <p class="page__empty">À venir.</p>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import GlobalSearchBar from '../components/GlobalSearchBar.vue'
import { chargerPayload } from '../payload/loader'
import type { Territoire } from '../payload/types'

/**
 * Demo placement (issue #38): C1 (fiche shell) wires GlobalSearchBar into
 * the AppHeader on every page; until then it renders here on the Accueil
 * route so the search is reachable. The payload comes from the single seam
 * (chargerPayload) — never raw JSON.
 */
const territoires = ref<Territoire[]>([])
const chargement = ref(true)
const erreur = ref<string | null>(null)

onMounted(async () => {
  try {
    const payload = await chargerPayload()
    territoires.value = payload.territoires
  } catch {
    erreur.value = 'Impossible de charger les territoires.'
  } finally {
    chargement.value = false
  }
})
</script>

<style scoped>
.accueil__recherche {
  margin-bottom: var(--space-8);
}
</style>
