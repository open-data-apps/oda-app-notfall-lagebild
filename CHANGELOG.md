# Changelog

## 1.18.0 - 2026-08-12
- FIX: Toten ID-Selektor `#nlb-methodik-body` auf Klassen-Selektor `.nlb-methodik-body` umgestellt — die Methodik-Box-Regeln greifen nach der instanzeindeutigen ID-Umstellung wieder (F-54)

## 1.17.0 - 2026-08-11
- FIX: Laufzeitressourcen beim Seitenwechsel freigeben (F-43): neuer `onPageLeave`-Hook entfernt Leaflet-Karte und Chart.js-Instanz und macht späte Async-Renders über ein `disposed`-Flag wirkungslos

## 1.16.0 - 2026-08-11
- FIX: XSS- und URL-Vertrag geschlossen (F-35): neuer Top-Level-Helfer `safeHttpUrl`; der Datenquellen-Link in der Statuszeile wird nur noch bei gültigem http(s)-Schema gerendert, sonst nur escapter Text

## 1.15.0 - 2026-08-07
- FIX: Bootstrap-Ziele instanzeindeutig machen (F-32)

## 1.14.0 - 2026-08-06
- FIX: Datenschutzangabe beschreibt den tatsaechlichen Stand nach dem Vendoring (Welle G)

## 1.13.0 - 2026-08-06
- FIX: Drittanbietersektion nennt keine Beim-Aufruf-Behauptung mehr (Welle G)

## 1.12.0 - 2026-08-06
- FIX: Drittanbieterliste "Beim Aufruf kontaktierte Drittanbieter" an das Vendoring angepasst — jetzt lokal ausgelieferte Bibliotheken (Leaflet MarkerCluster) sind aus der Liste entfernt, weiterhin extern geladene Dienste (Kartenkacheln) bleiben genannt

## 1.11.0 - 2026-08-06
- FIX: Leaflet MarkerCluster vendored in `app/vendor/` statt von CDN geladen (Vendoring Teil 3) — Standalone-Betrieb laedt die Zusatzbibliotheken nicht mehr extern

## 1.10.0 - 2026-08-06
- FIX: Base auf Template oda-generic 1.6.0 vereinheitlicht (Hook renderPageOverride)

## 1.9.0 - 2026-08-04
- FIX: Datenschutzhinweis "Beim Aufruf kontaktierte Drittanbieter" an das Vendoring angepasst — jetzt lokal ausgelieferte Bibliotheken (Bootstrap/Leaflet/Chart.js) sind aus der Liste entfernt, weiterhin extern geladene Dienste (Kartenkacheln, Zusatzbibliotheken) bleiben genannt

## 1.8.0 - 2026-08-04
- FIX: Bootstrap, Leaflet, Chart.js vendored in `app/vendor/` statt von CDN geladen (F-07 Teil 2) — Standalone-Betrieb laedt diese Bibliotheken nicht mehr extern

## 1.7.0 - 2026-08-04
- FIX: Drittanbieter (CDN, Kartendienste) in `datenschutz`-Default und README dokumentiert (F-07 Teil 1)
- FIX: Bootstrap CSS/JS auf einheitlich 5.3.8 gezogen (vorher gemischt 5.3.0/5.3.1 bzw. 5.3.0/5.3.0) (F-31)

## 1.6.0 - 2026-07-31
- CHG: toter Konfigurationsschlüssel lizenz entfernt (F-17)
- CHG: brandingCSS und brandingCSSFile als Base-Abhängigkeiten deklariert und lokal gespiegelt (F-17)
- CHG: Groß-/Kleinschreibung der Config-Schlüssel vereinheitlicht, Fallback-Ketten entfernt (F-17)
- CHG: dropdown-Default auf Feldebene verschoben statt in format (F-18)
- CHG: assets/schema.json auf ein flaches Frictionless Table Schema gebracht (F-20)

## 1.5.0 - 2026-07-30

- **FIX:** Laufzeitfehler nach dem Laden der Konfiguration werden jetzt sichtbar gemeldet; `handleRouting()` wird `await`et und besitzt einen Fehlerpfad. Bisher blieb die Seite bei einem Fehler im Seitenaufbau stumm leer
- **FIX:** `getConfigUrl()` schneidet bei einer URL ohne abschliessenden Schraegstrich nicht mehr das letzte Verzeichnis ab; die Konfiguration wird auch unter `.../app` gefunden
- **FIX:** Klick auf einen Hash-Link, der bereits die aktive Seite bezeichnet, rendert die Seite neu (`setupSamePageLinks()`) - das Logo fuehrt damit aus Unteransichten zurueck zur Startseite
- **ENH:** `app/app-base.js` ist wieder byte-identisch zum Template `oda-generic` 1.4.0; app-spezifisches Aufraeumen laeuft ueber den neuen Hook `onPageLeave(page)` in `app/app.js`

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
