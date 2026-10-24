# Vera 2.0 — composants et licences

Application personnelle pour Windows 11. Aucun service payant, aucun compte.

- **Dépendances Rust et npm** (Tauri, React, rusqlite/SQLite, lopdf, quick-xml, zip, ureq, image, hayro, lettre, keyring, clipboard-win…) : inventaire généré à la fabrication (`licenses/third-party.json`) avec les textes de licence, installés dans le dossier `notices` de l’application.
- **kepubify** 4.0.4, Patrick Gaskin : licence MIT (`licenses/tools/kepubify-MIT.txt`). Programme séparé, lancé pour convertir les EPUB au format Kobo.
- **hayro** (rendu des PDF pour les couvertures), licence MIT ou Apache 2.0. Il incorpore les polices standard de PDFium/Foxit (licence BSD à trois clauses), les CMaps d’Adobe et un profil de couleur CGATS ; leurs textes de licence sont copiés dans l’inventaire avec ceux de hayro.
- **foliate-js** 1.0.1 (affichage des EPUB dans la lecture), John Factotum : licence MIT. Il embarque zip.js (Gildas Lormeau, licence BSD à trois clauses) et fflate (Arjun Barrett, licence MIT), dont les textes sont dans `licenses/tools/`.
- **pdf.js** (`pdfjs-dist`, affichage des PDF dans la lecture), Mozilla : licence Apache 2.0. Ses polices standard (Foxit, Liberation) et ses décodeurs (OpenJPEG, JBIG2, qcms) ont leurs licences copiées dans l’inventaire.
- **Polices** Literata (couvertures sans image, thème Papier), Cinzel (thème Citadelle) et Instrument Serif (thème Encre, nom du logo) : SIL Open Font License 1.1, textes incorporés avec leurs paquets. L’interface utilise Segoe UI, police de Windows, non distribuée avec Vera.
- **Logo** « Vera. » : dessiné d’après la police Bodoni Moda (SIL Open Font License 1.1, Owen Earl), vectorisé ; la police elle-même n’est pas distribuée (`src-tauri/icons/vera-mot.svg`).
- **Open Library** : catalogue bibliographique public interrogé seulement quand l’utilisateur clique « Compléter la fiche ».

Les couvertures de l’aperçu navigateur (`src/dev/covers/`) sont des tableaux du domaine public diffusés par Standard Ebooks (CC0), sauf `le-horla.jpg`, dessinée par Vera. Aucun livre, catalogue ou relevé personnel n’est dans ce dépôt.
