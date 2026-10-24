# Vera — décisions en vigueur

Chaque section est une décision explicite de l’utilisateur. Les sections absentes concernent des versions retirées.

## I. Version 2.0 — Vera simplifiée, 22 octobre 2026

Décisions explicites de l’utilisateur ; elles remplacent les sections G et H. Détail dans `docs/CAHIER-DES-CHARGES-2.0.md`.
- Vera ne gère que l’EPUB et le PDF. Conversion (Calibre, missions) et statistiques de lecture retirées.
- Vera surveille le dossier Google Drive et liste ses livres sans les copier ; à chaque branchement, elle copie sur la Kobo ceux qui n’y sont pas, sans doublon (empreinte).
- Ajout seulement : miroir retiré, aucune suppression ni sur le dossier ni sur la Kobo ; un livre supprimé de la Kobo n’est pas renvoyé.
- Les sous-dossiers deviennent des étagères Kobo qui suivent exactement les dossiers ; les étagères créées sur la Kobo ne sont jamais touchées.
- Vera démarre avec Windows et reste active en arrière-plan.
- Gardés : modification des fiches (corrections écrites dans la copie envoyée sur la Kobo), « Compléter la fiche » par ISBN sur Open Library, éjection de la Kobo.
- Retirés aussi : liseuse intégrée, recherche dans le texte, import Kobo → Vera. KEPUB conservé à l’envoi. Plus de Python.

## K. Après les essais réels, 22 octobre 2026

Les essais de `docs/ESSAIS-2.0.md` sont concluants (confirmé par l’utilisateur). Décisions explicites :
- **Design** : un seul style, épuré dans l’esprit d’Apple, avec une **couleur d’accent au choix** (comme macOS) ; apparence Auto, Clair ou Sombre.
- **Oui** : couvertures générées quand il n’y en a pas (première page des PDF ; couverture créée pour les EPUB et intégrée à la copie envoyée), vignettes et rapidité, doublons probables signalés (jamais supprimés), raccourcis clavier, tri, vue par auteur, icônes d’état dans la zone de notification, alerte d’espace sur la Kobo, journal des synchronisations.
- **Non** : « Garder hors de la Kobo », nettoyage des titres tirés du nom de fichier, mises à jour automatiques, séries sur la Kobo.

## L. Lecture dans Vera, 23 octobre 2026

Décision explicite de l’utilisateur, après les maquettes d’habillages et de lecture :
- **Oui** : un mode lecture sobre, dans l’esprit d’Apple Books, pour les EPUB et les PDF de la bibliothèque (bouton « Lire » de la fiche). Revient sur le retrait de la « liseuse intégrée » (section I) pour la lecture seulement : pas de recherche dans le texte, pas d’annotations.
- La position de lecture est gardée dans le catalogue de Vera ; elle **ne suit pas** celle de la Kobo (Vera ne touche jamais à l’état de lecture de la liseuse).
- Le fichier du dossier est seulement lu. Le code éventuellement contenu dans un livre ne s’exécute jamais.
- « Je ne veux qu’ajouter le mode lecture, c’est tout » : les habillages proposés ne sont pas retenus ; le design reste celui de la section K. La base commune proposée avec eux (couverture qui s’envole, ressorts, fond vivant) n’est donc pas faite, sauf nouvelle demande.

## M. Partage guidé, 23 octobre 2026

Décision explicite de l’utilisateur, après les maquettes (toile « Partager des livres ») :
- **Oui** : partager un ou plusieurs livres avec un assistant guidé dans Vera : sélection, « les livres » (version corrigée par Vera ou fichiers d’origine, .zip au choix), « avec quoi », envoi.
- Destinations : **e-mail envoyé depuis Vera** (Gmail et autres messageries, mot de passe d’application gardé dans le Gestionnaire d’identification de Windows — accepté par l’utilisateur), **salon Discord envoyé depuis Vera** (webhook), **Discord en message privé et WhatsApp avec un panneau guide** (Vera ouvre l’application, copie les livres ; l’envoi reste fait par l’utilisateur, ces services n’autorisant pas d’envoi à sa place), **autre messagerie** (guidé), **clé USB ou dossier**.
- Pas de mention sur les droits dans l’interface (l’utilisateur partage des livres acquis légalement).
- Les copies partagées sont préparées dans les données de Vera ; rien n’est écrit dans le dossier surveillé ni sur la Kobo.

## N. Miroir du dossier sur la Kobo, 23 octobre 2026

Décision explicite de l’utilisateur : « que les livres dans mon Drive, sur Vera et sur la liseuse soient toujours les mêmes ». Elle remplace deux règles de la section I :
- **Un livre supprimé sur la Kobo mais toujours dans le dossier est renvoyé** au branchement suivant (le dossier est la seule référence ; pour retirer un livre de la Kobo, on le retire du dossier).
- **Les copies de Vera (`Vera/<sha256>.*`) dont le livre a quitté le dossier sont retirées de la Kobo, après confirmation** : au branchement, Vera les liste (« N livres ont quitté ton dossier ») et ne retire qu’après le clic de l’utilisateur (choix « 2a » : pas de retrait automatique pour l’instant).
- Les livres en cours de lecture ne sont pas traités à part (choix « 3b ») : leur progression et leurs annotations partent avec eux.
- Garde-fous acceptés : un livre n’est proposé au retrait qu’absent du dossier depuis au moins 24 h ; au-delà de 20 livres ou de 20 % de la bibliothèque d’un coup, l’avertissement est renforcé ; rien n’est proposé tant que le dossier est introuvable. **Pas de copie gardée sur le PC** (refusé) : le retrait est définitif sur la liseuse ; le livre reste récupérable par la corbeille de Google Drive.
- Inchangé : Vera n’écrit jamais dans le dossier surveillé ; les livres mis sur la Kobo autrement (boutique, copie à la main) ne sont jamais touchés.

