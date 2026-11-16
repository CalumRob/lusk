# Accueil — direction de conception

Statut : direction approuvée avec le propriétaire le 16 novembre 2026 ; mise en œuvre et validation visuelle à venir. Ce document décrit la cible, pas l'état actuel de l'application.

## Rôle

Une entrée utile dans l'observatoire, accompagnée de quelques portes d'entrée éditoriales. L'introduction explique l'intérêt de Lusk ; les contrôles rendent son utilisation évidente. Ni argumentaire promotionnel, ni tutoriel, ni fil de publication.

## Identité et introduction

- Conserver le logo, l'hermine et la palette appréciés sur l'accueil existant. Ne pas transformer ce travail local en refonte de l'identité du site.
- Conserver « Intelligence territoriale en Bretagne », avec une présence typographique plus discrète que le titre actuel.
- Texte de travail approuvé : « Accès aux équipements, migrations, occupation des sols, habitat… Lusk propose des données ouvertes et des analyses originales pour comprendre les dynamiques et les tensions des territoires bretons. »
- Respecter les rôles typographiques et les jetons partagés. `DESIGN.md` reste la source humaine des décisions visuelles globales ; ce brief ne le remplace pas.

## Entrées fonctionnelles

- Une recherche de territoire directement accessible, sans carte-conteneur explicative. Sa largeur ne dépend ni de la saisie, ni des suggestions, ni de leur état ; aucun déplacement du reste de la page lors de la recherche.
- Un lien explicite « Explorer les indicateurs », sans seconde carte concurrente ni recherche d'indicateur sur l'accueil.
- Conserver la gestion accessible du clavier, du focus et des suggestions, ainsi que des états de chargement, d'erreur, de recherche vide et de nouvelle tentative. La suppression des dates promotionnelles ne supprime pas les informations de provenance nécessaires dans les surfaces de données.

## Entrées éditoriales

- Sous l'introduction et les accès, une petite sélection durable de textes : analyses originales, exploration d'un jeu de données ou explication de sa construction. Ces types sont des possibilités de contenu, pas des rubriques obligatoires.
- Aucun titre de section « Analyses et méthodes », aucune date, aucun habillage « derniers articles », aucun article vedette et aucun carrousel.
- Des entrées de même largeur et de même poids éditorial : image ou figure issue du texte, titre, introduction courte seulement si utile. Ni photographie décorative ni miniature promotionnelle.
- Les cartes peuvent avoir des hauteurs naturelles différentes, notamment selon les proportions des figures. Une disposition de type masonry est une piste approuvée ; ne pas fabriquer des hauteurs inégales pour la justifier. Avec une seule rangée, une grille simple suffit. La technique de placement reste à décider lors de l'implémentation.
- Une colonne sur mobile. L'ordre de lecture et de navigation doit rester compréhensible ; ne pas réordonner les textes par importance implicite.

## État provisoire : contenus absents

Les textes et leurs figures n'existent pas encore. Travailler avec quelques emplacements simples portant « À venir » ; les sujets des premières maquettes ne sont pas approuvés comme programme éditorial.

- Aucun lien, bouton, faux état de survol ou ordre de tabulation ne doit laisser croire qu'un texte est déjà consultable.
- Aucun graphique fictif ne doit être présenté comme un résultat de Lusk. Un espace d'image provisoire reste explicitement identifiable comme tel et ne reçoit pas une description accessible prétendant décrire de vraies données.
- Ne pas créer d'articles, de routes vides, de CMS ou de pipeline de publication pour ces emplacements. Le passage à du contenu réel fera l'objet d'un travail distinct.
- Ces emplacements sont une exception provisoire et localisée pour la conception de l'accueil, pas une règle autorisant des pages de données « en construction » ailleurs.

## Suppressions ciblées

- La ligne « Données actualisées le… » sur l'accueil et sa répétition dans le pied de page.
- Le bloc promotionnel « Sources » et « Derrière chaque fiche… la preuve, plutôt que la promesse ».
- La biographie « Conçu par Calum Robertson — Docteur en économie urbaine » dans le pied de page.

La page Sources et son accès restent disponibles ; supprimer ce discours promotionnel n'est pas supprimer les sources. Les effets éventuels d'un changement de pied de page partagé doivent être vérifiés explicitement, sans étendre la refonte aux autres surfaces.

## Alignement documentaire et périmètre

- `CONTEXT.md` reste le glossaire du domaine : ces choix d'organisation ne créent pas de nouveau concept métier et n'y nécessitent pas de spécification de mise en page.
- Aucun nouvel ADR : la composition, les textes et les emplacements provisoires sont réversibles et ne constituent pas une décision architecturale.
- La justification historique de la ligne de fraîcheur dans ADR-0003 ne constitue plus une exigence de présentation de l'accueil : la présente décision propriétaire la retire. Cela ne révise ni les contrats de fraîcheur/provenance des données, ni les décisions de service API ultérieures.
- Les commentaires et tests de l'accueil actuel décrivant deux cartes de même poids et une ligne de fraîcheur devront évoluer avec l'interface. Ils ne doivent pas être utilisés pour réintroduire le dispositif rejeté.
- Ne pas modifier les faits, dates d'observation, identités territoriales ou autres contrats producteurs pour satisfaire une décision de présentation.
- Le travail de cette session porte sur la conception de l'accueil et son alignement documentaire. La réalisation des contenus éditoriaux en est exclue. La validation de la nouvelle interface sur ordinateur et mobile reste à faire ; les croquis dans la conversation ne sont pas une recette visuelle finale.
