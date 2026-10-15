# Transport for constrained, already-projected serving artifacts. Family
# projectors and validators own meaning/schema; this helper owns only immutable
# generation staging, typed Parquet tables, JSON descriptor sidecars, and checks.
typed_artifact_hash <- function(paths) {
  identity <- tempfile("typed-artifact-hash-")
  on.exit(unlink(identity), add=TRUE)
  hashes <- unname(tools::md5sum(paths))
  writeLines(paste(names(paths), hashes, sep="="), identity, useBytes=TRUE)
  unname(tools::md5sum(identity))
}

typed_value_schema <- function(value) {
  if (is.null(value)) return(list(kind="null"))
  if (is.data.frame(value)) {
    raw_row_names <- .row_names_info(value, 0L)
    compact <- is.integer(raw_row_names) && length(raw_row_names) == 2L && is.na(raw_row_names[[1L]])
    row_names_form <- if (compact && raw_row_names[[2L]] < 0L) "automatic_compact" else
      if (compact) "explicit_compact" else "explicit_vector"
    return(list(kind="data.frame", class=as.list(class(value)),
    row_names=as.list(raw_row_names), row_names_form=row_names_form,
    row_names_type=typeof(raw_row_names),
    attribute_names=as.list(names(attributes(value))),
    columns=stats::setNames(lapply(value, typed_value_schema), names(value))))
  }
  if (is.list(value)) return(list(kind="list", names=if (is.null(names(value))) NULL else as.list(names(value)),
    values=stats::setNames(lapply(seq_along(value), function(i) typed_value_schema(value[[i]])),
      if (is.null(names(value))) as.character(seq_along(value)) else names(value))))
  schema <- list(kind="atomic", type=typeof(value), class=if (is.null(class(value))) NULL else as.list(class(value)),
    names=if (is.null(names(value))) NULL else as.list(names(value)))
  if (typeof(value) == "double" && length(value)) {
    missing <- which(is.na(value))
    if (length(missing)) {
      bytes <- writeBin(as.double(value), raw(), size=8L, endian="big")
      starts <- (missing - 1L) * 8L + 1L
      payload <- vapply(starts, function(start)
        paste(sprintf("%02x", as.integer(bytes[start + 0:7])), collapse=""), character(1))
      groups <- split(missing, payload)
      schema$missing_double_payloads <- lapply(names(groups), function(hex) list(
        hex=hex, indices=as.list(as.integer(groups[[hex]]))))
    }
  }
  schema
}

validate_typed_value_schema <- function(schema) {
  if (!is.list(schema) || length(schema$kind) != 1L || is.na(schema$kind))
    stop("Typed artifact schema node is invalid", call.=FALSE)
  if (identical(schema$kind, "null")) return(invisible(TRUE))
  if (identical(schema$kind, "atomic")) {
    allowed_types <- c("character","integer","double","logical","raw")
    classes <- unlist(schema$class, use.names=FALSE)
    if (length(schema$type) != 1L || !schema$type %in% allowed_types ||
        any(!classes %in% c("Date","POSIXct","POSIXt","numeric","integer","character","logical","raw")) ||
        ("Date" %in% classes && !identical(schema$type,"double") && !identical(schema$type,"integer")) ||
        (!is.null(schema$names) && !is.list(schema$names)))
      stop("Typed artifact atomic schema is outside the supported contract (type=",
        schema$type, ", class=", paste(classes,collapse=","), ")", call.=FALSE)
    if (!is.null(schema$missing_double_payloads)) {
      if (!identical(schema$type,"double") || !is.list(schema$missing_double_payloads))
        stop("Typed artifact missing-double schema is invalid", call.=FALSE)
      for (group in schema$missing_double_payloads)
        if (!is.list(group) || length(group$hex) != 1L || !is.list(group$indices))
          stop("Typed artifact missing-double group is invalid", call.=FALSE)
    }
    return(invisible(TRUE))
  }
  if (identical(schema$kind, "data.frame")) {
    classes <- unlist(schema$class, use.names=FALSE)
    attrs <- unlist(schema$attribute_names, use.names=FALSE)
    if (!identical(tail(classes,1L),"data.frame") ||
        any(!classes %in% c("tbl_df","tbl","data.frame")) ||
        !setequal(attrs,c("names","row.names","class")) ||
        anyDuplicated(attrs) || !schema$row_names_form %in% c("automatic_compact","explicit_compact","explicit_vector") ||
        !schema$row_names_type %in% c("integer","character") || !is.list(schema$columns))
      stop("Typed artifact dataframe schema is invalid (class=",paste(classes,collapse=","),
        "; attrs=",paste(attrs,collapse=","),"; row form=",schema$row_names_form,
        "; row type=",schema$row_names_type,")", call.=FALSE)
    for (column in schema$columns) validate_typed_value_schema(column)
    return(invisible(TRUE))
  }
  if (identical(schema$kind,"list")) {
    if (!is.list(schema$values) || (!is.null(schema$names) && !is.list(schema$names)))
      stop("Typed artifact list schema is invalid", call.=FALSE)
    for (element in schema$values) validate_typed_value_schema(element)
    return(invisible(TRUE))
  }
  stop("Unknown typed artifact schema node", call.=FALSE)
}

