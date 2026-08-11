source("renv/activate.R")

# testthat parallèle (issue #330) : le nombre de workers par défaut est
# getOption("Ncpus", 2) — sans cette ligne, un run nu plafonne à 2 workers
# (~90 s au lieu de ~40 s sur cette machine, 16 cœurs). detectCores() s'adapte
# à la machine (2 sur un runner GH standard) : pas de hardcode.
options(Ncpus = parallel::detectCores())
