# Rennes — partage de l’espace public (visual prototype)

This folder contains a throwaway QGIS visual iteration. It is deliberately
separate from the application: no Vue component or payload consumes this map.

## First-pass contract

- one composite PNG for Rennes (`code_insee = 35238`);
- network source/context BBOX based on the Rennes boundary plus 5 km;
- exported map extent based on the Rennes boundary plus a tight 250 m margin;
- output preserves that extent's aspect ratio, with a 1,600 px long edge;
- OCS-GE is a subtle tonal background, using the lusk-hero paper CS palette
  from `E:\lusk-hero\visual-class-map-paper.csv`;
- car (`c`) uses the canonical **likely drivable public network** contract:
  OSM car highway classes, measured once per mapped way (including separately
  mapped carriageways), with hard access denials, private/customer/permit-only
  and emergency-only ways, parking aisles, driveways, drive-throughs, and
  fully bus-only ways excluded. Roads with an ordinary bus lane remain in the
  network;
- the walking visual keeps dedicated pedestrian ways (`footway`, `pedestrian`,
  `steps`, `path`), pedestrian-priority streets (`living_street`), and
  unrestricted residential streets as likely walking corridors. Other ordinary
  roads are admitted only when they carry explicit positive `sidewalk=*` or
  `foot=yes`, `foot=designated`, or `foot=permissive` evidence, or a numeric
  `maxspeed` at or below 30 km/h. This is a bounded visual proxy for mapped—but
  not necessarily geometrically separated—pavements. Motorways, motorway
  links, trunks, trunk links, tracks, and restricted-access ways remain
  excluded in all cases;
- cycling (`b`) uses the pinned Geovelo snapshot and its canonical
  `ame_d`/`ame_g` side attribution; protected/shared are solid treatments in
  distinct cycling colours;
- all three modes have the same thicker base line width and opacity;
- network ways are rendered over the whole BBOX, then a grey outside-commune
  mask is drawn above them; Rennes' boundary is a solid black outline;
- no place or road labels;
- `visual-us-map.csv` is not a CS fill palette; it remains deferred as a
  secondary US-code ink/detail layer.
- no north arrow or scale bar in this iteration (both are deliberately deferred
  for redesign).

## Build

Run with the installed QGIS 3.44 LTR Python launcher:

```powershell
& 'E:\Program Files\QGIS 3.44.14\bin\python-qgis-ltr.bat' `
  pipeline/maps/build_rennes_sharing_map.py
```

The script writes `rennes-sharing.qgz`, the composite
`rennes-sharing-v1.png`, and one focused export for each network:
`rennes-sharing-car-v1.png`, `rennes-sharing-walking-v1.png`, and
`rennes-sharing-bike-v1.png`. The QGIS project embeds the derived renderer
settings, but the source data remains the authoritative files in
`pipeline/data/raw` and the colours remain sourced from lusk-hero. Re-run the
script when either source changes.

Validate the generated project against the source-level visual contracts:

```powershell
& 'E:\Program Files\QGIS 3.44.14\bin\python-qgis-ltr.bat' `
  pipeline/maps/validate_network_render.py
```
