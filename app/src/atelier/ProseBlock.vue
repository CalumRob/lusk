<script setup lang="ts">
/**
 * Bloc de texte du lecteur — porté du prototype (0657b2fe), sans la poignée
 * de réordonnancement : le déplacement est #1082 et n'est pas à demi-construit
 * ici. Les blocs restent en ordre d'insertion. Le rendu passe par ProseMarkdown
 * (VNodes sûrs) ; la saisie est un textarea ordinaire.
 */
import { nextTick, ref } from 'vue'
import { Check, CircleHelp, Pencil, Trash2, X } from 'lucide-vue-next'

import IconButton from './IconButton.vue'
import { ProseMarkdown } from './markdown'

const props = withDefaults(defineProps<{ uid: string; text: string; startEditing?: boolean }>(), {
  startEditing: false,
})
const emit = defineEmits<{ save: [text: string]; remove: [] }>()

const INDICE = 'Markdown : ## titre, ### sous-titre, **gras**, *italique*, - puces, 1. numéros. Pas de liens.'

const edition = ref(props.startEditing)
const brouillon = ref(props.text)
const zone = ref<HTMLTextAreaElement | null>(null)

async function editer(): Promise<void> {
  brouillon.value = props.text
  edition.value = true
  await nextTick()
  zone.value?.focus()
}
if (edition.value) nextTick(() => zone.value?.focus())

function enregistrer(): void {
  edition.value = false
  const texte = brouillon.value.trim()
  if (!texte) emit('remove')
  else emit('save', texte)
}

function annuler(): void {
  edition.value = false
  if (!props.text.trim()) emit('remove')
}
</script>

<template>
  <div class="atelier-bloc bloc-prose" :data-bloc="uid">
    <template v-if="edition">
      <div class="bloc-prose__etiquette">
        <label class="atelier-libelle" :for="`${uid}-texte`">Texte</label>
        <span class="bloc-prose__indice" role="img" tabindex="0" :aria-label="INDICE" :title="INDICE">
          <CircleHelp :size="14" aria-hidden="true" />
        </span>
      </div>
      <textarea
        :id="`${uid}-texte`"
        ref="zone"
        v-model="brouillon"
        class="atelier-prose-zone"
        rows="6"
        spellcheck="true"
        @keydown.esc.prevent.stop="annuler"
      />
      <div class="atelier-bloc__actions atelier-bloc__actions--visibles">
        <IconButton :icon="Check" label="Enregistrer le texte" @click="enregistrer" />
        <IconButton :icon="X" label="Annuler" @click="annuler" />
      </div>
    </template>
    <template v-else>
      <ProseMarkdown :source="text" />
      <div class="atelier-bloc__actions">
        <IconButton :icon="Pencil" label="Modifier le texte" @click="editer" />
        <IconButton :icon="Trash2" label="Retirer le texte" @click="emit('remove')" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.bloc-prose__etiquette { display: flex; align-items: center; gap: var(--space-2); }
.bloc-prose__indice { display: inline-grid; color: var(--muted); cursor: help; }
.bloc-prose__indice:hover, .bloc-prose__indice:focus-visible { color: var(--red); outline-offset: 2px; }
.atelier-prose-zone {
  box-sizing: border-box;
  width: 100%;
  padding: var(--space-3);
  border: 1px solid color-mix(in srgb, var(--ink) 35%, transparent);
  border-radius: 0;
  background: transparent;
  color: var(--ink);
  font: 400 15px/1.45 var(--font-body);
  resize: vertical;
}
.atelier-prose-zone:focus-visible { outline: 2px solid var(--red); outline-offset: 2px; }
</style>
