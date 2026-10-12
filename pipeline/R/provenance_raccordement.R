# Stable source fingerprints for checked-in routing recipes. Git's core.autocrlf
# may materialize these text files with CRLF on Windows, so normalize only the
# CRLF line-ending pair before hashing; preserve every other source byte.
empreinte_source_raccordement <- function(path) {
  if (length(path) != 1L || is.na(path) || !file.exists(path)) {
    stop("Source fingerprint requires one existing file path.", call. = FALSE)
  }
  connection <- file(path, "rb")
  on.exit(close(connection))
  bytes <- readBin(connection, what = "raw", n = file.info(path)$size)
  if (length(bytes) > 1L) {
    crlf <- bytes[-length(bytes)] == as.raw(13L) & bytes[-1L] == as.raw(10L)
    bytes <- bytes[!c(crlf, FALSE)]
  }
  paste0(openssl::sha256(bytes))
}
