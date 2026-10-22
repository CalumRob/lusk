test_that("AEDAR source registry includes every current downloadable source in one raw bundle", {
  expect_setequal(AEDAR_SOURCE_RESOURCES$filename, c(
    "address-walk-53-2026v1.parquet",
    "address-transit-gain-53-2026v1.parquet",
    "address-transit-53-2026v1.parquet",
    "address-car-53-2026v1.parquet",
    "address-bike-lts4-53-2026v1.parquet",
    "address-bike-lts2-53-2026v1.parquet",
    "aggregates-commune-53-2026v1.parquet",
    "aggregates-epci-53-2026v1.parquet",
    "aggregates-departement-53-2026v1.parquet",
    "aggregates-region-53-2026v1.parquet",
    "aedar-doc-2026v1.pdf"
  ))
  expect_equal(sum(AEDAR_SOURCE_RESOURCES$kind == "address"), 6L)
  expect_equal(sum(AEDAR_SOURCE_RESOURCES$kind == "aggregate"), 4L)
  expect_equal(sum(AEDAR_SOURCE_RESOURCES$kind == "documentation"), 1L)
  expect_true(all(nzchar(AEDAR_SOURCE_RESOURCES$url)))
  expect_true(all(grepl("^[0-9a-f]{40}$", AEDAR_SOURCE_RESOURCES$sha1)))
})

make_aedar_download_fixture <- function() {
  bytes <- charToRaw("aedar source fixture bytes")
  list(bytes=bytes, resources=data.frame(
    url="https://example.invalid/aedar.parquet", filename="fixture.parquet",
    sha1=paste(as.character(openssl::sha1(bytes)),collapse=""),
    stringsAsFactors=FALSE))
}

test_that("AEDAR source acquisition validates and atomically installs downloaded bytes", {
  fixture <- make_aedar_download_fixture()
  raw_dir <- tempfile("aedar-source-download-")
  on.exit(unlink(raw_dir,recursive=TRUE),add=TRUE)
  calls <- 0L
  downloader <- function(url,destfile,mode,quiet) {
    calls <<- calls+1L
    expect_equal(url,fixture$resources$url)
    expect_equal(mode,"wb")
    writeBin(fixture$bytes,destfile)
    0L
  }
  paths <- download_aedar_sources(raw_dir,fixture$resources,download=downloader)
  expect_equal(names(paths),fixture$resources$filename)
  expect_equal(readBin(paths[[1L]],"raw",n=100L),fixture$bytes)
  expect_false(file.exists(paste0(paths[[1L]],".part")))
  expect_equal(calls,1L)
  expect_equal(download_aedar_sources(raw_dir,fixture$resources,download=downloader),paths)
  expect_equal(calls,1L)
})

test_that("AEDAR source acquisition rejects bad downloaded or cached bytes", {
  fixture <- make_aedar_download_fixture()
  raw_dir <- tempfile("aedar-source-integrity-")
  on.exit(unlink(raw_dir,recursive=TRUE),add=TRUE)
  bad_download <- function(url,destfile,mode,quiet) {
    writeBin(charToRaw("wrong bytes"),destfile)
    0L
  }
  expect_error(download_aedar_sources(raw_dir,fixture$resources,download=bad_download),
               "Pinned AEDAR checksum mismatch")
  target <- file.path(raw_dir,fixture$resources$filename)
  expect_false(file.exists(target))
  expect_false(file.exists(paste0(target,".part")))
  writeBin(charToRaw("corrupt cached bytes"),target)
  expect_error(download_aedar_sources(raw_dir,fixture$resources,
    download=function(...) stop("must not download over a corrupt cached file")),
    "Pinned AEDAR checksum mismatch")
  expect_equal(readBin(target,"raw",n=100L),charToRaw("corrupt cached bytes"))
})

test_that("AEDAR source acquisition cleans partial files after a failed download", {
  fixture <- make_aedar_download_fixture()
  raw_dir <- tempfile("aedar-source-failure-")
  on.exit(unlink(raw_dir,recursive=TRUE),add=TRUE)
  expect_error(download_aedar_sources(raw_dir,fixture$resources,
    download=function(url,destfile,mode,quiet) {
      writeBin(charToRaw("partial"),destfile)
      stop("fixture network failure")
    }),"fixture network failure")
  expect_length(list.files(raw_dir,all.files=FALSE),0L)
})

