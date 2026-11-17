/**
 * App-owned display wording of the exported value tables (#1024).
 *
 * The approved generator (`pdf-prototype/desktop.js`) prints two table shapes,
 * and these are its stable editorial labels — never a fact:
 *
 * - shape A (`appendTimeRampTables`): a flat table per ramp panel whose first
 *   column is the time cut (`Temps`) and whose second column names the mode;
 * - shape B (`appendSandboxTables`): one table per panel, rows = the panel's
 *   x-axis categories, columns grouped by legend key (`Temps` for the volume
 *   ramp, `Statistique` for the distribution) with one territory/`Groupe¹`/
 *   `Rang` triplet per group.
 *
 * The data, the categories, the mode identities and the served values/ranks
 * stay producer/API-owned; only these headings are app presentation.
 */

/** Row-dimension header of the time-ramp tables. */
export const TABLEAU_TEMPS_LABEL = 'Temps'

/** Row-dimension header of the distribution table. */
export const TABLEAU_STATISTIQUE_LABEL = 'Statistique'

/** Mode column of the flat access table (approved `desktop.js:220`). */
export const TABLEAU_MODE_LABEL = 'Mode'

/**
 * Sub-header of the compared cell inside a legend-key group. The approved
 * generator renders `Groupe` plus its `¹` footnote reference; the painter owns
 * the mark so the cell text stays the word.
 */
export const TABLEAU_GROUPE_LABEL = 'Groupe'
