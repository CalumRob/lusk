# Construit la table des communes bretonnes depuis le cache brut (ticket 2).
pkgload::load_all(".", quiet = TRUE)
cat("loaded ok\n")

brut <- tryCatch(
  construire_donnees_brut(),
  error = function(e) {
    cat("BUILD ERROR:", conditionMessage(e), "\n")
    cat("CALL:", deparse(conditionCall(e)), "\n")
    quit(status = 1)
  }
)

cat("ROWS:", nrow(brut), "\n")
cat("COLS:", paste(names(brut), collapse = ", "), "\n")
cat("--- Rennes (35238) ---\n")
print(as.data.frame(brut[brut$code == "35238", ]))
cat("--- par departement ---\n")
print(table(brut$departement))
