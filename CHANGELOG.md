# Changelog

## 1.0.1 - 2026-05-19

- `demoMode` und hardcodierte Demo-Generierung aus `app/app.js` entfernt.
- Einheitlicher Datenpfad: alle Datenquellen (inkl. Demo) werden ueber `apiurl` geladen.
- Default-Quelle auf die neue externe JSON-Ressource umgestellt, `useProxy` standardmaessig auf `ja` gesetzt.
- `resourceId`, Karten-/KPI-Tuning-Configs und lokale Zusatzschluessel aus den ODAS-Konfigurationen entfernt.
- Kartenmittelpunkt wird nun aus geladenen Koordinaten abgeleitet, interne Fallbacks bleiben in `app/app.js`.
- Release-Bereinigung: `tests/`, `tools/`, `demo-data/` und `App_Konzept_2.md` entfernt.

## 1.0.0 - 2026-05-18

- Initiale ODAS-App "Notfall-Lagebild".
- Demo-Daten, Daten-Normalisierung, KPI-Berechnung und Filterlogik umgesetzt.
- Leaflet-Karte mit Status-Markern, Clustering, Popups, Legende und optionalem Radius ergaenzt.
- Chart.js-Diagramm und sortierbare, paginierte Standorttabelle ergaenzt.
- ODAS-Metadaten, Schema, README und App-Icon app-spezifisch aktualisiert.
