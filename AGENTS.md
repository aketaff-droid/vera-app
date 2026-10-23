# AGENTS.md — consignes pour les agents (Codex, Claude) travaillant sur Vera

## État
La référence est `docs/CAHIER-DES-CHARGES-2.0.md`, puis `docs/DECISIONS.md` pour les décisions plus récentes.

## Ce que Vera fait, et rien d’autre
- Surveiller un dossier (en pratique Google Drive), EPUB et PDF seulement.
- Envoyer à chaque branchement de la Kobo les livres qu’elle n’a pas, sans doublon, ranger les étagères d’après les sous-dossiers, et proposer de retirer les copies de Vera dont le livre a quitté le dossier (miroir, après confirmation).
- Corriger les fiches (à la main, ou par ISBN sur Open Library) ; les corrections vont dans la copie envoyée.
- Rester active fenêtre fermée ; éjecter la Kobo ; afficher la progression et les notes de la Kobo (lecture seule) ; proposer une visite guidée au démarrage ; signaler une nouvelle version et l’installer après un clic (section O ; mise à jour signée, clé jamais dans le dépôt).
- Lire un livre de la bibliothèque dans la fenêtre (EPUB et PDF, lecture seule du fichier ; position gardée dans le catalogue de Vera, jamais sur la Kobo ; aucun script venant d’un livre ne s’exécute).
- Partager des livres avec un assistant guidé (e-mail et salon Discord envoyés depuis Vera ; WhatsApp et Discord en privé guidés ; clé USB). Copies préparées dans les données de Vera ; secrets (mots de passe d’application, webhooks) seulement dans le Gestionnaire d’identification de Windows.

## Règles de sécurité des données (non négociables)
- Ne jamais écrire, déplacer ni supprimer un fichier du dossier surveillé.
- Sur la Kobo, Vera ne touche qu’à ses propres copies (`Vera/<sha256>.*`). Elle peut les remplacer avec le réglage `replace_edited` (désactivé tant que l’utilisateur n’a pas vérifié qu’un remplacement garde la position de lecture), et les retirer quand leur livre a quitté le dossier depuis au moins 24 h, **uniquement après confirmation de l’utilisateur** (DECISIONS.md, section N). Les livres mis sur la Kobo autrement ne sont jamais supprimés.
- Le dossier est la référence : un livre supprimé de la Kobo mais toujours dans le dossier est renvoyé (section N).
- Toute écriture dans `KoboReader.sqlite` passe par `core/src/shelves.rs` : sauvegarde vérifiée sur le PC, transaction, contrôle d’intégrité, restauration en cas d’échec, aucune écriture si rien ne change. Ne jamais toucher aux étagères créées sur la Kobo, aux achats de la boutique ni à l’état de lecture.
- Première écriture sur la vraie Kobo d’une fonction nouvelle : uniquement avec l’accord explicite de l’utilisateur.
- Aucune API payante ; aucune automatisation de téléchargement d’œuvres protégées.

## Architecture
- Le métier vit dans `core/` (vera-core), testable sans Windows ni interface. La coquille `src-tauri/` reste mince : elle appelle vera-core.
- Toute fonction de vera-core a ses tests ; la synchronisation Kobo se teste sur le simulateur (`tests/fixtures/kobo-schema.sql`).
- Lecture : après tout changement de la politique de contenu (`src-tauri/tauri.conf.json`) ou de foliate-js, lancer `node tests/reader-csp.mjs` (livre piégé, voir l’en-tête du script).
- L’utilisateur installe lui-même Vera depuis l’Explorateur ; un agent dans un conteneur ne produit ni installation ni données personnelles.

## Interface
- Cinq thèmes (Vera, Papier, Citadelle, Encre, Reflet), chacun avec sa couleur d’accent « maison » et les autres au choix ; apparence Auto, Clair ou Sombre ; le mode lecture n’a pas de thème (DECISIONS.md, section P). Tout thème passe les contrastes de `tests/check-interface.mjs` ; Citadelle reste une création originale, sans rien emprunter à un jeu.
- Référence d’expérience : Apple Books. Conventions Windows 11 pour la fenêtre, les notifications et la zone de notification.

## Discipline
- Annoncer le plan avant un chantier ; après : commandes lancées, résultats constatés, limites, fichiers touchés.
- Ne jamais dire « terminé » pour une étape non testée. Signaler les hypothèses.
- Commits petits et décrits en français ; `docs/DECISIONS.md` seulement pour une décision explicite de l’utilisateur.