test_that("AEDAR source acquisition rejects malformed selections", {
  fixture <- make_aedar_download_fixture()
  raw_dir <- tempfile("aedar-source-selection-")
  on.exit(unlink(raw_dir,recursive=TRUE),add=TRUE)
  expect_error(download_aedar_sources(raw_dir,fixture$resources["filename"]),"malformed")
  expect_error(download_aedar_sources(raw_dir,rbind(fixture$resources,fixture$resources)),"malformed")
})

test_that("AEDAR aggregate resource compatibility remains limited to all four levels", {
  expected <- AEDAR_SOURCE_RESOURCES[AEDAR_SOURCE_RESOURCES$kind=="aggregate",
    c("level","url","filename","sha1","published_on")]
  expect_equal(AEDAR_AGGREGATE_RESOURCES,expected)
  expect_equal(AEDAR_AGGREGATE_RESOURCES$level,AEDAR_AGGREGATE_LEVELS)
  expect_error(verify_aedar_resource_hash("unused","unknown"),"Unknown AEDAR aggregate level")
})

test_that("AEDAR TYPEQU metadata joins individual codes and preserves explicit no-gamme", {
  registry <- data.frame(TYPEQU=sprintf("A%03d",1:235),
    LIB_TYPEQU=paste("Equipment",1:235), stringsAsFactors=FALSE)
  i <- seq_len(235)
  domain <- ((i-1L) %% 27L) %% 7L + 1L
  hierarchy <- data.frame(TYPEQU=registry$TYPEQU,label=registry$LIB_TYPEQU,description=paste("Description",i),
    domain_code=paste0("D",domain),domain_label=paste("Domain",domain),
    subdomain_code=paste0("S",((i-1L) %% 27L)+1L),subdomain_label=paste("Subdomain",((i-1L) %% 27L)+1L),source_order=i)
  gamme <- data.frame(TYPEQU=registry$TYPEQU, LIBELLE_TYPEQU=registry$LIB_TYPEQU,
    GAMME=c("Proximité","Hors Gamme",NA_character_,rep("Proximité",232)),stringsAsFactors=FALSE)
  result <- validate_aedar_typequ_metadata(registry,hierarchy,gamme)
  expect_equal(result$TYPEQU,registry$TYPEQU)
  expect_equal(result$gamme_status[1:3],c("classified","hors_gamme","absent"))
  expect_identical(result$GAMME[2],"Hors Gamme")
  expect_true(is.na(result$GAMME[3]))
  expect_error(validate_aedar_typequ_metadata(registry,hierarchy,gamme[-1,]),
    "exactly one")
  bad <- gamme; bad$LIBELLE_TYPEQU[1] <- "Wrong"
  expect_error(validate_aedar_typequ_metadata(registry,hierarchy,bad),"label")
})

