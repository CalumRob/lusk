import { describe, expect, it } from 'vitest'

import { metadonneesThemesFixtures } from '../payload/fixtures'
import type { Theme, ThemeMetadata } from '../payload/types'
import { GROUPES_PAR_STORY } from '../payload/types'
import { PayloadError, validerThemeMetadata } from '../payload/validate'

/**
 * Le contrat de métadonnées par thème (issue #309, parent #308) — le miroir
 * TypeScript de test-theme-metadata.R : le fichier theme_<theme>.json doit
 * déclarer l'ordre des sous-groupes, leurs labels et cadrages, les familles
 * de figures, le texte riche TYPÉ (jamais de HTML brut), le lien vers
 * l'histoire résolue de chaque sous-groupe et la politique de source de
 * référence. La dérive échoue FORT (PayloadError kind 'validation'), jamais
 * silencieuse.
 *
 * Cas couverts (acceptance #309) : fixtures valides des cinq thèmes
 * construits ; échouent — thème absent, sous-groupe invalide, figure
 * invalide, texte riche invalide, référence cross-thème, lien d'histoire
 * inconnu ; la frontière explicite : Programmes est un contrat de publication
 * séparé, jamais un thème.
 */

function copieBrute(theme: Theme): ThemeMetadata {
  return JSON.parse(JSON.stringify(metadonneesThemesFixtures[theme])) as ThemeMetadata
}

function attendErreur(theme: Theme, muter: (meta: ThemeMetadata) => void): PayloadError {
  const meta = copieBrute(theme)
  muter(meta)
  let erreur: unknown
  try {
    validerThemeMetadata(meta, `theme_${theme}.json`)
  } catch (e) {
    erreur = e
  }
  expect(erreur).toBeInstanceOf(PayloadError)
  const payloadError = erreur as PayloadError
  expect(payloadError.kind).toBe('validation')
  return payloadError
}

describe('validerThemeMetadata — accepte la forme du contrat', () => {
  it('accepte les fixtures valides des cinq thèmes construits', () => {
    for (const theme of Object.keys(metadonneesThemesFixtures) as Theme[]) {
      const meta = validerThemeMetadata(metadonneesThemesFixtures[theme], `theme_${theme}.json`)

      expect(meta.theme).toBe(theme)
      expect(meta.subgroups.length).toBeGreaterThan(0)
      // la bijection : chaque indicateur du registre vit dans exactement un
      // sous-groupe ; chaque sous-groupe lie une story déclarée au registre —
      // une fois, jamais deux lectures pour le même slot
      const indicateurs = meta.subgroups.flatMap((g) => g.indicators)
      expect(new Set(indicateurs).size).toBe(meta.indicator_keys.length)
      const liees = meta.subgroups.map((g) => g.reading.story_key)
      expect(new Set(liees).size).toBe(liees.length)
      for (const cle of liees) expect(meta.story_keys).toContain(cle)
      // chaque story du registre est liée OU candidate de saillance déclarée
      // du groupe d'un sous-groupe (le pool Mobilité partage SON slot —
      // ADR-0002) : jamais une story orpheline, jamais un slot fabriqué
      for (const cle of meta.story_keys.filter((c) => !liees.includes(c))) {
        const groupe = GROUPES_PAR_STORY[meta.theme]?.[cle]
        expect(groupe, `« ${cle} » — candidate déclarée au registre`).toBeDefined()
        expect(meta.subgroups.map((g) => g.key)).toContain(groupe)
      }
    }
  })

  it('l\u2019ordre des sous-groupes est l\u2019ordre de la fiche (Économie : deux sous-groupes)', () => {
    const meta = validerThemeMetadata(metadonneesThemesFixtures.economie, 'theme_economie.json')
    expect(meta.subgroups.map((g) => g.key)).toEqual([
      'sante-et-taille',
      'structure-verte',
    ])
  })

  it('accepte une story candidate de saillance déclarée au registre (le pool Mobilité, ADR-0002)', () => {
    // Le registre story_keys du thème déclare AUSSI les candidates de saillance
    // — pas seulement la story liée par le sous-groupe : le pool Mobilité
    // résout « ce-que-le-velo-preserve » là où le delta tire (139 territoires
    // du payload committé), le candidat partage le slot du défaut
    // (acces-aux-services). Une story déclarée mais non liée est LÉGITIME
    // quand le registre la déclare candidate du groupe d'un sous-groupe —
    // jamais une lecture en double, jamais un slot supplémentaire.
    const meta = copieBrute('mobilite')
    meta.story_keys = ['vingt-minutes-sans-voiture', 'ce-que-le-velo-preserve']

    const validee = validerThemeMetadata(meta, 'theme_mobilite.json')
    expect(validee.story_keys).toEqual(['vingt-minutes-sans-voiture', 'ce-que-le-velo-preserve'])
  })
})

