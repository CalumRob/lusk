# Planted-violation matrix for the structural audits (#1172 review).
# Table cases are derived from the constant the serving-write audit uses, so a
# new shape family from #1173 automatically receives SQL and dbWriteTable proofs.

racine_audit_plantee <- function(lignes, sous = "R") {
  d <- tempfile("audit-plante-")
  dir.create(file.path(d, sous), recursive = TRUE)
  writeLines(lignes, file.path(d, sous, "violation.R"))
  d
}

tester_regle_audit <- function(nom, lignes, audit, verificateur, message,
                               pred_id = NULL, sous = "R") {
  test_that(nom, {
    d <- racine_audit_plantee(lignes, sous = sous)
    on.exit(unlink(d, recursive = TRUE), add = TRUE)
    sites <- audit(d)
    if (is.null(pred_id)) {
      expect_true(nrow(sites) > 0L, info = nom)
    } else {
      fautes <- sites[pred_id(sites), , drop = FALSE]
      expect_true(nrow(fautes) > 0L, info = nom)
    }
    expect_error(verificateur(d), message, info = nom)
  })
}

# --- Serving connections: direct, bare, multiline and do.call -----------------

tester_regle_audit(
  "serving connection proof — DBI::dbConnect",
  "f <- function() DBI::dbConnect(RPostgres::Postgres())",
  auditer_appels_db, verifier_structure_gel, "serving-DB call site",
  function(x) !x$garde & !x$autorise
)
tester_regle_audit(
  "serving connection proof — bare dbConnect",
  "f <- function() dbConnect(RPostgres::Postgres())",
  auditer_appels_db, verifier_structure_gel, "serving-DB call site",
  function(x) !x$garde & !x$autorise
)
tester_regle_audit(
  "serving connection proof — multiline DBI::dbConnect",
  c("f <- function() {", "  DBI::dbConnect(", "    RPostgres::Postgres(),", "    dbname = 'lusk'", "  )", "}"),
  auditer_appels_db, verifier_structure_gel, "serving-DB call site",
  function(x) !x$garde & !x$autorise
)
tester_regle_audit(
  "serving connection proof — do.call(DBI::dbConnect)",
  "f <- function() do.call(DBI::dbConnect, list(RPostgres::Postgres(), dbname = 'lusk'))",
  auditer_appels_db, verifier_structure_gel, "serving-DB call site",
  function(x) !x$garde & !x$autorise
)
tester_regle_audit(
  "serving connection proof — configuration_service_postgres",
  "f <- function() configuration_service_postgres()",
  auditer_appels_db, verifier_structure_gel, "serving-DB call site",
  function(x) !x$garde & !x$autorise
)

# --- Guard calls: explicit sortie remains mandatory -----------------------------

tester_regle_audit(
  "guard-call proof — bare verifier_gel_release()",
  "f <- function() verifier_gel_release()",
  auditer_appels_garde, verifier_structure_garde, "without an explicit sortie",
  function(x) x$sans_argument
)
tester_regle_audit(
  "guard-call proof — multiline namespaced call",
  c("f <- function() {", "  lusk::verifier_gel_release(", "  )", "}"),
  auditer_appels_garde, verifier_structure_garde, "without an explicit sortie",
  function(x) x$sans_argument
)
tester_regle_audit(
  "guard-call proof — do.call with an empty argument list",
  "f <- function() do.call(verifier_gel_release, list())",
  auditer_appels_garde, verifier_structure_garde, "without an explicit sortie",
  function(x) x$sans_argument
)

# --- Serving writes: every pattern in TABLES_SERVICE × every call form ----------

nom_table_audit <- function(motif) {
  if (endsWith(motif, "_")) paste0(motif, "audit") else motif
}

formes_ecriture_audit <- list(
  sql_bare = function(table) c(
    "f <- function(con) {", paste0("  dbExecute(con, 'DELETE FROM ", table, "')"), "}"
  ),
  sql_namespaced_multiline = function(table) c(
    "f <- function(con) {", "  DBI::dbExecute(", "    con,",
    paste0("    'INSERT INTO ", table, " DEFAULT VALUES'"), "  )", "}"
  ),
  write_bare = function(table) c(
    "f <- function(con, value) {", paste0("  dbWriteTable(con, '", table, "', value)"), "}"
  ),
  append_namespaced = function(table) c(
    "f <- function(con, value) {", paste0("  DBI::dbAppendTable(con, '", table, "', value)"), "}"
  ),
  do_call_write = function(table) c(
    "f <- function(con, value) {",
    paste0("  do.call(DBI::dbWriteTable, list(con, '", table, "', value))"), "}"
  )
)

