# test-download-timeout --------------------------------------------------------
# Le seam du timeout de téléchargement (issue #105) : sur R 4.4.1 (version
# épinglée), utils::download.file n'a PAS d'argument `timeout` — le seul levier
# est l'option globale options(timeout=), par défaut 60 s. Mesuré en réel :
# l'export SIRENE prend ~112 s (un run froid mode full échoue avec
# « Timeout of 60 seconds ») et le zip chômage (~121 Mo, mode cron, type
# fichier) frôle le même plafond.
# Le fix vit AU SEAM : telecharger_fichier applique une constante nommée
# (TELECHARGEMENT_TIMEOUT) autour de l'appel et la restaure avec on.exit() —
# l'option globale n'est jamais laissée modifiée. Jamais de réseau dans la
# boucle de test : utils::download.file est mocké (motif maison), on n'observe
# que l'option.

test_that("TELECHARGEMENT_TIMEOUT relève le timeout par défaut de 60 s", {
  # garde-fou de la constante elle-même : si elle retombe à 60 (la valeur par
  # défaut de R), le plafond n'est plus relevé et le fix a régressé
  expect_true(TELECHARGEMENT_TIMEOUT > 60)
})

test_that("telecharger_fichier applique TELECHARGEMENT_TIMEOUT pendant le téléchargement", {
  # le téléchargement est mocké — jamais de réseau ; on capture l'option
  # DANS l'appel mocké : c'est là que le 60 s par défaut doit être levé
  timeout_pendant <- NULL
  local_mocked_bindings(
    download.file = function(url, destfile, ...) {
      timeout_pendant <<- getOption("timeout")
      invisible(NULL)
    },
    .package = "utils"
  )

  telecharger_fichier("https://example.invalid/x", tempfile("cible-"))

  expect_equal(timeout_pendant, TELECHARGEMENT_TIMEOUT)
})

test_that("telecharger_fichier restaure l'option timeout après l'appel", {
  # un sentinelle : quelle que soit la valeur précédente, elle doit être
  # rendue telle quelle — aucune fuite d'état global après le retour
  options(timeout = 123)
  on.exit(options(timeout = 60), add = TRUE)

  local_mocked_bindings(
    download.file = function(url, destfile, ...) invisible(NULL),
    .package = "utils"
  )

  telecharger_fichier("https://example.invalid/x", tempfile("cible-"))

  expect_equal(getOption("timeout"), 123)
})
