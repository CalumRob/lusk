# Cahier — contract de contenu Mobilité

Variant E exposes four ContentUnits in the order declared in `theme_mobilite.json`:

| Order | Subgroup | Content contract | Availability |
|---|---|---|---|
| 1 | `acces-aux-services` | Summary, BPE profiles, essential-service access, building distribution. Published `iso_*`, `avg_tot_*`, `avg_div_*`, and `nb_buildings` remain attached to relevant content as explorables. | Preserve `complete` / `incomplete` / `absent`; never infer missing access. |
| 2 | `partage-de-lespace-public` | Absolute and per-inhabitant network lengths, road-surface scalar, cycling offer, parking. | Absolute and per-inhabitant network measures stay distinct. |
| 3 | `motorisation` | Household car composition (`voitures_menage`), charging stations, stations per service station. | Each category/scalar is only shown when the payload carries it; no substitute zero. |
| 4 | `offre-transports-commun` | Stop proximity (`offre_tc`) and connectivity trajectory (`raccordement_courbe`) against its published reference series (`raccordement_reference`). | Do not manufacture a curve or reference when absent. |

Facts, values, provenance and comparison scope come from normalized `TerritoryFacts` and published metadata. Renderers own only the figure grammar. The E pagination input is `content.units`, yielding four ordered Mobilité pages; the book's global page numbers still include other theme subgroups.