describe('validerThemeMetadata — rejette la dérive, fort', () => {
  it('rejette un thème absent', () => {
    const erreur = attendErreur('demographie', (meta) => {
      delete (meta as unknown as Record<string, unknown>).theme
    })
    expect(erreur.message).toMatch(/theme/i)
  })

  it('rejette la frontière Programmes — un contrat séparé, jamais un thème', () => {
    const erreur = attendErreur('demographie', (meta) => {
      ;(meta as unknown as Record<string, unknown>).theme = 'programmes'
    })
    expect(erreur.message).toMatch(/s[ée]par[ée]/i)
  })

  it('rejette un sous-groupe invalide', () => {
    // clé de sous-groupe en double
    let erreur = attendErreur('economie', (meta) => {
      meta.subgroups[1].key = meta.subgroups[0].key
    })
    expect(erreur.message).toMatch(/double/i)

    // indicateur hors du registre indicator_keys
    erreur = attendErreur('demographie', (meta) => {
      meta.subgroups[0].indicators.push('fantome')
    })
    expect(erreur.message).toMatch(/indicator_keys/i)

    // liste d'indicateurs vide
    erreur = attendErreur('economie', (meta) => {
      meta.subgroups[1].indicators = []
    })
    expect(erreur.message).toMatch(/indicateur/i)
  })

  it('rejette une figure invalide', () => {
    // famille hors contrat
    let erreur = attendErreur('demographie', (meta) => {
      meta.subgroups[0].figure.family = 'camembert' as ThemeMetadata['subgroups'][number]['figure']['family']
    })
    expect(erreur.message).toMatch(/figure/i)

    // la figure rend un indicateur que le sous-groupe ne possède pas
    erreur = attendErreur('demographie', (meta) => {
      meta.subgroups[0].figure.indicator = 'fantome'
    })
    expect(erreur.message).toMatch(/figure/i)
  })

  it('rejette un texte riche invalide', () => {
    // type de nœud inconnu (le HTML n'est pas un type)
    let erreur = attendErreur('demographie', (meta) => {
      meta.subgroups[0].reading.template[0].type = 'html' as ThemeMetadata['subgroups'][number]['reading']['template'][number]['type']
    })
    expect(erreur.message).toMatch(/HTML/i)

    // HTML brut dans un nœud text
    erreur = attendErreur('demographie', (meta) => {
      const noeud = meta.subgroups[0].reading.template.find((n) => n.type === 'text')
      if (noeud && noeud.type === 'text') noeud.content = '<strong>gras</strong>'
    })
    expect(erreur.message).toMatch(/HTML/i)

    // lien sans href
    erreur = attendErreur('demographie', (meta) => {
      const lien = meta.subgroups[0].reading.template.find((n) => n.type === 'link')
      if (lien && lien.type === 'link') {
        delete (lien as unknown as Record<string, unknown>).href
      }
    })
    expect(erreur.message).toMatch(/lien/i)

    // paramètre non déclaré dans reading.params
    erreur = attendErreur('demographie', (meta) => {
      const param = meta.subgroups[0].reading.template.find((n) => n.type === 'param')
      if (param && param.type === 'param') param.key = 'fantome'
    })
    expect(erreur.message).toMatch(/param/i)
  })

  it('rejette une référence cross-thème (l\u2019herméticité, ADR-0020)', () => {
    // une story d'un autre thème dans story_keys (la Mobilité dans la Démographie)
    const erreur = attendErreur('demographie', (meta) => {
      meta.story_keys.push('vingt-minutes-sans-voiture')
    })
    expect(erreur.message).toMatch(/cross-th[èe]me/i)
  })

  it('rejette un lien d\u2019histoire inconnu', () => {
    // la lecture d'un sous-groupe pointe une story non déclarée dans story_keys
    let erreur = attendErreur('demographie', (meta) => {
      meta.subgroups[0].reading.story_key = 'histoire-inconnue'
    })
    expect(erreur.message).toMatch(/inconnu/i)

    // une story déclarée sans sous-groupe qui la lit (orpheline)
    erreur = attendErreur('economie', (meta) => {
      meta.subgroups = meta.subgroups.slice(0, 1)
      meta.indicator_keys = [...meta.subgroups[0].indicators]
      meta.sources = Object.fromEntries(
        Object.entries(meta.sources).filter(([cle]) => meta.indicator_keys.includes(cle)),
      )
      // les libellés suivent le registre resserré (la bijection #318)
      meta.indicator_labels = Object.fromEntries(
        Object.entries(meta.indicator_labels).filter(([cle]) => meta.indicator_keys.includes(cle)),
      )
      const params = new Set(meta.subgroups.flatMap((g) => g.reading.params))
      meta.param_labels = Object.fromEntries(
        Object.entries(meta.param_labels).filter(([cle]) => params.has(cle)),
      )
    })
    expect(erreur.message).toMatch(/orpheline/i)
  })

  it('rejette une carte des sources incomplète (la politique de source de référence)', () => {
    const erreur = attendErreur('demographie', (meta) => {
      delete meta.sources.densite
    })
    expect(erreur.message).toMatch(/source/i)
  })

  it('rejette indicator_labels hors de la bijection avec indicator_keys (#318)', () => {
    // un indicateur du registre sans libellé
    let erreur = attendErreur('demographie', (meta) => {
      delete meta.indicator_labels.densite
    })
    expect(erreur.message).toMatch(/indicator_labels/i)

    // un libellé pour une clé hors du registre (fantôme)
    erreur = attendErreur('demographie', (meta) => {
      meta.indicator_labels['fantome'] = 'Libellé fantôme'
    })
    expect(erreur.message).toMatch(/indicator_labels/i)

    // une carte absente
    erreur = attendErreur('demographie', (meta) => {
      delete (meta as unknown as Record<string, unknown>).indicator_labels
    })
    expect(erreur.message).toMatch(/indicator_labels/i)
  })

  it('rejette detail_labels avec une clé hors registre ou un libellé vide (#318)', () => {
    // une clé de détail hors du registre des indicateurs
    let erreur = attendErreur('demographie', (meta) => {
      meta.detail_labels['fantome'] = { x: 'y' }
    })
    expect(erreur.message).toMatch(/detail_labels/i)

    // un libellé de détail vide
    erreur = attendErreur('demographie', (meta) => {
      meta.detail_labels.structure_age['15-24'] = ''
    })
    expect(erreur.message).toMatch(/detail_labels/i)

    // une carte absente
    erreur = attendErreur('demographie', (meta) => {
      delete (meta as unknown as Record<string, unknown>).detail_labels
    })
    expect(erreur.message).toMatch(/detail_labels/i)
  })

  it('rejette param_labels hors de l\u2019union des reading.params (#318)', () => {
    // un paramètre de lecture sans libellé
    let erreur = attendErreur('demographie', (meta) => {
      delete meta.param_labels.periode
    })
    expect(erreur.message).toMatch(/param_labels/i)

    // un libellé pour un paramètre jamais déclaré (fantôme)
    erreur = attendErreur('demographie', (meta) => {
      meta.param_labels['fantome'] = 'Libellé fantôme'
    })
    expect(erreur.message).toMatch(/param_labels/i)

    // une carte absente
    erreur = attendErreur('demographie', (meta) => {
      delete (meta as unknown as Record<string, unknown>).param_labels
    })
    expect(erreur.message).toMatch(/param_labels/i)
  })

  it('accepte les cartes de libellés des cinq thèmes — chaque clé a son libellé, chaque libellé sa clé', () => {
    for (const theme of Object.keys(metadonneesThemesFixtures) as Theme[]) {
      const meta = validerThemeMetadata(metadonneesThemesFixtures[theme], `theme_${theme}.json`)
      // indicator_labels : la bijection exacte avec indicator_keys
      expect(Object.keys(meta.indicator_labels).sort()).toEqual([...meta.indicator_keys].sort())
      // detail_labels : clés ⊆ indicator_keys, libellés non vides
      for (const [cle, carte] of Object.entries(meta.detail_labels)) {
        expect(meta.indicator_keys).toContain(cle)
        expect(Object.keys(carte).length).toBeGreaterThan(0)
        for (const libelle of Object.values(carte)) expect(libelle.length).toBeGreaterThan(0)
      }
      // param_labels : la bijection exacte avec l'union des reading.params
      const params = [...new Set(meta.subgroups.flatMap((g) => g.reading.params))]
      expect(Object.keys(meta.param_labels).sort()).toEqual([...params].sort())
    }
  })
})