restore_typed_value <- function(value, schema) {
  if (identical(schema$kind, "null")) return(NULL)
  if (identical(schema$kind, "atomic")) {
    values <- if (is.list(value)) unlist(value, recursive=TRUE, use.names=FALSE) else value
    result <- switch(schema$type, character=as.character(values), integer=as.integer(values),
      double=as.numeric(values), logical=as.logical(values), raw=as.raw(values), values)
    if (identical(schema$type, "double") && length(schema$missing_double_payloads)) {
      raw_values <- writeBin(as.double(result), raw(), size=8L, endian="big")
      expected_indices <- integer()
      for (group in schema$missing_double_payloads) {
        indices <- as.integer(unlist(group$indices, use.names=FALSE))
        hex <- as.character(group$hex)
        if (!length(indices) || anyNA(indices) || any(indices < 1L | indices > length(result)) ||
            anyDuplicated(indices) || length(hex) != 1L || is.na(hex) ||
            !grepl("^[0-9a-f]{16}$", hex))
          stop("Invalid missing-double payload metadata", call.=FALSE)
        bytes <- as.raw(strtoi(substring(hex, seq(1L, 15L, 2L), seq(2L, 16L, 2L)), 16L))
        if (length(bytes) != 8L) stop("Invalid missing-double payload encoding", call.=FALSE)
        check <- readBin(bytes, what=double(), n=1L, size=8L, endian="big")
        if (!is.na(check)) stop("Missing-double payload encodes a non-missing value", call.=FALSE)
        expected_indices <- c(expected_indices, indices)
        for (index in indices) {
          offsets <- (index - 1L) * 8L + seq_len(8L)
          raw_values[offsets] <- bytes
        }
      }
      if (anyDuplicated(expected_indices) ||
          !identical(sort(expected_indices), which(is.na(result))))
        stop("Missing-double payload indices do not match decoded missing values", call.=FALSE)
      connection <- rawConnection(raw_values, "rb")
      on.exit(close(connection), add=TRUE)
      result <- readBin(connection, what=double(), n=length(result), size=8L, endian="big")
    }
    if (!is.null(schema$class)) {
      classes <- unlist(schema$class, use.names=FALSE)
      if ("Date" %in% classes) {
        date_value <- if (inherits(value, "Date")) value else as.Date(as.character(values))
        result <- switch(schema$type, integer=as.integer(unclass(date_value)), double=as.double(unclass(date_value)), unclass(date_value))
        class(result) <- classes
      } else if ("POSIXct" %in% classes) {
        time_value <- if (inherits(value, "POSIXct")) value else as.POSIXct(values, tz="UTC")
        result <- switch(schema$type, integer=as.integer(unclass(time_value)), double=as.double(unclass(time_value)), unclass(time_value))
        class(result) <- classes
      }
      else class(result) <- classes
    }
    if (!is.null(schema$names)) names(result) <- unlist(schema$names, use.names=FALSE)
    return(result)
  }
  if (identical(schema$kind, "data.frame")) {
    if (is.data.frame(value)) {
      result <- value
      for (column in names(schema$columns))
        result[[column]] <- restore_typed_value(result[[column]], schema$columns[[column]])
    } else {
      rows <- value %||% list()
      columns <- lapply(names(schema$columns), function(column) {
        cells <- lapply(rows, function(row) row[[column]])
        restore_typed_value(cells, schema$columns[[column]])
      })
      result <- as.data.frame(stats::setNames(columns, names(schema$columns)), stringsAsFactors=FALSE)
    }
    class(result) <- unlist(schema$class, use.names=FALSE)
    desired <- unlist(schema$attribute_names, use.names=FALSE)
    attributes(result) <- attributes(result)[desired]
    row_names_type <- schema$row_names_type
    row_names <- unlist(schema$row_names, use.names=FALSE)
    if (identical(schema$row_names_form, "automatic_compact")) {
      row.names(result) <- NULL
    } else if (identical(schema$row_names_form, "explicit_compact")) {
      attr(result, "row.names") <- c(NA_integer_, as.integer(nrow(result)))
    } else {
      if (identical(row_names_type, "integer")) row_names <- as.integer(row_names)
      else if (identical(row_names_type, "character")) row_names <- as.character(row_names)
      if (length(row_names) == nrow(result)) attr(result, "row.names") <- row_names
    }
    return(result)
  }
  if (identical(schema$kind, "list")) {
    schemas <- schema$values
    if (is.null(names(schemas))) schemas <- as.list(schemas)
    keys <- names(schemas)
    if (is.null(keys)) keys <- as.character(seq_along(schemas))
    result <- lapply(seq_along(schemas), function(i) {
      item <- if (!is.null(names(value)) && keys[[i]] %in% names(value)) value[[keys[[i]]]] else value[[i]]
      restore_typed_value(item, schemas[[i]])
    })
    if (!is.null(schema$names)) names(result) <- unlist(schema$names, use.names=FALSE)
    return(result)
  }
  stop("Unknown typed JSON schema node", call.=FALSE)
}

