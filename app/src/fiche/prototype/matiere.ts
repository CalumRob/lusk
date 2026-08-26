/**
 * [PROTOTYPE #499 — JETABLE] La matière d'un onglet de fiche pour les trois
 * variantes de lecture (?variant=A|B|C).
 *
 * Ce module est du code de DÉCISION, pas du code de production : il résout
 * UNE FOIS, au-dessus du commutateur de variantes, tout ce que les trois
 * anatomies rendent (sous-groupes, lectures, valeurs importantes, rangs,
 * passarelles « Explorer », preuves/vintages) depuis les mêmes sélecteurs que
 * la fiche réelle (sousGroupesPourTerritoire & co). Les variantes ne font que
 * mettre en page — aucun fetch, aucun état propre.
 *
 * Les duplications locales assumées (unités des paramètres de lecture,
 * SOURCES_PAR_STORY) sont volontaires : le module disparaît avec le verdict
 * produit, une abstraction partagée serait prématurée (consigne #499 : ne
 * pas sur-abstraire un jetable).
 */

import type { RouteLocationRaw } from 'vue-router'
import type {
  FamilleFigure,
  Indicateur,
  NoeudTexteRiche,
  Payload,
  Theme,
  ThemeMetadata,
} from '@/payload/types'
import {
  descriptionNuage,
  detailsRangEnContexte,
  estampilleSnapshot,
  formaterDateFrancaise,
  formaterLicence,
  formaterNombreFR,
  formaterValeur,
  formaterVintage,
  trouverTerritoire,
} from '@/payload/selectors'
import type { DescriptionNuage } from '@/payload/selectors'
import {
  figureLecturePour,
  lignesLQPour,
  sourceLecture,
  sousGroupesPourTerritoire,
} from '@/fiche/sousGroupes'
import type { FigureLecture, LigneLQ } from '@/fiche/sousGroupes'
import { handoffExploration, passarellesLecture } from '@/fiche/explorationHandoff'
import type { PassarelleLecture } from '@/fiche/explorationHandoff'
import {
  accentPositionRang,
  directionIndicateur,
  puceRangDirection,
} from '@/fiche/figureGrammaire'
import type { PuceRangDirection } from '@/fiche/figureGrammaire'

/** La puce de rang enrichie de l'accent de position (#371) — prête à rendre. */
export interface RangMatiere extends PuceRangDirection {
  accent: 'fort' | 'faible' | null
}

/** Une ligne de détail d'un indicateur multi-détails (reseaux, voitures…). */
export interface TrancheMatiere {
  libelle: string
  texte: string
  unite: string
  /** Le rang PROPRE à cette ligne — jamais celui de la première ligne (#451 F3). */
  rang: RangMatiere | null
}

/** Un indicateur de sous-groupe résolu pour mise en page. */
export interface ValeurIndicateur {
  clef: string
  libelle: string
  famille: FamilleFigure | null
  /** L'id vintage cité par la métadonnée pour cette clé (le marqueur de preuve). */
  sourceId: string | null
  valeurTexte: string | null
  signePlus: boolean
  unite: string
  multi: boolean
  tranches: TrancheMatiere[]
  rang: RangMatiere | null
  rider: string | null
  /** L'estampille vintage complète (formaterVintage) — preuve locale généreuse. */
  vintageComplet: string | null
  /** La source COURTE (« INSEE · 2023 ») — micro-estampille compacte. */
  sourceCourte: string | null
  /** La route Explorer vers la Page d'indicateur publiée — null si aucune. */
  passarelle: RouteLocationRaw | null
}

/** Un nombre important de la lecture — prêt pour hiérarchie typographique. */
export interface ValeurCleLecture {
  clef: string
  texte: string
  libelle: string
  unite: string | null
}

/** La lecture résolue d'un sous-groupe, matière des trois variantes. */
export interface LectureMatiere {
  storyKey: string
  /** Les ids vintages cités exhaustivement par CETTE lecture (marqueurs). */
  sourceIds: readonly string[]
  /** Le gabarit de la métadonnée, rendu par NoeudLecture. */
  template: NoeudTexteRiche[]
  /** Les paramètres résolus du gabarit (les chaînes affichées). */
  parametres: Record<string, string>
  figure: FigureLecture | null
  lignesLQ: LigneLQ[]
  sourceComplete: string | null
  sourceCourte: string | null
  passarelles: PassarelleLecture[]
  valeursCles: ValeurCleLecture[]
}

