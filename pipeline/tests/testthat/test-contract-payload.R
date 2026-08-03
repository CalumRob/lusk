# Le SEAM de test : la forme du payload de la fiche (docs/architecture.md).
# ROUGE par conception — compute_payload() arrive avec les tickets 3-4
# (issues #4 et #5). Ce test EST la spécification du contrat qu'ils doivent
# satisfaire : même fixture -> même payload, pour toujours.

test_that("le payload couvre chaque territoire du fixture", {
  payload <- compute_payload(load_fixture())

  territoires_attendus <- c(
    "22001", "22002", "29001", "29002", # communes
    "200000001", "200000002",           # EPCIs
    "22", "29",                         # départements
    "53"                                # région Bretagne
  )
  expect_setequal(names(payload$territoires), territoires_attendus)
})

test_that("chaque territoire porte le bloc démographie : 4 indicateurs + Histoire", {
  payload <- compute_payload(load_fixture())

  for (code in names(payload$territoires)) {
    themes <- payload$territoires[[code]]$themes
    expect_true("demographie" %in% names(themes), info = code)
    bloc <- themes$demographie

    expect_length(bloc$indicateurs, 4, info = code)
    for (indicateur in bloc$indicateurs) {
      expect_named(
        indicateur,
        c("key", "value", "unit", "rank_in_context", "vintage"),
        info = code
      )
      expect_named(indicateur$vintage, c("source", "version", "date"))
    }

    expect_named(bloc$histoire, c("key", "soldes", "classification"))
  }
})
