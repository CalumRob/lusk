/**
 * The map's geometry state (ADR-0008 — static GeoJSON fetched at runtime via
 * the chargerMasques seam). Same contract as usePayload: loading/error/ready
 * refs; `recharger` is the Retry button's path. A shared module-level promise
 * keeps one fetch per session; tests inject their own charger through
 * GEOMETRIE_CHARGER_KEY to isolate the fetch seam.
 */

import { inject, ref } from 'vue'
import type { InjectionKey, Ref } from 'vue'

import { chargerMasques } from './chargerMasques'
import type { Masques } from './types'
import { PayloadError } from '../payload/validate'

/** The geometry charger — injectable so component tests stub the fetch seam. */
export type ChargerGeometrie = () => Promise<Masques>

export const GEOMETRIE_CHARGER_KEY: InjectionKey<ChargerGeometrie> = Symbol('geometrie-charger')

export interface EtatGeometrie {
  masques: Ref<Masques | null>
  erreur: Ref<PayloadError | null>
  chargement: Ref<boolean>
  recharger: () => void
}

let promessePartagee: Promise<Masques> | null = null

export function useGeometrie(): EtatGeometrie {
  const chargerInjects = inject(GEOMETRIE_CHARGER_KEY, null)
  const masques = ref<Masques | null>(null)
  const erreur = ref<PayloadError | null>(null)
  const chargement = ref(true)

  function lancer(promesse: Promise<Masques>): void {
    chargement.value = true
    erreur.value = null
    promesse
      .then((m) => {
        masques.value = m
      })
      .catch((cause: unknown) => {
        erreur.value =
          cause instanceof PayloadError
            ? cause
            : new PayloadError('fetch', '', 'Impossible de charger le fond de carte.')
      })
      .finally(() => {
        chargement.value = false
      })
  }

  function recharger(): void {
    if (chargerInjects) {
      lancer(chargerInjects())
    } else {
      promessePartagee = chargerMasques()
      lancer(promessePartagee)
    }
  }

  if (chargerInjects) {
    lancer(chargerInjects())
  } else {
    promessePartagee ??= chargerMasques()
    lancer(promessePartagee)
  }

  return { masques, erreur, chargement, recharger }
}
