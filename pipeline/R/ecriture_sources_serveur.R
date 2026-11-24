# Écriture partagée des sources et vintages de service (ADR-0049 step 2,
# #1137/#1138 review). UNE seule écriture par table : `source_dataset` et
# `source_vintage` sont écrits ICI, jamais dupliqués dans un adaptateur de forme
# ou un publisher historique. Tout `params` est positionnel et sans nom
# (RPostgres refuse une liste nommée) ; tout guillemetage passe par
# DBI::dbQuoteString — aucun littéral SQL fabriqué à la main.

# PostgreSQL array literal for DBI COPY/parameters. NULL, NA and empty vectors
# are SQL NULL (never '{}'): absent arrays must not masquerade as an empty
# array. Values in these contracts are closed enums/numbers, but quote/escape
# defensively so no list/raw column can reach COPY as bytea.
litteral_tableau_postgres <- function(x) {
  if (is.null(x)) return(NA_character_)
  x <- as.character(unlist(x, use.names = FALSE))
  if (!length(x) || anyNA(x)) return(NA_character_)
  besoin <- grepl('[^[:alnum:]_.:-]', x)
  x[besoin] <- paste0('"', gsub('\\', '\\\\', x[besoin], fixed = TRUE),
                     gsub('"', '\\"', x[besoin], fixed = TRUE), '"')
  paste0("{", paste(x, collapse = ","), "}")
}

.quoter_sql_serveur <- function(con, x) {
  if (length(x) == 1L && is.na(x)) return("NULL")
  as.character(DBI::dbQuoteString(con, as.character(x)))
}

# `conflict = "nothing"` (adaptateur scalaire) préserve toute ligne existante ;
# `conflict = "update"` (profil, publishers historiques) rafraîchit le libellé.
.ecrire_sources_serveur <- function(con, datasets, vintages,
                                    conflict = c("nothing", "update")) {
  conflict <- match.arg(conflict)
  sql_source <- if (identical(conflict, "update"))
    "INSERT INTO source_dataset(source_id,name) VALUES($1,$2) ON CONFLICT(source_id) DO UPDATE SET name=EXCLUDED.name"
  else
    "INSERT INTO source_dataset(source_id,name) VALUES($1,$2) ON CONFLICT(source_id) DO NOTHING"
  sql_vintage <- if (identical(conflict, "update"))
    "INSERT INTO source_vintage(source_id,vintage_id,version,reference_date,publication_date) VALUES($1,$2,$3,$4,$5) ON CONFLICT(source_id,vintage_id) DO UPDATE SET version=EXCLUDED.version,reference_date=EXCLUDED.reference_date,publication_date=EXCLUDED.publication_date"
  else
    "INSERT INTO source_vintage(source_id,vintage_id,version,reference_date,publication_date) VALUES($1,$2,$3,$4,$5) ON CONFLICT(source_id,vintage_id) DO NOTHING"
  if (!is.null(datasets)) for (i in seq_len(nrow(datasets))) {
    d <- datasets[i, , drop = FALSE]
    DBI::dbExecute(con, sql_source,
                   params = unname(as.list(d[c("source_id", "name")])))
  }
  if (!is.null(vintages)) for (i in seq_len(nrow(vintages))) {
    v <- vintages[i, , drop = FALSE]
    DBI::dbExecute(con, sql_vintage,
                   params = unname(as.list(v[c("source_id", "vintage_id", "version",
                                                 "reference_date", "publication_date")])))
  }
  invisible(TRUE)
}