write_typed_artifact <- function(projection, directory, family, owner,
    table_fields, json_fields, version_fn, validator, decode_json) {
  if (!is.list(projection) || !identical(sort(names(projection)),
      sort(c(table_fields, json_fields))) || !is.function(version_fn) ||
      !is.function(validator) || !is.function(decode_json))
    stop("Typed artifact projection fields or codecs are invalid", call.=FALSE)
  validator(projection)
  if (!dir.exists(directory)) dir.create(directory, recursive=TRUE)
  pending <- tempfile(".typed-generation-", tmpdir=directory)
  dir.create(pending)
  installed <- FALSE
  on.exit(if (!installed && dir.exists(pending)) unlink(pending, recursive=TRUE), add=TRUE)
  for (field in table_fields)
    nanoparquet::write_parquet(projection[[field]], file.path(pending, paste0(field, ".parquet")))
  for (field in json_fields)
    jsonlite::write_json(projection[[field]], file.path(pending, paste0(field, ".json")),
      na="null", digits=17, auto_unbox=TRUE, pretty=TRUE)
  files <- c(if (length(table_fields)) paste0(table_fields, ".parquet"),
    if (length(json_fields)) paste0(json_fields, ".json"))
  paths <- stats::setNames(file.path(pending, files), files)
  storage_version <- typed_artifact_hash(paths)
  semantic_version <- version_fn(projection)
  hashes <- as.list(unname(tools::md5sum(paths)))
  names(hashes) <- files
  table_schemas <- stats::setNames(lapply(table_fields, function(field) typed_value_schema(projection[[field]])), table_fields)
  json_schemas <- stats::setNames(lapply(json_fields, function(field) typed_value_schema(projection[[field]])), json_fields)
  jsonlite::write_json(list(family=family, owner=owner, storage_version=storage_version,
    semantic_version=semantic_version, table_fields=as.list(table_fields),
    json_fields=as.list(json_fields), projection_fields=as.list(names(projection)),
    table_schemas=table_schemas, json_schemas=json_schemas,
    row_names=as.list(stats::setNames(lapply(table_fields, function(field) {
      current <- rownames(projection[[field]])
      if (identical(current, as.character(seq_len(nrow(projection[[field]]))))) NULL else current
    }), table_fields)), files=as.list(files), hashes=hashes),
    file.path(pending, "manifest.json"), auto_unbox=TRUE, pretty=TRUE)
  generation <- file.path(directory, paste0("generation-", storage_version))
  read_typed_artifact_generation(pending, family, owner, table_fields, json_fields,
    semantic_version, version_fn, validator, decode_json)
  if (dir.exists(generation)) {
    read_typed_artifact_generation(generation, family, owner, table_fields, json_fields,
      semantic_version, version_fn, validator, decode_json)
    unlink(pending, recursive=TRUE)
  } else if (!file.rename(pending, generation)) {
    if (!dir.exists(generation)) stop("Could not install typed artifact generation", call.=FALSE)
    read_typed_artifact_generation(generation, family, owner, table_fields, json_fields,
      semantic_version, version_fn, validator, decode_json)
    unlink(pending, recursive=TRUE)
  }
  installed <- TRUE
  read_typed_artifact_generation(generation, family, owner, table_fields, json_fields,
    semantic_version, version_fn, validator, decode_json)
  pointer <- file.path(directory, "current.json")
  if (file.exists(pointer)) {
    current <- jsonlite::fromJSON(pointer)
    if (identical(current$storage_version, storage_version) &&
        identical(current$semantic_version, semantic_version)) return(invisible(semantic_version))
  }
  temp <- tempfile(".typed-current-", tmpdir=directory)
  on.exit(unlink(temp), add=TRUE)
  jsonlite::write_json(list(family=family, owner=owner,
    generation=basename(generation), storage_version=storage_version,
    semantic_version=semantic_version), temp, auto_unbox=TRUE)
  fs::file_move(temp, pointer)
  invisible(semantic_version)
}

