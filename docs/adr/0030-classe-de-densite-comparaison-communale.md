# ADR-0030 : Comparer par défaut les communes de même classe de densité

- **Statut :** accepté
- **Date :** 2026-09-15

## Contexte

La comparaison historique d'une commune avec les autres communes de son EPCI
offre un cadre administratif local, mais rapproche des réalités territoriales
très différentes. Elle peut notamment opposer une grande ville à des communes
rurales ou périurbaines alors que la lecture recherchée est parfois celle de
territoires ayant une morphologie comparable. Une catégorie vague de
« communes comparables » serait toutefois impossible à expliquer et à maintenir.

La grille communale de densité à sept niveaux de l'Insee fournit une
classification officielle fondée sur le nombre d'habitants et leur
concentration spatiale. Elle distingue les grands centres urbains, centres
urbains intermédiaires, petites villes, ceintures urbaines, bourgs ruraux et
communes rurales à habitat dispersé ou très dispersé.

## Décision

Sur une fiche de commune, le contexte de comparaison par défaut réunit les
communes bretonnes de la même **Classe de densité communale**. Le visiteur peut
choisir à la place les communes de l'EPCI nommé, lorsqu'il existe, ou toutes les
communes bretonnes. La commune consultée appartient toujours à son groupe.

Le choix constitue un unique contexte pour toute la fiche : il pilote les
rangs, références territoriales et projections agrégées sur les bâtiments de
tous les thèmes. Il est explicite dans l'URL et se conserve lors de la
navigation vers une autre commune, où le groupe est résolu de nouveau. Un mode
invalide ou indisponible revient au contexte de densité par défaut. Les autres
niveaux territoriaux conservent leur politique actuelle.

La pipeline est autoritaire sur le millésime Insee épinglé, le rattachement des
communes, les codes, les libellés publics et les projections qui doivent être
pré-calculées. Une commune bretonne sans classe fait échouer la publication ;
la classe n'est jamais inférée dans l'app. L'app porte la sélection, résout le
mode publié et présente la comparaison.

## Conséquences

- L'option de densité porte le nom réel de la classe, jamais « communes
  comparables » ni un terme emprunté aux aires d'attraction des villes.
- Chaque figure conserve « Groupe comparé » pour son repère compact. Son
  sélecteur sous la figure nomme la statistique réellement employée et le
  périmètre sélectionné ; tous ces sélecteurs restent synchronisés.
- Les explications de la classe sont accessibles au survol et au focus, et le
  libellé Insee exact ainsi que son millésime restent documentés dans Sources.
- Une comparaison exige au moins deux communes disposant de la valeur utile ;
  sinon elle est déclarée indisponible sans masquer le sélecteur.

Cette décision remplace, pour les seules communes, le contexte par défaut fixé
par l'ADR-0021. L'EPCI demeure un contexte explicite disponible, pas le défaut.
