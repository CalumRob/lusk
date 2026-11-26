# Heavy suite entry points share one machine-wide lock; filtered tests stay lock-free.

test_that("a second heavy run waits for the named mutex and says so", {
  # The handoff budget process already owns this mutex; contention is proved by
  # the filtered lock-free run instead of self-deadlocking inside the suite.
  skip_if(identical(Sys.getenv("LUSK_HEAVY_TEST_LOCK_HELD", unset = ""), "1"),
          "the enclosing heavy run already holds the mutex")
  skip_if_not(.Platform$OS.type == "windows")
  skip_if_not(nzchar(Sys.which("powershell")))
  scripts <- file.path(pkgload::pkg_path(), "scripts")
  wrapper <- file.path(scripts, "run-heavy-r.ps1")
  module <- file.path(scripts, "heavy-test-lock.ps1")
  absent <- file.path(tempdir(), "this-heavy-script-does-not-exist.R")
  harness <- tempfile(fileext = ".ps1")
  on.exit(unlink(harness), add = TRUE)
  writeLines(c(
    "$ErrorActionPreference = 'Stop'",
    sprintf(". '%s'", module),
    "$mutex = New-Object System.Threading.Mutex($false, 'Local\\LuskIntegrationContractDb')",
    "$acquired = $false",
    "try {",
    "  $null = Enter-HeavyTestLock -Mutex $mutex -TimeoutSeconds 1",
    "  $acquired = $true",
    "  $clock = [Diagnostics.Stopwatch]::StartNew()",
    "  $ErrorActionPreference = 'Continue'",
    sprintf("  $output = & powershell -NoProfile -ExecutionPolicy Bypass -File '%s' -Script '%s' -LockTimeoutSeconds 2 2>&1", wrapper, absent),
    "  $code = $LASTEXITCODE",
    "  $clock.Stop()",
    "  $ErrorActionPreference = 'Stop'",
    "  $text = $output -join [Environment]::NewLine",
    "  if ($code -eq 0) { throw 'the contending invocation unexpectedly ran' }",
    "  if ($text -notmatch [regex]::Escape('Waiting for Local\\LuskIntegrationContractDb')) { throw $text }",
    "  if ($text -match 'Heavy-run lock acquired') { throw 'the contender entered before the holder released' }",
    "  if ($clock.Elapsed.TotalSeconds -lt 1.5) { throw 'the contender did not wait' }",
    "  'contention proved'",
    "} finally {",
    "  if ($acquired) { Exit-HeavyTestLock -Mutex $mutex } else { $mutex.Dispose() }",
    "}"
  ), harness)
  sortie <- suppressWarnings(system2("powershell", c("-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", shQuote(harness)), stdout = TRUE, stderr = TRUE))
  status <- attr(sortie, "status")
  if (is.null(status)) status <- 0L
  expect_identical(status, 0L, info = paste(sortie, collapse = "\n"))
  expect_true(any(grepl("contention proved", sortie, fixed = TRUE)))
})

test_that("the PowerShell 5.1 heavy wrapper executes R on an isolated test lock", {
  skip_if_not(.Platform$OS.type == "windows")
  skip_if_not(nzchar(Sys.which("powershell")))
  wrapper <- file.path(pkgload::pkg_path(), "scripts", "run-heavy-r.ps1")
  script <- tempfile(fileext = ".R")
  on.exit(unlink(script), add = TRUE)
  lock_name <- paste0("Local\\LuskHeavyWrapperTest-",
                      paste(sample(c(letters, 0:9), 12, TRUE), collapse = ""))
  real_db_variables <- c("PGPASSFILE", "LUSK_SCALAR_TEST_HOST",
    "LUSK_SCALAR_TEST_PORT", "LUSK_SCALAR_TEST_DATABASE", "LUSK_SCALAR_TEST_USER",
    "LUSK_SCALAR_TEST_CLEANUP", "LUSK_TEST_ALLOW_SCHEMA_CLEANUP", "DATABASE_URL",
    "PUBLISH_DATABASE_URL", "LUSK_PUBLISH_HOST", "LUSK_PUBLISH_DATABASE",
    "LUSK_PUBLISH_USER", "PGOPTIONS", "PGCONNECT_TIMEOUT")
  withr::local_envvar(c(
    stats::setNames(rep("", length(real_db_variables)), real_db_variables),
    LUSK_HEAVY_TEST_STUB = "1", LUSK_HEAVY_TEST_LOCK_NAME = lock_name
  ))
  executer <- function(contenu) {
    writeLines(contenu, script)
    sortie <- suppressWarnings(system2("powershell", c("-NoProfile",
      "-ExecutionPolicy", "Bypass", "-File", shQuote(wrapper), "-Script", shQuote(script)),
      stdout = TRUE, stderr = TRUE))
    status <- attr(sortie, "status")
    if (is.null(status)) status <- 0L
    list(status = status, output = sortie)
  }

  passe <- executer('cat("heavy wrapper executed\\n")')
  expect_identical(passe$status, 0L, info = paste(passe$output, collapse = "\n"))
  expect_true(any(grepl("heavy wrapper executed", passe$output, fixed = TRUE)))
  expect_true(any(grepl(paste0("Heavy-run lock acquired: ", lock_name),
                        passe$output, fixed = TRUE)))
  expect_false(any(grepl("Local\\LuskIntegrationContractDb", passe$output, fixed = TRUE)))

  echec <- executer('stop("heavy wrapper failure")')
  expect_true(echec$status != 0L, info = paste(echec$output, collapse = "\n"))
  expect_true(any(grepl("heavy wrapper failure", echec$output, fixed = TRUE)))

  withr::local_envvar(LUSK_SCALAR_TEST_DATABASE = "lusk_it_contract")
  refus <- executer('cat("must not run")')
  expect_true(refus$status != 0L)
  expect_false(any(grepl("must not run", refus$output, fixed = TRUE)))
  expect_true(any(grepl("Refusing: heavy test stub cannot be combined", refus$output,
                        fixed = TRUE)))

  withr::local_envvar(LUSK_HEAVY_TEST_STUB = "", LUSK_HEAVY_TEST_LOCK_NAME = lock_name)
  refus_override <- executer('cat("must not run")')
  expect_true(refus_override$status != 0L)
  expect_true(any(grepl("LUSK_HEAVY_TEST_LOCK_NAME requires LUSK_HEAVY_TEST_STUB=1",
                        refus_override$output, fixed = TRUE)))
})

