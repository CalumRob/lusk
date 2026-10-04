test_that("Habitat typed readings retain values and classify source states", {
  histories <- data.frame(
    territoire=c("35238","22006","22007"), type="commune", theme="habitat",
    groupe="etat-energetique-du-parc", story_key="etat-energetique-du-parc",
    salience_reason="defaut", classification=c("parc-intermediaire",NA,NA),
    part_passoires=c(.05,NA,NA), part_abc=c(.48,NA,NA), n_dpe=c(100,24,NA),
    stringsAsFactors=FALSE)
  vintages <- data.frame(id="dpe_22",source="ADEME — Observatoire DPE, logements existants",
    version="2026-08-11",date_reference=NA_character_,date_publication="2026-08-11",
    stringsAsFactors=FALSE)

  metadata <- list(indicator_sources=list(part_passoires="dpe_22"),
    scalar_contracts=list(part_passoires=list(suppressed_below=30)))
  facts <- project_habitat_reading(histories,vintages,metadata)

  expect_equal(facts$status,c("measured","suppressed","unavailable"))
  expect_equal(facts$classification[[1]],"parc-intermediaire")
  expect_equal(facts$part_passoires[[1]],.05)
  expect_equal(facts$n_dpe,c(100,24,NA))
  expect_equal(facts$source_id,rep("dpe_22",3))
  expect_equal(facts$vintage_id,rep("dpe_22",3))
  expect_equal(attr(facts,"vintage")$version,"2026-08-11")
  expect_true(is.na(attr(facts,"vintage")$date_reference))
})
