/**
 * The app's payload state (ADR-0003 — static payload fetched at runtime via
 * the charger seam).
 *
 * Since issue #298 (the T2 heart of PRD #296 « la page d'abord, le reste en
 * arrière-plan »), the payload loads as a STORE of per-file promises feeding
 * one reactive `Payload` object that GROWS as files land. Every file is still
 * fetched eagerly and in parallel on first load (one fetch per session — the
 * payload is static, memory-cached); the wait-set is a pure rendering gate,
 * never a fetch trigger.
 *
 * `usePayload({ attendre: [...] })` returns the same `{ payload, erreur,
 * chargement, recharger }` shape, but:
 * - `payload` is always the live growing object — initialized to valid
 *   empty/null sections, populated section by section as each file's promise
 *   resolves (the `Payload` type itself is unchanged).
 * - `chargement` is true until every file in the wait-set has settled
 *   (resolved or failed); anything already loaded is readable while it is
 *   still true.
 * - `erreur` is the wait-set's failure if any (kind preserved), else null.
 * - No-arg `usePayload()` = wait for the FULL set = the previous
 *   all-or-nothing behavior (backward compatible).
 *
 * Failure semantics (option C): a wait-set file failing → the typed
 * `PayloadError` + Retry; a background file failing → its section stays at
 * the honest empty/null state (never a broken partial render), the error
 * recorded by `kind` — 'validation' drift stays LOUD in the console (a broken
 * theme can never masquerade as an absent one). `recharger` refetches ONLY
 * the failed files, never the whole payload.
 *
 * Tests inject their own per-file charger through PAYLOAD_CHARGER_KEY to
 * isolate the fetch seam — an injected charger is never shared between tests.
 */

import { computed, inject, reactive, ref } from 'vue'
import type { InjectionKey, Ref } from 'vue'

import { chargerFichier } from './loader'
import type { Fichier } from './loader'
import type {
  ApercuRow,
  DistributionAccesBatimentsRow,
  Histoire,
  Indicateur,
  Payload,
  ProgrammesPayload,
  ProfilAccesBpeRow,
  RampeAccesBatimentsRow,
  RunReport,
  Territoire,
  Theme,
  ThemeMetadata,
  Vintage,
} from './types'
import { THEMES_CANONIQUES } from './types'
import { PayloadError } from './validate'

/** The per-file payload charger — injectable so component tests stub the fetch seam. */
export type ChargerFichier = (fichier: Fichier) => Promise<unknown>

export const PAYLOAD_CHARGER_KEY: InjectionKey<ChargerFichier> = Symbol('payload-charger')

export interface EtatPayload {
  payload: Ref<Payload>
  erreur: Ref<PayloadError | null>
  chargement: Ref<boolean>
  recharger: () => void
}

export interface OptionsUsePayload {
  /** The wait-set — the files this consumer BLOCKS on. Default = the full set. */
  attendre?: Fichier[]
}

/** The honest empty payload — every section valid against the `Payload` type. */
function payloadVide(): Payload {
  return {
    territoires: [],
    indicateurs: [],
    histoires: [],
    apercu: null,
    runReport: null,
    vintages: null,
    programmes: null,
    profilsAccesBpe: null,
    distributionAccesBatiments: null,
    rampeAccesBatiments: null,
    themeMetadata: {},
  }
}

/** The files that validate WITHOUT the reference table — fired immediately. */
const SANS_REFERENCE = new Set<Fichier>(['territoires', 'run-report', 'vintages'])

/** The full file set — no-arg `usePayload()` waits for exactly this. */
const TOUS_LES_FICHIERS: Fichier[] = [
  'territoires',
  'run-report',
  'vintages',
  'apercu',
  'programmes',
  'profils_acces_bpe',
  'distribution_acces_batiments',
  'rampe_acces_batiments',
  ...THEMES_CANONIQUES.flatMap(
    (theme) => [`indicateurs_${theme}`, `histoires_${theme}`, `theme_${theme}`] as Fichier[],
  ),
]

type EtatFichier = 'en-cours' | 'succes' | 'echec'

interface EntreeFichier {
  promesse: Promise<unknown>
  etat: EtatFichier
  valeur: unknown
  erreur: PayloadError | null
}

interface Magasin {
  payload: Ref<Payload>
  etats: Map<Fichier, EntreeFichier>
  recharger: () => void
}

/**
 * One magasin = one store instance. The production app shares ONE module-level
 * magasin (one fetch per session); an injected charger gets a fresh magasin
 * per call so tests never share state.
 */
