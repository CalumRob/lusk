# The guarded runner receipt is a DB-free identity/verification contract (#1177).

skip_if_not(.Platform$OS.type == "windows")
skip_if_not(nzchar(Sys.which("powershell")))
skip_if_not(nzchar(Sys.which("git")))

nouveau_depot_receipt <- function() {
  depot <- tempfile("guarded-receipt-repo-")
  dir.create(depot)
  git <- function(...) {
    arguments <- c("-C", shQuote(depot), unlist(lapply(list(...), shQuote)))
    sortie <- suppressWarnings(system2("git", arguments, stdout = TRUE, stderr = TRUE))
    status <- attr(sortie, "status")
    if (!is.null(status) && status != 0L)
      stop(paste(sortie, collapse = "\n"), call. = FALSE)
    sortie
  }
  git("init", "-q")
  writeLines("fixture", file.path(depot, "tracked.txt"))
  pipeline <- file.path(depot, "pipeline")
  dir.create(pipeline)
  writeLines("Package: lusk", file.path(pipeline, "DESCRIPTION"))
  writeLines("list()", file.path(pipeline, "_targets.R"))
  git("add", "tracked.txt", "pipeline")
  git("-c", "user.name=Receipt Test", "-c", "user.email=receipt@example.invalid",
      "commit", "-qm", "initial")
  list(depot = depot, pipeline = pipeline, head = unname(git("rev-parse", "HEAD")))
}

executer_receipt_powershell <- function(harness) {
  sortie <- suppressWarnings(system2("powershell", c("-NoProfile", "-ExecutionPolicy",
    "Bypass", "-File", shQuote(harness)), stdout = TRUE, stderr = TRUE))
  status <- attr(sortie, "status")
  if (is.null(status)) status <- 0L
  list(status = status, output = sortie)
}

ecrire_harness_receipt <- function(repo, log, head, filter = "adopt-db") {
  module <- file.path(pkgload::pkg_path(), "scripts", "guarded-r-receipt.ps1")
  receipt <- sub("\\.log$", ".receipt.json", log)
  harness <- tempfile(fileext = ".ps1")
  on.exit(unlink(harness), add = TRUE)
  writeLines(c(
    "$ErrorActionPreference = 'Stop'",
    sprintf(". '%s'", module),
    sprintf("$logLines = @(Get-Content -LiteralPath '%s')", log),
    sprintf("Write-GuardedRReceipt -RepoDir '%s' -LogPath '%s' -Filter '%s' -RunnerVersion '1.0.0' -StartedAtUtc '2026-11-26T10:00:00Z' -EndedAtUtc '2026-11-26T10:01:00Z' -Succeeded $true -ExitCode 0 -LogLines $logLines",
            repo, log, filter),
    sprintf("Assert-GuardedRReceipt -ReceiptPath '%s' -RepoDir '%s' -ExpectedHead '%s' -ExpectedFilter '%s'", receipt, repo, head, filter),
    "'verified'"
  ), harness)
  resultat <- executer_receipt_powershell(harness)
  expect_identical(resultat$status, 0L, info = paste(resultat$output, collapse = "\n"))
  expect_true(any(grepl("verified", resultat$output, fixed = TRUE)))
  receipt
}

test_that("the guarded receipt records the exact clean head, filter, summaries and runner version", {
  repo <- nouveau_depot_receipt()
  on.exit(unlink(repo$depot, recursive = TRUE), add = TRUE)
  log <- tempfile(fileext = ".log")
  on.exit(unlink(log), add = TRUE)
  writeLines(c("[ FAIL 0 | WARN 0 | SKIP 0 | PASS 420 ]",
               "Leftover schemas: none"), log)
  receipt_path <- ecrire_harness_receipt(repo$depot, log, repo$head)
  on.exit(unlink(receipt_path), add = TRUE)
  receipt <- jsonlite::fromJSON(receipt_path, simplifyVector = FALSE)
  expect_identical(receipt$head, repo$head)
  expect_length(receipt$git_status_porcelain, 0L)
  expect_identical(receipt$filter, "adopt-db")
  expect_identical(receipt$testthat_summary,
                   "[ FAIL 0 | WARN 0 | SKIP 0 | PASS 420 ]")
  expect_identical(receipt$leftover_schema_line, "Leftover schemas: none")
  expect_identical(receipt$runner_version, "1.0.0")
  expect_identical(receipt$stub, FALSE)
  expect_identical(receipt$started_at_utc, "2026-11-26T10:00:00Z")
  expect_identical(receipt$ended_at_utc, "2026-11-26T10:01:00Z")
  expect_true(receipt$succeeded)
  expect_identical(receipt$exit_code, 0L)
  expect_identical(dirname(receipt_path), dirname(log))
})

