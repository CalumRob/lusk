# Variant E — cartographic plate exploration

This note preserves the decisions behind the throwaway map-plate prototype in case the session is compacted. It is not yet a production specification. The representative rerender must answer the unresolved visual questions before a full map rerun is approved.

## Question

Can static network maps become an editorial figure inside Variant E’s « Partage de l’espace public » chapter without replacing the Cahier or breaking its masonry grammar?

## Settled decisions

### Place in the Cahier

- Keep Variant E’s Cahier and masonry grammar.
- Add one contained, two-column-wide cartographic group **above** the chapter’s ordinary masonry modules.
- The map group uses the same frame and title/tagline language as masonry groups rather than appearing as a separate atlas product.
- The top-right quadrant owns the group heading: title « Réseaux », tagline « Trois réseaux, trois empreintes ».
- The 2 × 2 composition is:
  - top-left: automobile map;
  - top-right: title/tagline and compact evidence;
  - bottom-left: pedestrian map;
  - bottom-right: cycling map.
- « Stationnement » remains a normal half-width masonry module below, even when it is temporarily the only ordinary module.
- The former section 02 « Offre cyclable » becomes redundant once protected/shared cycling is integrated into « Réseaux » and may be retired.

### Inline map shape and inspection

- All three inline maps use equal circular viewports.
- Each circle has a mode-identifying ring:
  - automobile: solid automobile colour;
  - pedestrian: solid pedestrian colour;
  - cycling: fixed protected→shared gradient, never proportional (the bar owns quantity).
- A small mode icon accompanies each map; colour is never the only identifier.
- Maps are clickable.
- Inspection reveals the complete underlying **square export**, not a larger circle.
- Inspection chrome is minimal: darkened page and close control only. No frame, title, legend, or duplicated sources.

### Framing geometry

- Do not fit a rectangular raster into a circle. Generate square exports for circular presentation.
- Fit the actual territory geometry into its smallest containing circle, then add a consistent proportional breathing margin. The circle’s bounding square is the shared export extent.
- Centre, radius, extent, and scale are identical for all three modes of one territory.
- Ordinary territories use their official selected geometry as the framing geometry.
- A cross-border EPCI uses only the union of its **Breton member communes** as the framing geometry.
- Context outside the selected geometry may be visible but never changes the framing extent.

### Cross-border EPCIs

- Only the Breton analytical footprint remains vivid; external member communes are desaturated context.
- The full official EPCI boundary remains visible where it intersects the viewport.
- The Bretagne regional frontier divides Breton and external areas.
- The previous bespoke Breton/external dotted separator is replaced by the general regional-frontier layer.

### Boundary grammar

- Selected-territory boundary: solid charcoal.
- Bretagne regional frontier: dashed charcoal and **land-only**; never stroke the coastline as a regional frontier.
- Draw the regional frontier whenever it intersects a map viewport.
- Where territory and regional boundaries coincide, the regional dashed treatment renders above the ordinary solid treatment.
- On the Bretagne map, the land-only regional frontier is the sole territory boundary; land/sea contrast expresses the coastline.
- Legend line samples use actual names rather than generic types. Under « Limites », examples are « Rennes » and « Bretagne », or « Redon Agglomération » and « Bretagne ». The names derive from territory contracts.

### Orientation, scale, sources, and handoff

- Retain one discreet, custom, vertically correct north symbol per plate. Do not use Lucide’s diagonal `Navigation` icon.
- Remove north arrows and scale bars from the three raster exports.
- Show one shared scale bar in the plate footer.
- The pipeline computes and publishes scale-bar data from the chosen circular extent; the app only renders it.
- Keep the current source treatment; no new vintage presentation has been approved for the plate.
- Keep the existing « En savoir plus » handoff used by the other Variant E groups.

### Quantitative evidence in the top-right quadrant

- Absorb section 01’s three network lengths and OCS-GE road footprint into the plate.
- Keep network length and road footprint visually distinct because they have different units and observations:
  - network length: `km / 1 000 hab.` on one shared axis;
  - road footprint: a separate percentage scalar with its own comparison.
- Preserve the visual character of the existing network figure rather than inventing a wholly new chart.
- Territory network values remain filled bars.
- « Groupe comparé » becomes a compact tick or point marker, keyed in the figure’s top-right; the comparison note still names the actual statistic and peer scope.
- Cycling’s territory bar is stacked protected/shared. Its comparison marker preserves only the total; hover/focus may reveal the detailed comparison values.
- Hover/focus links chart and map in both directions: interacting with a mode row emphasizes its map, and interacting with a map emphasizes its row.
- Exact marker shape (tick, round point, or square point) remains a visual-prototype decision.

### Cycling length convention

- « Partage de l’espace public » measures physical network geometry, not directional service capacity.
- Every Geovelo segment contributes its geometric length once, including bidirectional segments.
- Protected + shared equals the displayed cycling total and corresponds to the lines visible on the map.
- Geovelo remains the source and its protected/shared classification remains authoritative.
- ADR-0032 supersedes ADR-0016’s directional-length choice while retaining its source, Breton filter, side-bearing commune attribution, and deterministic `d` tiebreak.

## Open visual decisions — answer from representative renders

1. **Mode colours:** do the existing automobile, pedestrian, protected-cycling, and shared-cycling colours retain enough contrast at circular inline size?
2. **OCS-GE ground:** does it provide useful spatial orientation, or does it compete with dense networks? Test at least current opacity and a quieter/no-OCS-GE alternative.
3. **Outside-territory treatment:** is current desaturation sufficient inside a circular viewport?
4. **Circular breathing margin:** determine the proportional margin from Rennes, Bretagne, and a cross-border EPCI; do not choose it abstractly.
5. **Boundary weights and dash rhythm:** confirm solid territory and dashed regional lines remain legible without dominating networks.
6. **Mode-icon placement:** above the circle or tucked into its ring/corner.
7. **Comparison marker:** tick versus point, judged inside the real compact top-right figure.
8. **Image delivery:** production format and compression (likely high-resolution render followed by WebP) remain unapproved.

## Representative prototype set

- Rennes (`commune/35238`) — dense, near-square urban network.
- Bretagne (`region/53`) — very wide regional geometry; exposes failures in rectangular-to-circle fitting.
- CA Redon Agglomération (`epci/243500741`) — cross-border EPCI; tests Breton-only framing, external desaturation, official EPCI boundary, and land-only regional frontier.

The representative outputs are throwaway evidence. Do not launch the full territory rerun until these three are reviewed in the actual Variant E plate.
