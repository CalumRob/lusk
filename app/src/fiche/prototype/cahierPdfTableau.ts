/**
 * Value tables for the shared Cahier PDF (#1024).
 *
 * Tables come only from the frozen #1022 models. Columns are measured with the
 * embedded face; numbers keep their full native display and are never truncated
 * or abbreviated. The only permitted abbreviation is `Indisponible` → `Indisp.`
 * when the real cell width cannot hold the word — reported once under the
 * tables. A table wider than the page is split into coherent column groups and
 * continued with repeated headers, never scaled down.
 */
import type {
  CahierFigureTable,
  CahierTableCell,
  CahierTableColumn,
} from './cahierExportAdapters'
import type { MesureTexte } from './cahierPdfMesure'
import { plierTexte, tronquerParMesure } from './cahierPdfMesure'
import { PALETTE_PDF } from './cahierPdfPalette'
import { POLICE_PDF } from './cahierPdfFonts'

export const TAILLE_TABLEAU = {
  titre: 8,
  entete: 6.4,
  cellule: 7,
  note: 6.2,
  rang: 5.6,
} as const

export const INDISPONIBLE = 'Indisponible'
export const INDISPONIBLE_ABREGEE = 'Indisp.'
export const EXPLICATION_INDISPONIBLE = 'Indisp. : valeur indisponible.'

export interface ColonneTableauPdf {
  readonly column: CahierTableColumn
  readonly width: number
  readonly headerLines: readonly string[]
  readonly headerHeight: number
}

export interface CelluleTableauPdf {
  readonly cell: CahierTableCell
  readonly display: string
  readonly rankDisplay: string | null
}

export interface LigneTableauPdf {
  readonly label: string
  readonly labelLines: readonly string[]
  readonly cells: readonly CelluleTableauPdf[]
  readonly height: number
}

export interface TableauPdfPart {
  readonly key: string
  readonly title: string
  readonly titleLines: readonly string[]
  readonly columns: readonly ColonneTableauPdf[]
  readonly rows: readonly LigneTableauPdf[]
  readonly width: number
  readonly rowLabelWidth: number
  readonly headerHeight: number
  readonly unit: string | null
  readonly notes: readonly string[]
  readonly hasComparison: boolean
  readonly abbreviatedUnavailable: boolean
  /** Identifies the original table across its continued page parts. */
  readonly sourceKey: string
}

export interface OptionsTableauPdf {
  readonly mesure: MesureTexte
  readonly largeurDisponible: number
  /** The focal territory's exact public name; only that header may ellipsize. */
  readonly nomTerritoire: string | null
  /** Owner-observed comparison layer for this figure; never inferred from data. */
  readonly ownerDisplayed?: boolean
}

function largeurCellule(
  cell: CahierTableCell,
  mesure: MesureTexte,
): number {
  return Math.max(
    mesure.largeur(cell.display, POLICE_PDF.value, TAILLE_TABLEAU.cellule),
    cell.rankDisplay
      ? mesure.largeur(cell.rankDisplay, POLICE_PDF.meta, TAILLE_TABLEAU.rang)
      : 0,
  )
}

function estNumerique(cell: CahierTableCell): boolean {
  return cell.value !== null && Number.isFinite(cell.value)
}

function mesurerEntete(
  column: CahierTableColumn,
  largeur: number,
  mesure: MesureTexte,
  nomTerritoire: string | null,
): readonly string[] {
  const compact = nomTerritoire !== null && column.label === nomTerritoire
  if (compact) {
    const lignes = plierTexte(column.label, mesure, {
      police: POLICE_PDF.bodyStrong,
      taillePt: TAILLE_TABLEAU.entete,
      largeurMax: largeur - 2,
      casserMotsLongs: true,
    })
    if (lignes.length <= 2) return lignes.map((ligne) => ligne.texte)
    const first = lignes[0]!.texte
    const reste = lignes.slice(1).map((ligne) => ligne.texte).join(' ')
    return [first, tronquerParMesure(reste, mesure, {
      police: POLICE_PDF.bodyStrong,
      taillePt: TAILLE_TABLEAU.entete,
      largeurMax: largeur - 2,
    })]
  }
  return plierTexte(column.label, mesure, {
    police: POLICE_PDF.bodyStrong,
    taillePt: TAILLE_TABLEAU.entete,
    largeurMax: largeur - 2,
    casserMotsLongs: true,
  }).map((ligne) => ligne.texte)
}

export class CahierPdfTableLayoutError extends Error {
  readonly code = 'table-layout'
  constructor(message: string) {
    super(message)
    this.name = 'CahierPdfTableLayoutError'
  }
}

/**
 * Build the coherent page parts of one table. Column groups never split a
 * focal/comparison pair (`seriesKey`) and every part repeats the row label.
 */
