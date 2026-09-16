import { computed, inject, ref, watch } from 'vue'
import type { Ref } from 'vue'

import type { TerritoireType } from './types'
import {
  chargerModeleTerritoire,
  TERRITORY_READ_MODEL_CHARGER_KEY,
} from './territoryReadModel'
import type { TerritoryReadModel } from './territoryReadModel'
import { PayloadError } from './validate'

export interface EtatModeleTerritoire {
  model: Ref<TerritoryReadModel | null>
  erreur: Ref<PayloadError | null>
  chargement: Ref<boolean>
  recharger: () => void
}

const TYPES_TERRITOIRE: readonly TerritoireType[] = [
  'commune',
  'epci',
  'departement',
  'region',
]

/** Load one route-scoped territory artifact, or stay inert when the route uses the legacy path. */
export function useTerritoryReadModel(
  type: Ref<string>,
  territoire: Ref<string>,
  actif: Ref<boolean>,
): EtatModeleTerritoire {
  const charger = inject(TERRITORY_READ_MODEL_CHARGER_KEY, chargerModeleTerritoire)
  const model = ref<TerritoryReadModel | null>(null)
  const erreur = ref<PayloadError | null>(null)
  const chargement = ref(false)
  let sequence = 0

  async function chargerCourant(): Promise<void> {
    const currentSequence = ++sequence
    model.value = null
    erreur.value = null
    if (!actif.value) {
      chargement.value = false
      return
    }

    const currentType = type.value
    const currentTerritoire = territoire.value
    if (!TYPES_TERRITOIRE.includes(currentType as TerritoireType)) {
      erreur.value = new PayloadError(
        'validation',
        `territoires/${currentType}/${currentTerritoire}.json`,
        `Type de territoire inconnu « ${currentType} »`,
      )
      chargement.value = false
      return
    }

    chargement.value = true
    try {
      const loaded = await charger(currentType as TerritoireType, currentTerritoire)
      if (currentSequence !== sequence) return
      model.value = loaded
    } catch (cause) {
      if (currentSequence !== sequence) return
      erreur.value =
        cause instanceof PayloadError
          ? cause
          : new PayloadError(
              'fetch',
              `territoires/${currentType}/${currentTerritoire}.json`,
              'Impossible de charger le modèle de lecture du territoire.',
            )
    } finally {
      if (currentSequence === sequence) chargement.value = false
    }
  }

  watch([type, territoire, actif], chargerCourant, { immediate: true })

  return {
    model,
    erreur,
    chargement: computed(() => chargement.value),
    recharger: () => void chargerCourant(),
  }
}
