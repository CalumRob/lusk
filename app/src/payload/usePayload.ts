/**
 * The app's payload state (ADR-0003 — static payload fetched at runtime via
 * the chargerPayload seam).
 *
 * One fetch for the whole session (a shared module-level promise), exposed as
 * loading/error/ready refs; every consumer (footer, fiche) subscribes its own
 * refs to the same promise. `recharger` clears the shared promise and
 * refetches (the Retry button). Tests inject their own charger through
 * PAYLOAD_CHARGER_KEY to isolate the fetch seam — an injected charger is
 * never shared between tests.
 */

import { inject, ref } from 'vue'
import type { InjectionKey, Ref } from 'vue'

import { chargerPayload } from './loader'
import type { Payload } from './types'
import { PayloadError } from './validate'

/** The payload charger — injectable so component tests stub the fetch seam. */
export type ChargerPayload = () => Promise<Payload>

export const PAYLOAD_CHARGER_KEY: InjectionKey<ChargerPayload> = Symbol('payload-charger')

export interface EtatPayload {
  payload: Ref<Payload | null>
  erreur: Ref<PayloadError | null>
  chargement: Ref<boolean>
  recharger: () => void
}

let promessePartagee: Promise<Payload> | null = null

export function usePayload(): EtatPayload {
  const chargerInjects = inject(PAYLOAD_CHARGER_KEY, null)
  const payload = ref<Payload | null>(null)
  const erreur = ref<PayloadError | null>(null)
  const chargement = ref(true)

  function lancer(promesse: Promise<Payload>): void {
    chargement.value = true
    erreur.value = null
    promesse
      .then((p) => {
        payload.value = p
      })
      .catch((cause: unknown) => {
        erreur.value =
          cause instanceof PayloadError
            ? cause
            : new PayloadError('fetch', '', 'Impossible de charger les données.')
      })
      .finally(() => {
        chargement.value = false
      })
  }

  function recharger(): void {
    if (chargerInjects) {
      lancer(chargerInjects())
    } else {
      promessePartagee = chargerPayload()
      lancer(promessePartagee)
    }
  }

  if (chargerInjects) {
    lancer(chargerInjects())
  } else {
    promessePartagee ??= chargerPayload()
    lancer(promessePartagee)
  }

  return { payload, erreur, chargement, recharger }
}
