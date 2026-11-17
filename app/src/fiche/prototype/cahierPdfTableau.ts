/**
 * Value tables for the shared Cahier PDF (#1024).
 *
 * Tables come only from the frozen #1022 models. Columns are measured with the
 * embedded face; numbers keep their full native display and are never truncated
 * or abbreviated. The only permitted abbreviation is `Indisponible` → `Indisp.`
 * when the real cell width cannot hold the word — reported once under the
 * tables. A table wider than the page is split into coherent column groups and
 * continued with repeated headers, never scaled down.
 *
 * The approved generator prints the served comparison rank as its own `Rang`
 * column next to the compared group (`desktop.js`: headers
 * `['Temps','Mode',territory,'Groupe comparé','Rang']`, value
 * `row.comparison.rank ?? '—'`). The rank is therefore a column, never a second
 * micro-line under the value, and it is only ever the producer-served display:
 * `formatServedRank` has already folded absent/1-of-1 ranks to null, and the
 * painter writes the approved em dash for that absence. Nothing is recomputed.
 */
import type {
  CahierFigureTable,
  CahierTableCell,
  CahierTableColumn,
} from './cahierExportAdapters'
import type { MesureTexte } from './cahierPdfMesure'
import { plierTexte, tronquerParMesure } from './cahierPdfMesure'
import { PALETTE_PDF } from './cahierPdfPalette'
import { ROLE_PDF } from './cahierPdfGrammaire'

export const TAILLE_TABLEAU = {
  titre: ROLE_PDF.titreTableau.taille,
  entete: ROLE_PDF.enteteTableauSous.taille,
  enteteMode: ROLE_PDF.enteteTableauMode.taille,
  cellule: ROLE_PDF.valeurTableau.taille,
  libelle: ROLE_PDF.libelleTableau.taille,
} as const

export const INDISPONIBLE = 'Indisponible'
export const INDISPONIBLE_ABREGEE = 'Indisp.'
export const EXPLICATION_INDISPONIBLE = 'Indisp. : valeur indisponible.'
export const RANG_ABSENT = '—'

export type RoleColonneTableauPdf = 'valeur' | 'rang'

export interface ColonneTableauPdf {
  /** Stable key: the source column key, or `${source}:rang`. */
  readonly key: string
  /** The source column this PDF column displays (a rank column keeps its comparison column). */
  readonly column: CahierTableColumn
  readonly role: RoleColonneTableauPdf
  /** Mode/column group: focal, comparison and rank of one mode stay together. */
  readonly groupe: string
  readonly width: number
  readonly headerLines: readonly string[]
  readonly headerHeight: number
}

export interface CelluleTableauPdf {
  readonly cell: CahierTableCell
  readonly role: RoleColonneTableauPdf
  readonly display: string
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
  return mesure.largeur(cell.display, ROLE_PDF.valeurTableau.police, ROLE_PDF.valeurTableau.taille)
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
  const commun = {
    police: ROLE_PDF.enteteTableauSous.police,
    taillePt: ROLE_PDF.enteteTableauSous.taille,
    largeurMax: largeur - 2,
    casserMotsLongs: true,
  } as const
  if (compact) {
    const lignes = plierTexte(column.label, mesure, commun)
    if (lignes.length <= 2) return lignes.map((ligne) => ligne.texte)
    const first = lignes[0]!.texte
    const reste = lignes.slice(1).map((ligne) => ligne.texte).join(' ')
    return [first, tronquerParMesure(reste, mesure, commun)]
  }
  return plierTexte(column.label, mesure, commun).map((ligne) => ligne.texte)
}

export class CahierPdfTableLayoutError extends Error {
  readonly code = 'table-layout'
  constructor(message: string) {
    super(message)
    this.name = 'CahierPdfTableLayoutError'
  }
}

/** The explicit `Rang` column that follows one compared-group column. */
function colonneRang(column: CahierTableColumn): ColonneTableauPdf['column'] {
  return {
    ...column,
    key: `${column.key}:rang`,
    label: 'Rang',
    unit: null,
    kind: 'comparison',
  }
}

/**
 * Reading order of one table: a mode's focal value, its compared-group value and
 * the served rank stay adjacent, as in the approved desktop grouped table.
 * Series-keyed families are regrouped by their mode; flat families already
 * arrive as focal/comparison pairs and keep their source order.
 */