test_that("the receipt verifier refuses a mismatched sha and a dirty tree", {
  repo <- nouveau_depot_receipt()
  on.exit(unlink(repo$depot, recursive = TRUE), add = TRUE)
  log <- tempfile(fileext = ".log")
  on.exit(unlink(log), add = TRUE)
  writeLines(c("[ FAIL 0 | WARN 0 | SKIP 0 | PASS 420 ]",
               "Leftover schemas: none"), log)
  receipt_path <- ecrire_harness_receipt(repo$depot, log, repo$head)
  on.exit(unlink(receipt_path), add = TRUE)
  module <- file.path(pkgload::pkg_path(), "scripts", "guarded-r-receipt.ps1")
  harness <- tempfile(fileext = ".ps1")
  on.exit(unlink(harness), add = TRUE)
  writeLines(c(
    "$ErrorActionPreference = 'Stop'",
    sprintf(". '%s'", module),
    sprintf("$path = '%s'", receipt_path),
    "$receipt = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json",
    "$original = $receipt.head",
    "$receipt.head = '0000000000000000000000000000000000000000'",
    "$receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $path -Encoding UTF8",
    sprintf("$refus = $false; try { Assert-GuardedRReceipt -ReceiptPath '%s' -RepoDir '%s' -ExpectedHead '%s' -ExpectedFilter 'adopt-db' } catch { $refus = $true }",
            receipt_path, repo$depot, repo$head),
    "if (-not $refus) { throw 'mismatched sha was accepted' }",
    "'mismatch refused'",
    "$receipt.head = $original",
    "$receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $path -Encoding UTF8",
    sprintf("Set-Content -LiteralPath '%s' -Value 'dirty'", file.path(repo$depot, "dirty.txt")),
    sprintf("$refus = $false; try { Assert-GuardedRReceipt -ReceiptPath '%s' -RepoDir '%s' -ExpectedHead '%s' -ExpectedFilter 'adopt-db' } catch { $refus = $true }",
            receipt_path, repo$depot, repo$head),
    "if (-not $refus) { throw 'dirty tree was accepted' }",
    "'dirty refused'"
  ), harness)
  resultat <- executer_receipt_powershell(harness)
  expect_identical(resultat$status, 0L, info = paste(resultat$output, collapse = "\n"))
  expect_true(any(grepl("mismatch refused", resultat$output, fixed = TRUE)))
  expect_true(any(grepl("dirty refused", resultat$output, fixed = TRUE)))
})

test_that("the compact testthat summary is accepted only when its failure count is zero", {
  module <- file.path(pkgload::pkg_path(), "scripts", "guarded-r-receipt.ps1")
  harness <- tempfile(fileext = ".ps1")
  on.exit(unlink(harness), add = TRUE)
  writeLines(c(
    "$ErrorActionPreference = 'Stop'",
    sprintf(". '%s'", module),
    "$summary = Get-GuardedRReceiptLines -LogLines @('[ FAIL 0 | WARN 0 | SKIP 0 | PASS 420 ]')",
    "if ($summary -ne '[ FAIL 0 | WARN 0 | SKIP 0 | PASS 420 ]') { throw 'compact summary was lost' }",
    "if (-not (Test-GuardedRSummaryPassed -Summary $summary)) { throw 'clean summary was rejected' }",
    "if (Test-GuardedRSummaryPassed -Summary '[ FAIL 1 | WARN 0 | SKIP 0 | PASS 419 ]') { throw 'failing summary was accepted' }",
    "'compact proved'"
  ), harness)
  resultat <- executer_receipt_powershell(harness)
  expect_identical(resultat$status, 0L, info = paste(resultat$output, collapse = "\n"))
  expect_true(any(grepl("compact proved", resultat$output, fixed = TRUE)))
})

