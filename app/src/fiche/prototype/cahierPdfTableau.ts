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
import { PALETTE_PDF, couleurPdf } from './cahierPdfPalette'
import { ROLE_PDF, mmDepuisCssPx } from './cahierPdfGrammaire'

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

/**
 * One owned box model for the table caption/header, consumed by the composer's
 * pagination measurement and by the painter.
 *
 * Provenance is mixed on purpose, and each value says which it is:
 * - a **conversion** of the approved source's own CSS box (the `th` padding);
 * - a **measured** advance read on R1–R3, because the embedded face's line box
 *   is not the browser's (the caption gap, the header/row advances).
 *
 * A cited CSS value is the source *role*, never a claim that a millimetre value
 * equals its direct conversion: `apresTitreMm` is the measured caption→header
 * gap on the approved artifacts, not the source's 8 px caption margin (which
 * would be 1.48 mm), and `interligneEntete` is the measured advance over the
 * face's own 1.2 em box — not the CSS `line-height: 1.35`.
 */
export const ESPACE_TABLEAU = {
  /** `desktop.js` table `th` vertical padding (`padding:6px 4px`) — converted. */
  remplissageEnteteMm: mmDepuisCssPx(6),
  /** Approved caption line-height (`line-height: 1.18`). */
  interligneTitre: 1.18,
  /** Measured caption → header gap on R1–R3 (1.2 mm, ~3.4 px). */
  apresTitreMm: 1.2,
  /** `(suite)` line box on a continued page part. */
  suiteMm: 2.8,
  /** Row-label/value top inset inside a row (1 mm measured). */
  ligneInsetMm: 1,
  /** Measured header advance over the embedded face's 1.2 em line box. */
  interligneEntete: 1.16,
  /** Measured row-text advance over the same box. */
  interligneLigne: 1.12,
  /** Row box bottom padding measured on the approved table rows. */
  remplissageLigneMm: 1.8,
} as const

export type RoleColonneTableauPdf = 'valeur' | 'rang'

export interface ColonneTableauPdf {
  /** Stable key: the source column key, or `${source}:rang`. */
  readonly key: string
  /** The source column this PDF column displays (a rank column keeps its comparison column). */
  readonly column: CahierTableColumn
  readonly role: RoleColonneTableauPdf
  /** Mode/column group: focal, comparison and rank of one mode stay together. */
  readonly groupe: string
  /** Starts a vertical rule block (mode group or legend-key boundary). */
  readonly separatorBefore: boolean
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
  /** Approved table shape: `grouped` paints a legend-key header row. */
  readonly layout: 'flat' | 'grouped'
  /** Row-dimension header (`Temps`, `Statistique`); null for a scalar table. */
  readonly rowHeader: string | null
  readonly groups: readonly GroupeEnteteTableauPdf[]
  readonly columns: readonly ColonneTableauPdf[]
  readonly rows: readonly LigneTableauPdf[]
  readonly width: number
  /** Smallest measured width that keeps every number and header readable. */
  readonly naturalWidth: number
  /** Approved flat shape A: fixed `colgroup` percentages fill the available width. */
  readonly colgroupFixe: boolean
  readonly rowLabelWidth: number
  /** Legend-key header row height (0 for the flat shape). */
  readonly groupHeaderHeight: number
  readonly headerHeight: number
  readonly notes: readonly string[]
  readonly hasComparison: boolean
  readonly abbreviatedUnavailable: boolean
  /** Identifies the original table across its continued page parts. */
  readonly sourceKey: string
}

