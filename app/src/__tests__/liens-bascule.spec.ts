import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { routes } from '../router'

/**
 * L'hygiène des liens de la bascule (#410) — le verrou transversal qui
 * complète les suites par surface (route, header, footer, accueil, listes,
 * fiche). La bascule atomique impose que :
 *
 *  1. `/methodologie` ne soit plus UNE cible de lien ni UNE route — Méthodes
 *     est retirée, son contenu vit dans Sources (#406) et À propos ;
 *  2. `/carte` reste routée (ruling produit 2026-08-26 : outil d'exploration
 *     personnel du PO) mais n'apparaisse comme LIEN face-utilisateur nulle
 *     part — ni header, ni footer, ni accueil, ni recherche, ni listes.
 *
 * Ce fichier balaie tout `src/` hors tests : un RouterLink, un `href`, un
 * `path:` de lien ou un `router.push` vers ces surfaces fait échouer la
 * suite — la régression ne peut pas se glisser dans un composant oublié.
 */

/** Les motifs d'un LIEN interne (pas une mention dans un commentaire). */
const MOTIFS_LIEN = [
  /to\s*=\s*["']\/(carte|methodologie)["']/,
  /:to\s*=\s*["']\/(carte|methodologie)["']/,
  /path:\s*['"]\/(carte|methodologie)['"]/,
  /href\s*=\s*["']\/(carte|methodologie)["']/,
  /\bpush\(\s*['"]\/(carte|methodologie)['"]/,
]

function fichiersSous(dir: string): string[] {
  const sorties: string[] = []
  for (const entree of readdirSync(dir, { withFileTypes: true })) {
    const chemin = join(dir, entree.name)
    if (entree.isDirectory()) {
      if (entree.name === '__tests__') continue // les suites citent les liens pour prouver leur absence
      sorties.push(...fichiersSous(chemin))
    } else if (/\.(vue|ts)$/.test(entree.name)) {
      sorties.push(chemin)
    }
  }
  return sorties
}

const racineSrc = join(process.cwd(), 'src')

describe('bascule #410 — l’hygiène des liens internes', () => {
  it('ne laisse aucune cible de lien vers /methodologie dans le code de production', () => {
    const coupables: string[] = []
    for (const fichier of fichiersSous(racineSrc)) {
      const contenu = readFileSync(fichier, 'utf8')
      if (/\/methodologie/.test(contenu.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, ''))) {
        coupables.push(fichier)
      }
    }
    expect(coupables, 'des fichiers de production mentionnent encore /methodologie hors commentaire').toEqual([])
  })

  it('garde /carte routée mais sans AUCUN lien face-utilisateur (ruling PO, épargnée)', () => {
    // La route survit — l'outil du PO reste fonctionnel.
    expect(routes.some((r) => r.path === '/carte')).toBe(true)

    const coupables: string[] = []
    for (const fichier of fichiersSous(racineSrc)) {
      const contenu = readFileSync(fichier, 'utf8')
      for (const motif of MOTIFS_LIEN) {
        if (motif.test(contenu)) {
          // Seule exception : l'enregistrement de la route elle-même
          // (router/index.ts), exigé par le ruling.
          if (fichier.endsWith(join('router', 'index.ts')) && motif.source.startsWith('path')) continue
          coupables.push(`${fichier} (${motif})`)
        }
      }
    }
    expect(coupables, '/carte ne doit être liée depuis aucun composant').toEqual([])
  })

  it('enregistre les destinations de la nouvelle architecture', () => {
    const chemins = new Set(routes.map((r) => r.path))
    for (const chemin of ['/', '/sources', '/a-propos', '/indicateurs']) {
      expect(chemins.has(chemin), chemin).toBe(true)
    }
    expect(chemins.has('/methodologie')).toBe(false)
  })
})