read_typed_artifact_generation <- function(generation, family, owner,
    table_fields, json_fields, expected_semantic_version, version_fn, validator,
    decode_json) {
  manifest_path <- file.path(generation, "manifest.json")
  if (!file.exists(manifest_path)) stop("Typed artifact generation is incomplete", call.=FALSE)
  manifest <- jsonlite::fromJSON(manifest_path, simplifyVector=FALSE)
  files <- c(if (length(table_fields)) paste0(table_fields, ".parquet"),
    if (length(json_fields)) paste0(json_fields, ".json"))
  if (!identical(manifest$family, family) || !identical(manifest$owner, owner) ||
      !identical(as.character(unname(unlist(manifest$files, use.names=FALSE))), files) ||
      !identical(as.character(unname(unlist(manifest$table_fields, use.names=FALSE))), table_fields) ||
      !identical(as.character(unname(unlist(manifest$json_fields, use.names=FALSE))), json_fields))
    stop("Typed artifact manifest contract mismatch", call.=FALSE)
  paths <- stats::setNames(file.path(generation, files), files)
  if (any(!file.exists(paths))) stop("Typed artifact table is missing: ",
    paste(paths[!file.exists(paths)],collapse=", "),call.=FALSE)
  hashes <- unname(tools::md5sum(paths))
  if (!identical(unname(unlist(manifest$hashes, use.names=FALSE)), hashes))
    stop("Typed artifact checksum mismatch", call.=FALSE)
  storage_version <- typed_artifact_hash(paths)
  if (!identical(manifest$storage_version, storage_version) ||
      (!is.null(expected_semantic_version) &&
       !identical(manifest$semantic_version, expected_semantic_version)))
    stop("Typed artifact version mismatch", call.=FALSE)
  projection_fields <- as.character(unlist(manifest$projection_fields, use.names=FALSE))
  if (!setequal(projection_fields, c(table_fields, json_fields)) || anyDuplicated(projection_fields))
    stop("Typed artifact projection field inventory mismatch", call.=FALSE)
  projection <- stats::setNames(lapply(projection_fields, function(field) {
    if (field %in% table_fields) {
      value <- as.data.frame(nanoparquet::read_parquet(
        file.path(generation, paste0(field, ".parquet"))), stringsAsFactors=FALSE)
      validate_typed_value_schema(manifest$table_schemas[[field]])
      restore_typed_value(value, manifest$table_schemas[[field]])
    } else {
      decoded <- decode_json(jsonlite::fromJSON(file.path(generation, paste0(field, ".json")), simplifyVector=FALSE), field)
      validate_typed_value_schema(manifest$json_schemas[[field]])
      restore_typed_value(decoded, manifest$json_schemas[[field]])
    }
  }), projection_fields)
  validator(projection)
  actual_semantic_version <- as.character(version_fn(projection))
  if (!identical(actual_semantic_version, as.character(manifest$semantic_version)))
    stop("Typed artifact semantic content version mismatch", call.=FALSE)
  projection
}

read_typed_artifact <- function(directory, family, owner, table_fields, json_fields,
    version_fn, validator, decode_json) {
  pointer_path <- file.path(directory, "current.json")
  if (!file.exists(pointer_path)) stop("Typed canonical artifact is missing", call.=FALSE)
  pointer <- jsonlite::fromJSON(pointer_path)
  if (!identical(pointer$family, family) || !identical(pointer$owner, owner) ||
      !grepl("^[a-f0-9]{32}$", pointer$storage_version) ||
      !identical(pointer$generation, paste0("generation-", pointer$storage_version)))
    stop("Typed artifact pointer is invalid", call.=FALSE)
  root <- normalizePath(directory, winslash="/", mustWork=TRUE)
  generation <- normalizePath(file.path(root, pointer$generation), winslash="/", mustWork=TRUE)
  if (!startsWith(paste0(generation, "/"), paste0(root, "/")))
    stop("Typed artifact generation escapes owner directory", call.=FALSE)
  result <- read_typed_artifact_generation(generation, family, owner, table_fields,
    json_fields, pointer$semantic_version, version_fn, validator, decode_json)
  if (!identical(pointer$storage_version,
      sub("^generation-", "", basename(generation))))
    stop("Typed artifact pointer generation mismatch", call.=FALSE)
  result
}
