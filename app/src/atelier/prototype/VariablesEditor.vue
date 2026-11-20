<script setup lang="ts">
/** PROTOTYPE — Variables: x, y, taille, couleur, each bound by the search picker, a Formule, or a category / membership. */
import CellulePicker from './CellulePicker.vue'
import type { ResourceDef } from './prototypeCellules'
import {
  APPARTENANCES,
  CATEGORIES,
  CHANNELS,
  formulaIsValid,
  formulaReadingOf,
  letterOf,
  operandUnits,
  prettyExpression,
  type ChannelId,
  type ChannelMode,
  type ChannelState,
  type FigureState,
} from './prototypeFigure'

const props = defineProps<{ state: FigureState; catalogue: ResourceDef[] }>()

const MODE_LABELS: Record<ChannelMode, string> = { aucune: 'Aucune', cellule: 'Cellule', formule: 'Formule', categorie: 'Catégorie', appartenance: 'Appartenance' }
const modesFor = (id: ChannelId): ChannelMode[] =>
  id === 'x' || id === 'y' ? ['cellule', 'formule'] : id === 'taille' ? ['aucune', 'cellule', 'formule'] : ['aucune', 'cellule', 'formule', 'categorie', 'appartenance']

const lookup = (id: string) => props.catalogue.find((r) => r.id === id)

function setMode(channel: ChannelState, mode: ChannelMode) {
  channel.mode = mode
  if (mode === 'formule' && !channel.operands.length) {
    channel.operands = [channel.cell ? { ...channel.cell, coordinates: { ...channel.cell.coordinates } } : null]
    if (!channel.expression && channel.cell) channel.expression = 'A'
  }
}
const addOperand = (channel: ChannelState) => channel.operands.push(null)
const removeLast = (channel: ChannelState) => channel.operands.pop()

const reading = (channel: ChannelState) => formulaReadingOf(channel)
const units = (channel: ChannelState) => operandUnits(channel, reading(channel), lookup)
</script>

<template>
  <ul class="at-channels">
    <li v-for="channel in CHANNELS" :key="channel.id" class="at-channel">
      <div class="at-channel__name">
        <b>{{ channel.label }}</b>
        <span>{{ channel.note }}</span>
      </div>

      <div class="at-channel__controls">
        <fieldset class="at-levels at-modes">
          <legend>Liaison du canal {{ channel.label }}</legend>
          <label v-for="mode in modesFor(channel.id)" :key="mode" class="at-choice">
            <input type="radio" :name="`mode-${channel.id}`" :value="mode" :checked="state.channels[channel.id].mode === mode" @change="setMode(state.channels[channel.id], mode)" />
            <span>{{ MODE_LABELS[mode] }}</span>
          </label>
        </fieldset>

        <CellulePicker v-if="state.channels[channel.id].mode === 'cellule'" v-model="state.channels[channel.id].cell" :catalogue="catalogue" :uid="`v-${channel.id}`" />

        <template v-else-if="state.channels[channel.id].mode === 'formule'">
          <div class="formula">
            <label class="at-label" :for="`f-${channel.id}`">Expression</label>
            <input
              :id="`f-${channel.id}`"
              v-model="state.channels[channel.id].expression"
              class="at-input at-formula"
              type="text"
              spellcheck="false"
              autocomplete="off"
              placeholder="(B - A) / C"
              :aria-describedby="`f-${channel.id}-notes`"
            />
            <div :id="`f-${channel.id}-notes`" class="at-formula-notes">
              <p v-if="reading(state.channels[channel.id]).empty" class="at-formula-note">log, log10, sqrt, abs, min, max</p>
              <p v-else-if="formulaIsValid(reading(state.channels[channel.id]))" class="at-formula-note">{{ prettyExpression(state.channels[channel.id].expression) }}</p>
              <p v-if="reading(state.channels[channel.id]).unknownLetters.length" class="at-formula-note at-formula-note--error">
                <b>Erreur —</b> opérande inconnue : {{ reading(state.channels[channel.id]).unknownLetters.join(', ') }}
              </p>
              <p v-if="reading(state.channels[channel.id]).unknownTokens.length" class="at-formula-note at-formula-note--error">
                <b>Erreur —</b> « {{ reading(state.channels[channel.id]).unknownTokens.join(', ') }} » n’est pas une fonction
              </p>
              <p v-if="!reading(state.channels[channel.id]).balanced" class="at-formula-note at-formula-note--error"><b>Erreur —</b> parenthèses</p>
              <p v-if="!reading(state.channels[channel.id]).empty && !reading(state.channels[channel.id]).letters.length && !reading(state.channels[channel.id]).unknownTokens.length" class="at-formula-note at-formula-note--error">
                <b>Erreur —</b> aucune opérande référencée
              </p>
              <p v-if="units(state.channels[channel.id]).length > 1" class="at-formula-note at-formula-note--warn">
                <b>Attention —</b> unités mêlées : {{ units(state.channels[channel.id]).join(' / ') }}
              </p>
            </div>
          </div>

          <ol class="operands" aria-label="Opérandes">
            <li v-for="(_, index) in state.channels[channel.id].operands" :key="index" class="operand">
              <span class="operand__letter" aria-hidden="true">{{ letterOf(index) }}</span>
              <CellulePicker v-model="state.channels[channel.id].operands[index]" :catalogue="catalogue" :uid="`v-${channel.id}-${letterOf(index)}`" :label="`Opérande ${letterOf(index)}`" />
            </li>
          </ol>
          <div class="operands__foot">
            <button v-if="state.channels[channel.id].operands.length < 8" type="button" class="at-text-button" @click="addOperand(state.channels[channel.id])">+ Opérande {{ letterOf(state.channels[channel.id].operands.length) }}</button>
            <button v-if="state.channels[channel.id].operands.length > 1" type="button" class="at-text-button" @click="removeLast(state.channels[channel.id])">Retirer {{ letterOf(state.channels[channel.id].operands.length - 1) }}</button>
          </div>
        </template>

        <div v-else-if="state.channels[channel.id].mode === 'categorie'" class="formula">
          <label class="at-label" :for="`k-${channel.id}`">Catégorie territoriale</label>
          <select :id="`k-${channel.id}`" v-model="state.channels[channel.id].categorie" class="at-select">
            <option v-for="c in CATEGORIES" :key="c.id" :value="c.id">{{ c.label }}</option>
          </select>
        </div>
        <div v-else-if="state.channels[channel.id].mode === 'appartenance'" class="formula">
          <label class="at-label" :for="`a-${channel.id}`">Appartenance territoriale</label>
          <select :id="`a-${channel.id}`" v-model="state.channels[channel.id].appartenance" class="at-select">
            <option v-for="a in APPARTENANCES" :key="a.id" :value="a.id">{{ a.label }}</option>
          </select>
        </div>
      </div>
    </li>
  </ul>
</template>

<style scoped>
.formula { display: grid; gap: 2px; max-width: 34rem; }
.formula .at-select { width: 100%; }
.operands { display: grid; gap: var(--space-4); margin: 0; padding: 0 0 0 var(--space-4); list-style: none; border-left: 1px solid var(--at-rule-soft); }
.operand { display: grid; grid-template-columns: 1.75rem minmax(0, 1fr); gap: var(--space-2); }
.operand__letter { color: var(--red); font: 400 1.5rem/1 var(--font-ui); }
.operands__foot { display: flex; gap: var(--space-4); }
</style>
