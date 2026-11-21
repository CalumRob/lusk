# Apply declared bases to every MANIFEST_* object (issue #1103) ------------------
# At load time, after every manifest has been assembled, attach the explicit
# `vintage_basis` column declared in 00_source_basis.R. One registry is the
# single source of truth: an id shared by several manifests (epci, serie_
# historique, ...) gets one basis, and a new source without a declaration makes
# the package fail to load rather than inherit a silent default.
ns <- environment()
noms_manifestes <- ls(ns, all.names = TRUE)
noms_manifestes <- noms_manifestes[grepl("^MANIFEST_[A-Z0-9_]+$", noms_manifestes)]
for (nom_manifeste in noms_manifestes) {
  objet_manifeste <- get(nom_manifeste, envir = ns, inherits = FALSE)
  if (inherits(objet_manifeste, "tbl_df")) {
    assign(nom_manifeste, declarer_bases(objet_manifeste), envir = ns)
  }
}
rm(ns, noms_manifestes, nom_manifeste, objet_manifeste)