function creerMagasin(chargerInjecte: ChargerFichier | null): Magasin {
  const payload = ref<Payload>(payloadVide())
  const etats: Map<Fichier, EntreeFichier> = reactive(new Map())

  /** The theme behind an `indicateurs_<theme>` / `histoires_<theme>` name. */
  function themeDe(nom: Fichier): Theme {
    return nom.split('_').slice(1).join('_') as Theme
  }

  /** Populate the growing payload section as a file resolves. */
  function peupler(nom: Fichier, valeur: unknown): void {
    const p = payload.value
    switch (nom) {
      case 'territoires':
        p.territoires = valeur as Territoire[]
        break
      case 'run-report':
        p.runReport = valeur as RunReport | null
        break
      case 'vintages':
        p.vintages = valeur as Vintage[] | null
        break
      case 'apercu':
        p.apercu = valeur as ApercuRow[] | null
        break
      case 'programmes':
        p.programmes = valeur as ProgrammesPayload | null
        break
      case 'profils_acces_bpe':
        p.profilsAccesBpe = valeur as ProfilAccesBpeRow[] | null
        break
      case 'distribution_acces_batiments':
        p.distributionAccesBatiments = valeur as DistributionAccesBatimentsRow[] | null
        break
      case 'rampe_acces_batiments':
        p.rampeAccesBatiments = valeur as RampeAccesBatimentsRow[] | null
        break
      default:
        // Un thème absent (null) ne contribue aucune ligne — l'état vide honnête.
        if (nom.startsWith('indicateurs_') && Array.isArray(valeur)) {
          // Ne passe pas le tableau entier comme arguments : les payloads de
          // trajectoires peuvent dépasser la limite d'arguments de la VM.
          for (const ligne of valeur as Indicateur[]) p.indicateurs.push(ligne)
        } else if (nom.startsWith('histoires_') && Array.isArray(valeur)) {
          for (const ligne of valeur as Histoire[]) p.histoires.push(ligne)
        } else if (nom.startsWith('theme_') && valeur !== null) {
          // Les métadonnées du thème (theme_<theme>.json, #313) — une entrée
          // par thème présent ; un thème absent ne contribue aucune entrée.
          p.themeMetadata ??= {}
          p.themeMetadata[themeDe(nom)] = valeur as ThemeMetadata
        }
    }
  }

  /**
   * The promise for ONE file. Ordering constraint kept: files that validate
   * AGAINST the reference table chain off territoires' own entry (which is
   * always kicked first), so the reference settles before its dependents.
   * histoires_<theme> additionally chains off its indicateurs pair: a theme
   * ABSENT by 404 has no histoires to fetch (ADR-0007, payload-driven
   * discovery), while a theme PRESENT without its histoires file is contract
   * drift — the typed validation error, loud.
   */
  // Le nom générique Fichier (union) ne satisfait pas les surcharges typées
  // du loader — on appelle la signature d'implémentation, dont le contrat est
  // le même (le garde exigerReference valide l'argument de référence).
  const chargerFichierElargi = chargerFichier as (
    nom: Fichier,
    territoires?: Territoire[],
  ) => Promise<unknown>

  function construire(nom: Fichier): Promise<unknown> {
    if (SANS_REFERENCE.has(nom)) {
      return chargerInjecte ? chargerInjecte(nom) : chargerFichierElargi(nom)
    }
    const territoires = etats.get('territoires')
    if (!territoires) {
      return Promise.reject(
        new PayloadError(
          'validation',
          `${nom}.json`,
          `« ${nom}.json » doit suivre la table de référence (l'ordre du loader).`,
        ),
      )
    }
    const fetchant = (reference: unknown) =>
      chargerInjecte ? chargerInjecte(nom) : chargerFichierElargi(nom, reference as Territoire[])

    if (nom.startsWith('histoires_')) {
      const theme = themeDe(nom)
      const indicateurs = etats.get(`indicateurs_${theme}`)
      if (!indicateurs) {
        return Promise.reject(
          new PayloadError('validation', `${nom}.json`, `« ${nom}.json » doit suivre ses indicateurs.`),
        )
      }
      return indicateurs.promesse.then((indicateursTheme) => {
        if (indicateursTheme === null) return null // thème absent → histoires absentes
        return territoires.promesse.then(fetchant).then((histoires) => {
          if (histoires === null) {
            throw new PayloadError(
              'validation',
              `${nom}.json`,
              `Le thème « ${theme} » publie des indicateurs sans histoires (${nom}.json introuvable)`,
            )
          }
          return histoires
        })
      })
    }
    // Les métadonnées (theme_<theme>.json, #313) suivent la même découverte
    // que les histoires : chaînées sur la paire indicateurs du MÊME thème
    // (jamais un fetch transitif) — thème absent → métadonnées absentes ;
    // thème présent sans son fichier → dérive typée, loud.
    if (nom.startsWith('theme_')) {
      const theme = themeDe(nom)
      const indicateurs = etats.get(`indicateurs_${theme}`)
      if (!indicateurs) {
        return Promise.reject(
          new PayloadError('validation', `${nom}.json`, `« ${nom}.json » doit suivre ses indicateurs.`),
        )
      }
      return indicateurs.promesse.then((indicateursTheme) => {
        if (indicateursTheme === null) return null // thème absent → métadonnées absentes
        return territoires.promesse.then(fetchant).then((meta) => {
          if (meta === null) {
            throw new PayloadError(
              'validation',
              `${nom}.json`,
              `Le thème « ${theme} » publie des indicateurs sans métadonnées (${nom}.json introuvable)`,
            )
          }
          return meta
        })
      })
    }
    return territoires.promesse.then(fetchant)
  }

  /**
   * Kick ONE file: create its entry, wire the settle handlers, and populate
   * the growing payload on success. Re-kicking an 'echec' file replaces its
   * entry (the file-scoped retry of `recharger`).
   */
  function lancer(nom: Fichier): void {
    const existant = etats.get(nom)
    if (existant && existant.etat !== 'echec') return

    const promesse = construire(nom)
    const entree: EntreeFichier = reactive({
      promesse,
      etat: 'en-cours' as const,
      valeur: null,
      erreur: null,
    })
    etats.set(nom, entree)

    promesse.then(
      (valeur) => {
        entree.etat = 'succes'
        entree.valeur = valeur
        peupler(nom, valeur)
      },
      (cause: unknown) => {
        entree.etat = 'echec'
        entree.erreur =
          cause instanceof PayloadError
            ? cause
            : new PayloadError('fetch', `${nom}.json`, 'Impossible de charger les données.')
        // La dérive de validation reste LOUD (canari) : un thème cassé ne peut
        // jamais se faire passer pour un thème absent.
        if (entree.erreur.kind === 'validation') {
          console.error(entree.erreur)
        }
      },
    )
  }

  /** The eager parallel kick — all files, one fetch per session. */
  function demarrer(): void {
    // La table de référence d'abord (l'ordre du loader) ; les fichiers sans
    // référence partent en parallèle avec elle.
    lancer('territoires')
    lancer('run-report')
    lancer('vintages')
    // Les fichiers liés chaînent sur territoires (leur promesse attend sa
    // résolution) ; histoires_<theme> chaîne sur sa paire indicateurs.
    lancer('apercu')
    lancer('programmes')
    lancer('profils_acces_bpe')
    lancer('distribution_acces_batiments')
    lancer('rampe_acces_batiments')
    for (const theme of THEMES_CANONIQUES) {
      lancer(`indicateurs_${theme}`)
      lancer(`histoires_${theme}`)
      lancer(`theme_${theme}`)
    }
  }

  /** Refetch ONLY the failed files — never the full set. */
  function recharger(): void {
    const echoues = [...etats.entries()]
      .filter(([, entree]) => entree.etat === 'echec')
      .map(([nom]) => nom)
    for (const nom of echoues) {
      etats.delete(nom)
    }
    // L'ordre d'origine est gardé : la référence repart avant ses dépendants.
    for (const nom of echoues) {
      lancer(nom)
    }
  }

  demarrer()

  return { payload, etats, recharger }
}

/** The one shared store for the production app — one fetch per session. */
let magasinPartage: Magasin | null = null

export function usePayload({ attendre }: OptionsUsePayload = {}): EtatPayload {
  const chargerInjecte = inject(PAYLOAD_CHARGER_KEY, null)
  const magasin = chargerInjecte ? creerMagasin(chargerInjecte) : (magasinPartage ??= creerMagasin(null))

  const attendreEffectif: readonly Fichier[] = attendre ?? TOUS_LES_FICHIERS

  /** true until every wait-set file has settled (resolved or failed). */
  const chargement = computed(() =>
    attendreEffectif.some((nom) => {
      const entree = magasin.etats.get(nom)
      return !entree || entree.etat === 'en-cours'
    }),
  )

  /** The wait-set's failure if any — else null (background failures never surface). */
  const erreur = computed(() => {
    for (const nom of attendreEffectif) {
      const entree = magasin.etats.get(nom)
      if (entree && entree.etat === 'echec' && entree.erreur) return entree.erreur
    }
    return null
  })

  return { payload: magasin.payload, erreur, chargement, recharger: magasin.recharger }
}
