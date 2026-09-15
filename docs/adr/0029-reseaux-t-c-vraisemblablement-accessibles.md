# ADR-0029 : Mesurer les réseaux vraisemblablement accessibles

- **Statut :** accepté
- **Date :** 2026-09-15

## Contexte

Le profil `reseaux` mesure des longueurs OSM pour les modes `t` (marche) et
`c` (voiture). Une définition limitée aux voies explicitement étiquetées
`footway`/`path` sous-estime la marche dans les rues où les trottoirs ne sont
pas renseignés. À l'inverse, la liste brute des voies routières inclut des
voies privées, des parkings et des voies réservées aux bus.

L'indicateur ne cherche pas à reproduire un moteur d'itinéraire. Il décrit la
quantité de réseau vraisemblablement utilisable et doit donc rester une mesure
de géométries OSM, sans multiplier une voie `oneway` par son nombre de sens.

## Décision

Le réseau piéton `t` est le **réseau vraisemblablement marchable**. Il inclut
les voies piétonnes dédiées, `living_street`, les voies résidentielles, les
voiries ordinaires portant une preuve positive `sidewalk=*` ou `foot=*`, ainsi
que les voiries ordinaires dont `maxspeed` numérique est inférieur ou égal à
30 km/h. Les autoroutes, bretelles d'autoroute, voies rapides et bretelles de
voies rapides (`motorway`, `motorway_link`, `trunk`, `trunk_link`) sont toujours
exclues, quelle que soit leur vitesse. Les chemins `track` et les accès
explicitement refusés restent exclus.

Le réseau voiture `c` est le **réseau vraisemblablement accessible en
voiture**. Chaque way contribue une fois, et deux ways OSM distincts d'une
chaussée séparée contribuent tous deux. Sont exclus les accès
non-publics/refusés, les voies de parking, les voies d'accès privées ou de
drive-through, les voies d'urgence, et les voies entièrement réservées aux
bus. Une voie ordinaire qui comporte seulement une voie réservée aux bus est
conservée ; un accès `destination` est conservé.

Les mêmes sélections s'appliquent au calcul R et aux prototypes cartographiques.
Les trois longueurs t/b/c restent des catégories séparées ; la règle de
comptage par direction du mode `b` (ADR-0016) ne change pas.

## Conséquences

- `t_longueur` et `c_longueur` décrivent des réseaux plausibles, pas une
  inventaire exhaustif des trottoirs ni une distance routable.
- Le signal `maxspeed` apporte une couverture utile lorsque les tags de
  trottoir manquent, mais ne prouve pas qu'un trottoir existe.
- Les voies unidirectionnelles ne sont jamais comptées deux fois par direction.
- Les tags OSM absents, ambigus ou mal renseignés restent une limite déclarée
  de l'indicateur ; les filtres ne prétendent pas résoudre la topologie ou les
  restrictions conditionnelles.