test_that("the receipt verifier refuses errors, failures, leftovers, missing summary and nonzero exit", {
  repo <- nouveau_depot_receipt()
  on.exit(unlink(repo$depot, recursive = TRUE), add = TRUE)
  log <- tempfile(fileext = ".log")
  on.exit(unlink(log), add = TRUE)
  writeLines("initial", log)
  receipt <- sub("\\.log$", ".receipt.json", log)
  on.exit(unlink(receipt), add = TRUE)
  module <- file.path(pkgload::pkg_path(), "scripts", "guarded-r-receipt.ps1")
  harness <- tempfile(fileext = ".ps1")
  on.exit(unlink(harness), add = TRUE)
  writeLines(c(
    "$ErrorActionPreference = 'Stop'",
    sprintf(". '%s'", module),
    "$cases = @(",
    "  @{ Name='errors'; Exit=0; Lines=@('[ FAIL 0 | WARN 0 | SKIP 0 | PASS 420 ]', 'ERROR: planted error', 'testthat results: 0 failures, 2 errors', 'Leftover schemas: none') },",
    "  @{ Name='failures'; Exit=0; Lines=@('[ FAIL 1 | WARN 0 | SKIP 0 | PASS 419 ]', 'Leftover schemas: none') },",
    "  @{ Name='leftovers'; Exit=0; Lines=@('[ FAIL 0 | WARN 0 | SKIP 0 | PASS 420 ]', 'LEFTOVER SCHEMAS: planted') },",
    "  @{ Name='missing_summary'; Exit=0; Lines=@('Leftover schemas: none') },",
    "  @{ Name='nonzero_exit'; Exit=1; Lines=@('[ FAIL 0 | WARN 0 | SKIP 0 | PASS 420 ]', 'Leftover schemas: none') }",
    ")",
    "foreach ($case in $cases) {",
    sprintf("  [IO.File]::WriteAllLines('%s', [string[]]$case.Lines)", log),
    sprintf("  Write-GuardedRReceipt -RepoDir '%s' -LogPath '%s' -ReceiptPath '%s' -Filter 'adopt-db' -RunnerVersion '1.0.0' -StartedAtUtc '2026-11-26T10:00:00Z' -EndedAtUtc '2026-11-26T10:01:00Z' -Succeeded ($case.Exit -eq 0) -ExitCode $case.Exit -LogLines $case.Lines | Out-Null",
            repo$depot, log, receipt),
    sprintf("  $refused = $false; try { Assert-GuardedRReceipt -ReceiptPath '%s' -RepoDir '%s' -ExpectedHead '%s' -ExpectedFilter 'adopt-db' | Out-Null } catch { $refused = $true }",
            receipt, repo$depot, repo$head),
    "  if (-not $refused) { throw \"$($case.Name) was accepted\" }",
    "  \"$($case.Name) refused\"",
    "}"
  ), harness)
  resultat <- executer_receipt_powershell(harness)
  expect_identical(resultat$status, 0L, info = paste(resultat$output, collapse = "\n"))
  for (cas in c("errors", "failures", "leftovers", "missing_summary", "nonzero_exit"))
    expect_true(any(grepl(paste0(cas, " refused"), resultat$output, fixed = TRUE)))
})