for (motif in strsplit(TABLES_SERVICE, "|", fixed = TRUE)[[1L]]) {
  table <- nom_table_audit(motif)
  for (nom_forme in names(formes_ecriture_audit)) {
    tester_regle_audit(
      paste("serving-write proof", motif, nom_forme),
      formes_ecriture_audit[[nom_forme]](table),
      auditer_ecritures_serveur, verifier_structure_ecritures_serveur,
      "outside a shape adapter", function(x) !x$autorise
    )
  }
}

# --- DBI named params: direct, bare, multiline and do.call ----------------------

tester_regle_audit(
  "DBI params proof — namespaced named list",
  "f <- function(con) DBI::dbExecute(con, 'SELECT 1', params = list(name = 1))",
  auditer_params_dbi, verifier_params_dbi_positionnels, "named `params`"
)
tester_regle_audit(
  "DBI params proof — bare as.list",
  "f <- function(con) dbGetQuery(con, 'SELECT 1', params = as.list(c('a', 'b')))",
  auditer_params_dbi, verifier_params_dbi_positionnels, "named `params`"
)
tester_regle_audit(
  "DBI params proof — multiline named list",
  c("f <- function(con) {", "  DBI::dbSendQuery(", "    con, 'SELECT 1',",
    "    params = list(", "      name = 1", "    )", "  )", "}"),
  auditer_params_dbi, verifier_params_dbi_positionnels, "named `params`"
)
tester_regle_audit(
  "DBI params proof — do.call named list",
  "f <- function(con) do.call(DBI::dbExecute, list(con, 'SELECT 1', params = list(name = 1)))",
  auditer_params_dbi, verifier_params_dbi_positionnels, "named `params`"
)

# --- WFS envelope hashing: direct, bare, multiline and do.call ------------------

tester_regle_audit(
  "WFS hash proof — namespaced direct call",
  "f <- function(reponse) openssl::sha256(charToRaw(jsonlite::toJSON(reponse)))",
  auditer_hachages_wfs, verifier_structure_hachages_wfs, "raw GetFeature envelope",
  function(x) x$enveloppe & !x$autorise
)
tester_regle_audit(
  "WFS hash proof — bare multiline call",
  c("f <- function(reponse) {", "  sha256(", "    charToRaw(toJSON(", "      reponse", "    ))",
    "  )", "}"),
  auditer_hachages_wfs, verifier_structure_hachages_wfs, "raw GetFeature envelope",
  function(x) x$enveloppe & !x$autorise
)
tester_regle_audit(
  "WFS hash proof — do.call(openssl::sha256)",
  "f <- function(reponse) do.call(openssl::sha256, list(charToRaw(jsonlite::toJSON(reponse))))",
  auditer_hachages_wfs, verifier_structure_hachages_wfs, "raw GetFeature envelope",
  function(x) x$enveloppe & !x$autorise
)

# --- Network reads: every detected function, bare/namespaced/multiline/do.call --

formes_reseau_audit <- list(
  "httr2::request" = "f <- function() httr2::request('https://example.test')",
  "utils::download.file" = "f <- function() utils::download.file('https://example.test')",
  "download.file" = "f <- function() download.file('https://example.test')",
  "httr2::req_perform" = "f <- function() httr2::req_perform(httr2::request('https://example.test'))",
  "req_perform" = "f <- function() req_perform(request('https://example.test'))",
  "httr::GET" = "f <- function() httr::GET('https://example.test')",
  "GET" = "f <- function() GET('https://example.test')",
  "curl_fetch" = "f <- function() curl_fetch('https://example.test')",
  "url" = "f <- function() url('https://example.test')",
  "st_read" = "f <- function() st_read('https://example.test/data.geojson')",
  "read_csv" = "f <- function() read_csv('https://example.test/data.csv')",
  "fromJSON" = "f <- function() fromJSON('https://example.test/data.json')"
)
for (nom_forme in names(formes_reseau_audit)) {
  tester_regle_audit(
    paste("network-read proof", nom_forme), formes_reseau_audit[[nom_forme]],
    auditer_appels_reseau, verifier_structure_reseau, "undeclared network read",
    function(x) !x$autorise
  )
}
tester_regle_audit(
  "network-read proof — multiline httr2::request",
  c("f <- function() {", "  httr2::request(", "    'https://example.test'", "  )", "}"),
  auditer_appels_reseau, verifier_structure_reseau, "undeclared network read",
  function(x) !x$autorise
)
tester_regle_audit(
  "network-read proof — do.call(utils::download.file)",
  "f <- function() do.call(utils::download.file, list('https://example.test'))",
  auditer_appels_reseau, verifier_structure_reseau, "undeclared network read",
  function(x) !x$autorise
)
tester_regle_audit(
  "network-read proof — do.call(httr2::req_perform)",
  "f <- function(req) do.call(httr2::req_perform, list(req))",
  auditer_appels_reseau, verifier_structure_reseau, "undeclared network read",
  function(x) !x$autorise
)