function ordonnerColonnes(columns: readonly CahierTableColumn[]): readonly CahierTableColumn[] {
  if (!columns.some((column) => column.seriesKey !== null)) return columns
  const groupes = new Map<string, CahierTableColumn[]>()
  for (const column of columns) {
    const groupe = column.seriesKey ?? column.key
    const liste = groupes.get(groupe) ?? []
    liste.push(column)
    groupes.set(groupe, liste)
  }
  return [...groupes.values()].flat()
}

/**
 * One focal/comparison pair is one group: a flat table's consecutive focal and
 * comparison columns stay together (and receive the rank column), while a
 * series-keyed table groups all its mode columns.
 */
function groupesSource(columns: readonly CahierTableColumn[]): readonly (readonly CahierTableColumn[])[] {
  if (columns.some((column) => column.seriesKey !== null)) {
    const groupes = new Map<string, CahierTableColumn[]>()
    for (const column of columns) {
      const groupe = column.seriesKey ?? column.key
      const liste = groupes.get(groupe) ?? []
      liste.push(column)
      groupes.set(groupe, liste)
    }
    return [...groupes.values()]
  }
  const groupes: CahierTableColumn[][] = []
  let index = 0
  while (index < columns.length) {
    const column = columns[index]!
    const suivant = columns[index + 1]
    if (column.kind === 'focal' && suivant?.kind === 'comparison') {
      groupes.push([column, suivant])
      index += 2
    } else {
      groupes.push([column])
      index += 1
    }
  }
  return groupes
}

interface ColonneAffichage {
  readonly column: CahierTableColumn
  readonly role: RoleColonneTableauPdf
  readonly groupe: string
  readonly natural: number
}