test_that("runner executions finish while the production mutex is held", {
  skip_if_not(.Platform$OS.type == "windows")
  skip_if_not(nzchar(Sys.which("powershell")))
  skip_if_not(nzchar(Sys.which("git")))
  scripts <- file.path(pkgload::pkg_path(), "scripts")
  repo <- tempfile("runner-lock-repo-")
  pipeline <- file.path(repo, "pipeline")
  dir.create(pipeline, recursive = TRUE)
  stub <- tempfile("runner-lock-stub-")
  dir.create(stub)
  on.exit(unlink(c(repo, stub), recursive = TRUE), add = TRUE)
  writeLines("Package: lusk", file.path(pipeline, "DESCRIPTION"))
  writeLines("list()", file.path(pipeline, "_targets.R"))
  git <- function(...) {
    arguments <- c("-C", shQuote(repo), unlist(lapply(list(...), shQuote)))
    sortie <- suppressWarnings(system2("git", arguments, stdout = TRUE, stderr = TRUE))
    status <- attr(sortie, "status")
    if (!is.null(status) && status != 0L)
      stop(paste(sortie, collapse = "\n"), call. = FALSE)
  }
  git("init", "-q")
  git("add", "pipeline")
  git("-c", "user.name=Runner Lock Test", "-c", "user.email=lock@example.invalid",
      "commit", "-qm", "initial")
  head <- unname(git("rev-parse", "HEAD"))
  writeLines(c(
    "@echo off",
    "if \"%~1\"==\"-e\" (",
    "  echo [ FAIL 0 ^| WARN 0 ^| SKIP 0 ^| PASS 420 ]",
    "  exit /b 0",
    ")",
    "exit /b 9"
  ), file.path(stub, "Rscript.cmd"))
  writeLines(c("@echo off", "echo it_stub_schema", "exit /b 0"),
             file.path(stub, "it-schemas.cmd"))
  heavy_script <- tempfile(fileext = ".R")
  on.exit(unlink(heavy_script), add = TRUE)
  writeLines('cat("heavy isolated execution\\n")', heavy_script)
  lock_name <- paste0("Local\\LuskHeavyWrapperTest-",
                      paste(sample(c(letters, 0:9), 12, TRUE), collapse = ""))
  real_db_variables <- c("PGPASSFILE", "LUSK_SCALAR_TEST_HOST",
    "LUSK_SCALAR_TEST_PORT", "LUSK_SCALAR_TEST_DATABASE", "LUSK_SCALAR_TEST_USER",
    "LUSK_SCALAR_TEST_CLEANUP", "LUSK_TEST_ALLOW_SCHEMA_CLEANUP", "DATABASE_URL",
    "PUBLISH_DATABASE_URL", "LUSK_PUBLISH_HOST", "LUSK_PUBLISH_DATABASE",
    "LUSK_PUBLISH_USER", "PGOPTIONS", "PGCONNECT_TIMEOUT")
  withr::local_envvar(c(
    stats::setNames(rep("", length(real_db_variables)), real_db_variables),
    LUSK_GUARDED_R_TEST_STUB_DIR = stub,
    LUSK_HEAVY_TEST_STUB = "1", LUSK_HEAVY_TEST_LOCK_NAME = lock_name
  ))

  guarded_log <- tempfile(fileext = ".log")
  guarded_out <- tempfile(fileext = ".out")
  guarded_err <- tempfile(fileext = ".err")
  heavy_out <- tempfile(fileext = ".out")
  heavy_err <- tempfile(fileext = ".err")
  harness <- tempfile(fileext = ".ps1")
  on.exit(unlink(c(guarded_log, sub("\\.log$", ".receipt.json", guarded_log),
                   guarded_out, guarded_err, heavy_out, heavy_err, harness)),
          add = TRUE)
  writeLines(c(
    "$ErrorActionPreference = 'Stop'",
    sprintf(". '%s'", file.path(scripts, "heavy-test-lock.ps1")),
    "$mutex = New-Object System.Threading.Mutex($false, 'Local\\LuskIntegrationContractDb')",
    "$acquired = $false",
    "try {",
    "  if ($env:LUSK_HEAVY_TEST_LOCK_HELD -ne '1') {",
    "    $null = Enter-HeavyTestLock -Mutex $mutex -TimeoutSeconds 1 -Name 'Local\\LuskIntegrationContractDb'",
    "    $acquired = $true",
    "  }",
    sprintf("$guardArgs = @('-NoProfile','-ExecutionPolicy','Bypass','-File','%s','-PipelineDir','%s','-Filter','adopt-db','-LogPath','%s')",
            file.path(scripts, "run-guarded-r.ps1"), pipeline, guarded_log),
    sprintf("$guard = Start-Process -FilePath 'powershell' -ArgumentList $guardArgs -PassThru -WindowStyle Hidden -RedirectStandardOutput '%s' -RedirectStandardError '%s'",
            guarded_out, guarded_err),
    "  if (-not $guard.WaitForExit(30000)) { $guard.Kill(); throw 'guarded stub execution timed out while the production mutex was held' }",
    "  $guard.WaitForExit() | Out-Null",
    sprintf("  $guardText = (((Get-Content -LiteralPath '%s') + (Get-Content -LiteralPath '%s')) -join [Environment]::NewLine); if ($guardText -notmatch 'Leftover schemas: none') { throw $guardText }",
            guarded_out, guarded_err),
    sprintf("$heavyArgs = @('-NoProfile','-ExecutionPolicy','Bypass','-File','%s','-Script','%s','-LockTimeoutSeconds','10')",
            file.path(scripts, "run-heavy-r.ps1"), heavy_script),
    sprintf("$heavy = Start-Process -FilePath 'powershell' -ArgumentList $heavyArgs -PassThru -WindowStyle Hidden -RedirectStandardOutput '%s' -RedirectStandardError '%s'",
            heavy_out, heavy_err),
    "  if (-not $heavy.WaitForExit(30000)) { $heavy.Kill(); throw 'heavy stub execution timed out while the production mutex was held' }",
    "  $heavy.WaitForExit() | Out-Null",
    sprintf("  $heavyText = (((Get-Content -LiteralPath '%s') + (Get-Content -LiteralPath '%s')) -join [Environment]::NewLine); if ($heavyText -notmatch 'heavy isolated execution') { throw $heavyText }",
            heavy_out, heavy_err),
    "  'isolated runners completed'",
    "} finally {",
    "  if ($acquired) { Exit-HeavyTestLock -Mutex $mutex } else { $mutex.Dispose() }",
    "}"
  ), harness)
  sortie <- suppressWarnings(system2("powershell", c("-NoProfile",
    "-ExecutionPolicy", "Bypass", "-File", shQuote(harness)), stdout = TRUE, stderr = TRUE))
  status <- attr(sortie, "status")
  if (is.null(status)) status <- 0L
  expect_identical(status, 0L, info = paste(sortie, collapse = "\n"))
  expect_true(any(grepl("isolated runners completed", sortie, fixed = TRUE)))
  expect_false(any(grepl("Waiting for Local\\LuskIntegrationContractDb", sortie,
                         fixed = TRUE)))
})

