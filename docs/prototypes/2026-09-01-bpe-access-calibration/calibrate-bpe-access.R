# BPE access-profile calibration -----------------------------------------------
#
# Throwaway calibration diagnostics for issue #541.  This script intentionally
# does not define production constants or choose a winning candidate.  It
# reads the current BPE24-backed snapshot, evaluates a small interpretable grid
# of global floors/gaps, and emits evidence for human review.

snapshot_path <- file.path("data", "processed", "mobilite",
                          "mobilite_snapshot.rds")
output_dir <- file.path("..", "docs", "prototypes",
                        "2026-09-01-bpe-access-calibration")

if (!file.exists(snapshot_path)) {
  stop("Snapshot introuvable : ", snapshot_path, call. = FALSE)
}
if (!dir.exists(output_dir)) dir.create(output_dir, recursive = TRUE)

snapshot <- readRDS(snapshot_path)

# The snapshot stores all metrics as the normalized table's columns.  Discover
# the canonical universe from complete `has` triptychs rather than copying a
# code list into this diagnostic.
has_columns <- grep("^has_[A-Z][0-9]{3}_[tbc]_raw$",
                    names(snapshot), value = TRUE)
if (!length(has_columns)) {
  stop("Aucune colonne has_<TYPE>_<MODE>_raw dans le snapshot.", call. = FALSE)
}

parts <- strcapture(
  "^has_([A-Z][0-9]{3})_([tbc])_raw$",
  has_columns,
  proto = list(code = character(), mode = character())
)
codes <- sort(unique(parts$code))
required <- as.vector(outer(
  codes, c("t", "b", "c"),
  FUN = function(code, mode) paste0("has_", code, "_", mode, "_raw")
))
missing <- setdiff(required, names(snapshot))
if (length(missing)) {
  stop("Triptyques has incomplets : ", paste(missing, collapse = ", "),
       call. = FALSE)
}

as_number <- function(x) suppressWarnings(as.numeric(as.character(x)))

context <- if ("raison_sociale" %in% names(snapshot)) {
  as.character(snapshot$raison_sociale)
} else {
  rep(NA_character_, nrow(snapshot))
}
department <- as.character(snapshot$code_departement_insee)
context_missing <- is.na(context) | !nzchar(context)
context[context_missing] <- paste0("Département ", department[context_missing])
context_type <- ifelse(context_missing, "departement", "epci")

# Small helper kept local to this throwaway script: the RDS normally has both
# raw and normalized identity names depending on which seam produced it.
`%||%` <- function(x, y) {
  if (!is.null(x)) x else y
}

# Long table: one row per commune × BPE type.  The classification unit is a
# type case, not a building or a service-family aggregate.
cases <- do.call(rbind, lapply(codes, function(code) {
  data.frame(
    commune = as.character(snapshot$code_insee %||% snapshot$commune),
    nom = as.character(snapshot$nom_commune %||% snapshot$nom),
    departement = department,
    context = context,
    context_type = context_type,
    type_code = code,
    t = as_number(snapshot[[paste0("has_", code, "_t_raw")]]),
    b = as_number(snapshot[[paste0("has_", code, "_b_raw")]]),
    c = as_number(snapshot[[paste0("has_", code, "_c_raw")]]),
    stringsAsFactors = FALSE
  )
}))
rownames(cases) <- NULL

bad_values <- cases[!complete.cases(cases[c("t", "b", "c")]) |
                      cases$t < 0 | cases$t > 1 |
                      cases$b < 0 | cases$b > 1 |
                      cases$c < 0 | cases$c > 1, ]
write.csv(bad_values,
          file.path(output_dir, "invalid-coverage-values.csv"),
          row.names = FALSE, na = "")

valid <- cases[complete.cases(cases[c("t", "b", "c")]) &
                cases$t >= 0 & cases$t <= 1 &
                cases$b >= 0 & cases$b <= 1 &
                cases$c >= 0 & cases$c <= 1, ]

