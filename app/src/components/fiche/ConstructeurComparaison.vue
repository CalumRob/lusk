<script setup lang="ts">
import { SlidersHorizontal } from 'lucide-vue-next'
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import type { Territoire } from '@/payload/types'
import { membreTerritoire, membresConstructeur } from '@/fiche/selectionBuilder'
import type { PresetComparaison, PresetComparaisonOption, SelectionComparaison } from '@/fiche/comparisonContext'
import CahierDialog from '@/fiche/prototype/CahierDialog.vue'
import MembresComparaison from './MembresComparaison.vue'

const props = defineProps<{
  selection: SelectionComparaison
  focal: Territoire
  territoires: readonly Territoire[]
  presets: readonly PresetComparaisonOption[]
  presetDefaut: PresetComparaison | null
  demandeOuverture?: number
}>()
const emit = defineEmits<{ choisir: [selection: SelectionComparaison] }>()
const ouvert = ref(false)
const titreId = useId()
const declencheur = ref<HTMLButtonElement | null>(null)
const selectionAffichee = computed<SelectionComparaison>(() =>
  props.selection.etat === 'defaut' && props.presetDefaut
    ? { etat: 'preset', preset: props.presetDefaut }
    : props.selection)
const membres = computed(() => membresConstructeur(selectionAffichee.value, props.focal, props.territoires))

watch(() => props.demandeOuverture, (demande, precedente) => {
  if (demande !== undefined && demande !== precedente) ouvrir()
})

function ouvrir(): void {
  ouvert.value = true
}
function fermer(): void {
  ouvert.value = false
  void nextTick(() => declencheur.value?.focus())
}
function appliquer(selection: SelectionComparaison): void {
  // An explicit-empty group stays empty until an actual edit. Its first add
  // creates the custom group with the focal as the starting member.
  if (props.selection.etat === 'vide' && selection.etat === 'membres') {
    const focal = membreTerritoire(props.focal)
    const contientFocal = selection.membres.some((member) =>
      member.territory_type === focal.territory_type && member.territory_id === focal.territory_id)
    if (!contientFocal) selection = { etat: 'membres', membres: [focal, ...selection.membres] }
  }
  emit('choisir', selection)
}

onBeforeUnmount(() => { ouvert.value = false })
defineExpose({ ouvrir })
</script>

<template>
  <div class="constructeur-comparaison">
    <button ref="declencheur" class="constructeur-comparaison__declencheur" type="button"
      aria-label="Construire un groupe de comparaison" aria-haspopup="dialog"
      :aria-expanded="ouvert" @click="ouvrir">
      <SlidersHorizontal :size="15" aria-hidden="true" />
    </button>
    <CahierDialog :open="ouvert" title="Construire un groupe de comparaison" :labelled-by="titreId" @close="fermer">
      <template #toolbar>
        <div v-if="presets.length" class="constructeur-comparaison__presets" aria-label="Démarrer avec un groupe prédéfini">
          <button v-for="preset in presets" :key="preset.preset" type="button"
            :aria-pressed="selection.etat === 'preset' && selection.preset === preset.preset"
            @click="appliquer({ etat: 'preset', preset: preset.preset })">{{ preset.label }}</button>
        </div>
      </template>
      <div class="constructeur-comparaison__contenu">
        <MembresComparaison :focal="focal" :territoires="territoires" :membres="membres" @choisir="appliquer" />
      </div>
    </CahierDialog>
  </div>
</template>

<style scoped>
.constructeur-comparaison { position: relative; display: inline-flex; align-self: center; flex: 0 0 auto; line-height: 0; }
.constructeur-comparaison__declencheur { display: grid; place-items: center; inline-size: 1.8em; block-size: 1.3em; padding: 0; border: 1px solid var(--border-default, var(--border-subtle)); border-radius: 2px; background: var(--paper, var(--surface-primary)); color: var(--cahier-theme-strong, var(--red, var(--accent-primary))); cursor: pointer; }
.constructeur-comparaison__declencheur:hover { background: color-mix(in srgb, var(--cahier-theme, var(--brand-500)) 8%, transparent); }
.constructeur-comparaison__declencheur:focus-visible { outline: var(--focus-ring); outline-offset: 2px; }
.constructeur-comparaison__presets { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: center; }
.constructeur-comparaison__presets button { min-block-size: 36px; padding: 0 var(--space-3); border: 1px solid var(--border-subtle, var(--border)); border-radius: 2px; background: transparent; color: inherit; font: 400 13px/1.35 var(--font-ui); cursor: pointer; }
.constructeur-comparaison__presets button[aria-pressed="true"] { background: color-mix(in srgb, var(--cahier-theme, var(--brand-500)) 12%, transparent); font-weight: 700; }
.constructeur-comparaison__contenu { min-width: 0; }
.constructeur-comparaison__contenu :deep(.membres-comparaison__liste) { max-block-size: min(34dvh, 18rem); overflow: auto; }
@media (max-width: 639px) {
  .constructeur-comparaison__declencheur { inline-size: 44px; block-size: 44px; }
  .constructeur-comparaison__presets { gap: var(--space-1); }
  .constructeur-comparaison__presets button { min-block-size: 44px; }
}
</style>
