import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { SOURCES_METHODES, ancreSource } from '../methodes/sources'
import type { Vintage } from '../payload/types'

/**
 * Le registre Méthodes — le contrat de parité (docs/themes/README.md §The
 * Méthodes contract, issue #128). Une thème n'est pas « construit » tant que
 * sa documentation Méthodes ne part pas : POUR CE TICKET, chaque id de la
 * table vintages commise (public/data/vintages.json) doit avoir une entrée de
 * registre — l'union est le contrat. Une entrée de registre sans ligne
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

    for (const vintage of vintages) {
      expect(SOURCES_METHODES[vintage.id], `id vintages « ${vintage.id} » sans entrée de registre`).toBeDefined()
    }
  })

  it('chaque entrée de registre porte les faits éditoriaux complets', () => {
    for (const [id, source] of Object.entries(SOURCES_METHODES)) {
      expect(source.nom.length, `« ${id} » sans nom`).toBeGreaterThan(0)
      expect(source.editeur.length, `« ${id} » sans éditeur`).toBeGreaterThan(0)
      expect(source.themes.length, `« ${id} » sans thème utilisé`).toBeGreaterThan(0)
      expect(source.themes.every((t) => ['demographie', 'habitat', 'economie', 'mobilite'].includes(t))).toBe(true)
    }
  })

  it('signale les entrées de registre sans ligne vintages en direct (dégradation autorisée)', () => {
    const vintages = lireVintagesCommites()
    const idsVintages = new Set(vintages.map((v) => v.id))
    const registreSeul = Object.keys(SOURCES_METHODES).filter((id) => !idsVintages.has(id))

    // Aucune aujourd'hui — si ce test passe avec une liste non vide, la
    // dégradation gracieuse doit être vérifiée à l'écran (faits éditoriaux
    // rendus, dates jamais inventées).
    expect(registreSeul).toEqual([])
  })

  it('déclare 35 sources — l\u2019union commise (demographie + habitat + economie + mobilite)', () => {
    expect(Object.keys(SOURCES_METHODES).length).toBe(35)
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