export function construireTableauxPdf(
  table: CahierFigureTable,
  options: OptionsTableauPdf,
): readonly TableauPdfPart[] {
  const { mesure, largeurDisponible, nomTerritoire } = options
  if (table.columns.length === 0) {
    return [{
      key: table.key,
      sourceKey: table.key,
      title: table.title,
      titleLines: plierTexte(table.title, mesure, {
        police: POLICE_PDF.bodyStrong,
        taillePt: TAILLE_TABLEAU.titre,
        largeurMax: largeurDisponible,
      }).map((ligne) => ligne.texte),
      columns: [],
      rows: [],
      width: largeurDisponible,
      rowLabelWidth: largeurDisponible,
      headerHeight: 0,
      unit: table.unit,
      notes: table.notes,
      hasComparison: false,
      abbreviatedUnavailable: false,
    }]
  }

  // A comparison column is an explicit owner-published slot. When no served
  // value/rank exists, it stays visible as `Indisponible` but is not proof:
  // no subtitle/footer/`¹` marker claims a comparison that was not served.
  const comparisonKeys = new Set(
    table.columns.filter((column) => column.kind === 'comparison').map((column) => column.key),
  )
  const comparatifProuve = table.rows.some((row) => row.cells.some((cell) => (
    comparisonKeys.has(cell.columnKey) && (cell.value !== null || cell.rankDisplay !== null)
  )))

  const largeurLibelle = Math.min(
    36,
    Math.max(
      20,
      ...table.rows.map((row) => mesure.largeur(row.label, POLICE_PDF.body, TAILLE_TABLEAU.cellule) + 4),
    ),
  )

  const largeursNaturelles = table.columns.map((column) => {
    const cellules = table.rows.map((row) => row.cells.find((cell) => cell.columnKey === column.key))
    const numerique = Math.max(
      0,
      ...cellules
        .filter((cell): cell is CahierTableCell => Boolean(cell) && estNumerique(cell!))
        .map((cell) => largeurCellule(cell, mesure)),
    )
    const enteteMin = nomTerritoire !== null && column.label === nomTerritoire
      ? 24
      : Math.max(
        ...column.label.split(/\s+/).map((word) => mesure.largeur(word, POLICE_PDF.bodyStrong, TAILLE_TABLEAU.entete)),
      )
    const texte = Math.max(
      ...cellules.filter((cell): cell is CahierTableCell => Boolean(cell)).map((cell) => (
        cell.display === INDISPONIBLE
          ? mesure.largeur(INDISPONIBLE_ABREGEE, POLICE_PDF.value, TAILLE_TABLEAU.cellule)
          : largeurCellule(cell, mesure)
      )),
    )
    return Math.max(9, numerique, enteteMin, Math.min(texte, 24)) + 2.6
  })

  const paires: { column: CahierTableColumn; natural: number }[][] = []
  for (let index = 0; index < table.columns.length; index += 1) {
    const column = table.columns[index]!
    const natural = largeursNaturelles[index]!
    if (natural + largeurLibelle > largeurDisponible) {
      throw new CahierPdfTableLayoutError(
        `La valeur de la colonne « ${column.label} » dépasse la largeur utile du PDF ; aucun nombre n’est tronqué.`,
      )
    }
    const derniere = paires[paires.length - 1]
    const precedent = derniere?.[derniere.length - 1]
    if (precedent && column.seriesKey !== null && precedent.column.seriesKey === column.seriesKey) {
      derniere!.push({ column, natural })
    } else {
      paires.push([{ column, natural }])
    }
  }

  const groupes: { column: CahierTableColumn; natural: number }[][] = []
  let courant: { column: CahierTableColumn; natural: number }[] = []
  let total = largeurLibelle
  for (const paire of paires) {
    const largeurPaire = paire.reduce((sum, item) => sum + item.natural, 0)
    if (largeurPaire + largeurLibelle > largeurDisponible) {
      throw new CahierPdfTableLayoutError(
        'Un groupe de colonnes focal/comparaison dépasse la largeur utile du PDF.',
      )
    }
    if (courant.length > 0 && total + largeurPaire > largeurDisponible) {
      groupes.push(courant)
      courant = []
      total = largeurLibelle
    }
    courant.push(...paire)
    total += largeurPaire
  }
  if (courant.length) groupes.push(courant)

  const parts: TableauPdfPart[] = []
  for (let groupIndex = 0; groupIndex < groupes.length; groupIndex += 1) {
    const groupe = groupes[groupIndex]!
    const naturelTotal = groupe.reduce((sum, item) => sum + item.natural, largeurLibelle)
    const marge = Math.max(0, largeurDisponible - naturelTotal)
    const bonus = groupe.length ? marge / groupe.length : 0
    const colonnes: ColonneTableauPdf[] = groupe.map((item) => {
      const width = item.natural + bonus
      const headerLines = mesurerEntete(item.column, width, mesure, nomTerritoire)
      return {
        column: item.column,
        width,
        headerLines,
        headerHeight: headerLines.length * (mesure.hauteurLigne(POLICE_PDF.bodyStrong, TAILLE_TABLEAU.entete) * 1.16) + 1.8,
      }
    })
    let abrege = false
    const rows: LigneTableauPdf[] = table.rows.map((row) => {
      const cells: CelluleTableauPdf[] = colonnes.map((colonne) => {
        const cell = row.cells.find((candidate) => candidate.columnKey === colonne.column.key)
        if (!cell) {
          throw new CahierPdfTableLayoutError(
            `Cellule manquante pour « ${row.label} » / « ${colonne.column.label} ».`,
          )
        }
        let display = cell.display
        if (display === INDISPONIBLE) {
          const largeur = mesure.largeur(display, POLICE_PDF.value, TAILLE_TABLEAU.cellule)
          if (largeur > colonne.width - 2) {
            display = INDISPONIBLE_ABREGEE
            abrege = true
          }
        }
        return { cell, display, rankDisplay: cell.rankDisplay }
      })
      const labelLines = plierTexte(row.label, mesure, {
        police: POLICE_PDF.body,
        taillePt: TAILLE_TABLEAU.cellule,
        largeurMax: largeurLibelle - 2,
        casserMotsLongs: true,
      }).map((ligne) => ligne.texte)
      const hauteurCellule = cells.reduce((max, cellule) => {
        const lignes = plierTexte(cellule.display, mesure, {
          police: POLICE_PDF.value,
          taillePt: TAILLE_TABLEAU.cellule,
          largeurMax: colonneLargeur(colonnes, cellule.cell.columnKey) - 2,
          casserMotsLongs: cellule.cell.value === null,
        }).length + (cellule.rankDisplay ? 1 : 0)
        return Math.max(max, lignes)
      }, labelLines.length)
      const hauteurLigneTexte = Math.max(
        mesure.hauteurLigne(POLICE_PDF.value, TAILLE_TABLEAU.cellule),
        mesure.hauteurLigne(POLICE_PDF.body, TAILLE_TABLEAU.cellule),
      )
      return {
        label: row.label,
        labelLines,
        cells,
        height: hauteurCellule * hauteurLigneTexte * 1.12 + 1.8,
      }
    })
    const headerHeight = Math.max(...colonnes.map((colonne) => colonne.headerHeight), 4)
    const hasComparison = comparatifProuve && options.ownerDisplayed !== false
    parts.push({
      key: `${table.key}${groupIndex ? `:colonnes-${groupIndex + 1}` : ''}`,
      sourceKey: table.key,
      title: table.title,
      titleLines: plierTexte(table.title, mesure, {
        police: POLICE_PDF.bodyStrong,
        taillePt: TAILLE_TABLEAU.titre,
        largeurMax: largeurDisponible,
      }).map((ligne) => ligne.texte),
      columns: colonnes,
      rows,
      width: colonnes.reduce((sum, colonne) => sum + colonne.width, largeurLibelle),
      rowLabelWidth: largeurLibelle,
      headerHeight,
      unit: table.unit,
      notes: table.notes,
      hasComparison,
      abbreviatedUnavailable: abrege,
    })
  }
  return parts
}

