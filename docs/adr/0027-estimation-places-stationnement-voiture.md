# ADR-0027 : Estimer les places de stationnement voiture depuis OSM

- **Statut :** accepté
- **Date :** 2026-09-14
- **Issue :** #553 (complément de #369)

## Contexte

OpenStreetMap décrit rarement la capacité d'un parking de façon complète. La
surface des aires est disponible plus souvent, tandis que `capacity` et
`capacity:cars` ne couvrent qu'une partie des objets. Le stationnement linéaire
porté par les lignes `highway` est une autre famille de géométrie et peut
recouvrir une aire déjà cartographiée. Les objets `amenity=parking_space` sont
des enfants du parking parent : les additionner à sa surface créerait un
double-compte.

## Décision

`places_stationnement_voiture_1000` est une **estimation** :

1. Les ways fermés et relations `amenity=parking` sont dédupliqués par leur
   identifiant OSM. Chaque parent est attribué une fois à la commune par son
   point représentatif.
2. Sa surface projetée est divisée par un facteur d'espace par place. Les
   capacités OSM positives servent uniquement à calibrer le facteur d'un type,
   jamais à être additionnées directement. Une calibration exige au moins cinq
   observations et un ratio surface/capacité entre 8 et 60 m²/place.
3. En l'absence de calibration suffisante, les valeurs de repli sont 25
   m²/place pour `surface`, 11,5 m²/place pour `street_side` et 25 m²/place
   pour `lane`. Un type inconnu utilise le facteur `surface`.
4. Les lignes `highway` ne contribuent que lorsqu'un côté est explicitement
   marqué par `parking:left/right/both` ou un équivalent historique. Chaque
   côté représente 2,3 m par place, avec un facteur de 11,5 m²/place.
5. La portion linéaire dans l'union des parents est retirée avant conversion :
   le parent possède la portion qui se chevauche. Les `parking_space` enfants,
   les nodes sans déduplication et les capacités déclarées ne sont pas ajoutés
   comme des places observées.

Les facteurs effectifs du snapshot OSM épinglé sont publiés dans la
méthodologie du `source_record` `osm_reseaux` du descripteur Mobilité. Cette
méthodologie est la source de vérité affichée par la page Sources ; l'interface
ne recopie pas les valeurs de calcul.

## Conséquences

- La mesure est comparable comme ordre de grandeur, pas comme inventaire
  exhaustif des places existantes.
- La règle préfère un sous-comptage local à un double-compte lorsque les
  géométries se recouvrent.
- Un changement de l'extrait OSM ou de la calibration doit republier les
  facteurs et la note de méthode avec le snapshot correspondant.
- La couverture et les exclusions sont visibles dans la fiche source, plutôt
  que cachées dans le renderer de l'indicateur.