# Source diagnostics independent of any candidate thresholds.
anomalies <- rbind(
  transform(valid[valid$b < valid$t, ], anomaly = "bike_below_foot_transit",
            delta = valid$b[valid$b < valid$t] - valid$t[valid$b < valid$t]),
  transform(valid[valid$c < valid$b, ], anomaly = "car_below_bike",
            delta = valid$c[valid$c < valid$b] - valid$b[valid$c < valid$b])
)
if (nrow(anomalies)) {
  anomalies <- anomalies[order(anomalies$anomaly, anomalies$delta,
                               anomalies$type_code, anomalies$commune), ]
}
write.csv(anomalies,
          file.path(output_dir, "mode-order-anomalies.csv"),
          row.names = FALSE, na = "")

coverage_summary <- do.call(rbind, lapply(c("t", "b", "c"), function(mode) {
  x <- valid[[mode]]
  data.frame(
    mode = mode,
    n = length(x),
    mean = mean(x),
    median = stats::median(x),
    zero_share = mean(x == 0),
    one_share = mean(x == 1),
    q05 = unname(stats::quantile(x, .05)),
    q25 = unname(stats::quantile(x, .25)),
    q75 = unname(stats::quantile(x, .75)),
    q95 = unname(stats::quantile(x, .95)),
    stringsAsFactors = FALSE
  )
}))
write.csv(coverage_summary,
          file.path(output_dir, "coverage-summary.csv"),
          row.names = FALSE)

# Candidate values are intentionally small and interpretable.  Floors are
# mode-specific in the candidate contract; the first pass varies coherent
# floor sets rather than pretending the current data justifies 125 arbitrary
# combinations.  Gaps use inclusive >= comparisons.
floor_sets <- data.frame(
  floor_set = c("permissive", "low", "moderate", "strict"),
  floor_t = c(.01, .05, .10, .20),
  floor_b = c(.01, .05, .10, .20),
  floor_c = c(.01, .05, .10, .20),
  stringsAsFactors = FALSE
)
gap_sets <- expand.grid(
  gap_car = c(.05, .10, .20, .30),
  gap_bike = c(.05, .10, .20, .30),
  KEEP.OUT.ATTRS = FALSE,
  stringsAsFactors = FALSE
)

profiles <- c(
  "La voiture est requise",
  "Accès à pied ou en TC possible",
  "Le vélo compense",
  "Inaccessible ou presque en 20 minutes"
)

classify <- function(x, floor_t, floor_b, floor_c, gap_car, gap_bike) {
  no_access <- x$c < floor_c & x$b < floor_b & x$t < floor_t
  car <- !no_access & x$c >= floor_c & (x$c - x$b) >= gap_car
  bike <- !no_access & !car & x$b >= floor_b & (x$b - x$t) >= gap_bike
  out <- rep(profiles[[2]], nrow(x))
  out[no_access] <- profiles[[4]]
  out[car] <- profiles[[1]]
  out[bike] <- profiles[[3]]
  factor(out, levels = profiles)
}

candidate_grid <- merge(floor_sets, gap_sets)
candidate_grid$candidate_id <- sprintf(
  "floor-%s__car-%.2f__bike-%.2f",
  candidate_grid$floor_set, candidate_grid$gap_car, candidate_grid$gap_bike
)
candidate_grid <- candidate_grid[order(candidate_grid$candidate_id), ]
rownames(candidate_grid) <- NULL

profile_rows <- list()
candidate_rows <- list()
exemplar_rows <- list()
boundary_rows <- list()

