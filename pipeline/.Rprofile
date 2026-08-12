source("renv/activate.R")

# testthat parallèle (issue #330) : le nombre de workers par défaut est
# getOption("Ncpus", 2) — sans cette ligne, un run nu plafonne à 2 workers
# (~90 s). Plafond à 4 : benchmark 2026-08-12 — 4 workers ≈ 78 s (CPU moyen
# 37 %, pic 68 %) contre 8 workers ≈ 69 s (CPU moyen 47 %, pic 94 % qui gèle
# la machine) ; 16 workers ≈ 40 s mais CPU à 100 %. Le min() garde
# l'adaptation à la machine (2 sur un runner GH standard) : le plafond ne
# mord jamais en CI.
options(Ncpus = min(parallel::detectCores(), 4L))
