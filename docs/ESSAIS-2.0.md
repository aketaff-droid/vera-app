# Vera 2.0 — essais à faire sur le vrai PC

Ce qui est déjà vérifié automatiquement (à chaque fabrication GitHub) : catalogue, surveillance du dossier, lecture des EPUB et PDF, fiches écrites dans les copies, conversion KEPUB et sa vérification, envoi sur une Kobo simulée au schéma réel (doublons, livre supprimé non renvoyé, Kobo pleine, interruption), étagères (sauvegarde, restauration, étagères personnelles intactes), Open Library (réponses simulées), interface (commandes, contrastes, français) et compilation Windows.

Ce qui ne peut l'être que chez toi, dans cet ordre :

## 1. Installation par-dessus la 1.2.1
- Lancer `Vera_2.6.0_x64-setup.exe` depuis l’Explorateur (il remplace les versions précédentes ; tes réglages et ton catalogue sont gardés).
- Attendu : Vera s'ouvre directement sur la bibliothèque si la 1.2 surveillait déjà ton dossier (sinon, l'écran « Où sont tes livres ? »).
- Le catalogue de la 1.2 (`%APPDATA%\fr.vera.personal\catalogue.sqlite`) est seulement lu : revenir à la 1.2.1 reste possible.

## 2. Le dossier Google Drive
- Fichiers « en ligne seulement » (mode flux de Drive pour ordinateur) : la première lecture les télécharge, elle peut prendre plusieurs minutes. Noter la durée pour ta bibliothèque.
- Ajouter un livre dans le Drive : il doit apparaître dans Vera en moins d'une minute environ.
- Quitter Google Drive : bandeau « Je ne vois pas ton dossier de livres », rien ne disparaît.

## 3. Premier branchement de la Kobo — à faire en connaissance de cause
C'est la première fois que la version Rust écrit sur ta vraie liseuse (copies dans `Vera/` et étagères). Le catalogue de la Kobo est sauvegardé sur le PC avant toute écriture d'étagères (dossier `backups` des données de Vera).
- Attendu : les livres déjà envoyés par la 1.2 sont reconnus (pas de doublon), les autres partent.
- Les étagères que la 1.2 avait créées pour des collections qui ne sont pas des dossiers de ton Drive sont retirées (les livres restent sur la Kobo) : les étagères suivent désormais exactement les dossiers.
- Tes propres étagères créées sur la Kobo ne doivent pas bouger.
- Éjecter depuis Vera, puis rebrancher : les nouveaux livres rejoignent leurs étagères.

## 4. Fenêtre fermée
- Fermer la fenêtre, brancher la Kobo : une seule notification Windows à la fin.
- Menu de l'icône (clic droit) : état, Éjecter la Kobo, Ouvrir Vera, Quitter.
- Redémarrer Windows : Vera doit se lancer seule, sans ouvrir sa fenêtre.

## 5. Nouveautés de la 2.0 « finale »
- Design : couleur d'accent et apparence dans Réglages ; vérifier la lisibilité en clair et en sombre sur ton écran.
- Couvertures : les PDF sans couverture prennent leur première page, les EPUB sans couverture une couverture dessinée par Vera (quelques livres à chaque passage, toutes les 4 secondes). Un PDF que le moteur de rendu ne sait pas dessiner reçoit une couverture dessinée à la place.
- **Première écriture d'une fonction nouvelle sur la Kobo** : un EPUB sans couverture part désormais avec la couverture de Vera dans sa copie (le fichier de ton Drive n'est jamais modifié). À regarder au premier branchement : la couverture apparaît-elle dans la bibliothèque de la Kobo ? Seuls les livres envoyés à partir de maintenant sont concernés ; ceux déjà sur la Kobo ne changent pas.
- Doublons probables : bandeau dans la Bibliothèque, « Montrer le fichier », « Ce ne sont pas des doublons ». Rien n'est jamais supprimé.
- Tri (bouton à gauche de la recherche), vue Auteurs, clavier : taper un mot cherche, les flèches parcourent les couvertures, Entrée ouvre la fiche, Échap efface, Ctrl+F cherche, Ctrl+, ouvre les réglages.
- Icône de la zone de notification : point bleu pendant l'envoi, vert quand la Kobo est à jour, rouge s'il faut regarder (dossier introuvable, Kobo pleine, envoi interrompu).
- Kobo presque pleine (moins de 500 Mo) : signalée dans la barre latérale et la notification ; le bandeau prévient si les livres en attente ne tiendront pas.
- Réglages › Journal des synchronisations : les 50 dernières.

