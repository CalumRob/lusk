/**
 * Approved comparison subtitle of the shared Cahier PDF (#1024/#1014).
 *
 * One rule, measured against the real embedded face: show every complete
 * public name when it fits on two lines, otherwise the largest complete prefix
 * plus `ET N AUTRES …`, otherwise `SÉLECTION DE N …`. There is no fixed name
 * count, no font shrinking and no truncated member name. The member total comes
 * from the source selection, never from a measure's eligible contributors.
 */
import type {
  CahierCaptureComparison,
  CahierCaptureComparisonGroup,
} from './cahierExportCapture'
import type { TerritoryIdentity } from '@/fiche/content/territoryFacts'
import type { MesureTexte } from './cahierPdfMesure'

export const PREFIXE_GROUPE_COMPARE = 'Groupe comparé :'

/**
 * The prefix run the approved mockup actually paints (`comparisonHeadingMockup.js:34`):
 * its trailing space belongs to the prefix span's own face/size, so the visible
 * gap is a real glyph advance, not a measured allowance invented by the PDF.
 */
export const PREFIXE_GROUPE_COMPARE_ESPACE = `${PREFIXE_GROUPE_COMPARE} `

export type StrategieSousTitreComparaison =
  | 'preset-epci'
  | 'preset-bretagne'
  | 'tous'
  | 'prefixe'
  | 'compte'

export interface RunSousTitre {
  readonly kind: 'prefix' | 'names'
  readonly texte: string
}

export interface SousTitreComparaison {
  readonly strategie: StrategieSousTitreComparaison
  readonly lignes: readonly (readonly RunSousTitre[])[]
  readonly total: number | null
  readonly nommes: number | null
  readonly texte: string
}

export interface OptionsMesureSousTitre {
  readonly mesure: MesureTexte
  /** Width available to the complete subtitle block. */
  readonly largeur: number
  readonly police: string
  readonly taillePt: number
  readonly espacementPt?: number
  readonly policePrefixe: string
  readonly taillePrefixePt: number
}

function niveau(type: TerritoryIdentity['type'] | null): 'commune' | 'epci' | 'departement' {
  if (type === 'epci') return 'epci'
  if (type === 'departement' || type === 'region') return 'departement'
  return 'commune'
}

/** Exact approved Bretagne preset wording; no per-section copy. */
export function libellePresetBretagne(type: TerritoryIdentity['type'] | null): string {
  switch (niveau(type)) {
    case 'commune': return 'COMMUNES BRETONNES'
    case 'epci': return 'EPCI BRETONS'
    case 'departement': return 'DÉPARTEMENTS BRETONS'
  }
}

function nominal(level: ReturnType<typeof niveau>, plural: boolean): string {
  switch (level) {
    case 'commune': return plural ? 'COMMUNES' : 'COMMUNE'
    case 'epci': return 'EPCI'
    case 'departement': return plural ? 'DÉPARTEMENTS' : 'DÉPARTEMENT'
  }
}

function upper(value: string): string {
  return value.toLocaleUpperCase('fr-FR')
}

/**
 * Whether the section actually shows comparative proof. A group identity or a
 * `capable` flag is not proof; the owner-observed display state and at least
 * one drawn layer are.
 */
export function comparaisonAffichee(comparison: CahierCaptureComparison): boolean {
  return comparison.display.state === 'displayed'
    && comparison.display.layers.some((layer) => layer.displayed)
}

export interface NomsGroupeCompare {
  readonly mode: 'preset' | 'custom'
  readonly preset: 'epci' | 'bretagne' | null
  readonly level: TerritoryIdentity['type'] | null
  readonly names: readonly string[]
  readonly total: number | null
}

/**
 * The names the subtitle may show, from the source group only. A custom group's
 * total is the actual selected membership count (never eligible contributors).
 */
export function nomsGroupeCompare(
  comparison: CahierCaptureComparison,
): NomsGroupeCompare | null {
  const group: CahierCaptureComparisonGroup | null = comparison.group
  if (!group) return null
  const preset = group.preset === 'epci' || group.preset === 'bretagne'
    ? group.preset
    : comparison.selection.preset === 'epci' || comparison.selection.preset === 'bretagne'
      ? comparison.selection.preset
      : null
  const level = group.level ?? comparison.selection.level
  const rawNames = group.names.map((name) => name.trim()).filter(Boolean)
  if (preset === 'bretagne') {
    return {
      mode: 'preset',
      preset: 'bretagne',
      level,
      names: [libellePresetBretagne(level)],
      total: null,
    }
  }
  if (preset === 'epci') {
    return { mode: 'preset', preset: 'epci', level, names: rawNames, total: null }
  }
  const total = group.selectedMemberCount
    ?? comparison.selection.memberCount
    ?? (rawNames.length > 0 ? rawNames.length : null)
  return { mode: 'custom', preset: null, level, names: rawNames, total }
}

interface LignesCandidate {
  readonly lignes: readonly (readonly RunSousTitre[])[]
  readonly nommes: number
}

