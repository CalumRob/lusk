import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { SOURCES_METHODES, ancreSource } from '../methodes/sources'
import { SOURCES_PROGRAMMES } from '../methodes/programmes'
import type { Vintage } from '../payload/types'

/**
 * Le registre Méthodes — le contrat de parité (docs/themes/README.md §The
 * Méthodes contract, issue #128). Une thème n'est pas « construit » tant que
 * sa documentation Méthodes ne part pas : POUR CE TICKET, chaque id de la
 * table vintages commise (public/data/vintages.json) doit avoir une entrée de
 * registre — l'union est le contrat. Depuis l'issue #180, la documentation
 * vit dans DEUX registres : les sources des thèmes (SOURCES_METHODES) et les
 * sources de l'élément Programmes & financements (SOURCES_PROGRAMMES) — la
 * table vintages partagée porte les deux. Une entrée de registre sans ligne
 * vintages en direct est autorisée (dégradation gracieuse) mais signalée.
 */

const dataDir = join(process.cwd(), '..', 'public', 'data')

function lireVintagesCommites(): Vintage[] {
  const brut = JSON.parse(readFileSync(join(dataDir, 'vintages.json'), 'utf-8')) as Vintage[]
  return brut
}

describe('registre Méthodes — la parité avec la table vintages commise', () => {
  it('couvre chaque id de la table vintages commise (l\u2019union est le contrat)', () => {
    const vintages = lireVintagesCommites()
    const registres = { ...SOURCES_METHODES, ...SOURCES_PROGRAMMES }

    for (const vintage of vintages) {
      expect(registres[vintage.id], `id vintages « ${vintage.id} » sans entrée de registre`).toBeDefined()
    }
  })

  it('chaque entrée de registre porte les faits éditoriaux complets', () => {
    for (const [id, source] of Object.entries(SOURCES_METHODES)) {
      expect(source.nom.length, `« ${id} » sans nom`).toBeGreaterThan(0)
      expect(source.libelle.length, `« ${id} » sans libellé éditorial`).toBeGreaterThan(0)
      expect(source.editeur.length, `« ${id} » sans éditeur`).toBeGreaterThan(0)
      expect(source.themes.length, `« ${id} » sans thème utilisé`).toBeGreaterThan(0)
      expect(source.themes.every((t) => ['demographie', 'habitat', 'economie', 'mobilite', 'milieux'].includes(t))).toBe(true)
    }
  })

  it('déclare 25 jeux de données — les trois familles générées (OCS-GE un seul jeu, états + patchs) et les sources uniques (ADR-0022)', () => {
    const idsJeux = new Set(
      Object.entries(SOURCES_METHODES).map(([id, source]) => source.dataset ?? id),
    )
    // osm_reseaux porte aussi les aires de stationnement ; BPE est le seul
    // nouveau jeu autonome.
    expect(idsJeux.size).toBe(25)
  })

  it('les familles générées partagent le nom du jeu et portent un libellé vintage dédié (ADR-0022)', () => {
    // DVF — 20 lignes, un seul jeu (le même nom, des libellés millésimés)
    const dvf = Object.entries(SOURCES_METHODES).filter(([id]) => id.startsWith('dvf_'))
    expect(dvf.length).toBe(20)
    expect(new Set(dvf.map(([, s]) => s.nom))).toEqual(new Set(['Étalab — DVF géolocalisées']))
    expect(dvf.every(([, s]) => s.dataset === 'dvf')).toBe(true)
    expect(SOURCES_METHODES['dvf_2021_dep22'].libelle).toBe('Millésime 2021 · Côtes-d\u2019Armor (22)')

    // OCS-GE — les huit archives d'état partagent le nom du jeu, libellés millésimés par département
    const etats = Object.entries(SOURCES_METHODES).filter(([id]) =>
      id.startsWith('ocsge_artificialisation_'),
    )
    expect(etats.length).toBe(8)
    expect(new Set(etats.map(([, s]) => s.nom)).size).toBe(1)
    expect(SOURCES_METHODES['ocsge_artificialisation_22_2021'].libelle).toBe(
      'Millésime 2021 · Côtes-d\u2019Armor (22)',
    )
    expect(SOURCES_METHODES['ocsge_artificialisation_35_2023'].libelle).toBe(
      'Millésime 2023 · Ille-et-Vilaine (35)',
    )

    // les patchs correctifs — du MÊME jeu que les archives d'état (un seul
    // en-tête OCS-GE, ADR-0022), leur nom dédié et leurs libellés propres
    const patchs = Object.entries(SOURCES_METHODES).filter(([id]) =>
      id.startsWith('ocsge_patch_correctif_'),
    )
    expect(patchs.length).toBe(3)
    expect(new Set(patchs.map(([, s]) => s.dataset))).toEqual(
      new Set(['ocsge_artificialisation']),
    )
    expect(SOURCES_METHODES['ocsge_patch_correctif_22'].nom).toBe(
      'IGN — OCS GE « patch correctif » (Nouvelle Génération)',
    )
    expect(SOURCES_METHODES['ocsge_patch_correctif_22'].libelle).toBe(
      'Patch correctif — Côtes-d\u2019Armor (22), millésime corrigé 2021',
    )
  })

  it('synchronise la ligne vintage BPE B316 avec le registre et les faits éditoriaux', () => {
    const vintages = lireVintagesCommites()
    const bpe = vintages.find((v) => v.id === 'bpe_b316')
    expect(bpe).toMatchObject({
      source: 'INSEE — Base permanente des équipements BPE25 géolocalisée, filtre B316 stations-service',
      version: '2025',
      licence: 'lov2',
      date_reference: '2025-01-01',
      date_publication: '2026-08-04',
    })
    expect(SOURCES_METHODES.bpe_b316).toMatchObject({
      url: 'https://www.insee.fr/fr/statistiques/fichier/8217525/BPE25.parquet',
      libelle: 'Millésime 2025',
    })
  })

  it('déclare 57 sources — l\u2019union commise (demographie + habitat + economie + mobilite + milieux + les 8 OCS-GE millésimés + les 3 patchs correctifs M2 + le jeu Geovelo + la table de passage COG + les 2 sources de #369)', () => {
    expect(Object.keys(SOURCES_METHODES).length).toBe(57)
  })

  it('documente la source Geovelo des aménagements cyclables — URL data.gouv.fr, ODbL (issue #233)', () => {
    // la figure « L'offre cyclable » cite le jeu Geovelo « Aménagements
    // cyclables France Métropolitaine » — la source du numérateur du ratio
    const geovelo = SOURCES_METHODES['amenagements_cyclables']
    expect(geovelo).toBeDefined()
    expect(geovelo.nom).toContain('Geovelo')
    expect(geovelo.nom).toMatch(/ODbL/)
    expect(geovelo.editeur).toBe('Geovelo')
    expect(geovelo.themes).toEqual(['mobilite'])
    // l'URL publique du jeu sur data.gouv.fr — jamais une URL inventée
    expect(geovelo.url).toBe(
      'https://www.data.gouv.fr/datasets/amenagements-cyclables-france-metropolitaine/',
    )
    // la licence ODbL est aussi le fait de fraîcheur de la table vintages
    const vintages = lireVintagesCommites()
    const ligne = vintages.find((v) => v.id === 'amenagements_cyclables')
    expect(ligne).toMatchObject({
      version: '2026-08',
      licence: 'odbl',
      date_reference: '2026-08-07',
    })
  })
})

describe('ancreSource — un ancrage stable par source', () => {
  it('slugifie l\u2019id en ancre de section (#source-<slug>)', () => {
    expect(ancreSource('dvf_2021_dep22')).toBe('source-dvf-2021-dep22')
    expect(ancreSource('serie_historique')).toBe('source-serie-historique')
  })

  it('ne collisionne jamais avec l\u2019ancre de section (#sources)', () => {
    for (const id of Object.keys(SOURCES_METHODES)) {
      expect(ancreSource(id)).not.toBe('sources')
      expect(ancreSource(id)).toMatch(/^source-/)
    }
  })
})
