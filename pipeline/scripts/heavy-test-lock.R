# Full-suite entry points re-execute under the shared heavy-run lock (#1177).
# Sourcing this file or running filtered testthat tests never acquires the lock.

fichier_script_courant <- function() {
  arguments <- commandArgs(trailingOnly = FALSE)
  fichiers <- arguments[startsWith(arguments, "--file=")]
  if (length(fichiers) != 1L)
    stop("Cannot identify the current Rscript file.", call. = FALSE)
  normalizePath(sub("^--file=", "", fichiers), winslash = "/", mustWork = TRUE)
}

executer_avec_lock_lourd <- function(script, args = character()) {
  if (identical(Sys.getenv("LUSK_HEAVY_TEST_LOCK_HELD", unset = ""), "1"))
    return(invisible(NULL))
  script <- normalizePath(script, winslash = "/", mustWork = TRUE)
  scripts <- dirname(script)
  if (identical(.Platform$OS.type, "windows")) {
    powershell <- Sys.which("powershell")
    if (!nzchar(powershell)) powershell <- "powershell"
    wrapper <- file.path(scripts, "run-heavy-r.ps1")
    payload <- jsonlite::toJSON(args, auto_unbox = TRUE)
    status <- system2(powershell, c(
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", shQuote(wrapper),
      "-Script", shQuote(script), "-ScriptArgumentsJson", shQuote(payload)
    ))
  } else {
    wrapper <- file.path(scripts, "run-heavy-r.sh")
    status <- system2("sh", c(shQuote(wrapper), "Rscript", shQuote(script),
                              shQuote(args)))
  }
  quit(save = "no", status = status)
}