test_that("the PowerShell 5.1 guarded runner executes end-to-end with DB-free stubs", {
  scripts <- file.path(pkgload::pkg_path(), "scripts")
  runner <- file.path(scripts, "run-guarded-r.ps1")
  source_runner <- paste(readLines(runner, warn = FALSE), collapse = "\n")
  expect_match(source_runner, "LUSK_GUARDED_R_TEST_STUB_DIR", fixed = TRUE)
  # Fail safely before execution if the explicit test-only seam is absent.
  if (!grepl("LUSK_GUARDED_R_TEST_STUB_DIR", source_runner, fixed = TRUE)) return()

  repo <- nouveau_depot_receipt()
  on.exit(unlink(repo$depot, recursive = TRUE), add = TRUE)
  stub <- tempfile("guarded-runner-stub-")
  dir.create(stub)
  on.exit(unlink(stub, recursive = TRUE), add = TRUE)
  writeLines(c(
    "@echo off",
    "if \"%~1\"==\"-e\" (",
    "  if \"%LUSK_GUARDED_R_TEST_FAIL%\"==\"1\" (",
    "    echo [ FAIL 1 ^| WARN 0 ^| SKIP 0 ^| PASS 419 ]",
    "  ) else (",
    "    echo [ FAIL 0 ^| WARN 0 ^| SKIP 0 ^| PASS 420 ]",
    "  )",
    "  exit /b 0",
    ")",
    "echo unexpected stub arguments 1>&2",
    "exit /b 9"
  ), file.path(stub, "Rscript.cmd"))
  writeLines(c("@echo off", "echo it_stub_schema", "exit /b 0"),
             file.path(stub, "it-schemas.cmd"))

  real_db_variables <- c("PGPASSFILE", "LUSK_SCALAR_TEST_HOST",
    "LUSK_SCALAR_TEST_PORT", "LUSK_SCALAR_TEST_DATABASE", "LUSK_SCALAR_TEST_USER",
    "LUSK_SCALAR_TEST_CLEANUP", "LUSK_TEST_ALLOW_SCHEMA_CLEANUP", "DATABASE_URL",
    "PUBLISH_DATABASE_URL", "LUSK_PUBLISH_HOST", "LUSK_PUBLISH_DATABASE",
    "LUSK_PUBLISH_USER", "PGOPTIONS", "PGCONNECT_TIMEOUT")
  withr::local_envvar(c(
    stats::setNames(rep("", length(real_db_variables)), real_db_variables),
    LUSK_GUARDED_R_TEST_STUB_DIR = stub,
    LUSK_GUARDED_R_TEST_FAIL = "0"
  ))

  executer_runner <- function(log, fail = "0") {
    withr::local_envvar(LUSK_GUARDED_R_TEST_FAIL = fail)
    sortie <- suppressWarnings(system2("powershell", c("-NoProfile",
      "-ExecutionPolicy", "Bypass", "-File", shQuote(runner),
      "-PipelineDir", shQuote(repo$pipeline), "-Filter", "adopt-db",
      "-LogPath", shQuote(log)), stdout = TRUE, stderr = TRUE))
    status <- attr(sortie, "status")
    if (is.null(status)) status <- 0L
    list(status = status, output = sortie)
  }
  verifier_receipt <- function(receipt, allow_stub = FALSE) {
    module <- file.path(scripts, "guarded-r-receipt.ps1")
    harness <- tempfile(fileext = ".ps1")
    on.exit(unlink(harness), add = TRUE)
    option <- if (allow_stub) " -AllowTestStub" else ""
    writeLines(c(
      "$ErrorActionPreference = 'Stop'",
      sprintf(". '%s'", module),
      sprintf("Assert-GuardedRReceipt -ReceiptPath '%s' -RepoDir '%s' -ExpectedHead '%s' -ExpectedFilter 'adopt-db'%s | Out-Null",
              receipt, repo$depot, repo$head, option),
      "'verified'"
    ), harness)
    executer_receipt_powershell(harness)
  }

  log_pass <- tempfile(fileext = ".log")
  log_fail <- tempfile(fileext = ".log")
  log_refuse <- tempfile(fileext = ".log")
  on.exit(unlink(c(log_pass, log_fail, log_refuse,
    sub("\\.log$", ".receipt.json", log_pass), sub("\\.log$", ".receipt.json", log_fail),
    sub("\\.log$", ".receipt.json", log_refuse))), add = TRUE)

  passe <- executer_runner(log_pass)
  expect_identical(passe$status, 0L, info = paste(passe$output, collapse = "\n"))
  expect_true(any(grepl("Leftover schemas: none", passe$output, fixed = TRUE)))
  receipt_pass <- jsonlite::fromJSON(sub("\\.log$", ".receipt.json", log_pass),
                                     simplifyVector = FALSE)
  expect_true(receipt_pass$succeeded)
  expect_identical(receipt_pass$exit_code, 0L)
  expect_identical(receipt_pass$testthat_summary,
                   "[ FAIL 0 | WARN 0 | SKIP 0 | PASS 420 ]")
  expect_identical(receipt_pass$runner_version, "1.0.0-test-stub")
  expect_identical(receipt_pass$stub, TRUE)
  receipt_pass_path <- sub("\\.log$", ".receipt.json", log_pass)
  refus_stub <- verifier_receipt(receipt_pass_path)
  expect_true(refus_stub$status != 0L)
  expect_identical(verifier_receipt(receipt_pass_path, allow_stub = TRUE)$status, 0L)

  echec <- executer_runner(log_fail, fail = "1")
  expect_true(echec$status != 0L, info = paste(echec$output, collapse = "\n"))
  receipt_fail <- jsonlite::fromJSON(sub("\\.log$", ".receipt.json", log_fail),
                                     simplifyVector = FALSE)
  expect_false(receipt_fail$succeeded)
  expect_true(receipt_fail$exit_code != 0L)
  expect_true(verifier_receipt(sub("\\.log$", ".receipt.json", log_fail))$status != 0L)

  withr::local_envvar(LUSK_SCALAR_TEST_DATABASE = "lusk_it_contract")
  refus <- executer_runner(log_refuse)
  expect_true(refus$status != 0L)
  expect_true(any(grepl("Refusing: test stub cannot be combined with real DB environment",
                        refus$output, fixed = TRUE)))
})

