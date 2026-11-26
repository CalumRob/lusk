test_that("positional IN placeholders have ONE shared definition", {
  expect_identical(in_params(c("a", "b", "c")), "$1,$2,$3")
  expect_identical(in_params("a"), "$1")
  expect_identical(in_params(c("a", "b"), start = 3L), "$3,$4")
  clause <- clause_in_positionnelle(c("s", "s", NA, "t"), "source_id")
  expect_identical(clause$where, " WHERE source_id IN ($1,$2)")
  expect_identical(clause$params, list("s", "t"))
  expect_null(clause_in_positionnelle(character(), "source_id"))
  paires <- data.frame(source_id = c("s", "t"), vintage_id = c("v1", "v2"))
  p <- clause_paires_positionnelle(paires, c("source_id", "vintage_id"))
  expect_identical(p$where, "(source_id=$1 AND vintage_id=$2) OR (source_id=$3 AND vintage_id=$4)")
  expect_identical(p$params, list("s", "v1", "t", "v2"))
})

test_that("no other function in pipeline/R builds $-placeholders", {
  racine <- testthat::test_path("..", "..", "R")
  fichiers <- list.files(racine, pattern = "\\.R$", full.names = TRUE)
  fichiers <- fichiers[basename(fichiers) != "sql_positionnels.R"]
  # A $n placeholder BUILDER concatenates a "$" (or "=$") literal with a counter:
  # paste0("$", seq...), paste0("(a=$", i ...), sprintf("...$%d").
  motif <- paste0('paste0?\\(\\s*["\'][^"\']*\\$["\']\\s*,|sprintf\\(\\s*["\'][^"\']*\\$%[0-9]*d')
  for (fichier in fichiers) {
    lignes <- readLines(fichier, warn = FALSE, encoding = "UTF-8")
    lignes <- lignes[!grepl("^\\s*#", lignes)]
    # Regex-escape idioms such as paste0("_", mode, "$") end a pattern, they do not
    # build placeholders: only a "$" literal that is FOLLOWED by an argument counts.
    vus <- grep(motif, lignes, value = TRUE)
    vus <- vus[!grepl('"\\$"\\s*,\\s*"",|,\\s*"\\$"\\)', vus)]
    expect_length(vus, 0L)
    if (length(vus)) message(basename(fichier), ": ", paste(vus, collapse = " | "))
  }
})
