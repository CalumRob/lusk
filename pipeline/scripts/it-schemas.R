# Read-only: print the non-system schema names of lusk_it_contract, one per line.
con <- DBI::dbConnect(RPostgres::Postgres(), host = "192.168.1.120", port = 5432L,
                      dbname = "lusk_it_contract", user = "lusk_it_contract_pub")
on.exit(DBI::dbDisconnect(con))
DBI::dbExecute(con, "BEGIN TRANSACTION READ ONLY")
id <- DBI::dbGetQuery(con, "SELECT current_database() AS db, current_user AS usr")
stopifnot(identical(id$db, "lusk_it_contract"), identical(id$usr, "lusk_it_contract_pub"))
s <- DBI::dbGetQuery(con, paste(
  "SELECT nspname FROM pg_namespace WHERE nspname NOT IN ('public','information_schema')",
  "AND nspname NOT LIKE 'pg\\_%' ORDER BY 1"))$nspname
DBI::dbExecute(con, "ROLLBACK")
writeLines(s)
