# Vera 2.0 — Cahier des charges

> 22 octobre 2026. Décisions de l’utilisateur prises en conversation (section I de `DECISIONS.md`).
> Remplace, pour la 2.0, `01-CAHIER-DES-CHARGES.md` et les livraisons 0.x à 1.2.
> Ce document porte sur le **backend** ; l’interface sera revue ensuite.

## 1. Ce que fait Vera, en une phrase
Vera surveille le dossier Google Drive des livres et, à chaque branchement de la Kobo, y copie les livres qui n’y sont pas encore, rangés en étagères selon les sous-dossiers, sans doublon et sans jamais rien supprimer.

## 2. Fonctions gardées

### 2.1 Fonctionnement en arrière-plan
- Vera démarre avec Windows et reste dans la zone de notification ; fermer la fenêtre ne l’arrête pas.
- Une seule instance à la fois.

### 2.2 Dossier surveillé
- Un seul dossier, choisi par l’utilisateur (en pratique sur le lecteur Google Drive).
- Seuls les **EPUB** et les **PDF** sont pris en compte ; tout autre fichier est ignoré.
- Un fichier n’est pris qu’une fois stable (taille et date inchangées sur plusieurs relevés), Drive écrivant en plusieurs étapes.
- Dossier inaccessible (Drive non démarré, disque absent) : rien ne change, un message l’indique.

### 2.3 Liste des livres
- Vera **ne copie pas** les livres : sa liste pointe vers les fichiers du dossier. Seules les couvertures sont gardées en local, pour l’affichage.
- Identité d’un livre = empreinte SHA-256 du fichier. Deux fichiers identiques = un seul livre.
- Un livre déplacé ou renommé dans le dossier reste le même livre (même empreinte) ; il change seulement de collection.
- Un fichier retiré du dossier disparaît de la liste de Vera, **rien d’autre** : il reste sur la Kobo.
- Collections = sous-dossiers ; une sous-collection porte son chemin « A › B », comme son étagère sur la Kobo.

### 2.4 Fiches
- Titre, auteur(s), langue, ISBN, éditeur, date, sujets, résumé, lus dans le fichier puis modifiables à la main.
- Bouton « Compléter la fiche » : recherche par ISBN sur Open Library, gratuite, sur demande seulement, sans remplacer la couverture.
- **Une fiche corrigée est écrite dans la copie envoyée sur la Kobo** (le fichier du Drive n’est jamais modifié). Si la fiche change après l’envoi, la copie sur la Kobo est remplacée au branchement suivant, au même emplacement.

### 2.5 Synchronisation Kobo, automatique à chaque branchement
1. **Inventaire** : liste des fichiers de la Kobo, avec empreinte (gardée en cache selon taille et date pour ne pas tout relire à chaque fois).
2. **Envoi** des livres de Vera dont l’empreinte n’est nulle part sur la Kobo et qui n’y ont jamais été envoyés :
   - EPUB converti en KEPUB par kepubify (repli sur l’EPUB si kepubify échoue), fiche corrigée appliquée ;
   - PDF envoyé tel quel (fiche appliquée si possible, voir §5) ;
   - destination `Vera/<empreinte>.kepub.epub|epub|pdf`, comme en 1.2, pour reconnaître aussi les livres déjà envoyés par l’ancienne version ;
   - copie dans un fichier temporaire sur la Kobo, vérification, puis renommage ; contrôle de l’espace libre avant.
3. **Pas de renvoi** d’un livre que l’utilisateur a supprimé de la Kobo : Vera retient ce qu’elle a déjà envoyé.
4. **Étagères** (écriture dans `KoboReader.sqlite`) :
   - chaque collection devient une étagère, contenant exactement ses livres présents sur la Kobo ;
   - un livre déplacé de dossier change d’étagère ; une étagère créée par Vera pour un dossier disparu est retirée ;
   - les étagères créées sur la Kobo elle-même, les achats de la boutique et l’état de lecture ne sont jamais touchés ;
   - sauvegarde du catalogue Kobo sur le PC avant toute écriture, vérification d’intégrité après, restauration en cas d’échec ;
   - rien n’est écrit si rien ne change.
   - Limite connue : la Kobo n’intègre un livre qu’à l’éjection ; un livre envoyé au branchement N est rangé dans son étagère au branchement N+1.
5. **Notification** de bilan (livres copiés, étagères mises à jour, erreurs), puis proposition d’éjecter.

### 2.6 Éjection
- Bouton « Éjecter la Kobo » ; message clair si Windows refuse.

## 3. Ce que Vera ne fait jamais
- Supprimer ou modifier un fichier du dossier surveillé.
- Supprimer un livre de la Kobo (seules ses propres copies `Vera/…` peuvent être **remplacées**, après une correction de fiche).
- Importer dans Vera les livres présents seulement sur la Kobo.
- Envoyer quoi que ce soit sur internet, hors « Compléter la fiche ».

## 4. Retiré par rapport à la 1.2
Conversion (Calibre, missions), statistiques et suivi de lecture (relevés, objectif, historique, « Bravo »), miroir et Corbeille, import Kobo → Vera, recherche dans le texte (la lecture est revenue, voir DECISIONS.md section L), maintenance des caches, crochets de test dans le binaire livré, restes de l’avatar, de la traduction et de Google Drive (API). Plus de Python : tout le backend est en Rust ; seul kepubify reste comme outil externe.

## 5. Points à vérifier pendant la construction
- **Drive en mode « flux »** : un fichier « en ligne seulement » doit être téléchargé avant l’empreinte et l’envoi ; mesurer le comportement réel et le temps.
- **Fiche d’un PDF** : la Kobo lit-elle le titre et l’auteur dans les métadonnées du PDF ? À vérifier ; sinon la correction n’apparaît que dans Vera pour les PDF.
- **Remplacement d’une copie après correction** : la Kobo conserve-t-elle la progression de lecture d’un fichier remplacé au même emplacement ? À vérifier sur la vraie liseuse avant d’activer ce remplacement.
- **Reprise de la 1.2** : catalogue reconstruit à partir du dossier ; les livres déjà sur la Kobo (dossier `Vera/` ou ailleurs) sont reconnus par empreinte, donc pas renvoyés. Les étagères créées par la 1.2 sont reprises comme étagères gérées par Vera.
- **Réécriture en Rust de l’écriture des étagères** : même logique que `documentary/kobo_collections.py` de la 1.2, validée sur le simulateur `tests/fixtures/kobo-schema.sql` avant tout essai sur la vraie Kobo, et première écriture réelle seulement avec l’accord explicite de l’utilisateur.