function colonneLargeur(
  colonnes: readonly ColonneTableauPdf[],
  key: string,
): number {
  return colonnes.find((colonne) => colonne.column.key === key)?.width ?? 10
}

/** Fixed vertical rules only between mode/column groups. */
export function separateurVertical(
  columns: readonly ColonneTableauPdf[],
  index: number,
): boolean {
  if (index <= 0) return false
  const previous = columns[index - 1]!.column
  const current = columns[index]!.column
  if (current.kind === 'comparison' && previous.kind !== 'comparison') return true
  if (current.kind !== 'comparison' && previous.kind === 'comparison') return true
  return current.seriesKey !== null
    && previous.seriesKey !== null
    && current.seriesKey !== previous.seriesKey
}

/** Total table height before any row split; title/headers included. */
export function hauteurTableauPdf(part: TableauPdfPart): number {
  const hauteurTitre = part.titleLines.length
    * (TAILLE_TABLEAU.titre * 0.3528 * 1.18)
  const hauteurUnite = part.unit ? 2.4 : 0
  return hauteurTitre + 2 + hauteurUnite + part.headerHeight + part.rows.reduce((sum, row) => sum + row.height, 0) + 6
}

export const COULEURS_TABLEAU_PDF = {
  ink: PALETTE_PDF.ink,
  muted: PALETTE_PDF.muted,
  rule: PALETTE_PDF.borderLight,
  groupRule: PALETTE_PDF.muted,
} as const
