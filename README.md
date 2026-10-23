# Vera — bibliothèque personnelle et Kobo

Application Windows 11 (Tauri 2, Rust, React). Vera surveille le dossier de tes livres (en pratique Google Drive) et tient ta liseuse Kobo à l’image de ce dossier. Interface en français, aucun compte, aucun service payant.

## Ce que fait Vera
- **Dossier surveillé** : EPUB et PDF seulement. Un livre est identifié par l’empreinte SHA-256 de son fichier. Vera ne copie, ne modifie ni ne supprime rien dans le dossier.
- **Kobo**, à chaque branchement :
  - envoi des livres absents dans `Vera/` (KEPUB vérifié, sinon EPUB), sans doublon ;
  - étagères calquées sur les sous-dossiers ;
  - un livre retiré du dossier depuis un jour est proposé au retrait, **seulement après confirmation**. Les livres mis sur la Kobo autrement ne sont jamais touchés.
- **Progression et notes de la Kobo** affichées dans Vera, en lecture seule ; notes exportables en Markdown.
- **Fiches** corrigées à la main ou par ISBN (Open Library). Les corrections sont écrites dans la copie envoyée, jamais dans l’original.
- **Lecture** des EPUB et PDF dans la fenêtre. Le fichier est seulement lu, et aucun script venant d’un livre ne s’exécute.
- **Partage guidé** : par e-mail ou dans un salon Discord, envoyé depuis Vera ; WhatsApp et Discord en privé, avec un guide ; ou sur une clé USB. Les secrets restent dans le Gestionnaire d’identification de Windows.
- **Fenêtre fermée**, Vera reste dans la zone de notification et démarre avec Windows.
- **Mises à jour** : Vera signale une nouvelle version et l’installe quand tu cliques. Seule une mise à jour signée par la clé de Vera est acceptée.

## Organisation
- `core/` : **vera-core**, tout le métier en Rust, sans interface. Il est testé, y compris sur un simulateur de Kobo au schéma réel (`tests/fixtures/kobo-schema.sql`) : `cargo test --manifest-path core/Cargo.toml`.
- `src-tauri/` : la coquille Windows (fenêtre, zone de notification, notifications, boucles du dossier et de la Kobo, mises à jour, commandes de l’interface).
- `src/` : l’interface React. Aperçu navigateur avec `npm run dev` (données fictives de `src/dev/`).
- `docs/` : cahier des charges, décisions, essais.

## Fabriquer et publier
GitHub fabrique l’installateur : **Actions › Fabrication Windows › Run workflow**. Cocher « publier » le met dans **Releases**, avec `latest.json` pour les mises à jour depuis Vera. La signature demande les secrets `TAURI_SIGNING_PRIVATE_KEY` et `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Tout se passe dans `scripts/ci-windows.ps1` :
- kepubify, avec son empreinte vérifiée ;
- les tests ;
- la fabrication ;
- la signature ;
- la publication.

Sur un PC de développement : Node 24, Rust, puis
```powershell
npm ci --ignore-scripts
cargo test --manifest-path core/Cargo.toml
./scripts/fetch-runtime.ps1   # crée .release/
npm run tauri -- build
```

## Données
Catalogue `vera2.sqlite` dans `%APPDATA%\fr.vera.personal`. Avant chaque écriture d’étagères, le catalogue de la Kobo est sauvegardé dans le dossier `backups`.

[Notices et licences](NOTICE.md)
