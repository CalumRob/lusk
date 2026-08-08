# helper-ocsge -----------------------------------------------------------------
# Les fixtures partagées de l'ingestion OCS-GE (issue #234) : un PETIT GPKG
# réel écrit avec sf::st_write (le même motif que helper-fixture-geometrie.R,
# mais un vrai GeoPackage — jamais un téléchargement, jamais le réseau dans la
# boucle de test) portant la couche différentielle officielle de l'IGN (les
# colonnes de Doc_artif.pdf : Id_*/Cs_*/Us_*/Artif_* aux deux millésimes,
# Artificialisation +1/-1, Surface en m²), et la couche des LIMITES COMMUNALES
# du fixture (l'INSEE dans la colonne `code`). Quelques polygones d'artificialisation
# TRAVERSENT les frontières communales pour prouver la pondération par la
# surface : un polygone entièrement dans une commune lui donne sa pleine
# mesure, un polygone qui coupe la frontière donne à A et B leurs tranches
# pondérées. La fenêtre des millésimes est PARAMÉTRABLE (m2/m3) : la règle
# « la fenêtre dérive de la donnée » est testée en écrivant des couches à
# d'autres millésimes, jamais codés en dur.

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
# département (ex. c("22001", "22002")) pour les tranches pondérées.
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
            geometry = sf::st_sfc(geom, crs = 2154))
}

# lignes_fixture_ocsge : la table des polygones de flux du fixture, en
# coordonnées de base (x0,y0,x1,y1), chaque ligne avec son sens et sa Surface
# OFFICIELLE en m² :
#   P1 — entièrement dans la commune A : Non Artif -> Artif (artificialisation),
#        Surface 400 = la géométrie (400 m²) ;
#   P2 — TRAVERSE la frontière A|B (80..120 en x, la frontière est à x=100) :
#        Artif -> Non Artif (désartificialisation), Surface 1600 = la géométrie
#        (la moitié dans A, la moitié dans B) ;
#   P3 — entièrement dans la commune B : Non Artif -> Artif, Surface 400 ;
#   P4 — entièrement dans la commune A : Non Artif -> Artif, Surface 600 pour
#        une géométrie de 400 m² — la MESURE OFFICIELLE (Surface) diffère de la
#        géométrie : c'est elle qui est distribuée (jamais la géométrie
#        re-dérivée — la mesure de l'État est lue, pas recalculée).
lignes_fixture_ocsge <- function() {
  tibble::tribble(
    ~x0, ~y0, ~x1, ~y1, ~statut_m2, ~statut_m3, ~sens, ~surface,
    20, 20, 40, 40, "Non Artif", "Artif", 1L, 400,
    80, 20, 120, 60, "Artif", "Non Artif", -1L, 1600,
    150, 50, 170, 70, "Non Artif", "Artif", 1L, 400,
    30, 70, 50, 90, "Non Artif", "Artif", 1L, 600
  )
}

# fixture_gpkg_ocsge : écrit un VRAI GeoPackage (layer
# COUCHE_OCSGE_ARTIFICIALISATION, EPSG:2154) au chemin demandé, avec les
# colonnes officielles du différentiel IGN (Doc_artif.pdf) pour la fenêtre
# (m2, m3) — les statuts Artif_{m2}/Artif_{m3}, le sens Artificialisation
# (+1/-1) et Surface (m²). `dx`/`dy` décalent les polygones (les tests du
# builder placent chaque département dans son propre quartier) ; `complet`
# = FALSE écrit le seul polygone P1 (le builder testé sur une géométrie
# simple par département). Retourne le chemin écrit.
fixture_gpkg_ocsge <- function(chemin, m2, m3, dx = 0, dy = 0, complet = TRUE) {
  lignes <- lignes_fixture_ocsge()
  if (!complet) lignes <- lignes[1, ]
  geometries <- lapply(seq_len(nrow(lignes)), function(i) {
    l <- lignes[i, ]
    sf::st_polygon(list(polygone_rectangle(
      l$x0 + dx, l$y0 + dy, l$x1 + dx, l$y1 + dy
    )))
  })
  tbl <- tibble::tibble(
    !!paste0("Id_", m2) := paste0("S", seq_len(nrow(lignes)), "_", m2),
    !!paste0("Cs_", m2) := "CS1.1.1.1",
    !!paste0("Us_", m2) := "US5",
    !!paste0("Artif_", m2) := lignes$statut_m2,
    !!paste0("Id_", m3) := paste0("S", seq_len(nrow(lignes)), "_", m3),
    !!paste0("Cs_", m3) := "CS1.1.1.1",
    !!paste0("Us_", m3) := "US5",
    !!paste0("Artif_", m3) := lignes$statut_m3,
    Artificialisation = lignes$sens,
    Surface = as.double(lignes$surface)
  )
  couche <- sf::st_sf(tbl, geometry = sf::st_sfc(geometries, crs = 2154))
  if (file.exists(chemin)) unlink(chemin)
  sf::st_write(couche, chemin, layer = COUCHE_OCSGE_ARTIFICIALISATION,
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
