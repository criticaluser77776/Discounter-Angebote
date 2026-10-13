# Angebote Preisvergleich – App

Wird automatisch aus dem Projekt erzeugt (`tools/deploy_pages.py`). Enthält nur die Web-App; die Daten kommen aus Supabase und sind nur nach Anmeldung abrufbar.

## Hinweis zum Veröffentlichen

`tools/deploy_pages.py` im Hauptprojekt überschreibt bei jedem Lauf alle Dateien dieses Repos (auch diese README).
Änderungen, die direkt hier gemacht werden, gehen dabei verloren, wenn sie nicht auch im Hauptprojekt stehen.

- Direkt hier geändert (z. B. über Claude Code im Browser): die Änderungen danach ins Hauptprojekt übernehmen,
  bevor dort das nächste Mal `deploy_pages.py` läuft. Am einfachsten die geänderten Dateien
  (`app.js`, `list.js`, `style.css`, `sw.js` …) aus `main` dieses Repos in den Frontend-Ordner des Hauptprojekts kopieren
  bzw. den Commit dort nachziehen.
- `config.js` wird von `deploy_pages.py` erzeugt (Supabase-Zugang, Versionsnummer). Wird die Versionsnummer hier von Hand
  erhöht, zählt das Hauptprojekt beim nächsten Lauf von seinem eigenen Stand weiter – die Nummer sollte dann
  mindestens so hoch sein wie hier.
- Nach Änderungen an App-Dateien den Cache-Namen `SHELL` in `sw.js` erhöhen, sonst laden installierte Apps
  den neuen Stand nicht.
- GitHub Pages veröffentlicht `main`; Änderungen auf anderen Zweigen sind erst nach dem Zusammenführen live.

Dasselbe gilt für das Repo `Discounter-Angebote-Abruf` (`tools/deploy_abruf.py`).