test_that("the repo guarded runner retains every external guard and writes a receipt", {
  scripts <- file.path(pkgload::pkg_path(), "scripts")
  runner <- paste(readLines(file.path(scripts, "run-guarded-r.ps1"), warn = FALSE),
                  collapse = "\n")
  for (token in c("lusk_it_contract", "lusk_it_contract_pub", "Refusing:",
                  "HeavyTestMutexName", "it-schemas.R",
                  "LEFTOVER SCHEMAS", "Leftover schemas: none",
                  "Write-GuardedRReceipt"))
    expect_match(runner, token, fixed = TRUE, info = token)
  lock <- paste(readLines(file.path(scripts, "heavy-test-lock.ps1"), warn = FALSE),
                collapse = "\n")
  expect_match(lock, "Local\\LuskIntegrationContractDb", fixed = TRUE)
  snapshot <- paste(readLines(file.path(scripts, "it-schemas.R"), warn = FALSE),
                    collapse = "\n")
  for (token in c("BEGIN TRANSACTION READ ONLY", "current_database()",
                  "current_user AS usr", "ROLLBACK"))
    expect_match(snapshot, token, fixed = TRUE, info = token)
  harness <- tempfile(fileext = ".ps1")
  on.exit(unlink(harness), add = TRUE)
  writeLines(c(
    "$ErrorActionPreference = 'Stop'",
    sprintf("$files = @('%s', '%s')", file.path(scripts, "run-guarded-r.ps1"),
            file.path(scripts, "guarded-r-receipt.ps1")),
    "foreach ($file in $files) {",
    "  $tokens = $null; $errors = $null",
    "  $null = [System.Management.Automation.Language.Parser]::ParseFile($file, [ref]$tokens, [ref]$errors)",
    "  if ($errors.Count) { throw ($errors | Out-String) }",
    "}",
    "'parsed'"
  ), harness)
  resultat <- executer_receipt_powershell(harness)
  expect_identical(resultat$status, 0L, info = paste(resultat$output, collapse = "\n"))
  expect_true(any(grepl("parsed", resultat$output, fixed = TRUE)))
})