for (i in seq_len(nrow(candidate_grid))) {
  candidate <- candidate_grid[i, ]
  classified <- classify(valid, candidate$floor_t, candidate$floor_b,
                         candidate$floor_c, candidate$gap_car,
                         candidate$gap_bike)
  valid$profile <- classified
  counts <- table(classified)
  shares <- as.numeric(counts) / sum(counts)

  candidate_rows[[i]] <- data.frame(
    candidate_id = candidate$candidate_id,
    floor_set = candidate$floor_set,
    floor_t = candidate$floor_t,
    floor_b = candidate$floor_b,
    floor_c = candidate$floor_c,
    gap_car = candidate$gap_car,
    gap_bike = candidate$gap_bike,
    non_empty_profiles = sum(counts > 0),
    min_profile_share = min(shares),
    max_profile_share = max(shares),
    entropy_normalized = if (all(shares > 0)) {
      -sum(shares * log(shares)) / log(length(shares))
    } else 0,
    stringsAsFactors = FALSE
  )

  profile_rows[[i]] <- do.call(rbind, lapply(seq_along(profiles), function(j) {
    rows <- valid[classified == profiles[[j]], ]
    data.frame(
      candidate_id = candidate$candidate_id,
      profile = profiles[[j]],
      n = nrow(rows),
      share = nrow(rows) / nrow(valid),
      mean_c = if (nrow(rows)) mean(rows$c) else NA_real_,
      median_c = if (nrow(rows)) stats::median(rows$c) else NA_real_,
      mean_t = if (nrow(rows)) mean(rows$t) else NA_real_,
      median_t = if (nrow(rows)) stats::median(rows$t) else NA_real_,
      mean_b = if (nrow(rows)) mean(rows$b) else NA_real_,
      median_b = if (nrow(rows)) stats::median(rows$b) else NA_real_,
      stringsAsFactors = FALSE
    )
  }))

  # Profile rarity is calculated in the available EPCI context, with a
  # department fallback for rows without an EPCI name.  It is evidence for
  # exemplar selection only; no public rarity field is invented here.
  group_key <- interaction(valid$type_code, valid$context, drop = TRUE,
                           lex.order = TRUE)
  profile_key <- interaction(valid$type_code, valid$context, classified,
                             drop = TRUE, lex.order = TRUE)
  denominator <- ave(rep(1, nrow(valid)), group_key, FUN = length)
  numerator <- ave(as.integer(classified == classified), profile_key,
                   FUN = length)
  rarity <- numerator / denominator

  signal <- rep(NA_real_, nrow(valid))
  signal[classified == profiles[[4]]] <- -pmax(
    valid$c[classified == profiles[[4]]],
    valid$b[classified == profiles[[4]]],
    valid$t[classified == profiles[[4]]]
  )
  signal[classified == profiles[[1]]] <- -pmax(
    valid$b[classified == profiles[[1]]],
    valid$t[classified == profiles[[1]]]
  )
  signal[classified == profiles[[3]]] <-
    valid$b[classified == profiles[[3]]] - valid$t[classified == profiles[[3]]]
  signal[classified == profiles[[2]]] <- valid$t[classified == profiles[[2]]]

  valid$rarity <- rarity
  valid$signal <- signal
  valid$candidate_id <- candidate$candidate_id
  exemplar <- do.call(rbind, lapply(profiles, function(profile) {
    rows <- valid[classified == profile, ]
    if (!nrow(rows)) return(NULL)
    rows <- rows[order(-rows$signal, rows$rarity, rows$type_code,
                       rows$commune), ]
    rows[1, c("candidate_id", "type_code", "commune", "nom", "context",
              "profile", "c", "t", "b", "rarity", "signal")]
  }))
  if (!is.null(exemplar)) exemplar_rows[[i]] <- exemplar

  boundary_distance <- pmin(
    abs(valid$c - candidate$floor_c),
    abs(valid$b - candidate$floor_b),
    abs(valid$t - candidate$floor_t),
    abs((valid$c - valid$b) - candidate$gap_car),
    abs((valid$b - valid$t) - candidate$gap_bike)
  )
  boundary <- valid[boundary_distance <= .01, ]
  if (nrow(boundary)) {
    boundary$candidate_id <- candidate$candidate_id
    boundary$boundary_distance <- boundary_distance[boundary_distance <= .01]
    # There can be hundreds of thousands of exact-zero cases (especially
    # coverage values at 0 or 1). Keep the diagnostic reviewable while making
    # the selection deterministic: the closest 12 cases per profile, then
    # stable code/commune ordering.
    boundary <- do.call(rbind, lapply(profiles, function(profile) {
      rows <- boundary[boundary$profile == profile, ]
      if (!nrow(rows)) return(NULL)
      rows <- rows[order(rows$boundary_distance, rows$type_code,
                         rows$commune), ]
      utils::head(rows, 12)
    }))
    boundary_rows[[i]] <- boundary[, c(
      "candidate_id", "type_code", "commune", "nom", "context", "profile",
      "c", "t", "b", "boundary_distance"
    )]
  }
}