test_that("AEDAR TYPEQU metadata cache and downloads enforce pinned SHA-256 identities", {
  bytes <- charToRaw("typequ metadata pinned bytes")
  hash <- paste(as.character(openssl::sha256(bytes)),collapse="")
  expect_match(AEDAR_TYPEQU_METADATA_RESOURCES$sha256[[1]],"^[0-9a-f]{64}$")
  expect_match(AEDAR_TYPEQU_METADATA_RESOURCES$sha256[[2]],"^[0-9a-f]{64}$")
  expect_identical(AEDAR_TYPEQU_METADATA_RESOURCES$sha256,c(
    "63c3f4708f2098b647ed54f8394ec4924515a5dc10ecb97d92d66fb0402f31c9",
    "c804a56f7aa43984da80809ad4a028a70f87fe996495b1abeec327dd8c87980e"))
  path <- tempfile(fileext=".html")
  writeBin(bytes,path)
  expect_invisible(verify_aedar_typequ_metadata_hash(path,hash,"fixture"))
  expect_error(verify_aedar_typequ_metadata_hash(path,paste0("0",substr(hash,2,64)),"fixture"),
    "SHA-256 mismatch")

  resources <- data.frame(url="https://example.invalid/typequ.html",filename="typequ.html",
    sha256=hash,stringsAsFactors=FALSE)
  raw_dir <- tempfile("aedar-metadata-download-")
  on.exit(unlink(raw_dir,recursive=TRUE),add=TRUE)
  calls <- 0L
  downloader <- function(url,destfile,mode,quiet) {
    calls <<- calls+1L
    writeBin(bytes,destfile)
    0L
  }
  installed <- download_aedar_typequ_metadata(raw_dir,downloader,resources)
  expect_equal(readBin(installed[[1]],"raw",n=100),bytes)
  expect_equal(download_aedar_typequ_metadata(raw_dir,downloader,resources),installed)
  expect_equal(calls,1L)

  bad_cache <- tempfile("aedar-metadata-bad-cache-")
  dir.create(bad_cache)
  writeBin(charToRaw("corrupt cache"),file.path(bad_cache,"typequ.html"))
  expect_error(download_aedar_typequ_metadata(bad_cache,
    function(...) stop("must not replace a corrupt cached source"),resources),"SHA-256 mismatch")
  expect_equal(readBin(file.path(bad_cache,"typequ.html"),"raw",n=100),charToRaw("corrupt cache"))

  bad_download <- tempfile("aedar-metadata-bad-download-")
  expect_error(download_aedar_typequ_metadata(bad_download,
    function(url,destfile,mode,quiet) { writeBin(charToRaw("wrong download"),destfile); 0L },resources),
    "SHA-256 mismatch")
  expect_false(file.exists(file.path(bad_download,"typequ.html")))
  expect_length(list.files(bad_download,all.files=FALSE),0L)
})

test_that("source-faithful hierarchy fixture and individual TYPEQU workbook parse completely", {
  registry <- read_aedar_typequ_registry()
  hierarchy_path <- testthat::test_path("fixtures","aedar-typequ-hierarchy-2025.html")
  workbook <- testthat::test_path("fixtures","aedar-typequ-gamme-2025.xlsx")
  sources <- read_aedar_typequ_metadata_sources(hierarchy_path,workbook)
  expected <- readr::read_csv(testthat::test_path("fixtures","aedar-typequ-hierarchy-2025.csv"),
    col_types=readr::cols(.default=readr::col_character()),trim_ws=FALSE,show_col_types=FALSE)
  # The source-faithful CSV fixture may be checked out with CRLF line endings;
  # readr retains the carriage return when trim_ws=FALSE. Normalize only that
  # transport artifact so the assertions compare the actual source labels.
  for (column in c("LIB_TYPEQU", "description", "domain_label", "subdomain_label"))
    expected[[column]] <- gsub("\r", "", expected[[column]], fixed=TRUE)
  expect_equal(nrow(sources$hierarchy),235L)
  expect_equal(length(unique(sources$hierarchy$domain_code)),7L)
  expect_equal(length(unique(paste(sources$hierarchy$domain_code,sources$hierarchy$subdomain_code))),27L)
  fields <- c("TYPEQU","label","description","domain_code","domain_label","subdomain_code","subdomain_label","source_order")
  expected$label <- expected$LIB_TYPEQU
  expected$source_order <- as.integer(expected$source_order)
  expect_equal(as.data.frame(sources$hierarchy[fields]),as.data.frame(expected[fields]))
  expect_length(sources$hierarchy$description,235L)
  expect_true(all(!is.na(sources$hierarchy$description)))
  expect_equal(sources$hierarchy$TYPEQU,registry$TYPEQU[match(sources$hierarchy$TYPEQU,registry$TYPEQU)])
  expect_equal(sources$hierarchy$source_order,seq_len(235L))
  # Workbook regroupement codes intentionally repeat; individual TYPEQU are unique.
  expect_true(anyDuplicated(sources$gamme$TYPEQU_REGROUPEMENT)>0L)
  expect_equal(sources$gamme$TYPEQU,registry$TYPEQU)
  result <- validate_aedar_typequ_metadata(registry,sources$hierarchy,sources$gamme)
  expect_equal(result$source_order,seq_len(235L))
  expect_identical(result$LIB_TYPEQU,sources$hierarchy$label)
  expect_identical(result$description,sources$hierarchy$description)
  c401 <- match("C401",result$TYPEQU)
  expect_match(result$LIB_TYPEQU[c401],"GRANDES\\nÉCOLES")
  expect_identical(result$LIB_TYPEQU[c401],expected$LIB_TYPEQU[match("C401",expected$TYPEQU)])
  expect_equal(result$GAMME[match(sources$gamme$TYPEQU,result$TYPEQU)],sources$gamme$GAMME)
  source_examples <- sources$gamme$TYPEQU[1:3]
  expect_equal(result$gamme_status[match(source_examples,result$TYPEQU)],c("classified","hors_gamme","absent"))
  expect_identical(result$GAMME[match(source_examples[2],result$TYPEQU)],"Hors Gamme")
  expect_true(is.na(result$GAMME[match(source_examples[3],result$TYPEQU)]))
})

