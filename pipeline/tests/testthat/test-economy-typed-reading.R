test_that("canonical Economy reading preserves the producer's populated top-five order", {
  history <- data.frame(territoire="35238",type="commune",theme="economie",
    groupe="sante-et-taille",story_key="ce-que-la-commune-abrite",
    salience_reason="defaut",top1_activity_code="A",top1_activity_label="Alpha",
    top1_lq=2,top1_n=5L,top1_part_parc=NA_real_,
    top2_activity_code="C",top2_activity_label="Gamma",top2_lq=1.5,
    top2_n=2L,top2_part_parc=NA_real_,stringsAsFactors=FALSE)
  for (rank in 3:5) {
    history[[paste0("top",rank,"_activity_code")]] <- NA_character_
    history[[paste0("top",rank,"_activity_label")]] <- NA_character_
    history[[paste0("top",rank,"_lq")]] <- NA_real_
    history[[paste0("top",rank,"_n")]] <- NA_integer_
    history[[paste0("top",rank,"_part_parc")]] <- NA_real_
  }
  vintage <- data.frame(id="sirene_snapshot",source="Région Bretagne",version="2026-04",
    date_reference="2026-03-31",date_publication="2026-05-01",stringsAsFactors=FALSE)
  metadata <- list(sources=list(eco_activites="sirene_snapshot"),subgroups=list(list(
    key="sante-et-taille",reading=list(story_key="ce-que-la-commune-abrite"))))
  projected <- project_economy_reading(history,vintage,metadata)
  expect_equal(projected$story_key,"ce-que-la-commune-abrite")
  expect_equal(projected$groupe,"sante-et-taille")
  expect_equal(projected$status,"measured")
  expect_equal(unlist(projected[1,paste0("top",1:2,"_activity_code")],use.names=FALSE),c("A","C"))
  expect_equal(projected$top1_lq,2)
  expect_equal(projected$top1_n,5L)
  expect_true(is.na(projected$top1_part_parc))
  expect_error(project_economy_reading(history,vintage,modifyList(metadata,list(sources=list(eco_activites="wrong_source")))),
    "unique economy source clock")
})
