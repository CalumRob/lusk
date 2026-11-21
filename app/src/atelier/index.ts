/**
 * Public surface of the Atelier model (ADR-0046 containment).
 *
 * Only the page contract, the link codec, the acquisition seam and the pure
 * join are exposed. Nothing here carries a direction, a rank or a computed
 * indicator value into a fiche, a Page d'indicateur or a map.
 */

export {
  DEFAULT_TITLE, STATE_VERSION, cellKey, emptyAtelierState, isValidAtelierState,
} from './state'
export type {
  AtelierBlock, AtelierLevel, AtelierState, Attribute, AttributeBinding, Binding, CellRef,
  FigureBlock, FigureSpec, FigureType, FormuleBinding, Littoral, OverlayLevel, ProseBlock,
  ValueThreshold,
} from './state'

export { LINK_PARAM, decodeAtelierLink, defaultCodec, encodeAtelierLink } from './linkCodec'
export type { Codec, DecodedAtelierLink } from './linkCodec'

export { acquireCellules } from './acquisition'
export type { AcquisitionOptions } from './acquisition'

export { joinFigures } from './join'
export type {
  ExcludedPoint, FigureTerritory, JoinOptions, NonTracee, PlottedPoint, PlottedValues, RenderedFigure,
} from './join'

export type {
  AdmittedCohort, CelluleCoordinate, CelluleCoordinateValue, CelluleDeclaration, CelluleDemand,
  CohortAvailability, CohortSource, CohortValue, DiscoveryResource,
} from './types'