## O. Mises à jour depuis Vera, progression et notes de la Kobo, 23 octobre 2026

Décisions explicites de l’utilisateur (« ne plus avoir à installer/désinstaller mais pouvoir mettre à jour Vera depuis Vera et qu’elle me dise qu’une mise à jour est disponible » ; « les fonctions qui auraient du sens »). Elles remplacent le « Non : mises à jour automatiques » de la section K :
- **Vera cherche une nouvelle version** peu après son démarrage puis toutes les 6 heures, le **signale** (une notification par version, la zone de notification, un rappel dans la fenêtre) et **ne l’installe qu’après un clic** (Réglages › À propos). L’installation se fait sans désinstaller ; réglages et bibliothèque sont gardés. Pas d’installation sans clic.
- Une mise à jour n’est acceptée que **signée par la clé privée de Vera** ; la clé et son mot de passe ne sont jamais dans le dépôt (secrets GitHub et copie gardée par l’utilisateur). Perdre la clé oblige à réinstaller une fois à la main.
- Les versions sont publiées sur un **dépôt GitHub public distinct**, instantané propre du code (sans données personnelles, sans les maquettes ni les références des skills), le dépôt de travail restant privé (choix « Nouveau dépôt public propre »).
- **Progression et notes de la Kobo dans Vera**, en lecture seule : à chaque branchement, Vera copie le pourcentage lu, l’état et les surlignages/notes des livres qu’elle a envoyés, sans rien écrire sur la liseuse. Les notes s’exportent en Markdown depuis la fiche. La position du mode lecture de Vera reste distincte (section L).
- Pas de prise en charge du MOBI (l’utilisateur n’en a aucun).

## P. Thèmes, logo, visite guidée, zoom et surlignage dans la lecture, collections repliables (2.6–2.7), 23 octobre 2026

Décisions explicites de l’utilisateur, après les maquettes d’une refonte « cognitive » (non retenue : « pas fan ») :
- **Thèmes** pour la fenêtre, en plus du style actuel : **Vera** (l’actuel), **Papier**, **Citadelle**, **Encre** et **Reflet** (« Thème c’est très bien »). Ils remplacent la phrase « un seul style » de la section K ; Clair, Sombre et Auto restent.
- Chaque thème a **sa propre couleur d’accent** (« maison ») et donne accès aux autres couleurs si l’utilisateur le désire.
- **Le mode lecture n’a pas de thème** : il garde ses fonds (section L).
- Citadelle est une création originale : aucun nom, élément ni signe venant d’un jeu (le code est public).
- **Logo** (2.7, remplace l’elfe de la 2.6.0, « rester sur “Vera” avec une typo élégante ») : le nom « Vera. » en Bodoni Moda, avec un point final, vectorisé (`src-tauri/icons/vera-mot.svg`, `src/logo.tsx`) et à l’encre de chaque thème ; l’icône est « V. » crème sur vert forêt, plus grasse sous 48 px et dans la zone de notification (`icone.svg`, `icone-petite.svg`).
- **Visite guidée au démarrage** (« ajoute un tuto de départ guidé ») : des bulles sur la vraie fenêtre (bibliothèque, collections, un livre, partager, Kobo, réglages), montrée une fois — y compris après la mise à jour qui l’apporte — puis rejouable depuis Réglages › À propos. Elle ne fait rien à la place de l’utilisateur.
- **Zoom dans la lecture** (2.7, « ajoute dans le mode lecture la possibilité de zoomer ») : − / % / + dans la barre, Ctrl + molette, Ctrl +, Ctrl −, Ctrl 0. Un PDF agrandit sa page (jusqu’à 400 %, déplacée en la faisant glisser) ; un EPUB agrandit son texte (la taille du texte du réglage « Aa »).
- **Surligner dans la lecture** (2.7, « ajoute aussi la possibilité de surligner ») : revient sur le « pas d’annotations » de la section L. Dans un EPUB, choisir un passage propose quatre couleurs ; toucher un surlignage permet de changer sa couleur, d’ajouter une note ou de le retirer ; un panneau les liste et les exporte en Markdown avec les notes de la Kobo. Gardés dans le catalogue de Vera seulement : jamais dans le fichier du livre, jamais sur la Kobo. Pas encore dans les PDF (pdf.js n’y affiche pas de texte sélectionnable dans Vera).
- **Collections repliables** dans la barre latérale (chaque collection à sous-collections, et le groupe entier) ; l’état est gardé sur le PC.
- Publication par la mise à jour depuis Vera (section O), qui sert de premier essai réel de ce cycle ; retour à la 2.5.0 possible en la réinstallant (elle ignore le réglage de thème).