## 6. Lecture dans Vera (2.2)
- Fiche d’un livre › « Lire » : le livre s’ouvre en plein écran, à l’endroit où tu l’avais laissé dans Vera (« Reprendre · 34 % »).
- « Aa » : taille du texte, fond (Blanc, Papier, Calme, Nuit), police (Literata ou Sans) ; le réglage est gardé pour les livres suivants.
- Sommaire, barre de progression (cliquable), flèches ← →, Page précédente/suivante, Espace ; Échap ou « Bibliothèque » pour revenir.
- À vérifier chez toi : un gros PDF (temps d’ouverture), un EPUB avec images, un EPUB protégé par DRM (message clair attendu, pas de plantage).
- La position de lecture de Vera est indépendante de celle de la Kobo : c’est voulu.

## 7. Partage (2.3)
- Bibliothèque › « Sélectionner », touche des couvertures (ou « Tout sélectionner » dans une collection), puis « Partager… ». Ou fiche d’un livre › « Partager… ».
- **E-mail** : la première fois, « Relier ton adresse » (validation en deux étapes et mot de passe d’application Google, ouverts depuis Vera). À vérifier : un vrai envoi arrive, avec les livres en pièces jointes et des noms lisibles ; une erreur de mot de passe donne un message clair.
- **Salon Discord** : ajouter un salon (webhook), puis un envoi réel. Un livre de plus de 10 Mo doit être refusé avant l’envoi.
- **WhatsApp et Discord en privé** : Vera copie les livres, ouvre l’application et se réduit à côté en petit guide. À vérifier : Ctrl+V colle bien les livres dans WhatsApp et dans Discord ; « Recopier les livres » ; « C’est envoyé » ramène Vera.
- **Autre messagerie** : ta messagerie s’ouvre sur un nouveau message ; Ctrl+V ou glisser les livres.
- **Clé USB** : enregistrer une copie ; Vera refuse d’écrire dans ton dossier de livres.
- Les mots de passe et webhooks sont visibles dans le Gestionnaire d’identification de Windows (Informations d’identification Windows, entrées « Vera »).

## 8. Miroir de ton dossier (2.4)
- **Première écriture d’une fonction nouvelle sur la Kobo : le retrait de livres.** Rien ne part sans ton clic.
- Retire un livre de ton dossier (ou laisse l’agent remplacer des PDF par des EPUB). Les EPUB partent au branchement suivant ; **un jour plus tard**, au branchement, la capsule Kobo affiche « N livres ont quitté ton dossier · Retirer de la Kobo… » et une notification te prévient si la fenêtre est fermée.
- Vérifie la liste avant de confirmer (tu peux décocher). Après l’éjection, les livres retirés doivent disparaître de la bibliothèque de la Kobo.
- Supprime un livre sur la Kobo alors qu’il est encore dans ton dossier : il doit revenir au branchement suivant.
- Un livre mis sur la Kobo à la main (hors du dossier « Vera » de la liseuse) ne doit jamais être proposé.
- Rien n’est proposé si ton dossier est introuvable (Google Drive arrêté).

## 9. Progression, notes et mises à jour (2.5)
- Branche la Kobo : sur les livres envoyés par Vera, la fiche affiche « lu à N % » et les surlignages/notes faits sur la liseuse ; « Exporter les notes… » les enregistre en Markdown. Rien n’est écrit sur la Kobo pour cela.
- **La 2.5.0 s’installe une dernière fois à la main.** Les suivantes : Vera te prévient (notification, point dans la zone de notification, rappel en bas de la barre latérale) ; Réglages › À propos › « Installer et redémarrer ». Vérifie après le redémarrage que la version a changé et que tes réglages et ta bibliothèque sont là.
- « Rechercher » dans Réglages › À propos doit répondre « Vera est à jour. » quand il n’y a rien de nouveau.

## 10. Thèmes et logo (2.6)
- La 2.6.0 doit être proposée par Vera elle-même (notification, rappel en bas de la barre latérale) ; « Installer et redémarrer » dans Réglages › À propos. Après le redémarrage : Réglages › À propos indique 2.6.0, réglages et bibliothèque intacts.
- Le nouveau logo apparaît dans la barre des tâches, la zone de notification (avec ses points d’état), la fenêtre et le menu Démarrer (Windows peut garder l’ancienne icône en cache un moment).
- Réglages › Apparence : essayer chaque thème en clair et en sombre ; la pastille en pointillés est la couleur du thème, les autres restent au choix. Ouvrir un livre : la lecture ne change pas.
- Visite guidée : elle s’ouvre au premier démarrage de la 2.6 ; « Passer », Échap et les flèches fonctionnent ; elle ne revient pas au démarrage suivant ; Réglages › À propos › « Revoir la visite guidée » la relance.
- Barre latérale : replier et déplier une collection et le groupe « Collections » ; l’état reste après un redémarrage.

## 11. Plus tard, et seulement si tu le souhaites
- Corriger la fiche d'un livre déjà sur la Kobo, activer « Remplacer sur la Kobo les livres corrigés », rebrancher, et vérifier que la page de lecture de ce livre est conservée. Si elle ne l'est pas, désactiver le réglage.
- Vérifier si la Kobo affiche le titre corrigé d'un PDF (non garanti : elle peut lire le nom du fichier).