candidate_summary <- do.call(rbind, candidate_rows)
profile_summary <- do.call(rbind, profile_rows)
exemplars <- if (length(exemplar_rows)) do.call(rbind, exemplar_rows) else data.frame()
boundaries <- if (length(boundary_rows)) do.call(rbind, boundary_rows) else data.frame()

write.csv(candidate_summary,
          file.path(output_dir, "candidate-summary.csv"), row.names = FALSE)
write.csv(profile_summary,
          file.path(output_dir, "candidate-profile-stats.csv"), row.names = FALSE)
write.csv(exemplars,
          file.path(output_dir, "candidate-exemplars.csv"), row.names = FALSE)
write.csv(boundaries,
          file.path(output_dir, "candidate-boundary-cases.csv"), row.names = FALSE)

fmt <- function(x, digits = 3) formatC(x, format = "f", digits = digits)
top <- candidate_summary[order(-candidate_summary$entropy_normalized,
                               -candidate_summary$min_profile_share), ]
top <- utils::head(top, 8)

report <- c(
  "# BPE access-profile calibration report",
  "",
  "> Throwaway evidence for issue #541. No threshold is selected by this run.",
  "",
  "## Input",
  "",
  sprintf("- Snapshot: `%s`", snapshot_path),
  sprintf("- Commune rows: %d", length(unique(valid$commune))),
  sprintf("- BPE types: %d", length(codes)),
  sprintf("- Valid type cases: %d", nrow(valid)),
  sprintf("- Invalid/missing type cases: %d", nrow(bad_values)),
  "- Primary measure: `has_<TYPE>_<MODE>_raw` (building-coverage proportion).",
  "- `med_*` fields are intentionally excluded from classification.",
  "",
  "## Mode-order diagnostics",
  "",
  sprintf("- `b < t`: %d cases", sum(valid$b < valid$t)),
  sprintf("- `c < b`: %d cases", sum(valid$c < valid$b)),
  "",
  "These cases are retained for review; the script does not silently repair or",
  "clamp coverage values.",
  "",
  "## Candidate grid",
  "",
  sprintf("- %d floor/gap candidates evaluated.", nrow(candidate_grid)),
  "- No automatic winner: entropy and minimum profile share are inspection aids,",
  "  not an optimization target.",
  "",
  "| Candidate | No. profiles | Min share | Max share | Normalized entropy |",
  "|---|---:|---:|---:|---:|",
  vapply(seq_len(nrow(top)), function(i) {
    x <- top[i, ]
    sprintf("| `%s` | %d | %s | %s | %s |", x$candidate_id,
            x$non_empty_profiles, fmt(x$min_profile_share),
            fmt(x$max_profile_share), fmt(x$entropy_normalized))
  }, character(1)),
  "",
  "## Output files",
  "",
  "- `coverage-summary.csv` — pooled `t/b/c` distributions.",
  "- `mode-order-anomalies.csv` — retained `b < t` and `c < b` cases.",
  "- `candidate-summary.csv` — one row per floor/gap candidate.",
  "- `candidate-profile-stats.csv` — count, share, mean, and median by profile.",
  "- `candidate-exemplars.csv` — deterministic rare-profile inspection cases.",
  "- `candidate-boundary-cases.csv` — cases within 0.01 of a floor or gap.",
  "- `invalid-coverage-values.csv` — missing or out-of-range inputs.",
  "",
  "The canonical universe is the 53-type universe carried by this snapshot.",
  "Mode-order anomalies are retained as rare valid observations; they are not",
  "silently clamped. Threshold constants still require human review before",
  "they are frozen."
)
writeLines(report, file.path(output_dir, "calibration-report.md"), useBytes = TRUE)

message("Wrote BPE calibration artifacts to ", normalizePath(output_dir))