/**
 * Build the coherent page parts of one table. Column groups never split a
 * focal/comparison/rank group (`seriesKey`) and every part repeats the row label.
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
        police: ROLE_PDF.titreTableau.police,
        taillePt: ROLE_PDF.titreTableau.taille,
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
      ...table.rows.map((row) => mesure.largeur(
        row.label,
        ROLE_PDF.libelleTableau.police,
        ROLE_PDF.libelleTableau.taille,
      ) + 4),
    ),
  )

  const groupesOrdonnes = groupesSource(ordonnerColonnes(table.columns))
  const groupeParCle = new Map<string, string>()
  groupesOrdonnes.forEach((groupe, index) => {
    for (const colonne of groupe) groupeParCle.set(colonne.key, `g${index}`)
  })
  const colonnesOrdonnees = groupesOrdonnes.flat()
  const affichage: ColonneAffichage[] = []
  for (const column of colonnesOrdonnees) {
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
        ...column.label.split(/\s+/).map((word) => mesure.largeur(
          word,
          ROLE_PDF.enteteTableauSous.police,
          ROLE_PDF.enteteTableauSous.taille,
        )),
      )
    const texte = Math.max(
      ...cellules.filter((cell): cell is CahierTableCell => Boolean(cell)).map((cell) => (
        cell.display === INDISPONIBLE
          ? mesure.largeur(INDISPONIBLE_ABREGEE, ROLE_PDF.valeurTableau.police, ROLE_PDF.valeurTableau.taille)
          : largeurCellule(cell, mesure)
      )),
    )
    const natural = Math.max(9, numerique, enteteMin, Math.min(texte, 24)) + 2.6
    const groupe = groupeParCle.get(column.key) ?? column.key
    affichage.push({ column, role: 'valeur', groupe, natural })
    if (column.kind === 'comparison') {
      const libelleRang = colonneRang(column)
      const rangMax = Math.max(
        0,
        ...cellules.filter((cell): cell is CahierTableCell => Boolean(cell)).map((cell) => (
          mesure.largeur(
            cell.rankDisplay ?? RANG_ABSENT,
            ROLE_PDF.valeurTableau.police,
            ROLE_PDF.valeurTableau.taille,
          )
        )),
      )
      const enteteRang = mesure.largeur(
        libelleRang.label,
        ROLE_PDF.enteteTableauSous.police,
        ROLE_PDF.enteteTableauSous.taille,
      )
      affichage.push({
        column: libelleRang,
        role: 'rang',
        groupe,
        natural: Math.max(7, enteteRang, rangMax) + 2.6,
      })
    }
  }

  const paires: ColonneAffichage[][] = []
  for (const colonne of affichage) {
    if (colonne.natural + largeurLibelle > largeurDisponible) {
      throw new CahierPdfTableLayoutError(
        `La valeur de la colonne « ${colonne.column.label} » dépasse la largeur utile du PDF ; aucun nombre n’est tronqué.`,
      )
    }
    const derniere = paires[paires.length - 1]
    if (derniere && derniere[0]!.groupe === colonne.groupe) {
      derniere.push(colonne)
    } else {
      paires.push([colonne])
    }
  }

  const groupes: ColonneAffichage[][] = []
  let courant: ColonneAffichage[] = []
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
      if (item.role === 'rang') {
        const headerLines = [item.column.label]
        return {
          key: item.column.key,
          column: item.column,
          role: 'rang',
          groupe: item.groupe,
          width,
          headerLines,
          headerHeight: mesure.hauteurLigne(
            ROLE_PDF.enteteTableauSous.police,
            ROLE_PDF.enteteTableauSous.taille,
          ) * 1.16 + 1.8,
        }
      }
      const headerLines = mesurerEntete(item.column, width, mesure, nomTerritoire)
      return {
        key: item.column.key,
        column: item.column,
        role: 'valeur',
        groupe: item.groupe,
        width,
        headerLines,
        headerHeight: headerLines.length * (
          mesure.hauteurLigne(ROLE_PDF.enteteTableauSous.police, ROLE_PDF.enteteTableauSous.taille) * 1.16
        ) + 1.8,
      }
    })
    let abrege = false
    const rows: LigneTableauPdf[] = table.rows.map((row) => {
      const cells: CelluleTableauPdf[] = colonnes.map((colonne) => {
        const source = row.cells.find((candidate) => (
          candidate.columnKey === colonne.column.key
          || candidate.columnKey === colonne.column.key.replace(/:rang$/, '')
        ))
        if (!source) {
          throw new CahierPdfTableLayoutError(
            `Cellule manquante pour « ${row.label} » / « ${colonne.column.label} ».`,
          )
        }
        if (colonne.role === 'rang') {
          return { cell: source, role: 'rang' as const, display: source.rankDisplay ?? RANG_ABSENT }
        }
        let display = source.display
        if (display === INDISPONIBLE) {
          const largeur = mesure.largeur(
            display,
            ROLE_PDF.valeurTableau.police,
            ROLE_PDF.valeurTableau.taille,
          )
          if (largeur > colonne.width - 2) {
            display = INDISPONIBLE_ABREGEE
            abrege = true
          }
        }
        return { cell: source, role: 'valeur' as const, display }
      })
      const labelLines = plierTexte(row.label, mesure, {
        police: ROLE_PDF.libelleTableau.police,
        taillePt: ROLE_PDF.libelleTableau.taille,
        largeurMax: largeurLibelle - 2,
        casserMotsLongs: true,
      }).map((ligne) => ligne.texte)
      const hauteurCellule = cells.reduce((max, cellule) => {
        if (cellule.role === 'rang') return Math.max(max, 1)
        const lignes = plierTexte(cellule.display, mesure, {
          police: ROLE_PDF.valeurTableau.police,
          taillePt: ROLE_PDF.valeurTableau.taille,
          largeurMax: colonneLargeur(colonnes, cellule.cell.columnKey) - 2,
          casserMotsLongs: cellule.cell.value === null,
        }).length
        return Math.max(max, lignes)
      }, labelLines.length)
      const hauteurLigneTexte = Math.max(
        mesure.hauteurLigne(ROLE_PDF.valeurTableau.police, ROLE_PDF.valeurTableau.taille),
        mesure.hauteurLigne(ROLE_PDF.libelleTableau.police, ROLE_PDF.libelleTableau.taille),
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
        police: ROLE_PDF.titreTableau.police,
        taillePt: ROLE_PDF.titreTableau.taille,
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
  return colonnes.find((colonne) => colonne.key === key)?.width ?? 10
}

/** Fixed vertical rules only between mode/column groups. */
export function separateurVertical(
  columns: readonly ColonneTableauPdf[],
  index: number,
): boolean {
  if (index <= 0) return false
  return columns[index]!.groupe !== columns[index - 1]!.groupe
}

/** Total table height before any row split; title/headers included. */
export function hauteurTableauPdf(part: TableauPdfPart): number {
  const hauteurTitre = part.titleLines.length
    * (ROLE_PDF.titreTableau.taille * 0.3528 * 1.18)
  const hauteurUnite = part.unit ? 2.4 : 0
  return hauteurTitre + 2 + hauteurUnite + part.headerHeight + part.rows.reduce((sum, row) => sum + row.height, 0) + 6
}

export const COULEURS_TABLEAU_PDF = {
  ink: PALETTE_PDF.ink,
  muted: PALETTE_PDF.muted,
  rule: PALETTE_PDF.borderLight,
  groupRule: PALETTE_PDF.muted,
} as const
