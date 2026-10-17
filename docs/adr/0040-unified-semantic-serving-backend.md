# ADR-0040 : Contrat sémantique unifié pour le service backend

- **Statut :** accepté et implémenté dans le cadre de #797
- **Date :** 2026-10-17

## Contexte

Les routes historiques par thème, forme ou famille de données dupliquaient la
découverte des ressources, la projection des champs et la lecture cohérente des
publications. Les contrats validés par #795 puis intégrés après `09364831`
retiennent une grammaire commune sans imposer un stockage universel.

## Décision

- La découverte est dérivée des déclarations productrices; une lecture unique
  et chaque item de lot partagent la même identité de ressource, cible typée,
  coordonnées déclarées, sélection de champs et intention.
- Un lot est prévalidé, borné et exécuté dans une transaction PostgreSQL
  `READ ONLY REPEATABLE READ`; tout échec annule la réponse entière.
- Les formes physiques restent contraintes par leurs sémantiques: faits
  scalaires, profils déclarés, séries ordonnées, collections clairsemées,
  références nommées et agrégats AEDAR à granularité source. Il n'existe pas de
  table universelle EAV ni de table par indicateur.
- Les publishers conservent des marqueurs de publication et dépendances
  explicites; données, descripteurs et marqueurs sont remplacés atomiquement.
  Les incompatibilités échouent de manière fermée.
- Les routes et publications legacy d'accessibilité BPE/services et les lectures
  Mobilité dérivées des anciens snapshots sont retirées. Les données source
  AEDAR et le ratio propriétaire B316 restent distincts et ne les remplacent pas.
- L'API AEDAR à granularité source reste séparée du contrat ordinaire des
  ressources sémantiques.

## Conséquences

`GET /api/resources` et `POST /api/resources/read` / `read-batch` forment le
contrat des ressources retenues. Les consommateurs de l'ancien backend doivent
être migrés séparément; cette décision n'autorise aucun changement frontend.
Le schéma frais et la migration explicite sont couverts par les tests gardés.
La migration de production et la republication opérationnelle nécessitent une
procédure distincte et ne sont pas exécutées par cette décision.

Voir [le design accepté](../design/serving-model-simplification.md),
[l'inventaire de couverture](../design/serving-resource-catalogue-snapshot.md)
et [le contrat API](../../api/ENDPOINTS.md).
