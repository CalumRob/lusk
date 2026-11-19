# helper-mobilite-retrait -------------------------------------------------------
# Les 29 identifiants du snapshot porté retirés en #1048 (slice 2). Source
# indépendante : #1048 « Removed — 29 indicator keys » / CONTEXT.md. C'est la
# liste nominale que le catalogue déclare comme `excluded_legacy_accessibility`
# dans ses scalar_contracts pour que le backend retire les faits à la
# publication — jamais une liste dérivée du catalogue lui-même.
INDICATEURS_MOBILITE_RETIRES <- c(
  "tot_loss_t", "tot_loss_b",
  "avg_tot_car", "avg_tot_b", "avg_tot_t",
  "avg_div_car", "avg_div_b", "avg_div_t",
  "iso_alimentation", "iso_sante", "iso_administration", "iso_ecole", "iso_banque",
  "share_food_t", "share_food_b", "share_food_c",
  "share_health_t", "share_health_b", "share_health_c",
  "share_admin_t", "share_admin_b", "share_admin_c",
  "share_school_t", "share_school_b", "share_school_c",
  "share_bank_t", "share_bank_b", "share_bank_c",
  "nb_buildings"
)
