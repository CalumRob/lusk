<script setup lang="ts">
/**
 * L'Atelier — page d'exploration du lecteur (#1080), sur la coquille du cahier.
 *
 * Les blocs de figures, la modale, les filtres, les Formules et le tri arrivent
 * dans les tickets suivants : ici la page s'ouvre vide, on titre et on écrit
 * des blocs de texte, on les retire, et « Partager » copie un lien qui restaure
 * exactement la page. L'état et le codec viennent du modèle #1079, pas d'ici.
 */
import { Check, Share2, Type } from 'lucide-vue-next'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import {
  DEFAULT_TITLE, LINK_PARAM, decodeAtelierLink, emptyAtelierState, encodeAtelierLink, nextBlockId,
  type AtelierState, type ProseBlock as ProseBlockState,
} from '@/atelier'
import AppIcon from '@/components/AppIcon.vue'
// Le style de prose de production est importé, jamais recopié (#1074/#1093).
import '@/fiche/prototype/cahierLayout.css'
// #1093 — la coquille éditoriale a un seul propriétaire, partagé avec le Cahier.
import '@/styles/editorialPage.css'

import EditableText from '../atelier/EditableText.vue'
import IconButton from '../atelier/IconButton.vue'
import ProseBlock from '../atelier/ProseBlock.vue'
import '../atelier/atelierPage.css'

const route = useRoute()
const router = useRouter()

const etat = ref<AtelierState>(emptyAtelierState())
const notice = ref<string | undefined>()
const restaure = ref(false)
const copie = ref(false)
const nouveauBloc = ref<string | null>(null)

let minuteurSync: ReturnType<typeof setTimeout> | undefined
let minuteurCopie: ReturnType<typeof setTimeout> | undefined

const titre = computed(() => etat.value.title)
const blocs = computed(() => etat.value.blocks)

function mettreTitre(valeur: string): void {
  etat.value = { ...etat.value, title: valeur || DEFAULT_TITLE }
}

/** Les blocs restent en ordre d'insertion — aucun réordonnancement dans ce ticket. */
function ajouterTexte(index = etat.value.blocks.length): void {
  const bloc: ProseBlockState = { kind: 'prose', id: nextBlockId(etat.value.blocks), markdown: '' }
  const blocks = [...etat.value.blocks]
  blocks.splice(index, 0, bloc)
  etat.value = { ...etat.value, blocks }
  nouveauBloc.value = bloc.id
}

function enregistrerTexte(id: string, markdown: string): void {
  etat.value = {
    ...etat.value,
    blocks: etat.value.blocks.map((bloc) =>
      bloc.id === id && bloc.kind === 'prose' ? { ...bloc, markdown } : bloc),
  }
  if (nouveauBloc.value === id) nouveauBloc.value = null
}

function retirerBloc(id: string): void {
  etat.value = { ...etat.value, blocks: etat.value.blocks.filter((bloc) => bloc.id !== id) }
  if (nouveauBloc.value === id) nouveauBloc.value = null
}

/* -------------------------------------------------------------- partage */

function planifierSync(): void {
  if (!restaure.value) return
  clearTimeout(minuteurSync)
  minuteurSync = setTimeout(async () => {
    const encoded = await encodeAtelierLink(etat.value)
    if (route.query[LINK_PARAM] !== encoded) {
      void router.replace({ query: { ...route.query, [LINK_PARAM]: encoded } })
    }
  }, 400)
}

async function urlCourante(): Promise<string> {
  const encoded = await encodeAtelierLink(etat.value)
  return `${window.location.origin}${router.resolve({ name: 'atelier', query: { [LINK_PARAM]: encoded } }).href}`
}

async function partager(): Promise<void> {
  const url = await urlCourante()
  try {
    await navigator.clipboard.writeText(url)
    copie.value = true
    clearTimeout(minuteurCopie)
    minuteurCopie = setTimeout(() => { copie.value = false }, 2200)
  } catch {
    notice.value = 'Copie impossible : le lien est dans la barre d’adresse.'
  }
}

watch(etat, planifierSync, { deep: true })

onMounted(async () => {
  const encoded = route.query[LINK_PARAM]
  if (typeof encoded === 'string' && encoded) {
    // Le codec est total : invalide ou version inconnue → page vide + notice.
    const decoded = await decodeAtelierLink(encoded)
    etat.value = decoded.state
    notice.value = decoded.notice
  }
  restaure.value = true
  planifierSync()
})

onBeforeUnmount(() => {
  clearTimeout(minuteurSync)
  clearTimeout(minuteurCopie)
})
</script>

<template>
  <article class="atelier editorial-page cahier presentation-editorial cahier--sans-grille">
    <div class="atelier-wrap">
      <section class="atelier-page editorial-sheet" aria-labelledby="atelier-titre">
        <header class="atelier-entete editorial-rule">
          <EditableText
            id="atelier-titre"
            class="atelier-titre editorial-page-title"
            tag="h1"
            label="Titre de la page"
            :model-value="titre"
            @commit="mettreTitre"
          />
          <div class="atelier-entete__actions">
            <!-- Réservé à l'action PDF (#1093+) : aucun bouton à demi-construit. -->
            <button type="button" class="atelier-action atelier-partager" @click="partager">
              <AppIcon :icone="copie ? Check : Share2" :taille="14" aria-hidden="true" />
              <span aria-live="polite">{{ copie ? 'Lien copié' : 'Partager' }}</span>
            </button>
          </div>
        </header>

        <p v-if="notice" class="atelier-notice" role="status">{{ notice }}</p>

        <div class="atelier-blocs">
          <template v-for="(bloc, index) in blocs" :key="bloc.id">
            <ProseBlock
              v-if="bloc.kind === 'prose'"
              :uid="bloc.id"
              :text="bloc.markdown"
              :start-editing="nouveauBloc === bloc.id"
              @save="enregistrerTexte(bloc.id, $event)"
              @remove="retirerBloc(bloc.id)"
            />
            <div
              v-if="index < blocs.length - 1"
              class="atelier-insertion"
              role="group"
              :aria-label="`Insérer un texte après le bloc ${index + 1}`"
            >
              <IconButton :icon="Type" label="Insérer un texte ici" @click="ajouterTexte(index + 1)" />
            </div>
          </template>

          <div class="atelier-emplace">
            <p>Aucune figure sur cette page.</p>
            <div class="atelier-emplace__actions">
              <button type="button" class="atelier-ajouter atelier-ajouter-texte" @click="ajouterTexte()">
                <span class="atelier-ajouter__plus" aria-hidden="true">+</span>Ajouter un texte
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  </article>
</template>
