/**
 * #501 — PROTOTYPE JETABLE (dev uniquement, jamais rendu en production).
 *
 * Contrat passé entre IndicateurPage.vue et les trois shells Repères :
 * les variantes reçoivent EXACTEMENT la matière résolue par la page réelle
 * (modèles d'exploration, dispatch de famille, payload carte, sources) et
 * rappellent LES MÊMES mutateurs d'URL (setQuery / setSort / setVue) —
 * l'état reste porté par l'URL, aucune copie locale de vérité.
 *
 * Ce dossier est volontairement jetable : pas d'abstraction production,
 * pas de test — l'artefact accepté est la décision visuelle (verdict PO).
 */
import type { Couche } from '@/carte/coucheModel'
import type {
  ModeleComposition,
  ModeleEnsembleComparaison,
  ModeleExploration,
  ModeleProfil,
  ModeleRelation,
  ModeleSignature,
  ModeleTrajectoire,
  TriExploration,
} from '@/indicateurs/explorationModel'
import type { FamilyDispatch } from '@/indicateurs/familySeam'
import type { NiveauMasque, Masques } from '@/geo/types'
import type { IndicatorPageMetadata, Payload, Territoire, Theme, ThemeMetadata } from '@/payload/types'
import type { SourceDatasetRecord } from '@/payload/selectors'

export type VarianteProto = 'A' | 'B' | 'C'
export type VueIndicateur = 'reperes' | 'carte' | 'indicateur'

export interface ProtocoleProps {
  /** La variante résolue depuis ?variant= (garde import.meta.env.DEV côté page). */
  variante: VarianteProto
  theme: Theme
  page: IndicatorPageMetadata
  metadata: ThemeMetadata | undefined
  dispatch: FamilyDispatch
  model: ModeleExploration
  trajectoire: ModeleTrajectoire | null
  signature: ModeleSignature | null
  ensemble: ModeleEnsembleComparaison | null
  profil: ModeleProfil | null
  relation: ModeleRelation | null
  composition: ModeleComposition | null
  sources: SourceDatasetRecord[]
  territoires: readonly Territoire[]
  masques: Masques | null
  payloadCarte: Payload
  couche: Couche | null
  niveauMasque: NiveauMasque
  territoireCible: Territoire | null
  vue: VueIndicateur
  setQuery: (key: string, value?: string) => void
  setSort: (tri: TriExploration) => void
  setVue: (vue: VueIndicateur) => void
}