/** One coloured legend-key header spanning its focal/compared/rank columns. */
export interface GroupeEnteteTableauPdf {
  readonly key: string
  readonly label: string
  readonly color: string | null
  readonly width: number
  /** The label wrapped to the measured group width (native `overflow-wrap`). */
  readonly labelLines: readonly string[]
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
  role: { readonly police: string; readonly taille: number },
): readonly string[] {
  const compact = nomTerritoire !== null && column.label === nomTerritoire
  const commun = {
    police: role.police,
    taillePt: role.taille,
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

/**
 * Approved flat (shape A) `colgroup` widths, `desktop.js:215`, in percent.
 * With comparison: `14 / 32 / 18 / 18 / 18` (label, mode, territory, Groupe,
 * Rang). Without comparison: `18 / 46 / 36` (label, mode, territory) — the
 * reachable three-column state, not the five-column one.
 */
const COLGROUP_ACCES = {
  avecComparaison: [32, 18, 18, 18] as const,
  sansComparaison: [46, 36] as const,
  libelleAvecComparaison: 14,
  libelleSansComparaison: 18,
} as const

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
 * Reading order of one table. A grouped table keeps every legend-key group
 * together (focal, compared value and served rank), in the visible series
 * order the legend shows. A flat table keeps its source column order.
 */
function ordonnerColonnes(
  columns: readonly CahierTableColumn[],
  groupable: boolean,
): readonly CahierTableColumn[] {
  if (!groupable) return columns
  const groupes = new Map<string, CahierTableColumn[]>()
  for (const column of columns) {
    const groupe = column.groupLabel ?? column.seriesKey ?? column.key
    const liste = groupes.get(groupe) ?? []
    liste.push(column)
    groupes.set(groupe, liste)
  }
  return [...groupes.values()].flat()
}

/**
 * Approved column grouping. A grouped table (approved shape B) has one group
 * per legend key: the territory/focal column, its compared `Groupe` column and
 * the rank column stay together. A flat table (approved shape A) is one
 * group: its mode is a row dimension, so its five columns never split.
 */
function groupesSource(
  columns: readonly CahierTableColumn[],
  groupable: boolean,
): readonly (readonly CahierTableColumn[])[] {
  if (!groupable) return [columns]
  const groupes = new Map<string, CahierTableColumn[]>()
  for (const column of columns) {
    const groupe = column.groupLabel ?? column.seriesKey ?? column.key
    const liste = groupes.get(groupe) ?? []
    liste.push(column)
    groupes.set(groupe, liste)
  }
  return [...groupes.values()]
}

interface ColonneAffichage {
  readonly column: CahierTableColumn
  readonly role: RoleColonneTableauPdf
  readonly groupe: string
  /** Natural width in mm; a flat table may shrink it proportionally to fit. */
  natural: number
  /** Width of the widest served number in this column (0 if none). */
  readonly numerique: number
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
  /** Explicit approved shape: adapters declare it; the PDF never infers it. */
  const grouped = table.layout === 'grouped'
  /** Approved flat shape A: the generator's fixed `colgroup` percentages. */
  const colgroupFixe = table.colgroup === 'access-approved'
  /** Any series/legend-key grouping means a split may only cut whole groups. */
  const groupable = table.columns.some((column) => (
    column.groupLabel != null || column.seriesKey !== null
  ))
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
      layout: 'flat',
      rowHeader: table.rowHeader ?? null,
      groups: [],
      columns: [],
      rows: [],
      width: largeurDisponible,
      naturalWidth: largeurDisponible,
      colgroupFixe: false,
      rowLabelWidth: largeurDisponible,
      groupHeaderHeight: 0,
      headerHeight: 0,
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

  const avecComparaison = table.columns.some((column) => column.kind === 'comparison')
  const largeurLibelle = !colgroupFixe
    ? Math.min(
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
    : largeurDisponible * (
      avecComparaison ? COLGROUP_ACCES.libelleAvecComparaison : COLGROUP_ACCES.libelleSansComparaison
    ) / 100

  // The flat approved shape (A) prints its single header row in the mode role;
  // the grouped shape (B) keeps the smaller legend-role sub-header.
  const roleEntete = grouped ? ROLE_PDF.enteteTableauSous : ROLE_PDF.enteteTableauMode
  const groupesOrdonnes = groupesSource(ordonnerColonnes(table.columns, groupable), groupable)
  const groupeParCle = new Map<string, string>()
  const libelleGroupe = new Map<string, { label: string; color: string | null }>()
  groupesOrdonnes.forEach((groupe, index) => {
    for (const colonne of groupe) groupeParCle.set(colonne.key, `g${index}`)
    const premiere = groupe[0]!
    libelleGroupe.set(`g${index}`, {
      label: premiere.groupLabel ?? '',
      color: premiere.groupColor ?? null,
    })
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
    // Natural width is the honest one-line advance of the whole header label
    // and of every cell display, read from the embedded face. Keeping the full
    // label (not just its longest word) means a header such as « Groupe comparé »
    // is not forced onto two lines by the natural-width layout. The focal
    // territory is the one approved exception: its long public name wraps/
    // ellipsizes in a fixed compact band. Cell displays are measured at full
    // width so a cell that fit on one line before is never forced to wrap.
    const enteteMin = nomTerritoire !== null && column.label === nomTerritoire
      ? 24
      : mesure.largeur(column.label, roleEntete.police, roleEntete.taille)
    const texte = Math.max(
      0,
      ...cellules.filter((cell): cell is CahierTableCell => Boolean(cell)).map((cell) => largeurCellule(cell, mesure)),
    )
    // A served comparison header carries the `¹` link; reserve its advance so
    // the mark never spills into the neighbouring `Rang` column.
    const marqueComparaison = column.kind === 'comparison'
      ? mesure.largeur(' ¹', roleEntete.police, roleEntete.taille)
      : 0
    const natural = Math.max(9, numerique, enteteMin, Math.min(texte, 24)) + 2.6 + marqueComparaison
    const groupe = groupeParCle.get(column.key) ?? column.key
    affichage.push({ column, role: 'valeur', groupe, natural, numerique })
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
        roleEntete.police,
        roleEntete.taille,
      )
      affichage.push({
        column: libelleRang,
        role: 'rang',
        groupe,
        natural: Math.max(7, enteteRang, rangMax) + 2.6,
        numerique: rangMax,
      })
    }
  }

  // A single column that cannot fit next to its row label is a genuine layout
  // error: no number may be truncated, narrowed or abbreviated to hide it.
  for (const colonne of affichage) {
    if (colonne.natural + largeurLibelle > largeurDisponible) {
      throw new CahierPdfTableLayoutError(
        `La valeur de la colonne « ${colonne.column.label} » dépasse la largeur utile du PDF ; aucun nombre n’est tronqué.`,
      )
    }
  }

  // Smallest honest width: row labels plus every column at its measured
  // natural width, before the approved `colgroup` or proportional fit.
  const naturalWidth = largeurLibelle + affichage.reduce((sum, item) => sum + item.natural, 0)

  // Approved flat shape A uses the generator's fixed `colgroup` percentages
  // (`desktop.js:215`), not a proportional natural-width fit: `Temps` 14 %,
  // then the visible columns; the served numbers must still fit their cell.
  if (colgroupFixe) {
    const ratios = affichage.length === 4
      ? COLGROUP_ACCES.avecComparaison
      : COLGROUP_ACCES.sansComparaison
    if (ratios.length !== affichage.length) {
      throw new CahierPdfTableLayoutError('La forme plate n’a pas le nombre de colonnes approuvé.')
    }
    affichage.forEach((item, index) => {
      // The approved percentages are shares of the whole table width, the
      // label column included (`desktop.js:215`), never of the remaining box.
      item.natural = largeurDisponible * ratios[index]! / 100
      if (item.numerique > item.natural - 2) {
        throw new CahierPdfTableLayoutError(
          `La valeur de la colonne « ${item.column.label} » ne tient pas dans la largeur mesurée du tableau ; aucun nombre n’est réduit.`,
        )
      }
    })
  }

  // A flat table is the approved shape A: its mode is a row dimension, so the
  // column set is fixed and the browser's `table-layout: fixed` fits it to the
  // content box. Reproduce that proportional fit instead of inventing a column
  // split (there is no complete group boundary to split at).
  if (!groupable) {
    const naturels = affichage.reduce((sum, item) => sum + item.natural, 0)
    if (naturels + largeurLibelle > largeurDisponible) {
      const disponible = Math.max(7 * affichage.length, largeurDisponible - largeurLibelle)
      const facteur = disponible / naturels
      for (const item of affichage) item.natural = Math.max(7, item.natural * facteur)
      // A number may never be painted outside its own cell: if the native
      // proportional fit would clip a served value, this is a measured
      // continuation/layout decision, not permission to shrink the glyphs.
      for (const item of affichage) {
        if (item.numerique > item.natural - 2) {
          throw new CahierPdfTableLayoutError(
            `La valeur de la colonne « ${item.column.label} » ne tient pas dans la largeur mesurée du tableau ; aucun nombre n’est réduit.`,
          )
        }
      }
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
    // Natural width, not `largeurDisponible`: a narrow value table is as wide
    // as its measured content needs and is centred against the figure it
    // belongs to by the composer. Wide tables already carry their full width
    // in `item.natural` (the split/fit passes above never shrink below the
    // served content), so nothing here stretches or truncates any column.
    const politiqueSeparateur = table.columnSeparators
    const colonnes: ColonneTableauPdf[] = groupe.map((item, index) => {
      const width = item.natural
      const separatorBefore = politiqueSeparateur === 'legend-key'
        ? index > 0
        : politiqueSeparateur === 'group'
          ? index > 0 && groupe[index - 1]!.groupe !== item.groupe
          : false
      if (item.role === 'rang') {
        const headerLines = [item.column.label]
        return {
          key: item.column.key,
          column: item.column,
          role: 'rang',
          groupe: item.groupe,
          separatorBefore,
          width,
          headerLines,
          headerHeight: mesure.hauteurLigne(
            roleEntete.police,
            roleEntete.taille,
          ) * ESPACE_TABLEAU.interligneEntete + ESPACE_TABLEAU.remplissageEnteteMm,
        }
      }
      const headerLines = mesurerEntete(item.column, width, mesure, nomTerritoire, roleEntete)
      return {
        key: item.column.key,
        column: item.column,
        role: 'valeur',
        groupe: item.groupe,
        separatorBefore,
        width,
        headerLines,
        headerHeight: headerLines.length * (
          mesure.hauteurLigne(roleEntete.police, roleEntete.taille) * ESPACE_TABLEAU.interligneEntete
        ) + ESPACE_TABLEAU.remplissageEnteteMm,
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
        height: hauteurCellule * hauteurLigneTexte * ESPACE_TABLEAU.interligneLigne
          + ESPACE_TABLEAU.remplissageLigneMm,
      }
    })
    const hauteurLigneMode = mesure.hauteurLigne(
      ROLE_PDF.enteteTableauMode.police,
      ROLE_PDF.enteteTableauMode.taille,
    ) * ESPACE_TABLEAU.interligneEntete
    const groups: GroupeEnteteTableauPdf[] = []
    for (const colonne of colonnes) {
      const dernier = groups[groups.length - 1]
      if (dernier && dernier.key === colonne.groupe) {
        groups[groups.length - 1] = { ...dernier, width: dernier.width + colonne.width }
      } else {
        const libelle = libelleGroupe.get(colonne.groupe)
        groups.push({
          key: colonne.groupe,
          label: libelle?.label ?? '',
          color: libelle?.color ? couleurPdf(libelle.color) : null,
          width: colonne.width,
          labelLines: [],
        })
      }
    }
    // The group header is measured with the embedded face and wrapped to its
    // own colSpan width, like the native `th` (no unmeasured overflow). A flat
    // table has no legend-key row: its band is exactly zero, never an empty
    // mode line folded into `headerHeight`.
    let groupeHeaderHeight = 0
    if (grouped) {
      for (let index = 0; index < groups.length; index += 1) {
        const groupe = groups[index]!
        const labelLines = plierTexte(groupe.label, mesure, {
          police: ROLE_PDF.enteteTableauMode.police,
          taillePt: ROLE_PDF.enteteTableauMode.taille,
          largeurMax: Math.max(3, groupe.width - 2),
          casserMotsLongs: true,
        }).map((ligne) => ligne.texte)
        groups[index] = { ...groupe, labelLines }
        groupeHeaderHeight = Math.max(groupeHeaderHeight, labelLines.length * hauteurLigneMode)
      }
      groupeHeaderHeight += 1.6
    }
    const headerHeight = groupeHeaderHeight
      + Math.max(...colonnes.map((colonne) => colonne.headerHeight), 4)
    const hasComparison = comparatifProuve && options.ownerDisplayed !== false
    const largeurTableau = colonnes.reduce((sum, colonne) => sum + colonne.width, largeurLibelle)
    // The caption wraps to the table's own width, not the whole body, so a
    // narrow table keeps a short caption centred over its content.
    const titleLines = [
      ...plierTexte(table.title, mesure, {
        police: ROLE_PDF.titreTableau.police,
        taillePt: ROLE_PDF.titreTableau.taille,
        largeurMax: Math.max(largeurTableau, 24),
      }).map((ligne) => ligne.texte),
      ...(table.subtitle
        ? plierTexte(table.subtitle, mesure, {
          police: ROLE_PDF.titreTableau.police,
          taillePt: ROLE_PDF.titreTableau.taille,
          largeurMax: Math.max(largeurTableau, 24),
        }).map((ligne) => ligne.texte)
        : []),
    ]
    parts.push({
      key: `${table.key}${groupIndex ? `:colonnes-${groupIndex + 1}` : ''}`,
      sourceKey: table.key,
      title: table.title,
      titleLines,
      layout: grouped ? 'grouped' : 'flat',
      rowHeader: table.rowHeader ?? null,
      groups: grouped ? groups : [],
      columns: colonnes,
      rows,
      width: largeurTableau,
      naturalWidth,
      colgroupFixe,
      rowLabelWidth: largeurLibelle,
      groupHeaderHeight: groupeHeaderHeight,
      headerHeight,
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

/** Vertical rule policy is a declared shape fact, never inferred from a key. */
export function separateurVertical(
  columns: readonly ColonneTableauPdf[],
  index: number,
): boolean {
  if (index <= 0) return false
  return columns[index]!.separatorBefore
}

/**
 * One owned caption/header height, shared by the composer's pagination and the
 * painter. `suite` is the painter's `(suite)` line box on a continuation.
 */
export function hauteurEnteteTableau(
  part: TableauPdfPart,
  mesure: MesureTexte,
  continued: boolean,
): number {
  const hauteurTitre = part.titleLines.length
    * mesure.hauteurLigne(ROLE_PDF.titreTableau.police, ROLE_PDF.titreTableau.taille)
    * ESPACE_TABLEAU.interligneTitre
  return hauteurTitre + part.headerHeight + ESPACE_TABLEAU.apresTitreMm
    + (continued ? ESPACE_TABLEAU.suiteMm : 0)
}

export const COULEURS_TABLEAU_PDF = {
  ink: PALETTE_PDF.ink,
  muted: PALETTE_PDF.muted,
  rule: PALETTE_PDF.borderLight,
  groupRule: PALETTE_PDF.muted,
} as const
