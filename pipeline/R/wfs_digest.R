# wfs_digest — empreinte canonique des lectures WFS (issue #1119) ----------------
#
# Une réponse GetFeature de data.geopf.fr (Admin Express, fond de carte ADR-0008
# comme référentiel des limites communales `communes_limites`) porte une enveloppe
# VOLATILE : `timeStamp` change à chaque requête — mesuré le 2026-11-22, deux
# fetches à 2 s d'écart ne différaient QUE par ce membre — et `numberMatched` /
# `numberReturned` suivent la charge. Hacher la réponse brute rendait l'empreinte
# instable : le gel de release (ADR-0048, décision 5) refusait TOUTE publication,
# deux rebuilds à froid ne pouvaient pas produire le même digest, et une
# attribution de dérive blâmait la géométrie à chaque run.
#
# UN SEUL helper possède le hachage d'une collection WFS : il hache les FEATURES
# (la donnée), sérialisées déterministiquement, JAMAIS l'enveloppe de transport.
# Tout lecteur WFS du pipeline — publier_geometrie() et resoudre_source() pour
# communes_limites — passe par ici. `bytes` est la taille de cette représentation
# canonique (ce qui est effectivement haché), pas celle de la réponse brute.

# empreinte_wfs_features ---------------------------------------------------------
empreinte_wfs_features <- function(collection) {
  if (!is.list(collection) || !is.list(collection$features)) {
    stop(
      "Collection WFS invalide : une FeatureCollection avec `features` est attendue.",
      call. = FALSE
    )
  }
  canonique <- jsonlite::toJSON(
    collection$features,
    auto_unbox = TRUE, digits = NA, null = "null", na = "null"
  )
  list(
    sha256 = paste(openssl::sha256(charToRaw(canonique))),
    bytes = as.numeric(nchar(canonique, type = "bytes")),
    hachage = "features_wfs_canoniques"
  )
}

# --- Hachage d'un fichier du cache ---------------------------------------------
# Un « hacheur » renvoie toujours {sha256, bytes, hachage} : `bytes` est la
# taille de CE QUI EST HACHÉ (octets bruts ou features canoniques). La taille
# brute du fichier reste portée à part par le digest (`fichier_octets`) pour la
# validité du sidecar — les deux ne doivent pas être confondus.

empreinte_fichier_brut <- function(chemin) {
  list(
    sha256 = empreinte_fichier(chemin),
    bytes = as.numeric(file.size(chemin)),
    hachage = "octets_bruts"
  )
}

# communes_limites.geojson est téléchargé sur le MÊME WFS que le fond de carte :
# son enveloppe porte le même timeStamp volatile. On laisse les octets du fichier
# INTACTS (c'est le contrat du cache) et on ne canonise que l'empreinte.
empreinte_fichier_wfs <- function(chemin) {
  collection <- jsonlite::fromJSON(chemin, simplifyVector = FALSE)
  empreinte_wfs_features(collection)
}

# HACHAGE_WFS_PAR_ID -------------------------------------------------------------
# Les sources de MANIFEST_* dont le fichier cache est une réponse GetFeature
# GeoJSON. Registre par id, comme VINTAGE_BASIS_PAR_ID : aucun défaut implicite —
# une nouvelle lecture WFS doit être déclarée ici (et couverte par un test).
HACHAGE_WFS_PAR_ID <- c(communes_limites = "empreinte_fichier_wfs")

# Le hacheur d'une source, résolu au point d'usage (pas de dépendance Collate).
empreinte_source <- function(id) {
  nom <- unname(HACHAGE_WFS_PAR_ID[as.character(id)])
  if (length(nom) != 1L || is.na(nom) || !nzchar(nom)) {
    return(empreinte_fichier_brut)
  }
  get(nom, envir = asNamespace("lusk"), mode = "function", inherits = FALSE)
}