test_that("both full-suite R entry points delegate to the shared heavy-run lock", {
  scripts <- file.path(pkgload::pkg_path(), "scripts")
  for (fichier in c("verify-r-suite-budget.R", "run-slow-tests.R")) {
    source <- paste(readLines(file.path(scripts, fichier), warn = FALSE), collapse = "\n")
    expect_match(source, "executer_avec_lock_lourd(", fixed = TRUE, info = fichier)
  }
  if (.Platform$OS.type == "windows" && nzchar(Sys.which("powershell"))) {
    fichiers <- c("run-heavy-r.ps1", "heavy-test-lock.ps1")
    harness <- tempfile(fileext = ".ps1")
    on.exit(unlink(harness), add = TRUE)
    writeLines(c(
      "$ErrorActionPreference = 'Stop'",
      sprintf("$files = @(%s)", paste(sprintf("'%s'", file.path(scripts, fichiers)),
                                      collapse = ", ")),
      "foreach ($file in $files) {",
      "  $tokens = $null; $errors = $null",
      "  $null = [System.Management.Automation.Language.Parser]::ParseFile($file, [ref]$tokens, [ref]$errors)",
      "  if ($errors.Count) { throw ($errors | Out-String) }",
      "}",
      "'parsed'"
    ), harness)
    sortie <- system2("powershell", c("-NoProfile", "-ExecutionPolicy", "Bypass",
      "-File", shQuote(harness)), stdout = TRUE, stderr = TRUE)
    status <- attr(sortie, "status")
    if (is.null(status)) status <- 0L
    expect_identical(status, 0L, info = paste(sortie, collapse = "\n"))
    expect_true(any(grepl("parsed", sortie, fixed = TRUE)))
  }
})
