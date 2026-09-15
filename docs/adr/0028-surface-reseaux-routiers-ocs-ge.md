# ADR-0028 : Publier séparément l’emprise des réseaux routiers OCS-GE

- **Statut :** accepté
- **Date :** 2026-09-14
- **Issue :** #552

## Contexte

Le bloc Mobilité possède déjà `reseaux`, une mesure des longueurs
issues d’OSM/Geovelo. L’OCS-GE apporte une autre observation : des polygones
d’usage du sol, dont `US4.1.1` correspond aux réseaux routiers. Ces deux formes
ne sont pas interchangeables : l’OCS-GE ne donne pas la longueur du réseau ni
un mode de déplacement.

L’OCS-GE d’artificialisation porte aussi l’attribut `artif`. Celui-ci répond à
la question réglementaire de l’état artificialisé, pas à celle de l’emprise
spatiale d’un usage routier. Filtrer sur `artif` ferait donc disparaître des
surfaces US4.1.1 pertinentes pour cette mesure.

## Décision

Ajouter la clé scalaire `surface_reseaux_routiers`, alimentée par les polygones
OCS-GE `code_us == "US4.1.1"`, **quelle que soit** la valeur de `artif`.

La mesure communale est la somme des aires OCS-GE intersectées avec la commune,
réparties au prorata de l’aire géométrique source, divisée par l’aire de la
commune. Les niveaux EPCI et département recalculent le ratio à partir des
surfaces additives, sans moyenne de pourcentages.

La clé est publiée séparément de `reseaux`. Elle ne prétend pas répartir
l’emprise entre marche, vélo et voiture.

## Conséquences

- Les polygones US4.1.1 `artif` et `non artif` sont tous deux visibles dans la
  mesure d’emprise routière.
- Le stock Milieux d’artificialisation et le profil OSM `reseaux` gardent leurs
  propres définitions ; `reseaux` publie ses trois longueurs sans densité.
- Les sources OCS-GE départementales restent les lignes techniques de collecte,
  tandis que la clé porte un vintage éditorial composite.
- Les surfaces non cartographiées par l’OCS-GE et les limites de la classe
  US4.1.1 restent des limites explicites de l’indicateur.
