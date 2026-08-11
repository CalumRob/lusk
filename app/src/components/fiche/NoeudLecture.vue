<script setup lang="ts">
/**
 * NoeudLecture — one node of the metadata reading template (the constrained
 * rich-text AST of theme_<theme>.json, parent #308): text | param | territoire
 * | strong | link. Raw HTML is forbidden by the contract — the template renders
 * only these five node types. Recursive: strong/link walk their children.
 */
import { RouterLink } from 'vue-router'

import type { NoeudTexteRiche } from '@/payload/types'

defineProps<{
  noeud: NoeudTexteRiche
  /** The resolved params of the reading — a param node renders its display value. */
  parametres: Record<string, string>
  /** The « territoire » node renders the territory's name. */
  nomTerritoire: string
}>()
</script>

<template>
  <span v-if="noeud.type === 'text'" class="noeud-texte">{{ noeud.content }}</span>
  <span v-else-if="noeud.type === 'param'" class="noeud-param">{{ parametres[noeud.key] }}</span>
  <span v-else-if="noeud.type === 'territoire'" class="noeud-territoire">{{ nomTerritoire }}</span>
  <strong v-else-if="noeud.type === 'strong'" class="noeud-gras">
    <template v-for="(enfant, i) in noeud.children" :key="i">
      <NoeudLecture :noeud="enfant" :parametres="parametres" :nom-territoire="nomTerritoire" />
    </template>
  </strong>
  <RouterLink v-else class="noeud-lien" :to="noeud.href">
    <template v-for="(enfant, i) in noeud.children" :key="i">
      <NoeudLecture :noeud="enfant" :parametres="parametres" :nom-territoire="nomTerritoire" />
    </template>
  </RouterLink>
</template>
