<script setup lang="ts">
/** PROTOTYPE — channel binding (shared by the three variants): a Cellule letter, a Formule, or (couleur) a category / membership. */
import { cellShortLabel } from './prototypeCellules'
import { APPARTENANCES, CATEGORIES, CHANNELS, type Binding, type ChannelId, type Draft } from './prototypeFigure'

const props = defineProps<{ draft: Draft }>()

const encode = (binding: Binding | null): string => {
  if (!binding) return ''
  if (binding.kind === 'cellule') return `c:${binding.letter}`
  if (binding.kind === 'formule') return 'f'
  return `${binding.kind === 'categorie' ? 'cat' : 'app'}:${binding.id}`
}

function choose(channel: ChannelId, value: string) {
  const channels = props.draft.channels
  if (!value) channels[channel] = null
  else if (value === 'f') channels[channel] = { kind: 'formule', expression: channels[channel]?.kind === 'formule' ? (channels[channel] as { expression: string }).expression : '' }
  else if (value.startsWith('c:')) channels[channel] = { kind: 'cellule', letter: value.slice(2) }
  else if (value.startsWith('cat:')) channels[channel] = { kind: 'categorie', id: value.slice(4) }
  else channels[channel] = { kind: 'appartenance', id: value.slice(4) }
}

const expressionOf = (channel: ChannelId) => {
  const binding = props.draft.channels[channel]
  return binding?.kind === 'formule' ? binding.expression : ''
}
function setExpression(channel: ChannelId, expression: string) {
  props.draft.channels[channel] = { kind: 'formule', expression }
}

const cellLabel = (letter: string) => {
  const cell = props.draft.cellByLetter(letter)
  const resource = props.draft.resourceOf(cell?.resourceId ?? null)
  return resource && cell ? cellShortLabel(resource, cell.coordinates) : 'non adressée'
}
</script>

<template>
  <ul class="at-channels">
    <li v-for="channel in CHANNELS" :key="channel.id" class="at-channel">
      <div class="at-channel__name">
        <b>{{ channel.label }}</b>
        <span>{{ channel.note }}</span>
      </div>
      <div class="at-channel__controls">
        <select
          :id="`canal-${channel.id}`"
          class="at-select"
          :aria-label="`Canal ${channel.label} (${channel.note})`"
          :value="encode(draft.channels[channel.id])"
          @change="choose(channel.id, ($event.target as HTMLSelectElement).value)"
        >
          <option value="">{{ channel.id === 'x' || channel.id === 'y' ? 'À lier' : 'Aucun' }}</option>
          <optgroup label="Cellule">
            <option v-for="cell in draft.cells.value" :key="cell.letter" :value="`c:${cell.letter}`" :disabled="!cell.resourceId">
              {{ cell.letter }} — {{ cellLabel(cell.letter) }}
            </option>
          </optgroup>
          <optgroup label="Formule">
            <option value="f">Formule sur les cellules…</option>
          </optgroup>
          <template v-if="channel.id === 'couleur'">
            <optgroup label="Catégorie territoriale">
              <option v-for="c in CATEGORIES" :key="c.id" :value="`cat:${c.id}`">{{ c.label }}</option>
            </optgroup>
            <optgroup label="Appartenance territoriale">
              <option v-for="a in APPARTENANCES" :key="a.id" :value="`app:${a.id}`">{{ a.label }}</option>
            </optgroup>
          </template>
        </select>

        <template v-if="draft.channels[channel.id]?.kind === 'formule'">
          <input
            class="at-input at-formula"
            type="text"
            spellcheck="false"
            autocomplete="off"
            placeholder="(B - A) / C"
            :aria-label="`Formule du canal ${channel.label}`"
            :aria-describedby="`canal-note-${channel.id}`"
            :value="expressionOf(channel.id)"
            @input="setExpression(channel.id, ($event.target as HTMLInputElement).value)"
          />
          <div :id="`canal-note-${channel.id}`" class="at-formula-notes">
            <template v-if="draft.formulaProblems(draft.channels[channel.id])">
              <p v-if="draft.formulaProblems(draft.channels[channel.id])!.reading.empty" class="at-formula-note">
                Écrivez une expression sur les lettres des cellules. Fonctions : log, log10, sqrt, abs, min, max.
              </p>
              <template v-else>
                <p
                  v-if="draft.formulaProblems(draft.channels[channel.id])!.reading.letters.length && !draft.formulaProblems(draft.channels[channel.id])!.reading.unknownLetters.length"
                  class="at-formula-note"
                >
                  Lit {{ draft.formulaProblems(draft.channels[channel.id])!.reading.letters.join(', ') }} · étiquette : « {{ draft.bindingTitle(draft.channels[channel.id]) }} » · une cellule absente n’est jamais tracée comme zéro.
                </p>
                <p v-if="draft.formulaProblems(draft.channels[channel.id])!.reading.unknownLetters.length" class="at-formula-note at-formula-note--error">
                  <b>Erreur —</b> cellule inconnue : {{ draft.formulaProblems(draft.channels[channel.id])!.reading.unknownLetters.join(', ') }}. Cellules disponibles : {{ draft.letters.value.join(', ') }}.
                </p>
                <p v-if="draft.formulaProblems(draft.channels[channel.id])!.reading.unknownTokens.length" class="at-formula-note at-formula-note--error">
                  <b>Erreur —</b> « {{ draft.formulaProblems(draft.channels[channel.id])!.reading.unknownTokens.join(', ') }} » n’est ni une lettre de cellule ni une fonction connue.
                </p>
                <p v-if="!draft.formulaProblems(draft.channels[channel.id])!.reading.balanced" class="at-formula-note at-formula-note--error">
                  <b>Erreur —</b> parenthèses non appariées.
                </p>
                <p v-if="!draft.formulaProblems(draft.channels[channel.id])!.reading.letters.length && !draft.formulaProblems(draft.channels[channel.id])!.reading.unknownTokens.length" class="at-formula-note at-formula-note--error">
                  <b>Erreur —</b> aucune cellule référencée.
                </p>
                <p v-if="draft.formulaProblems(draft.channels[channel.id])!.units.length > 1" class="at-formula-note at-formula-note--warn">
                  <b>Attention —</b> unités mêlées : {{ draft.formulaProblems(draft.channels[channel.id])!.units.join(' / ') }}. Non bloquant : la formule garde la lecture de l’auteur.
                </p>
              </template>
            </template>
          </div>
        </template>
      </div>
    </li>
  </ul>
</template>