/** Un sous-groupe résolu — le grain de propriété des trois anatomies. */
export interface SousGroupeMatiere {
  key: string
  label: string
  framing: string
  lecture: LectureMatiere | null
  lectureIndisponible: boolean
  /** La figure compacte déclarée par la métadonnée (la matière du groupe). */
  valeurPrincipale: ValeurIndicateur | null
  /** Les autres indicateurs du groupe, ordre de la métadonnée. */
  valeurs: ValeurIndicateur[]
}

/** Une entrée du registre consolidé des preuves (bas de fiche). */
export interface PreuveRegistre {
  id: string
  dataset: string
  editeur: string | null
  licence: string | null
  fraicheur: string | null
  usages: number
}

/** Toute la matière d'un onglet — consommée par VarianteJournal/Cahier/Fil. */
export interface MatiereTheme {
  theme: Theme
  nomTheme: string
  nomTerritoire: string
  groupes: SousGroupeMatiere[]
  preuves: PreuveRegistre[]
  estampille: string | null
  nuage: DescriptionNuage | null
}

/**
 * Les unités d'affichage des paramètres de lecture — locale et jetable : la
 * production les porte ailleurs (audit #449 P1 : des lectures sans unité).
 */
const UNITES_PARAMETRES: Readonly<Record<string, string>> = {
  div_loss_t: 'types de services',
  div_loss_b: 'types de services',
  tot_loss_t: 'accès perdus',
  tot_loss_b: 'accès perdus',
  pct_iso_full_t: '%',
  part_passoires: '%',
  part_abc: '%',
  part_parc: '%',
  taux_solde_naturel: '‰/an',
  taux_solde_migratoire: '‰/an',
  taux_variation_population: '‰/an',
  trajectoire_artif_par_habitant: 'M3/M2 par hab.',
  n_dpe: 'DPE',
  lq: 'LQ',
  n: 'établissements',
}

/** Les clés NON numériques (mots de prose, fenêtres) — jamais des héros. */
const PARAMETRES_HORS_NOMBRE: ReadonlySet<string> = new Set([
  'classification',
  'classification_saillance',
  'rang',
  'activity_label',
  'activity_code',
])

/** Les fractions publiées en [0,1] lues en % — copie locale jetable. */
const CLEFS_POURCENT: ReadonlySet<string> = new Set([
  'part_passoires',
  'part_abc',
  'part_parc',
  'pct_iso_full_t',
])

const ALIAS_TOP_N: readonly string[] = ['activity_label', 'lq', 'n', 'part_parc']