/** Wrap a candidate exactly, keeping the prefix as the first run of line 1. */
function plierCandidat(
  noms: string,
  options: OptionsMesureSousTitre,
): readonly (readonly RunSousTitre[])[] | null {
  const {
    mesure,
    largeur,
    police,
    taillePt,
    espacementPt = 0,
    policePrefixe,
    taillePrefixePt,
  } = options
  const largeurPrefixe = mesure.largeur(
    PREFIXE_GROUPE_COMPARE_ESPACE,
    policePrefixe,
    taillePrefixePt,
  )
  const lignes: RunSousTitre[][] = []
  let motsLigne: string[] = []
  let largeurLigne = 0
  let depassement = false
  const largeurPremiere = Math.max(1, largeur - largeurPrefixe)
  const pousser = () => {
    if (!motsLigne.length) return
    const texte = motsLigne.join(' ')
    if (lignes.length === 0) {
      if (mesure.largeur(texte, police, taillePt, espacementPt) > largeurPremiere) depassement = true
      lignes.push([
        { kind: 'prefix', texte: PREFIXE_GROUPE_COMPARE_ESPACE },
        { kind: 'names', texte },
      ])
    } else {
      if (mesure.largeur(texte, police, taillePt, espacementPt) > largeur) depassement = true
      lignes.push([{ kind: 'names', texte }])
    }
    motsLigne = []
    largeurLigne = 0
  }
  for (const mot of noms.split(/\s+/).filter(Boolean)) {
    const largeurMot = mesure.largeur(mot, police, taillePt, espacementPt)
    const ajoutEspace = motsLigne.length > 0 ? mesure.espace(police, taillePt) : 0
    const limite = lignes.length === 0 ? largeurPremiere : largeur
    if (motsLigne.length > 0 && largeurLigne + ajoutEspace + largeurMot > limite) {
      pousser()
    }
    motsLigne.push(mot)
    largeurLigne = largeurLigne === 0 ? largeurMot : largeurLigne + ajoutEspace + largeurMot
  }
  pousser()
  if (depassement) return null
  return lignes.length ? lignes : null
}

function essayer(noms: string, options: OptionsMesureSousTitre): LignesCandidate | null {
  const lignes = plierCandidat(noms, options)
  if (!lignes || lignes.length > 2) return null
  const nommes = noms.split(',').filter((part) => part.trim()).length
  return { lignes, nommes }
}

/**
 * Build the approved subtitle. Returns null when the group has no displayable
 * public identity (the caller then omits the heading rather than inventing one).
 */
export function sousTitreComparaison(
  comparison: CahierCaptureComparison,
  options: OptionsMesureSousTitre,
): SousTitreComparaison | null {
  if (!comparaisonAffichee(comparison)) return null
  const group = nomsGroupeCompare(comparison)
  if (!group) return null

  if (group.preset === 'bretagne') {
    const texte = group.names[0] ?? libellePresetBretagne(group.level)
    const disposition = essayer(texte, options)
    return disposition
      ? {
        strategie: 'preset-bretagne',
        lignes: disposition.lignes,
        total: null,
        nommes: null,
        texte,
      }
      : null
  }

  if (group.preset === 'epci') {
    if (group.names.length === 0) return null
    // EPCI: its exact public name, not the producer scope sentence.
    const texte = upper(group.names[0]!)
    const disposition = essayer(texte, options)
    return disposition
      ? {
        strategie: 'preset-epci',
        lignes: disposition.lignes,
        total: null,
        nommes: null,
        texte,
      }
      : null
  }

  const collator = new Intl.Collator('fr-FR')
  const trie = [...group.names].sort(collator.compare)
  const total = group.total ?? trie.length
  if (trie.length === 0 || total === 0) return null
  const level = niveau(group.level)
  const complet = trie.map(upper).join(', ')
  const tous = essayer(complet, options)
  if (tous && tous.nommes === trie.length) {
    return {
      strategie: 'tous',
      lignes: tous.lignes,
      total,
      nommes: trie.length,
      texte: complet,
    }
  }
  for (let count = trie.length - 1; count >= 1; count -= 1) {
    const omitted = total - count
    if (omitted <= 0) continue
    const suffixe = `ET ${omitted} ${omitted === 1 ? 'AUTRE' : 'AUTRES'} ${nominal(level, omitted > 1)}`
    const candidat = `${trie.slice(0, count).map(upper).join(', ')} ${suffixe}`
    const disposition = essayer(candidat, options)
    if (disposition) {
      return {
        strategie: 'prefixe',
        lignes: disposition.lignes,
        total,
        nommes: count,
        texte: candidat,
      }
    }
  }
  const repli = `SÉLECTION DE ${total} ${nominal(level, total > 1)}`
  const disposition = essayer(repli, options)
  return disposition
    ? {
      strategie: 'compte',
      lignes: disposition.lignes,
      total,
      nommes: 0,
      texte: repli,
    }
    : null
}

/** Plain-text form used by tests and PDF text extraction. */
export function texteSousTitre(sousTitre: SousTitreComparaison): string {
  return sousTitre.lignes
    .map((ligne) => ligne.map((run) => run.texte).join(''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Measured height of the laid-out subtitle. */
export function hauteurSousTitre(sousTitre: SousTitreComparaison, options: {
  readonly mesure: MesureTexte
  readonly police: string
  readonly taillePt: number
  readonly policePrefixe: string
  readonly taillePrefixePt: number
}): number {
  return sousTitre.lignes.reduce((total, ligne) => {
    const hauteur = ligne.reduce((max, run) => Math.max(
      max,
      run.kind === 'prefix'
        ? options.mesure.hauteurLigne(options.policePrefixe, options.taillePrefixePt)
        : options.mesure.hauteurLigne(options.police, options.taillePt),
    ), 0)
    return total + hauteur * 1.18
  }, 0)
}
