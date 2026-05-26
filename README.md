# Notfall-Lagebild

Die App **Notfall-Lagebild** bietet ein operatives Dashboard fuer kommunale Notfall-Infrastruktur, Standorte, Status, Kapazitaeten und raeumliche Versorgung.

Die App ist fuer die Verwendung im [Open Data App Store](https://open-data-app-store.de/) gemacht und entspricht dem ODAS-Modell einer konfigurierbaren Open Data App.

---

## Funktionen

Die App ist eine Single Page Application mit:

- Logo-Anzeige
- Menue
- Seiten fuer Impressum, Datenschutz, Beschreibung, Kontakt und Hauptinhalt
- Kennzahlen fuer aktive, gestoerte und ueberfaellige Standorte
- Filter fuer Typ, Untertyp, Status, Stadtteil, Betreiber, Barrierefreiheit, Notstrom, Prioritaet und Freitextsuche
- Interaktive Leaflet-Karte mit farbigen Status-Markern, Clustering, Popups, Legende und optionalem 1-km-Radius
- Chart.js-Balkendiagramm "Standorte nach Typ"
- Sortierbare, paginierte Standorttabelle
- Demo-Daten als statische Dateien im `assets`-Ordner

---

## Datenformat

Die App unterstuetzt folgende Datenquellen:

- **Standardquelle**: externe JSON-Ressource unter `https://open-data-musterstadt.ckan.de/.../download/notfall-lagebild-demo.json`
- **JSON**: Array oder Objekt mit `records`, `results`, `data` oder direkten CKAN-`datastore_search`-Antworten
- **CSV**: Komma- oder Semikolon-separierte Dateien mit Kopfzeile

Fuer CORS-sensitive Datenquellen ist der ODAS-Proxy standardmaessig aktiviert. Im ODAS-Betrieb ruft die App externe Pfade per `POST` ueber `/odp-data?path=...` ab; bei lokalen Live-Server-Tests versucht sie weiter zuerst den Direktabruf.

### Gebuendelte Beispieldaten

Zusaetzlich liegen statische Beispielquellen im `assets`-Ordner. Sie koennen bei Bedarf manuell als alternative `apiurl` verwendet werden.

| Datei | Verwendung |
| --- | --- |
| `assets/notfall-lagebild-demo.csv` | CSV-Demoquelle |
| `assets/notfall-lagebild-demo.json` | JSON-Demoquelle (Default) |

---

## Kompatible Datensaetze

Die App ist kompatibel mit tabellarischen Standortdatensaetzen, die folgende Kernfelder enthalten:

| Feld | Beschreibung |
| --- | --- |
| `id` | Eindeutige Kennung |
| `name` | Anzeigename |
| `typ` | Hauptkategorie, z. B. Notunterkunft oder Sirenenstandort |
| `untertyp` | Feinerer Typ |
| `status` | `aktiv`, `eingeschraenkt`, `ausser Betrieb` oder `geplant` |
| `kapazitaet_max` | Gesamtkapazitaet |
| `kapazitaet_verfuegbar` | Freie Kapazitaet |
| `stadtteil` | Stadtteil oder Bezirk |
| `lat` / `lon` | Koordinaten |
| `barrierefrei` | Barrierefreiheit |
| `stromversorgung_notstrom` | Notstrom vorhanden |
| `wasser_verfuegbar` | Wasser verfuegbar |
| `sanitaer_verfuegbar` | Sanitaer verfuegbar |
| `betreiber` | Betreiber oder Zustaendigkeit |
| `letzte_pruefung` | Datum der letzten Pruefung |
| `prioritaet` | `hoch`, `mittel` oder `niedrig` |
| `hinweis` | Zusatzinformation |

Das vollstaendige Schema liegt in `assets/schema.json`.

---

## Konfiguration

Wichtige Instanz-Parameter:

| Parameter | Beschreibung | Pflicht |
| --- | --- | --- |
| `titel` | Titel in der App | ja |
| `seitentitel` | Browser-Tab-Titel | ja |
| `urlDaten` | Datensatz- oder Ressourcenseite im ODP | ja |
| `apiurl` | Direkter JSON-/CSV-Endpunkt | ja |
| `useProxy` | ODAS-Proxy fuer CORS-sensitive Quellen verwenden | nein |

Interne App-Defaults wie Kartenmittelpunkt, Zoom, KPI-Schwellen und Tabellen-Seitengroesse werden nicht mehr ueber Instanz-Config gepflegt, sondern direkt in `app/app.js` abgeleitet oder als interne Konstanten gefuehrt.

---

## Lokale Entwicklung

Die ODAS-Live-Server-Validierung laeuft gegen:

```text
http://127.0.0.1:5501/app/
```

Fuer lokale Tests wird die Konfiguration aus `odas-config/config.json` geladen. In der ODAS-Plattform kommt die Konfiguration zur Laufzeit aus der App-Instanz.

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
| `assets/schema.json` | Frictionless Data Schema fuer die Standortdaten |
| `assets/odas-app-icon.svg` | App-Icon |
| `assets/notfall-lagebild-demo.json` | Gebuendelte alternative JSON-Beispielquelle |
| `assets/notfall-lagebild-demo.csv` | Gebuendelte alternative CSV-Beispielquelle |
| `odas-config/config.json` | Lokale Entwicklungs-Konfiguration |

---

## Autor

(C) 2026, Ondics GmbH
