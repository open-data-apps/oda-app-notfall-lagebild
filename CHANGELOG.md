# Changelog

## 1.4.0 - 2026-07-24

- **FIX:** Laufzeit-Fehlermeldung wird vor der Anzeige HTML-maskiert (`escapeHtmlForBase`); ein Fehlertext kann kein Markup mehr in die Seite einschleusen (XSS)
- **FIX:** Startseiten-Renderer wird nun `await`et; bei asynchronen Apps erscheint kein kurzzeitiges `[object Promise]` in `#main-content`

## 1.3.0 - 2026-07-23

- **ENH:** Datenabruf auf den Schalter `proxyAktiv` umgestellt; direkte Abrufe sind der Standard, der ODAS-Proxy wird nur noch bei `ja` verwendet
- **ENH:** Einfachen Standalone-Betrieb hinter Traefik mit derselben `odas-config/config.json` wie in der Entwicklung ergänzt
- **ENH:** Traefik-Anbindung auf das externe Netzwerk `proxynet`, den EntryPoint `websecure` und den Zertifikatsresolver `letsencrypt` festgelegt
- **FIX:** Proxy-Basispfad funktioniert jetzt auch bei URLs mit `index.html`; der Ziel-Pfad wird URL-kodiert
- **FIX:** Alten useProxy-Schalter auf den Portfolio-Standard proxyAktiv migriert
- **DOC:** Start über `STANDALONE=true make up` dokumentiert

## 1.2.0 - 2026-06-16

- ENH: Methodikbox (ausklappbar) mit Datenquelle-Hinweis und Datenstand ergänzt (`datenquelleHinweis`, `datenStand`).
- ENH: KPI-Erklärungstexte unter den Kennzahlen ergänzt (`kpiKontext1`–`kpiKontext5`).

## 1.1.0 - 2026-06-16

- ENH: Schale-4-Verständlichkeit ergänzt – „Für wen ist diese App?"-Block in Beschreibung und README.
- ENH: Konfigurierbarer Abschnitt „Weitere Informationen" mit weiterführenden Links (neues Feld `weiterfuehrendeLinks`, leer = ausgeblendet).

## 1.0.1 - 2026-05-19

- `demoMode` und hardcodierte Demo-Generierung aus `app/app.js` entfernt.
- Einheitlicher Datenpfad: alle Datenquellen (inkl. Demo) werden über `apiurl` geladen.
- Default-Quelle auf die neue externe JSON-Ressource umgestellt, `useProxy` standardmäßig auf `ja` gesetzt.
- `resourceId`, Karten-/KPI-Tuning-Configs und lokale Zusatzschlüssel aus den ODAS-Konfigurationen entfernt.
- Kartenmittelpunkt wird nun aus geladenen Koordinaten abgeleitet, interne Fallbacks bleiben in `app/app.js`.
- Release-Bereinigung: `tests/`, `tools/`, `demo-data/` und `App_Konzept_2.md` entfernt.

## 1.0.0 - 2026-05-18

- Initiale ODAS-App "Notfall-Lagebild".
- Demo-Daten, Daten-Normalisierung, KPI-Berechnung und Filterlogik umgesetzt.
- Leaflet-Karte mit Status-Markern, Clustering, Popups, Legende und optionalem Radius ergänzt.
- Chart.js-Diagramm und sortierbare, paginierte Standorttabelle ergänzt.
- ODAS-Metadaten, Schema, README und App-Icon app-spezifisch aktualisiert.