test_that("approved apostrophe and surrounding-space label differences validate source-faithfully", {
  registry <- read_aedar_typequ_registry()
  i <- seq_len(nrow(registry)); subdomain <- (i-1L) %% 27L + 1L
  domain <- (subdomain-1L) %% 7L + 1L
  hierarchy <- data.frame(TYPEQU=registry$TYPEQU,label=registry$LIB_TYPEQU,description=paste("Description",i),
    domain_code=paste0("D",domain),domain_label=paste("Domain",domain),
    subdomain_code=paste0("S",subdomain),subdomain_label=paste("Subdomain",subdomain),
    source_order=i,stringsAsFactors=FALSE)
  apostrophe_codes <- c("A135","D503","D705","F125")
  for (code in apostrophe_codes) {
    index <- match(code,hierarchy$TYPEQU)
    hierarchy$label[index] <- gsub("'","’",hierarchy$label[index],fixed=TRUE)
  }
  d710 <- match("D710",hierarchy$TYPEQU)
  hierarchy$label[d710] <- trimws(hierarchy$label[d710])
  gamme <- data.frame(TYPEQU=registry$TYPEQU,LIBELLE_TYPEQU=registry$LIB_TYPEQU,
    GAMME=rep(NA_character_,nrow(registry)),stringsAsFactors=FALSE)
  gamme$LIBELLE_TYPEQU[d710] <- paste0(gamme$LIBELLE_TYPEQU[d710]," ")
  result <- validate_aedar_typequ_metadata(registry,hierarchy,gamme)
  expect_identical(result$LIB_TYPEQU[match(apostrophe_codes,result$TYPEQU)],
    hierarchy$label[match(apostrophe_codes,hierarchy$TYPEQU)])
  expect_identical(result$LIB_TYPEQU[match("D710",result$TYPEQU)],hierarchy$label[d710])
  expect_identical(result$GAMME,gamme$GAMME)
  substantive <- hierarchy
  substantive$label[substantive$TYPEQU=="A135"] <- "COUR D’ASSISES MODIFIÉE"
  expect_error(validate_aedar_typequ_metadata(registry,substantive,gamme),"label")

  c401 <- match("C401",hierarchy$TYPEQU)
  hierarchy$label[c401] <- sub("GRANDES ÉCOLES$","GRANDES\nÉCOLES",hierarchy$label[c401])
  c401_result <- validate_aedar_typequ_metadata(registry,hierarchy,gamme)
  expect_identical(c401_result$LIB_TYPEQU[c401],hierarchy$label[c401])

  other_newline <- hierarchy
  other <- match("A135",other_newline$TYPEQU)
  other_newline$label[other] <- sub(" ","\n",other_newline$label[other],fixed=TRUE)
  expect_error(validate_aedar_typequ_metadata(registry,other_newline,gamme),"label")

  gamme_newline <- gamme
  gamme_newline$LIBELLE_TYPEQU[c401] <- sub(" ","\n",gamme_newline$LIBELLE_TYPEQU[c401],fixed=TRUE)
  expect_error(validate_aedar_typequ_metadata(registry,hierarchy,gamme_newline),"gamme TYPEQU label")
})
