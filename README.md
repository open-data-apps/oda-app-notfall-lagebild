# Notfall-Lagebild

Die App **Notfall-Lagebild** visualisiert konfigurierte Standortdaten zur kommunalen Notfall-Infrastruktur mit Status, Kapazitäten und räumlicher Einordnung. Sie unterstützt die Orientierung, ersetzt aber keine amtliche Einsatz- oder Krisenentscheidung.

Die App ist für die Verwendung im [Open Data App Store](https://open-data-app-store.de/) gemacht und entspricht dem ODAS-Modell einer konfigurierbaren Open Data App.

---

## Funktionen

Die App ist eine Single Page Application mit:

- Logo-Anzeige
- Menü
- Seiten für Impressum, Datenschutz, Beschreibung, Kontakt und Hauptinhalt
- Kennzahlen mit ausdrücklich beschrifteten Standortaktionen, getrennten Kapazitäten und Prüfalter statt behaupteter Fristüberschreitung
- Filter für Typ, Untertyp, Status, Stadtteil, Betreiber, Barrierefreiheit, Notstrom, Priorität und Freitextsuche
- Interaktive Leaflet-Karte mit Status-Markern, neutralen Standortgruppen, gemeinsamen Standortdetails, Popups, Typ-Legende und optionalem 1-km-Radius
- Chart.js-Balkendiagramm "Standorte nach Typ"
- Sortierbare, paginierte Standorttabelle

---

## Für wen ist diese App?

Diese App richtet sich an kommunale Verwaltungen, Bevölkerungsschutz und Krisenstäbe sowie an interessierte Bürgerinnen und Bürger. Voraussetzung ist kein spezielles Datenwissen – wer die Notfall-Infrastruktur im Überblick braucht, kann die App direkt nutzen.

---

## Datenformat

Die App unterstützt folgende Datenquellen:

- **Paket-Standardquelle**: externe JSON-Demo-Ressource unter `https://open-data-musterstadt.ckan.de/.../download/notfall-lagebild-demo.json`
- **JSON**: vollständiges Array oder vollständige Listen in `records`, `results`, `data`, `result.records` oder `result.results`
- **CSV**: vollständige Komma- oder Semikolon-Dateien mit Kopfzeile, einschließlich gequoteter mehrzeiliger Texte

Direkte HTTP(S)-Ressourcen müssen keinen bestimmten CKAN-Downloadpfad besitzen. CKAN-Datastore-Endpunkte und erkennbare Teilantworten werden zurückgewiesen; die App lädt keine Folgeseiten. Eine gültige leere Liste ist kein Fehler, eine leere/unlesbare Antwort dagegen schon.

Die Laufzeit toleriert einzelne ungültige Einträge mit sichtbarer Qualitätsmeldung. Mindestens Name/Bezeichnung oder Kennung muss einen Standort erkennen lassen. Das Schema beschreibt das empfohlene kanonische Austauschformat, keine vollständige Laufzeit-Schemavalidierung. Doppelte Kennungen werden gemeldet und nicht still zusammengeführt. Fehlende Angaben bleiben unbekannt, auch bei Status, Priorität, Ausstattung und Kapazität. Standorte ohne gültige Koordinaten bleiben in der Liste nutzbar.

Der Datenabruf erfolgt standardmäßig direkt im Browser (`proxyAktiv: nein`). Bei `proxyAktiv: ja` nutzt die App im ODAS-Betrieb den ODAS-Proxy; lokale Tests verwenden den Direktabruf.

### Demoquelle und Grenzen

Der Paket-Default verweist auf die bekannte Demo-Ressource. Die dort dargestellten Standorte und Kapazitäten sind Anschauungsbeispiele, keine realen Einsatzdaten und keine Notfallentscheidungsgrundlage. Die Startansicht kennzeichnet nur diese bekannte URL; die Meldung bleibt auch bei Filterung sichtbar. Andere konfigurierte Quellen werden nicht pauschal als Demo eingeordnet. Die Demo-Datei wird extern geladen und liegt nicht als statische Beispieldatei im `assets`-Ordner.

| Quelle | Verwendung |
| --- | --- |
| `https://open-data-musterstadt.ckan.de/.../notfall-lagebild-demo.json` | Paket-Standardquelle (Demo, extern) |

### Kartenlegende und Radius

Standortgruppen sind neutral eingefärbt; ihre Zahlen geben nur die Anzahl zusammengefasster Standorte an. Das Typdiagramm nutzt keine Statusfarben und kennzeichnet eine Begrenzung auf die zehn häufigsten Typen ausdrücklich. Bei Kartenausfall bleiben alle auswertbaren Standorte in der paginierten Liste und den Details verfügbar; es gibt keine unvollständige Ersatzkarte.

Die Statusfarben zeigen den Status der Standorte; die Markerbuchstaben stehen für die in den Daten vorkommenden Standorttypen. Insbesondere kennzeichnet **N** eine Notfall-Anlaufstelle und **M** eine mobile Versorgungsstelle; beide sind damit nicht länger als „P“ zusammengefasst. Der optionale Radius umfasst 1 km um jeden gefilterten Standort und ist keine geprüfte Versorgungsreichweite. Er ist standardmäßig ausgeschaltet.

---

## Kompatible Datensätze

Die App ist kompatibel mit tabellarischen Standortdatensätzen, die folgende Kernfelder enthalten:

| Feld | Beschreibung |
| --- | --- |
| `id` | Eindeutige Kennung |
| `name` | Anzeigename |
| `typ` | Hauptkategorie, z. B. Notunterkunft oder Sirenenstandort |
| `untertyp` | Feinerer Typ |
| `status` | `aktiv`, `eingeschränkt`, `außer Betrieb`, `geplant`, `gestört` (Ausmaß unbekannt) oder unbekannt |
| `kapazitaet_max` | Gesamtkapazität |
| `kapazitaet_verfuegbar` | Freie Kapazität |
| `stadtteil` | Stadtteil oder Bezirk |
| `lat` / `lon` | Koordinaten |
| `barrierefrei` | Barrierefreiheit |
| `stromversorgung_notstrom` | Notstrom vorhanden |
| `wasser_verfuegbar` | Wasser verfügbar |
| `sanitaer_verfuegbar` | Sanitär verfügbar |
| `betreiber` | Betreiber oder Zuständigkeit |
| `letzte_pruefung` | Datum der letzten Prüfung |
| `prioritaet` | `hoch`, `mittel` oder `niedrig` |
| `hinweis` | Zusatzinformation |

Das vollständige Schema liegt in `assets/schema.json`.

---

## Standortdetails und Bedienung

Die beschriftete Namensaktion in der Liste und ein Kartenmarker öffnen dieselben vollständigen Standortdetails. Dort stehen auch Adresse, veröffentlichte Ansprechstelle, Ausstattung und der ungekürzte Hinweis. „Auf Karte zeigen“ macht Marker und Popup sichtbar; ohne gültige Koordinaten bleibt die textuelle Detailansicht nutzbar. Schließen führt den Tastaturfokus zum Auslöser zurück, sofern dieser noch vorhanden ist. Sortieren verändert nicht die Kartenkamera.

Mobil bleiben Suche, Typ, Status und Stadtteil direkt erreichbar. Weitere Filter sind aufklappbar; aktive zusätzliche Filter werden sichtbar zusammengefasst. Direkte Sprünge führen zu Karte und Standortliste.

## Kennzahlen und Filter

Kennzahlen beschreiben den gewählten Datenbereich vor der Status-/Schnellauswahl. Karte, Diagramm und Liste zeigen danach dieselbe Treffermenge; die Karte nennt deren kartierbaren Anteil. Die Stadtteilkennzahl verwendet unabhängig davon den gesamten geladenen Bestand (gegebenenfalls nur den gewählten Stadtteil): Sie zählt Stadtteile ohne gemeldeten aktiven Standort, nicht tatsächliche Versorgungslücken. Nicht in der Quelle enthaltene Stadtteile können nicht bewertet werden.

Kapazitäten werden nach Standorttyp und Betriebsstatus getrennt. Nur gemeldete freie Plätze aktiver Standorte bilden den Hauptwert. Ein unspezifisches „gestört“ behauptet weder eingeschränkte Nutzbarkeit noch vollständigen Ausfall. Ohne Typ ist die Vergleichbarkeit unbekannt. Fehlende Werte sind keine Nullmessung.

Das Prüfalter bezeichnet **mehr als 180 Kalendertage**, keine gesetzliche oder individuell konfigurierte Frist. Fehlende, ungültige oder zukünftige Prüfdaten bleiben als Qualitätsmangel erkennbar. Das jüngste Standortprüfdatum ist kein Aktualisierungsdatum der ganzen Quelle.

## Daten neu laden

„Daten neu laden“ ruft dieselbe konfigurierte vollständige Ressource erneut ab. Währenddessen bleibt der letzte erfolgreiche Bestand ausdrücklich als solcher sichtbar. Bei einem Fehler werden weder die Daten noch deren Erfolgszeit durch vermeintliche Nullwerte ersetzt; die Fehlermeldung bleibt sichtbar. Eine gültige leere Liste ersetzt dagegen den alten Bestand. Filter werden erhalten, soweit ihre Werte in der neuen Quelle weiterhin vorhanden sind; entfallene Auswahlwerte werden benannt. Es gibt keine automatische Aktualisierung.

„Letzter erfolgreicher Abruf“ ist nur die Abrufzeit. „Jüngste Standortprüfung“ bezeichnet eine Einzelprüfung, und ein konfigurierter `datenStand` erscheint getrennt als manuelle Quellenangabe. Keine dieser Angaben garantiert die Aktualität aller Standorte.

## Konfiguration

Wichtige Instanz-Parameter:

| Parameter | Beschreibung | Pflicht |
| --- | --- | --- |
| `titel` | Titel in der App | ja |
| `seitentitel` | Browser-Tab-Titel | ja |
| `urlDaten` | Datensatz- oder Ressourcenseite im ODP | ja |
| `apiurls` | URLs zu Datenressourcen. Eintrag `standorte`: direkter JSON-/CSV-Endpunkt | ja (Eintrag `standorte`) |
| `proxyAktiv` | ODAS-Proxy verwenden (`ja` nur für freigegebene Quellen; Standard `nein`) | nein |

Interne App-Defaults wie Kartenmittelpunkt, Zoom, KPI-Schwellen und Tabellen-Seitengröße werden nicht mehr über Instanz-Config gepflegt, sondern direkt in `app/app.js` abgeleitet oder als interne Konstanten geführt.

---

## Lokale Entwicklung

Die ODAS-Live-Server-Validierung läuft gegen:

```text
http://127.0.0.1:5501/app/
```

Für lokale Tests wird die Konfiguration aus `odas-config/config.json` geladen. In der ODAS-Plattform kommt die Konfiguration zur Laufzeit aus der App-Instanz.

Alternativ kann die App per Docker gestartet werden:

```bash
make build up
```

---

## Wichtige Dateien

| Datei | Beschreibung |
| --- | --- |
| `app/app.js` | Hauptlogik: Datenladen, Normalisierung, Filter, KPIs, Chart.js, Leaflet-Karte, Tabelle |
| `app/app.css` | App-spezifische Darstellung |
| `app-package.json` | ODAS-App-Metadaten und Instanz-Konfiguration |
| `assets/schema.json` | Frictionless Data Schema für die Standortdaten |
| `assets/odas-app-icon.svg` | App-Icon |
| `odas-config/config.json` | Lokale Entwicklungs-Konfiguration |

---

## Betriebsarten

Die App kann lokal, eigenstaendig hinter einem Traefik-Reverse-Proxy oder ueber den ODAS
betrieben werden.

### Datenabruf: `proxyAktiv`

| Wert   | Bedeutung                                                                   |
| ------ | --------------------------------------------------------------------------- |
| `nein` | Direkter Abruf der Daten-URL. Standard fuer Entwicklung und Standalone.      |
| `ja`   | Abruf ueber den ODAS-Proxy `…/odp-data`. Nur im ODAS-Live-System verfuegbar. |

Bei `nein` muss die Datenquelle CORS freigeben.

### Standalone-Betrieb

Voraussetzung: ein laufender Traefik mit dem externen Docker-Netzwerk `proxynet`,
dem EntryPoint `websecure` und dem Zertifikatsresolver `letsencrypt`.

1. In `docker-compose.standalone.yml` den Platzhalter `app1.example.com` durch den
   echten FQDN ersetzen.
2. In `odas-config/config.json` `proxyAktiv` auf `nein` belassen.
3. Starten:

```bash
STANDALONE=true make up
STANDALONE=true make logs
STANDALONE=true make down
```

Im Standalone-Betrieb entfaellt die lokale Portfreigabe; Traefik terminiert TLS und
leitet auf den internen Nginx-Port 80 weiter. Die Konfiguration wird aus derselben
`odas-config/config.json` gelesen wie in der Entwicklung und von Nginx unter `/config`
ausgeliefert.

### Beim Aufruf kontaktierte Drittanbieter

Beim Aufruf dieser App werden folgende externe Server kontaktiert:

- Die konfigurierte Standortquelle — bei `proxyAktiv: nein` direkt durch den Browser; bei `ja` erfolgt der Quellenabruf durch den ODAS-Server. Dessen serverseitige Übermittlung/Protokollierung richtet sich nach dem eingesetzten ODAS-System.
- `tile.openstreetmap.org` einschließlich Subdomains — Kartenkacheln (OpenStreetMap), direkt durch den Browser.

Der Instanzbetreiber muss die Veröffentlichung seiner Quelle prüfen. Insbesondere Ansprechstellen können personenbezogene Daten enthalten; die App garantiert keine Personenfreiheit. Portal-, Datensatz- und Ressourcenlinks werden aus der tatsächlichen Konfiguration erzeugt, fehlende Ebenen weggelassen. Bei bereits gebuchten Instanzen müssen redaktionelle Bestandskonfigurationen gesondert geprüft werden; Paket-Defaults sind keine automatische Live-Migration.

Diese Anbieter bleiben auch im Standalone-Betrieb extern; ein vollständig autarker Betrieb ohne Internetzugang ist derzeit nicht möglich. Alle Programmbibliotheken werden lokal aus `app/vendor/` ausgeliefert und nicht mehr extern geladen.

### Auslieferung an den ODAS

`make zip` erzeugt das Liefer-ZIP mit `app/`, `assets/`, `app-package.json` und
`CHANGELOG.md`. Die Infrastrukturdateien (`Dockerfile`, `docker-compose*.yml`,
`nginx.conf`, `Makefile`) sind nicht Teil der Auslieferung. Das ZIP ist ein Bauartefakt und wird nicht mitversioniert, sondern bei Bedarf mit `make zip` erzeugt.

## Regressionstests

```bash
node --test tests/*.test.cjs

# Separat: Browserfälle gegen Live Server, vorhandenes Playwright verwenden
NLB_BASE_URL=http://127.0.0.1:5501/app/ \
NLB_PLAYWRIGHT_MODULE=/pfad/zum/installierten/playwright \
node --test tests/browser-regression.cjs
```

Die Tests prüfen die tatsächlichen Render- und Normalisierungsfunktionen der App: Erkennung der bekannten Demoquelle einschließlich URL-Parametern, keine Demo-Kennzeichnung anderer Quellen, eigenständiger Demo-Hinweis, unterschiedliche N/M-Symbole, maskierte Typnamen in der Legende und die Erklärung des Radius. Es werden keine zusätzlichen Test-Abhängigkeiten benötigt.

## Autor

(C) 2026, Ondics GmbH
