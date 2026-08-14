import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  LIBELLES_DIRECTION,
  THEMES_CONSTRUITS,
  THEMES_METHODES,
  ancreIndicateur,
  indicateursParDataset,
} from '../methodes/indicateurs'
import { SOURCES_METHODES, datasetDeSource } from '../methodes/sources'
import type { DirectionRang, ThemeConstruit } from '../methodes/indicateurs'

/**
 * Le registre Méthodes des indicateurs & Stories (issue #129, docs/themes/
 * README.md §The Méthodes contract). La parité avec la payload : chaque clé
 * d'indicateur des thèmes construits (public/data/indicateurs_<theme>.json)
 * doit avoir une définition de registre, avec son unité et sa source en
 * ground truth ; chaque Story construite (public/data/histoires_<theme>.json)
 * doit être documentée. Le registre expose le mapping thème → documentation
 * dans la forme que le futur test de contrat de parité pourra asserter.
 */

const dataDir = join(process.cwd(), '..', 'public', 'data')

/**
 * Les payloads commis sont lus en balayage de lignes, jamais JSON.parse :
 * l'économie pèse 82 Mo (160 k lignes) — matérialiser les tableaux entiers
 * alourdirait la suite partagée. Un balayage par expression régulière ne
 * retient que les faits de parité (thème, clé, unité ; story_key,
 * classification), rien d'autre. L'ordre des champs est le schéma commis
 * (docs/architecture.md §The fiche payload) — un champ est toujours suivi de
 * son unité dans le même objet.
 */
