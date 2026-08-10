# helper-ocsge -----------------------------------------------------------------
# Les fixtures partagées de l'ingestion OCS-GE (issue #234, amendée par #243) :
# un PETIT GPKG réel écrit avec sf::st_write (le même motif que
# helper-fixture-geometrie.R, mais un vrai GeoPackage — jamais un
# téléchargement, jamais le réseau dans la boucle de test) portant la couche
# d'ÉTAT officielle de l'IGN dans SA FORME RÉELLE vérifiée à la première
# livraison (2026-08-09 — le produit millésimé « surfaces artificialisées » :
# la couche `artif_{millesime}_{departement}`, les colonnes id / code_cs /
# code_us / millesime / source / ossature / id_origine / code_or / aire /
# artif / crit_seuil, la surface `aire` en m², EPSG:2154), et la couche des
# LIMITES COMMUNALES du fixture (l'INSEE dans la colonne `code`). Quelques
# polygones d'état TRAVERSENT les frontières communales pour prouver la
# pondération par la surface : un polygone entièrement dans une commune lui
# donne sa pleine mesure, un polygone qui coupe la frontière donne à A et B
# leurs tranches pondérées. Le millésime est PARAMÉTRABLE : chaque archive
# porte un seul millésime (la règle « la fenêtre dérive de la donnée » est
# testée en écrivant des couches à d'autres millésimes, jamais codés en dur).

# polygone_rectangle : la matrice de coordonnées d'un rectangle axis-aligned
# (la forme des polygones du fixture — des surfaces exactes, arithmétique
# propre pour les tranches pondérées).
polygone_rectangle <- function(x0, y0, x1, y1) {
  rbind(c(x0, y0), c(x1, y0), c(x1, y1), c(x0, y1), c(x0, y0))
}

# fixture_communes_ocsge : les limites communales du fixture, une grille 2x2 de
# carrés de 100 m de côté (10 000 m² chacun), placés dans l'ordre des codes.
# Par défaut une commune par département breton (les quatre quartiers) ; les
# tests de la fonction pure demandent deux communes adjacentes du MÊME
# département (ex. c("22001", "22002")) pour les tranches pondérées. La couche
# porte code_insee_du_departement (la forme du référentiel Admin Express — le
# découpage par département de l'agrégation OCS-GE en a besoin, #243).
fixture_communes_ocsge <- function(codes = c("22001", "29001", "35001", "56001")) {
  quartiers <- list(
    c(0, 0, 100, 100),     # le quartier bas-gauche
    c(100, 0, 200, 100),   # le quartier bas-droit
    c(0, 100, 100, 200),   # le quartier haut-gauche
    c(100, 100, 200, 200)  # le quartier haut-droit
  )
  geom <- lapply(seq_along(codes), function(i) {
    q <- quartiers[[i]]
    sf::st_polygon(list(polygone_rectangle(q[1], q[2], q[3], q[4])))
  })
  sf::st_sf(code = codes,
            code_insee_du_departement = substr(codes, 1, 2),
            geometry = sf::st_sfc(geom, crs = 2154))
}

# lignes_fixture_etat : la table des polygones d'ÉTAT du fixture, en
# coordonnées de base (x0,y0,x1,y1), chaque ligne avec son statut artif et sa
# surface OFFICIELLE `aire` en m² (la forme du produit réel, 2026-08-09) :
#   P1 — entièrement dans la commune A : artif, aire 400 = la géométrie
#        (400 m²) ;
#   P2 — TRAVERSE la frontière A|B (80..120 en x, la frontière est à x=100) :
#        artif, aire 1600 = la géométrie (la moitié dans A, la moitié dans B) ;
#   P3 — entièrement dans la commune B : NON artif, aire 400 — un polygone qui
#        ne compte pas (le statut est le résultat officiel : jamais une
#        superposition brute) ;
#   P4 — entièrement dans la commune A : artif, aire 600 pour une géométrie de
#        400 m² — la MESURE OFFICIELLE (aire) diffère de la géométrie : c'est
#        elle qui est distribuée (jamais la géométrie re-dérivée — la mesure de
#        l'État est lue, pas recalculée).
lignes_fixture_etat <- function() {
  tibble::tribble(
    ~x0, ~y0, ~x1, ~y1, ~artif, ~aire,
    20, 20, 40, 40, "artif", 400,
    80, 20, 120, 60, "artif", 1600,
    150, 50, 170, 70, "non artif", 400,
    30, 70, 50, 90, "artif", 600
  )
}

# fixture_gpkg_ocsge : écrit un VRAI GeoPackage (layer
# artif_{millesime}_{departement}, EPSG:2154) au chemin demandé, avec les
# colonnes officielles du produit millésimé « surfaces artificialisées » IGN
# dans SA FORME RÉELLE (2026-08-09 — id / code_cs / code_us / millesime /
# source / ossature / id_origine / code_or / aire / artif / crit_seuil) pour
# le millésime et le département demandés. `dx`/`dy` décalent les polygones
# (les tests du builder placent chaque département dans son propre quartier) ;
# `polygones` = NULL utilise la spec par défaut (lignes_fixture_etat), un
# tibble personnalisé écrit ses polygones (la forme x0,y0,x1,y1,artif,aire).
# Retourne le chemin écrit.
fixture_gpkg_ocsge <- function(chemin, millesime, departement,
                               dx = 0, dy = 0, polygones = NULL) {
  if (is.null(polygones)) polygones <- lignes_fixture_etat()
  lignes <- polygones
  geometries <- lapply(seq_len(nrow(lignes)), function(i) {
    l <- lignes[i, ]
    sf::st_polygon(list(polygone_rectangle(
      l$x0 + dx, l$y0 + dy, l$x1 + dx, l$y1 + dy
    )))
  })
  tbl <- tibble::tibble(
    id = paste0("OCSGE", sprintf("%07d", seq_len(nrow(lignes)))),
    code_cs = "CS1.1.1.1",
    code_us = "US5",
    millesime = as.character(millesime),
    source = "calcul",
    ossature = 0,
    id_origine = "NC",
    code_or = "NC",
    aire = as.double(lignes$aire),
    artif = lignes$artif,
    crit_seuil = FALSE
  )
  couche <- sf::st_sf(tbl, geometry = sf::st_sfc(geometries, crs = 2154))
  if (file.exists(chemin)) unlink(chemin)
  sf::st_write(couche, chemin,
               layer = paste0("artif_", millesime, "_", departement),
               quiet = TRUE)
  invisible(chemin)
}

# mini_7z : un faux .7z — les six octets de signature 7-Zip (« 37 7A BC AF 27
# 1C ») plus du remplissage. Assez pour verifier_fichier (qui ne vérifie que
# la signature — la seule vérification possible sans dépendance) ; jamais un
# vrai archive, juste le contrat de forme du cache.
mini_7z <- function() {
  c(as.raw(c(0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c)), as.raw(rep(0x00, 32)))
}