/** Le nom court d'un jeu de données (« INSEE », « Korrigo »…) pour micro-stamps. */
function nomCourtJeu(record: {
  dataset: string
  publisher?: string
}): string {
  const premier = record.dataset.split(/[—(–]/)[0].trim()
  return premier || record.publisher || record.dataset
}

/** Le nom court d'un id de source via source_records puis vintages. */
function nomCourtSource(
  payload: Payload,
  metadata: ThemeMetadata | undefined,
  idSource: string | undefined,
): { court: string; version: string | null } | null {
  if (!idSource) return null
  const record = metadata?.source_records?.[idSource]
  const vintage = payload.vintages?.find((v) => v.id === idSource)
  const court = record ? nomCourtJeu(record) : vintage ? nomCourtJeu({ dataset: vintage.source }) : null
  if (!court) return null
  const version = record?.vintage ?? vintage?.version ?? null
  return { court, version }
}

function sourceCourteDe(
  payload: Payload,
  metadata: ThemeMetadata | undefined,
  clef: string,
): string | null {
  const resolu = nomCourtSource(payload, metadata, metadata?.sources[clef])
  if (!resolu) return null
  return resolu.version ? `${resolu.court} · ${resolu.version}` : resolu.court
}

/** Le rang directionnel complet d'une ligne d'indicateur (puce + accent). */
function rangMatiere(theme: Theme, ligne: Indicateur): RangMatiere | null {
  const details = detailsRangEnContexte(ligne)
  const direction = directionIndicateur(theme, ligne.key)
  if (!details || !direction) return null
  const puce = puceRangDirection(details.libelle, direction)
  return { ...puce, accent: accentPositionRang(details.rang, details.taille) }
}

function rangTranche(theme: Theme, ligne: Indicateur): RangMatiere | null {
  const details = detailsRangEnContexte(ligne)
  const direction = directionIndicateur(theme, ligne.key)
  if (!details || !direction) return null
  return { ...puceRangDirection(details.libelle, direction), accent: accentPositionRang(details.rang, details.taille) }
}

/** Un indicateur du groupe résolu (valeur, tranches, rang, preuves, Explorer). */
function valeurIndicateur(
  payload: Payload,
  metadata: ThemeMetadata,
  theme: Theme,
  clef: string,
  lignes: Indicateur[],
  refTerritoire: ReturnType<typeof trouverTerritoire>,
): ValeurIndicateur {
  const premiere = lignes[0] ?? null
  const brut = premiere ? formaterValeur(premiere) : null
  const signePlus =
    clef === 'evolution_1968' && premiere !== null && (premiere.value ?? 0) > 0

  const tranches: TrancheMatiere[] = lignes.map((ligne) => {
    // La dimension sexe (#390) distingue deux lignes de même détail — le
    // libellé la porte, jamais un doublon ambigu.
    const sexe = ligne.sex ? ` — ${ligne.sex === 'F' ? 'femmes' : 'hommes'}` : ''
    return {
      libelle: (metadata.detail_labels[clef]?.[ligne.detail ?? ''] ?? '') + sexe,
      texte: formaterValeur(ligne) ?? '—',
      unite: ligne.unit,
      rang: rangTranche(theme, ligne),
    }
  })

  return {
    clef,
    libelle: metadata.indicator_labels[clef] ?? clef,
    famille: null,
    sourceId: metadata.sources[clef] ?? null,
    valeurTexte: brut === null ? null : signePlus ? `+${brut}` : brut,
    signePlus,
    unite: premiere?.unit ?? '',
    multi: lignes.length > 1,
    tranches,
    rang: premiere ? rangMatiere(theme, premiere) : null,
    rider: premiere?.rider ?? null,
    vintageComplet: premiere ? formaterVintage(premiere) : null,
    sourceCourte: sourceCourteDe(payload, metadata, clef),
    passarelle: handoffExploration(metadata, clef, refTerritoire),
  }
}

/**
 * Les nombres importants de la lecture : TOUS les paramètres déclarés qui
 * résolvent en nombre sur la ligne (les fenêtres/classifications, chaînes,
 * restent de la prose). La résolution mire la règle du contrat (fractions %
 * en [0,1], alias top-N repliés d'Économie).
 */
function valeursClesLecture(
  metadata: ThemeMetadata,
  lecture: { paramsDeclares: readonly string[]; histoire: Record<string, unknown> },
): ValeurCleLecture[] {
  const resultats: ValeurCleLecture[] = []
  for (const clef of lecture.paramsDeclares) {
    if (PARAMETRES_HORS_NOMBRE.has(clef)) continue
    let brut: unknown = lecture.histoire[clef]
    if (brut === undefined && (clef === 'rang' || ALIAS_TOP_N.includes(clef))) {
      // Alias repliés du top-N Économie : premier rang présent.
      for (let k = 1; k <= 5; k += 1) {
        const code = lecture.histoire[`top${k}_activity_code`]
        if (code === null || code === undefined) continue
        brut = lecture.histoire[`top${k}_${clef}`]
        break
      }
    }
    if (typeof brut !== 'number') continue
    const texte = CLEFS_POURCENT.has(clef)
      ? formaterNombreFR(brut * 100, 1)
      : formaterNombreFR(brut, 2)
    resultats.push({
      clef,
      texte,
      libelle: metadata.param_labels[clef] ?? clef,
      unite: UNITES_PARAMETRES[clef] ?? null,
    })
  }
  return resultats
}

/**
 * Les ids vintages cités EXHAUSTIVEMENT par chaque lecture — copie locale
 * jetable de SOURCES_PAR_STORY (sousGroupes.ts) ; le module disparaît avec
 * le verdict.
 */
const SOURCES_PAR_STORY_LOCAL: Record<string, readonly string[]> = {
  'trajectoire-demographique': ['serie_historique', 'epci'],
  'se-densifier-setaler-ou-sen-aller': [
    'serie_historique',
    'ocsge_artificialisation_22_2021',
    'ocsge_artificialisation_22_2025',
    'ocsge_artificialisation_29_2021',
    'ocsge_artificialisation_29_2024',
    'ocsge_artificialisation_35_2020',
    'ocsge_artificialisation_35_2023',
    'ocsge_artificialisation_56_2022',
    'ocsge_artificialisation_56_2024',
  ],
}

/** Le registre consolidé des preuves du thème — dédupliqué, compté. */
function registrePreuves(
  payload: Payload,
  metadata: ThemeMetadata,
  groupes: SousGroupeMatiere[],
): PreuveRegistre[] {
  const usages = new Map<string, number>()

  function citer(id: string | undefined): void {
    if (!id) return
    usages.set(id, (usages.get(id) ?? 0) + 1)
  }

  for (const groupe of groupes) {
    for (const valeur of [groupe.valeurPrincipale, ...groupe.valeurs]) {
      if (valeur === null) continue
      citer(metadata.sources[valeur.clef])
    }
    if (groupe.lecture) {
      // Les lectures à citations exhaustives (Démographie, Milieux) ; les
      // autres citent la source propre de leurs indicateurs, déjà comptée.
      for (const id of SOURCES_PAR_STORY_LOCAL[groupe.lecture.storyKey] ?? []) citer(id)
    }
  }

  const entrees: PreuveRegistre[] = []
  for (const [id, nombre] of usages) {
    const record = metadata.source_records?.[id]
    const vintage = payload.vintages?.find((v) => v.id === id)
    if (record) {
      entrees.push({
        id,
        dataset: record.dataset,
        editeur: record.publisher,
        licence: record.licence,
        fraicheur: record.freshness ?? null,
        usages: nombre,
      })
      continue
    }
    if (vintage) {
      const fraicheurParts = [
        vintage.date_reference ? `réf. ${formaterDateFrancaise(vintage.date_reference)}` : null,
        vintage.date_publication ? `publ. ${formaterDateFrancaise(vintage.date_publication)}` : null,
      ].filter((p): p is string => p !== null)
      entrees.push({
        id,
        dataset: `${vintage.source} · ${vintage.version}`,
        editeur: null,
        licence: formaterLicence(vintage.licence),
        fraicheur: fraicheurParts.join(' · ') || null,
        usages: nombre,
      })
    }
  }
  return entrees
}

/**
 * LA matière d'un onglet — un seul appel au-dessus du commutateur ; les
 * variantes reçoivent le résultat et ne calculent plus rien.
 */
export function matiereTheme(
  payload: Payload,
  theme: Theme,
  territoire: string,
): MatiereTheme {
  const metadata = payload.themeMetadata?.[theme]
  const ref = trouverTerritoire(payload, territoire)

  if (!metadata || !ref) {
    return {
      theme,
      nomTheme: theme,
      nomTerritoire: territoire,
      groupes: [],
      preuves: [],
      estampille: null,
      nuage: null,
    }
  }

  const rendus = sousGroupesPourTerritoire(payload, theme, territoire)

  const groupes: SousGroupeMatiere[] = rendus.map((groupe) => {
    let valeurPrincipale: ValeurIndicateur | null = null
    if (groupe.figureCompacte) {
      valeurPrincipale = valeurIndicateur(
        payload,
        metadata,
        theme,
        groupe.figureCompacte.clef,
        groupe.figureCompacte.lignes,
        ref,
      )
      valeurPrincipale.famille = groupe.figureCompacte.famille
    }

    const autres = groupe.figures
      .filter((figure) => figure.key !== groupe.figureCompacte?.clef)
      .map((figure) =>
        valeurIndicateur(payload, metadata, theme, figure.key, figure.lignes, ref),
      )

    let lecture: LectureMatiere | null = null
    if (groupe.lecture) {
      const sourceComplete = sourceLecture(payload, groupe.lecture)
      // Les paramètres DÉCLARÉS de la déclaration du sous-groupe (l'ordre de
      // la métadonnée pilote la hiérarchie des nombres importants).
      const declares =
        metadata.subgroups.find((sg) => sg.key === groupe.key)?.reading?.params ?? []
      lecture = {
        storyKey: groupe.lecture.story_key,
        sourceIds: SOURCES_PAR_STORY_LOCAL[groupe.lecture.story_key] ?? [],
        template: groupe.lecture.template,
        parametres: groupe.lecture.parametres,
        figure: figureLecturePour(payload, territoire, groupe.lecture),
        lignesLQ: lignesLQPour(groupe.lecture),
        sourceComplete,
        sourceCourte:
          sourceComplete !== null
            ? (sourceComplete.split(' · ')[0] ?? null)
            : null,
        passarelles: passarellesLecture(metadata, groupe.lecture.story_key, ref),
        valeursCles: valeursClesLecture(metadata, {
          paramsDeclares: declares,
          histoire: groupe.lecture.histoire as unknown as Record<string, unknown>,
        }),
      }
    }

    return {
      key: groupe.key,
      label: groupe.label,
      framing: groupe.framing,
      lecture,
      lectureIndisponible: groupe.lectureIndisponible,
      valeurPrincipale,
      valeurs: autres,
    }
  })

  return {
    theme,
    nomTheme: metadata.label,
    nomTerritoire: ref.nom,
    groupes,
    preuves: registrePreuves(payload, metadata, groupes),
    estampille: estampilleSnapshot(payload),
    nuage: descriptionNuage(payload, territoire),
  }
}
