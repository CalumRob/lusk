test_that("Habitat typed readings retain values and classify source states", {
  histories <- data.frame(
    territoire=c("35238","22006","22007","22008"), type="commune", theme="habitat",
    groupe="etat-energetique-du-parc", story_key="etat-energetique-du-parc",
    salience_reason="defaut", classification=c("parc-intermediaire",NA,NA,NA),
    part_passoires=c(.05,NA,NA,NA), part_abc=c(.48,NA,NA,NA), n_dpe=c(100,24,NA,0),
    stringsAsFactors=FALSE)
  vintages <- data.frame(id="dpe_22",source="ADEME — Observatoire DPE, logements existants",
    version="2026-08-11",date_reference=NA_character_,date_publication="2026-08-11",
    stringsAsFactors=FALSE)

  metadata <- list(sources=list(part_passoires="dpe_22"),
    scalar_contracts=list(part_passoires=list(suppressed_below=30,zero_support_status="not_available")))
  facts <- project_habitat_reading(histories,vintages,metadata)

  expect_equal(facts$status,c("measured","suppressed","unavailable","unavailable"))
  expect_equal(facts$classification[[1]],"parc-intermediaire")
  expect_equal(facts$part_passoires[[1]],.05)
  expect_equal(facts$n_dpe,c(100,24,NA,0))
  expect_equal(facts$source_id,rep("dpe_22",4))
  expect_equal(facts$vintage_id,rep("2026-08-11/NA",4))
  expect_equal(attr(facts,"vintage")$version,"2026-08-11")
  expect_true(is.na(attr(facts,"vintage")$date_reference))
})

test_that("demographic reading identities exactly match the supported territory reference", {
  histories <- data.frame(territoire=c("a","b"),type="commune",theme="demographie",
    groupe="solde",story_key="solde",salience_reason="defaut",periode="2020-2021",
    solde_naturel=c(1,2),solde_migratoire=c(3,4),taux_solde_naturel=c(1,2),
    taux_solde_migratoire=c(3,4),classification="stable",stringsAsFactors=FALSE)
  territories <- data.frame(territoire=c("a","b"),type="commune",stringsAsFactors=FALSE)
  vintages <- data.frame(id="serie_historique",source="INSEE",version="v1",
    date_reference="2021-01-01",date_publication="2022-01-01")
  metadata <- list(param_labels=list(taux_solde_naturel="Taux (‰/an)"))
  expect_s3_class(project_demographic_reading(histories,territories,vintages,metadata),"data.frame")
  expect_s3_class(project_demographic_reading(histories[1,,drop=FALSE],territories[1,,drop=FALSE],vintages,metadata),"data.frame")
  expect_error(project_demographic_reading(histories[1,,drop=FALSE],territories,vintages,metadata),
    "exactly match")
  omitted_replaced <- histories
  omitted_replaced$territoire[[2]] <- "unregistered"
  expect_error(project_demographic_reading(omitted_replaced,territories,vintages,metadata),"exactly match")
  duplicated <- histories
  duplicated$territoire[[2]] <- duplicated$territoire[[1]]
  expect_error(project_demographic_reading(duplicated,territories,vintages,metadata),"duplicate selected reading identity")
  wrong_typed <- histories
  wrong_typed$type[[2]] <- "epci"
  expect_error(project_demographic_reading(wrong_typed,territories,vintages,metadata),"exactly match")
  wrong_type <- territories
  wrong_type$type[[2]] <- "epci"
  expect_error(project_demographic_reading(histories,wrong_type,vintages,metadata),"exactly match")
})
