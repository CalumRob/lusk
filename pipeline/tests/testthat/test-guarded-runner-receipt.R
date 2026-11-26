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
  git("add", "tracked.txt")
  git("-c", "user.name=Receipt Test", "-c", "user.email=receipt@example.invalid",
      "commit", "-qm", "initial")
  list(depot = depot, head = unname(git("rev-parse", "HEAD")))
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
    sprintf("Write-GuardedRReceipt -RepoDir '%s' -LogPath '%s' -Filter '%s' -RunnerVersion '1.0.0' -StartedAtUtc '2026-11-26T10:00:00Z' -EndedAtUtc '2026-11-26T10:01:00Z' -Succeeded $true -ExitCode 0 -LogLines @('testthat results: 6 tests, 20 expectations, 0 failures', 'Leftover schemas: none')",
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
  writeLines(c("testthat results: 6 tests, 20 expectations, 0 failures",
               "Leftover schemas: none"), log)
  receipt_path <- ecrire_harness_receipt(repo$depot, log, repo$head)
  on.exit(unlink(receipt_path), add = TRUE)
  receipt <- jsonlite::fromJSON(receipt_path, simplifyVector = FALSE)
  expect_identical(receipt$head, repo$head)
  expect_length(receipt$git_status_porcelain, 0L)
  expect_identical(receipt$filter, "adopt-db")
  expect_identical(receipt$testthat_summary,
                   "testthat results: 6 tests, 20 expectations, 0 failures")
  expect_identical(receipt$leftover_schema_line, "Leftover schemas: none")
  expect_identical(receipt$runner_version, "1.0.0")
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
  writeLines(c("testthat results: 6 tests, 20 expectations, 0 failures",
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
