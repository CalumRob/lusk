# ONE definition of PostgreSQL positional IN ($1,...) placeholders (#1142).
# RPostgres sends a length-one vector as a scalar, so `ANY($1::text[])` fails
# ("malformed array literal") whenever a key set has one member. Every caller that
# filters on a set of keys builds `IN (...)` with these unnamed positional
# parameters; there is no second implementation (typed readings and adoption share
# this file).

in_params <- function(values, start = 1L) {
  paste0("$", seq.int(start, length.out = length(values)), collapse = ",")
}

# `WHERE <colonne> IN ($1,...)` plus its unnamed positional params, or NULL when
# there is no key to select by.
clause_in_positionnelle <- function(valeurs, colonne) {
  valeurs <- unique(as.character(valeurs))
  valeurs <- valeurs[!is.na(valeurs) & nzchar(valeurs)]
  if (!length(valeurs)) return(NULL)
  list(where = paste0(" WHERE ", colonne, " IN (", in_params(valeurs), ")"),
       params = as.list(valeurs))
}
