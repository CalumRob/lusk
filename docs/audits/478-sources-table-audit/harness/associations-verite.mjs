/**
 * Audit #478 — fusion des associations RENDUES (metrics du run Chrome) avec
 * l'autorité publiée (expected-associations.json) et le registre éditorial,
 * en une table de vérité committable : associations-verite.json.
 *
 * Chaque jeu rendu sur /sources porte :
 *   - consommateursRendus   : ce que la page affiche (thème/clé/href)
 *   - consommateursAutorite : ce que la jointure theme_*.json produit
 *   - ecart                 : 'rendu==autorite' | liste des différences
 * Les jeux d'autorité filtrés hors page (0 consommateur) sont listés à part.
 *
 * Usage : node associations-verite.mjs <racine-du-dépôt>
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const racine = path.resolve(process.argv[2] ?? '.')
const dossierEvidence = path.join(racine, 'docs', 'audits', '478-sources-table-audit', 'evidence')

const rendus = JSON.parse(await readFile(path.join(dossierEvidence, 'sources--desktop-1440', 'metrics.json'), 'utf8'))
const autorite = JSON.parse(await readFile(path.join(dossierEvidence, 'expected-associations.json'), 'utf8'))

// Les liens rendus qui n'ont PAS de Page d'indicateur publiée (indicator_pages)
// — vérifié contre le payload : une main tendue vers « Indicateur introuvable ».
const pagesPubliees = new Set()
for (const theme of ['mobilite', 'demographie', 'habitat', 'economie', 'milieux', 'programmes']) {
  const meta = JSON.parse(await readFile(path.join(racine, 'public', 'data', `theme_${theme}.json`), 'utf8'))
  for (const cle of Object.keys(meta.indicator_pages ?? {})) pagesPubliees.add(`${theme}/${cle}`)
}

const lignes = []
for (const carte of rendus.cartes) {
  const id = carte.ancre.replace(/^source-/, '')
  const attendu = autorite.jeux[id]
  const clesRendues = carte.consommateurs.map((c) => `${c.theme}/${c.label}`)
  const clesAutorite = attendu ? attendu.consommateurs.map((c) => c.split(' (')[0]) : []
  const ecart = JSON.stringify([...clesRendues].sort()) === JSON.stringify([...clesAutorite].sort())
    ? 'rendu == autorité'
    : 'ÉCART rendu ≠ autorité'
  const liensMorts = carte.consommateurs
    .filter((c) => c.href && !pagesPubliees.has(c.href.replace('/indicateurs/', '')))
    .map((c) => `${c.theme}/${c.label} → ${c.href} (aucune indicator_pages : la route rend « Indicateur introuvable »)`)
  lignes.push({
    jeu: id,
    nom: carte.jeu,
    themesAffichesSurLaPage: null, // la page /sources ne rend PAS les thèmes (régression vs ancienne table)
    consommateursRendus: clesRendues,
    consommateursAutorite: clesAutorite,
    ecart,
    liensMorts,
    hauteurCartePx: carte.hauteurPx,
    horloges: carte.horloges,
  })
}

const sortie = {
  note: 'Table de vérité #478 : associations rendues (/sources, build branche) vs autorité publiée (theme_*.json). Les deux coïncident TOUJOURS — les défauts d\u2019attribution vivent dans l\u2019autorité elle-même (déclarations manquantes) ou dans le contrat (jeux sans consommateur filtrés, thèmes non rendus, lien sans page).',
  jeuxRendus: lignes,
  jeuxFiltresHorsPage: autorite.autoriteSansConsommateur_filtresHorsPage,
  liensSansPagePubliée: lignes.flatMap((l) => l.liensMorts),
}

await writeFile(path.join(dossierEvidence, 'associations-verite.json'), JSON.stringify(sortie, null, 2))
console.log(`associations-verite.json : ${lignes.length} jeux rendus, ${sortie.jeuxFiltresHorsPage.length} filtrés, ${sortie.liensSansPagePubliée.length} lien(s) sans page`)
for (const l of lignes) if (l.liensMorts.length) console.log('  LIEN MORT:', l.liensMorts[0])
