# Notfall-Lagebild

Die App **Notfall-Lagebild** bietet ein operatives Dashboard für kommunale Notfall-Infrastruktur, Standorte, Status, Kapazitäten und räumliche Versorgung.

Die App ist für die Verwendung im [Open Data App Store](https://open-data-app-store.de/) gemacht und entspricht dem ODAS-Modell einer konfigurierbaren Open Data App.

---

## Funktionen

Die App ist eine Single Page Application mit:

- Logo-Anzeige
- Menü
- Seiten für Impressum, Datenschutz, Beschreibung, Kontakt und Hauptinhalt
- Kennzahlen für aktive, gestörte und überfällige Standorte
- Filter für Typ, Untertyp, Status, Stadtteil, Betreiber, Barrierefreiheit, Notstrom, Priorität und Freitextsuche
- Interaktive Leaflet-Karte mit farbigen Status-Markern, Clustering, Popups, Legende und optionalem 1-km-Radius
- Chart.js-Balkendiagramm "Standorte nach Typ"
- Sortierbare, paginierte Standorttabelle
- Demo-Daten als statische Dateien im `assets`-Ordner

---

## Für wen ist diese App?

Diese App richtet sich an kommunale Verwaltungen, Bevölkerungsschutz und Krisenstäbe sowie an interessierte Bürgerinnen und Bürger. Voraussetzung ist kein spezielles Datenwissen – wer die Notfall-Infrastruktur im Überblick braucht, kann die App direkt nutzen.

---

## Datenformat

Die App unterstützt folgende Datenquellen:

- **Standardquelle**: externe JSON-Ressource unter `https://open-data-musterstadt.ckan.de/.../download/notfall-lagebild-demo.json`
- **JSON**: Array oder Objekt mit `records`, `results`, `data` oder direkten CKAN-`datastore_search`-Antworten
- **CSV**: Komma- oder Semikolon-separierte Dateien mit Kopfzeile

Für CORS-sensitive Datenquellen ist der ODAS-Proxy standardmäßig aktiviert. Im ODAS-Betrieb ruft die App externe Pfade per `POST` über `/odp-data?path=...` ab; bei lokalen Live-Server-Tests versucht sie weiter zuerst den Direktabruf.

### Gebündelte Beispieldaten

Zusätzlich liegen statische Beispielquellen im `assets`-Ordner. Sie können bei Bedarf manuell als alternative `apiurl` verwendet werden.

| Datei | Verwendung |
| --- | --- |
| `assets/notfall-lagebild-demo.csv` | CSV-Demoquelle |
| `assets/notfall-lagebild-demo.json` | JSON-Demoquelle (Default) |

---

## Kompatible Datensätze

Die App ist kompatibel mit tabellarischen Standortdatensätzen, die folgende Kernfelder enthalten:

| Feld | Beschreibung |
| --- | --- |
| `id` | Eindeutige Kennung |
| `name` | Anzeigename |
| `typ` | Hauptkategorie, z. B. Notunterkunft oder Sirenenstandort |
| `untertyp` | Feinerer Typ |
| `status` | `aktiv`, `eingeschränkt`, `außer Betrieb` oder `geplant` |
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

## Konfiguration

Wichtige Instanz-Parameter:

| Parameter | Beschreibung | Pflicht |
| --- | --- | --- |
| `titel` | Titel in der App | ja |
| `seitentitel` | Browser-Tab-Titel | ja |
| `urlDaten` | Datensatz- oder Ressourcenseite im ODP | ja |
| `apiurl` | Direkter JSON-/CSV-Endpunkt | ja |
| `useProxy` | ODAS-Proxy für CORS-sensitive Quellen verwenden | nein |

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
| `assets/notfall-lagebild-demo.json` | Gebündelte alternative JSON-Beispielquelle |
| `assets/notfall-lagebild-demo.csv` | Gebündelte alternative CSV-Beispielquelle |
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

- `tile.openstreetmap.org` — Kartenkacheln (OpenStreetMap)

Diese Anbieter bleiben auch im Standalone-Betrieb extern; ein vollständig autarker Betrieb ohne Internetzugang ist derzeit nicht möglich. Bootstrap, Leaflet und Chart.js werden seit Version 1.8.0 und Leaflet MarkerCluster seit Version 1.11.0 lokal aus `app/vendor/` ausgeliefert und nicht mehr extern geladen.

### Auslieferung an den ODAS

`make zip` erzeugt das Liefer-ZIP mit `app/`, `assets/`, `app-package.json` und
`CHANGELOG.md`. Die Infrastrukturdateien (`Dockerfile`, `docker-compose*.yml`,
`nginx.conf`, `Makefile`) sind nicht Teil der Auslieferung.

## Autor

(C) 2026, Ondics GmbH