const BALAYAGE_INDICATEURS =
  /"theme": "([a-z]+)",\s*"key": "([^"]+)",[\s\S]*?"unit": "([^"]*)"/g

const BALAYAGE_HISTOIRES =
  /"theme": "([a-z]+)",\s*"groupe": "[^"]+",\s*"story_key": "([^"]+)",[\s\S]*?"classification": ([^,\s]+)/g

interface FaitsIndicateurs {
  parTheme: Record<ThemeConstruit, Record<string, string>>
  parStory: Record<ThemeConstruit, Record<string, string[]>>
  storyKeys: Record<ThemeConstruit, Set<string>>
}

/** Balaye un payload commis et n'en extrait que les faits de parité. */
function lireFaits(nomFichier: string, balayage: RegExp): { theme: string; clef: string; valeur: string | null }[] {
  const brut = readFileSync(join(dataDir, nomFichier), 'utf-8')
  const faits: { theme: string; clef: string; valeur: string | null }[] = []
  for (const correspondance of brut.matchAll(balayage)) {
    const valeur = correspondance[3] === 'null' ? null : correspondance[3].replace(/"/g, '')
    faits.push({ theme: correspondance[1], clef: correspondance[2], valeur })
  }
  return faits
}

/** Les faits de parité des huit fichiers commis, extraits une seule fois à l'échelle du module. */
const FAITS: FaitsIndicateurs = {
  parTheme: { demographie: {}, habitat: {}, economie: {}, mobilite: {}, milieux: {} },
  parStory: { demographie: {}, habitat: {}, economie: {}, mobilite: {}, milieux: {} },
  storyKeys: {
    demographie: new Set(),
    habitat: new Set(),
    economie: new Set(),
    mobilite: new Set(),
    milieux: new Set(),
  },
}

for (const theme of THEMES_CONSTRUITS) {
  for (const fait of lireFaits(`indicateurs_${theme}.json`, BALAYAGE_INDICATEURS)) {
    FAITS.parTheme[theme as ThemeConstruit][fait.clef] = fait.valeur ?? ''
  }
  for (const fait of lireFaits(`histoires_${theme}.json`, BALAYAGE_HISTOIRES)) {
    const construit = theme as ThemeConstruit
    FAITS.storyKeys[construit].add(fait.clef)
    if (fait.valeur === null) continue
    if (!FAITS.parStory[construit][fait.clef]) FAITS.parStory[construit][fait.clef] = []
    if (!FAITS.parStory[construit][fait.clef].includes(fait.valeur)) {
      FAITS.parStory[construit][fait.clef].push(fait.valeur)
    }
  }
}

/** Les clés distinctes d'indicateurs de la payload, avec leur unité (ground truth). */
function clefsEtUnitesCommites(theme: ThemeConstruit): Record<string, string> {
  return FAITS.parTheme[theme]
}

function clefsHistoiresCommites(theme: ThemeConstruit): Set<string> {
  return FAITS.storyKeys[theme]
}

/** Les classifications publiées (non nulles) de chaque Story — les lectures à documenter. */
function classificationsParStory(theme: ThemeConstruit): Record<string, string[]> {
  return FAITS.parStory[theme]
}

describe('registre Méthodes — la forme exposée au contrat de parité', () => {
  it('couvre les thèmes construits, dans l\u2019ordre canonique', () => {
    expect(THEMES_CONSTRUITS).toEqual(['demographie', 'habitat', 'economie', 'mobilite', 'milieux'])
    expect(Object.keys(THEMES_METHODES)).toEqual(THEMES_CONSTRUITS)
  })

  it('expose par thème un mapping { indicateurs, stories } asserable', () => {
    for (const theme of THEMES_CONSTRUITS) {
      const themeMethodes = THEMES_METHODES[theme]
      expect(themeMethodes, `thème « ${theme} » sans registre`).toBeDefined()
      expect(typeof themeMethodes.indicateurs).toBe('object')
      expect(Array.isArray(themeMethodes.stories)).toBe(true)
    }
  })

  it('chaque thème construit documente au moins une Story', () => {
    for (const theme of THEMES_CONSTRUITS) {
      expect(THEMES_METHODES[theme].stories.length, `« ${theme} » sans Story`).toBeGreaterThan(0)
    }
  })
})

describe('registre Méthodes — la parité avec les indicateurs de la payload', () => {
  it('couvre chaque clé d\u2019indicateur des thèmes construits', () => {
    for (const theme of THEMES_CONSTRUITS) {
      const clefs = clefsEtUnitesCommites(theme)
      expect(Object.keys(clefs).length, `« ${theme} » sans indicateurs commis`).toBeGreaterThan(0)
      for (const clef of Object.keys(clefs)) {
        expect(
          THEMES_METHODES[theme].indicateurs[clef],
          `clé « ${theme}.${clef} » sans définition de registre`,
        ).toBeDefined()
      }
    }
  })

  it('porte les unités ground truth de la payload, clé par clé', () => {
    for (const theme of THEMES_CONSTRUITS) {
      const clefs = clefsEtUnitesCommites(theme)
      for (const [clef, unite] of Object.entries(clefs)) {
        expect(THEMES_METHODES[theme].indicateurs[clef].unite, `unité « ${theme}.${clef} »`).toBe(
          unite,
        )
      }
    }
  })

  it('chaque indicateur porte label, définition et source (jamais vides)', () => {
    for (const theme of THEMES_CONSTRUITS) {
      for (const [clef, indicateur] of Object.entries(THEMES_METHODES[theme].indicateurs)) {
        expect(indicateur.label.length, `« ${theme}.${clef} » sans label`).toBeGreaterThan(0)
        expect(
          indicateur.definition.length,
          `« ${theme}.${clef} » sans définition`,
        ).toBeGreaterThan(20)
        expect(indicateur.source.length, `« ${theme}.${clef} » sans source`).toBeGreaterThan(0)
      }
    }
  })

  it('un sourceId résout toujours une entrée du registre des sources, au même nom', () => {
    for (const theme of THEMES_CONSTRUITS) {
      for (const [clef, indicateur] of Object.entries(THEMES_METHODES[theme].indicateurs)) {
        if (indicateur.sourceId === null) continue
        const source = SOURCES_METHODES[indicateur.sourceId]
        expect(source, `« ${theme}.${clef} » → sourceId « ${indicateur.sourceId} » introuvable`).toBeDefined()
        expect(indicateur.source, `« ${theme}.${clef} » → nom divergent`).toBe(source.nom)
      }
    }
  })
})

describe('registre Méthodes — la parité avec les Stories de la payload', () => {
  // Le balayage lit les lectures par la colonne « classification », que seule
  // la payload de la démographie et de l'habitat porte. La payload de
  // l'économie (forme reshapée, issue #131) n'a pas de classification : ses
  // story_keys sont assertés contre le modèle CONTEXT.md (test ci-dessous).
  const THEMES_STABLES: ThemeConstruit[] = ['demographie', 'habitat']

  it('couvre chaque story_key des thèmes à payload stable (démographie, habitat)', () => {
    for (const theme of THEMES_STABLES) {
      const clefs = clefsHistoiresCommites(theme)
      expect(clefs.size, `« ${theme} » sans histoires commises`).toBeGreaterThan(0)
      const clefsRegistre = new Set(THEMES_METHODES[theme].stories.map((s) => s.clef))
      for (const clef of clefs) {
        expect(clefsRegistre.has(clef), `story_key « ${theme}.${clef} » non documentée`).toBe(true)
      }
    }
  })

  it('l\u2019économie documente le modèle CONTEXT.md — Story unique, note en pause (la Story de la région retirée, #367)', () => {
    const clefs = new Set(THEMES_METHODES.economie.stories.map((s) => s.clef))
    expect(clefs).toEqual(
      new Set(['ce-que-la-commune-abrite', 'le-matin-la-commune-se-vide']),
    )

    // la Story unique est publiée ; la note en pause est documentée, jamais publiée
    const commune = THEMES_METHODES.economie.stories.find((s) => s.clef === 'ce-que-la-commune-abrite')
    const dortoir = THEMES_METHODES.economie.stories.find((s) => s.clef === 'le-matin-la-commune-se-vide')
    expect(commune?.statut).toBe('publiee')
    expect(dortoir?.statut).toBe('en-pause')

    // la Story de structure de la région « Ce que la Bretagne abrite » est
    // RETIRÉE du contrat de la fiche (#367 — la fiche de la région ne la
    // référence plus) : le registre ne la documente plus
    expect(THEMES_METHODES.economie.stories.find((s) => s.clef === 'ce-que-la-bretagne-abrite')).toBeUndefined()
    expect(commune?.definition).toMatch(/retirée|retiré/)
  })

  it('la mobilité documente le modèle CONTEXT.md — la Story par défaut et sa candidate saillante', () => {
    const clefs = new Set(THEMES_METHODES.mobilite.stories.map((s) => s.clef))
    expect(clefs).toEqual(
      new Set(['vingt-minutes-sans-voiture', 'ce-que-le-velo-preserve']),
    )

    // les deux Stories sont publiées — le flagship est la Story par défaut,
    // la candidate « Ce que le vélo préserve » se déclenche par la saillance
    for (const story of THEMES_METHODES.mobilite.stories) {
      expect(story.statut, `« mobilite.${story.clef} » non publiée`).toBe('publiee')
    }
  })

  it('documente l\u2019horloge lente comme fait de première classe (ADR-0012)', () => {
    const horloge = THEMES_METHODES.mobilite.horlogeLente
    expect(horloge, '« mobilite » sans horloge lente documentée').toBeDefined()

    // ce que le flagship consomme, en une phrase — jamais vide
    expect(horloge!.consommation.length).toBeGreaterThan(20)

    // chaque entrée : ce qui bouge, à quelle fréquence, la référence figée
    expect(horloge!.entrees.length).toBeGreaterThan(0)
    for (const entree of horloge!.entrees) {
      expect(entree.donnee.length, 'entrée sans donnée').toBeGreaterThan(0)
      expect(entree.frequence.length, 'entrée sans fréquence').toBeGreaterThan(0)
      expect(entree.reference.length, 'entrée sans référence').toBeGreaterThan(0)
    }

    // le déclencheur de rebuild — quand le thème se recalcule
    expect(horloge!.declencheur.length).toBeGreaterThan(20)
  })

  it('le milieux documente le modèle CONTEXT.md — Story unique, les quatre lectures, les trois horloges', () => {
    // la Story unique « Se densifier, s'étaler, ou s'en aller » (ADR-0014,
    // pivotée ADR-0017) — un thème à Story unique comme l'Économie
    const clefs = new Set(THEMES_METHODES.milieux.stories.map((s) => s.clef))
    expect(clefs).toEqual(new Set(['se-densifier-setaler-ou-sen-aller']))
    const story = THEMES_METHODES.milieux.stories[0]
    expect(story.statut, '« milieux » Story non publiée').toBe('publiee')

    // les QUATRE lectures par signes (seuil 0) — exactement, ni plus ni moins
    const lectures = new Set(story.lectures.map((l) => l.clef))
    expect(lectures).toEqual(
      new Set([
        'grandir-en-se-densifiant',
        'grandir-en-setalant',
        'sen-aller-et-consommer-quand-meme',
        'les-departs-laissent-la-place-a-la-renaturation',
      ]),
    )

    // la lecture renaturation porte SON rider de précision — la renaturation
    // est MESURÉE (l'état final inférieur à l'état initial, ADR-0017) — jamais
    // le « potentielle, jamais mesurée » du pivot flux (US 17)
    const renaturation = story.lectures.find(
      (l) => l.clef === 'les-departs-laissent-la-place-a-la-renaturation',
    )
    expect(renaturation?.lecture).toMatch(/mesurée/)
    expect(renaturation?.lecture).not.toMatch(/potentielle, jamais mesurée/)

    // les trois horloges documentées comme fait de première classe (la
    // promesse de transparence étendue par ADR-0017 — la population, l'état
    // OCS-GE, le flux annuel)
    const horloges = THEMES_METHODES.milieux.deuxHorloges
    expect(horloges, '« milieux » sans les horloges documentées').toBeDefined()
    expect(horloges!.consommation.length).toBeGreaterThan(20)
    expect(horloges!.entrees.length).toBe(3)  // les trois horloges, jamais confondues
    for (const entree of horloges!.entrees) {
      expect(entree.donnee.length, 'entrée sans donnée').toBeGreaterThan(0)
      expect(entree.frequence.length, 'entrée sans fréquence').toBeGreaterThan(0)
      expect(entree.reference.length, 'entrée sans référence').toBeGreaterThan(0)
    }
    expect(horloges!.declencheur.length).toBeGreaterThan(20)
  })

  it('le milieux documente la règle de source de la population et la note de recherche', () => {
    const story = THEMES_METHODES.milieux.stories[0]

    // la règle de source d'ADR-0014 : la population vient de la série
    // historique, jamais des champs embarqués de CONSOENAF
    expect(story.definition).toMatch(/série historique/)
    // la note de recherche qui a fondé le bloc est référencée par son chemin
    expect(story.definition).toContain('docs/research/zan-rennes.md')
  })

  it('la mobilité documente « L\u2019offre cyclable » — la figure du sous-bloc (issue #233, ADR-0016)', () => {
    const figure = THEMES_METHODES.mobilite.indicateurs.offre_cyclable
    expect(figure, '« mobilite.offre_cyclable » non documentée').toBeDefined()
    expect(figure!.label).toBe('L\u2019offre cyclable')
    expect(figure!.unite).toBe('km')
    expect(figure!.definition.length).toBeGreaterThan(100)

    // la source Geovelo citée (le jeu « Aménagements cyclables », ODbL)
    expect(figure!.source).toMatch(/Geovelo/)
    expect(figure!.definition).toMatch(/Aménagements cyclables/)
    expect(figure!.definition).toMatch(/ODbL/)

    // la règle de longueur PAR DIRECTION (ADR-0016) — jamais un détail absent
    expect(figure!.definition).toMatch(/direction/)

    // l'attribution par le CÔTÉ PORTEUR de l'aménagement (ADR-0016)
    expect(figure!.definition).toMatch(/porteur/)

    // la définition du réseau = l'enum complet des aménagements (ame_d/g)
    expect(figure!.definition).toMatch(/PISTE CYCLABLE/)
    expect(figure!.definition).toMatch(/VOIE VERTE/)
    expect(figure!.definition).toMatch(/VELO RUE/)

    // le caveat de couverture OSM hétérogène en rural breton — lié, jamais
    // dissimulé (la promesse de transparence, docs/research/openstreetmap.md
    // §1.6 — le même modèle de référence que la note zan-rennes du Milieux)
    expect(figure!.definition).toContain('docs/research/openstreetmap.md')
    expect(figure!.definition).toMatch(/couverture|hétérogène|hétérogene/i)

    // la source de référence du ratio (l'horloge lente) nommée dans la figure
    expect(figure!.definition).toMatch(/OpenStreetMap/)
  })

  it('la mobilité documente les DEUX horloges du ratio — le gap est un fait de première classe (issue #233)', () => {
    const horloges = THEMES_METHODES.mobilite.deuxHorloges
    expect(horloges, '« mobilite » sans les deux horloges du ratio documentées').toBeDefined()

    // ce que les deux horloges sont, en une phrase — jamais vide
    expect(horloges!.consommation.length).toBeGreaterThan(20)

    // les deux horloges nommées, jamais confondues : Geovelo frais (le
    // numérateur) vs l'extrait OSM lent (le dénominateur — la référence)
    expect(horloges!.entrees.length).toBe(2)
    for (const entree of horloges!.entrees) {
      expect(entree.donnee.length, 'entrée sans donnée').toBeGreaterThan(0)
      expect(entree.frequence.length, 'entrée sans fréquence').toBeGreaterThan(0)
      expect(entree.reference.length, 'entrée sans référence').toBeGreaterThan(0)
    }
    expect(horloges!.declencheur.length).toBeGreaterThan(20)
    // le gap est un fait assumé : le ratio est limité par SA plus lente horloge,
    // la source de référence est l'extrait OSM — jamais le vintage Geovelo frais
    expect(horloges!.consommation).toMatch(/OSM|OpenStreetMap/)
    expect(horloges!.consommation).toMatch(/Geovelo/)
  })

  it('le milieux documente l\u2019anomalie d\u2019unité m²/ha dans la définition de la série annuelle', () => {
    const fenetre = THEMES_METHODES.milieux.indicateurs.conso_enaf_annuel
    expect(fenetre.unite, '« milieux.conso_enaf_annuel » en hectares').toBe('ha')

    // l'anomalie documentée, jamais silencieusement ignorée : le dictionnaire
    // Cerema dit hectares, le fichier distribue des m² — la conversion est
    // explicite (÷ 10 000) et testée (la source CONSOENAF de la série annuelle)
    expect(fenetre.definition).toMatch(/mètres carrés|m²/)
    expect(fenetre.definition).toMatch(/10 000|÷/)
  })

  it('documente chaque lecture publiée (classification non nulle) des thèmes stables', () => {
    for (const theme of THEMES_STABLES) {
      const parStory = classificationsParStory(theme)
      for (const story of THEMES_METHODES[theme].stories) {
        const classifications = parStory[story.clef] ?? []
        const lectures = new Set(story.lectures.map((l) => l.clef))
        for (const classification of classifications) {
          expect(
            lectures.has(classification),
            `« ${theme}.${story.clef} » → lecture « ${classification} » non documentée`,
          ).toBe(true)
        }
      }
    }
  })

  it('chaque Story porte titre, définition, état et des lectures nommées', () => {
    for (const theme of THEMES_CONSTRUITS) {
      for (const story of THEMES_METHODES[theme].stories) {
        expect(story.titre.length, `« ${theme}.${story.clef} » sans titre`).toBeGreaterThan(0)
        expect(
          story.definition.length,
          `« ${theme}.${story.clef} » sans définition`,
        ).toBeGreaterThan(20)
        expect(['publiee', 'en-pause'], `« ${theme}.${story.clef} » sans état`).toContain(
          story.statut,
        )
        for (const lecture of story.lectures) {
          expect(lecture.nom.length, `« ${theme}.${story.clef} » lecture sans nom`).toBeGreaterThan(0)
          expect(
            lecture.lecture.length,
            `« ${theme}.${story.clef} » lecture sans texte`,
          ).toBeGreaterThan(10)
        }
      }
    }
  })
})

describe('registre Méthodes — le sens des classements (ADR-0015, #367)', () => {
  const DIRECTIONS: DirectionRang[] = ['plus-est-mieux', 'moins-est-mieux']

  it('chaque indicateur porte sa direction — jamais silencieuse', () => {
    for (const theme of THEMES_CONSTRUITS) {
      for (const [clef, indicateur] of Object.entries(THEMES_METHODES[theme].indicateurs)) {
        expect(DIRECTIONS, `« ${theme}.${clef} » sans direction`).toContain(indicateur.direction)
      }
    }
  })

  it('déclare « moins = mieux » les clés dont le rang se lit à l\u2019envers (le tableau #367, amendé CONTEXT.md 2026-08-12)', () => {
    const clefsMoins: string[] = []
    for (const theme of THEMES_CONSTRUITS) {
      for (const [clef, indicateur] of Object.entries(THEMES_METHODES[theme].indicateurs)) {
        if (indicateur.direction === 'moins-est-mieux') clefsMoins.push(`${theme}.${clef}`)
      }
    }
    // iso_* ×5, part_passoires, chomage, div_loss_t/b, prix_m2, age_du_bati,
    // artif_par_habitant, conso_enaf_annuel, trajectoire_artif_par_habitant —
    // plus places_stationnement_voiture_1000 (moins = mieux verrouillée par le
    // sourçage #369, CONTEXT.md 2026-08-12), distribution_dpe (le classement
    // lit la part F/G, la même valeur que part_passoires) et tot_loss_t/b (la
    // perte totale d'accès — moins d'accès perdus, c'est mieux)
    expect(clefsMoins.sort()).toEqual(
      [
        'economie.chomage',
        'habitat.age_du_bati',
        'habitat.distribution_dpe',
        'habitat.part_passoires',
        'habitat.prix_m2',
        'milieux.artif_par_habitant',
        'milieux.conso_enaf_annuel',
        'milieux.trajectoire_artif_par_habitant',
        'mobilite.div_loss_b',
        'mobilite.div_loss_t',
        'mobilite.iso_administration',
        'mobilite.iso_alimentation',
        'mobilite.iso_banque',
        'mobilite.iso_ecole',
        'mobilite.iso_sante',
        'mobilite.places_stationnement_voiture_1000',
        'mobilite.tot_loss_b',
        'mobilite.tot_loss_t',
      ].sort(),
    )
  })

  it('déclare « plus = mieux » les clés re-travées et les ratios (voitures, statut, type, les deux rapports)', () => {
    const attendues: Record<string, DirectionRang> = {
      'mobilite.voitures_menage': 'plus-est-mieux',
      'habitat.statut': 'plus-est-mieux',
      'habitat.type': 'plus-est-mieux',
      'mobilite.bornes_ev_par_station_service': 'plus-est-mieux',
      'mobilite.stationnement_velo_par_voiture': 'plus-est-mieux',
    }
    for (const [themeClef, direction] of Object.entries(attendues)) {
      const [theme, clef] = themeClef.split('.') as [ThemeConstruit, string]
      expect(
        THEMES_METHODES[theme].indicateurs[clef]?.direction,
        `« ${theme}.${clef} »`,
      ).toBe(direction)
    }
  })

  it('expose les libellés publics « plus = mieux » / « moins = mieux » — le vocabulaire du glyphe de la fiche', () => {
    expect(LIBELLES_DIRECTION['plus-est-mieux']).toBe('plus = mieux')
    expect(LIBELLES_DIRECTION['moins-est-mieux']).toBe('moins = mieux')
  })

  it('documente les indicateurs re-través de la décomposition #367', () => {
    // voitures : les trois parts réelles (0/1/2+), la part sans voiture en tête
    const voitures = THEMES_METHODES.mobilite.indicateurs.voitures_menage
    expect(voitures, '« mobilite.voitures_menage »').toBeDefined()
    expect(voitures!.definition).toMatch(/sans voiture/)
    expect(voitures!.definition).toMatch(/deux voitures ou plus/)
    expect(voitures!.definition).toMatch(/100 %|totalisent/)

    // le découpage statut / âge du bâti / type remplace statut_anciennete_taille
    for (const clef of ['statut', 'type', 'age_du_bati']) {
      expect(THEMES_METHODES.habitat.indicateurs[clef], `« habitat.${clef} »`).toBeDefined()
      expect(THEMES_METHODES.habitat.indicateurs[clef]!.unite).toBe('%')
    }
    expect(THEMES_METHODES.habitat.indicateurs.statut!.definition).toMatch(/HLM/)
    expect(THEMES_METHODES.habitat.indicateurs.age_du_bati!.definition).toMatch(/isol/)

    // le stationnement voiture et les deux ratios scalaires
    expect(THEMES_METHODES.mobilite.indicateurs.places_stationnement_voiture_1000).toBeDefined()
    expect(THEMES_METHODES.mobilite.indicateurs.bornes_ev_par_station_service).toBeDefined()
    expect(THEMES_METHODES.mobilite.indicateurs.stationnement_velo_par_voiture).toBeDefined()

    // les lectures perte de diversité / perte totale, valeurs d'indicateurs du sous-groupe
    for (const clef of ['div_loss_t', 'div_loss_b', 'tot_loss_t', 'tot_loss_b']) {
      expect(THEMES_METHODES.mobilite.indicateurs[clef], `« mobilite.${clef} »`).toBeDefined()
    }
    // tot_loss compte le VOLUME d'accès perdu (jamais des types de services) :
    // la médiane sur les bâtiments, classée à l'envers (moins d'accès perdus = mieux)
    for (const clef of ['tot_loss_t', 'tot_loss_b']) {
      const totLoss = THEMES_METHODES.mobilite.indicateurs[clef]
      expect(totLoss!.unite, `« mobilite.${clef} » sans unité de volume`).toBe('accès perdus')
      expect(totLoss!.direction, `« mobilite.${clef} » non classée à l'envers`).toBe(
        'moins-est-mieux',
      )
      expect(totLoss!.definition).toMatch(/médiane|médian/)
    }
    // distribution_dpe est une composition en sept parts classée sur la part
    // F/G — la même valeur que part_passoires, jamais « plus = mieux »
    const dpe = THEMES_METHODES.habitat.indicateurs.distribution_dpe
    expect(dpe!.direction).toBe('moins-est-mieux')
    expect(dpe!.definition).toMatch(/F et G|F\/G/)
    expect(THEMES_METHODES.habitat.indicateurs.part_passoires!.direction).toBe('moins-est-mieux')
  })
})

describe('registre Méthodes — la langue publique, jamais celle du pipeline', () => {
  /** Les mots du pipeline à ne jamais publier (issue #129 : pas de gates, pas de noms d\u2019artefacts). */
  const MOTS_INTERNES = [
    /gate/i,
    /\.rds\b/,
    /parquet/i,
    /sidecar/i,
    /artefact/i,
    /manifeste/i,
    /plancher/i,
    /TOP_N/i,
    /dpe03existant/i,
    /sirene-v3/i,
    /histoires/,
  ]

  it('les définitions et lectures ne portent aucun mot interne au pipeline', () => {
    for (const theme of THEMES_CONSTRUITS) {
      for (const [clef, indicateur] of Object.entries(THEMES_METHODES[theme].indicateurs)) {
        const texte = indicateur.definition
        for (const motif of MOTS_INTERNES) {
          expect(
            motif.test(texte),
            `« ${theme}.${clef} » porte un mot interne : ${motif}`,
          ).toBe(false)
        }
      }
      for (const story of THEMES_METHODES[theme].stories) {
        const textes = [story.definition, ...story.lectures.map((l) => l.lecture)]
        for (const texte of textes) {
          for (const motif of MOTS_INTERNES) {
            expect(
              motif.test(texte),
              `« ${theme}.${story.clef} » porte un mot interne : ${motif}`,
            ).toBe(false)
          }
        }
      }
    }
  })

  it('les définitions parlent en français public (pas de clés brutes de payload)', () => {
    for (const theme of THEMES_CONSTRUITS) {
      for (const [clef, indicateur] of Object.entries(THEMES_METHODES[theme].indicateurs)) {
        // la clé brute n'apparaît jamais dans la définition — la définition est rédigée
        expect(indicateur.definition).not.toContain(clef)
      }
    }
  })
})

describe('ancreIndicateur — l\u2019ancrage stable par indicateur (#334)', () => {
  it('préfixe et slugifie la clé de payload en ancre de section (#indicateur-<clef>)', () => {
    expect(ancreIndicateur('part_passoires')).toBe('indicateur-part-passoires')
    expect(ancreIndicateur('evolution_1968')).toBe('indicateur-evolution-1968')
    expect(ancreIndicateur('places_stationnement_velo_1000')).toBe(
      'indicateur-places-stationnement-velo-1000',
    )
  })

  it('couvre chaque clé du registre d\u2019un slug stable, sans jamais collisionner avec l\u2019ancre de section (#indicateurs)', () => {
    for (const theme of THEMES_CONSTRUITS) {
      for (const clef of Object.keys(THEMES_METHODES[theme].indicateurs)) {
        const ancre = ancreIndicateur(clef)
        expect(ancre, `« ${theme}.${clef} »`).toMatch(/^indicateur-[a-z0-9-]+$/)
        expect(ancre, `« ${theme}.${clef} »`).not.toBe('indicateurs')
        expect(ancre, `« ${theme}.${clef} »`).not.toMatch(/--|-$/)
      }
    }
  })
})

describe('la matrice indicateur ↔ source (issue #336, #206 item 52)', () => {
  it('joint chaque indicateur à SON jeu de données — y compris les sources multi-vintage DVF/DPE, jadis injoignables', () => {
    const matrice = indicateursParDataset()

    // DVF — la médiane prix au m² était injoignable (sourceId null) ; l'en-tête
    // du jeu existe depuis #333, la jointure résout maintenant
    expect(matrice.get('dvf')).toEqual([
      { clef: 'prix_m2', label: 'Médiane prix au m²', theme: 'habitat' },
    ])

    // DPE — les deux indicateurs de la base roulante, dans l'ordre du registre
    expect(matrice.get('dpe')).toEqual([
      { clef: 'part_passoires', label: 'Part de passoires thermiques', theme: 'habitat' },
      {
        clef: 'distribution_dpe',
        label: 'Distribution des étiquettes DPE (A à G)',
        theme: 'habitat',
      },
    ])

    // OCS-GE — l'en-tête du jeu (jamais une ligne vintage) ; la trajectoire
    // par habitant (la valeur de la lecture Milieux, #367) rejoint le même jeu
    expect(matrice.get('ocsge_artificialisation')).toEqual([
      { clef: 'artif_par_habitant', label: 'Intensité état', theme: 'milieux' },
      { clef: 'trajectoire_artif_par_habitant', label: 'Trajectoire par habitant', theme: 'milieux' },
    ])
  })

  it('couvre chaque indicateur dont le sourceId pointe le registre — l\u2019union de la jointure', () => {
    const matrice = indicateursParDataset()
    for (const theme of THEMES_CONSTRUITS) {
      for (const [clef, indicateur] of Object.entries(THEMES_METHODES[theme].indicateurs)) {
        if (indicateur.sourceId === null) continue
        const dataset = datasetDeSource(indicateur.sourceId)
        const consommateurs = matrice.get(dataset) ?? []
        expect(
          consommateurs.some((c) => c.clef === clef),
          `« ${theme}.${clef} » → dataset « ${dataset} » absent de la matrice`,
        ).toBe(true)
      }
    }
  })

  it('ne résout que des jeux du registre des sources — jamais un dataset inventé', () => {
    const datasetsDuRegistre = new Set(
      Object.entries(SOURCES_METHODES).map(([id, source]) => source.dataset ?? id),
    )
    for (const dataset of indicateursParDataset().keys()) {
      expect(datasetsDuRegistre.has(dataset), `dataset « ${dataset} » hors registre`).toBe(true)
    }
  })

  it('n\u2019invente aucun consommateur — un jeu sans indicateur documenté reste absent de la matrice', () => {
    const matrice = indicateursParDataset()
    // flores_a38 (le registre cite la A88 pour les effectifs), la base des EPCI,
    // les sources du référentiel (COG, limites communales, BDNB) n'ont AUCUN
    // indicateur documenté : la matrice ne les liste pas, elle n'invente rien
    for (const dataset of ['flores_a38', 'epci', 'cog_passage', 'communes_limites', 'batiments_residentiels']) {
      expect(matrice.has(dataset), `« ${dataset} » listé sans consommateur documenté`).toBe(false)
    }
  })

  it('ne liste jamais les Stories — elles ne portent pas de champ source (gated #74/#308)', () => {
    const storyClefs = new Set(
      THEMES_CONSTRUITS.flatMap((theme) => THEMES_METHODES[theme].stories.map((s) => s.clef)),
    )
    for (const consommateurs of indicateursParDataset().values()) {
      for (const consommateur of consommateurs) {
        expect(
          storyClefs.has(consommateur.clef),
          `Story « ${consommateur.clef} » listée dans la matrice`,
        ).toBe(false)
      }
    }
  })
})
