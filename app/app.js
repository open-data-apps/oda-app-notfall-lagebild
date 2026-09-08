let nlbInstanzZaehler = 0;

const NLB_STATUS = {
  active: "aktiv",
  restricted: "eingeschraenkt",
  offline: "ausser Betrieb",
  planned: "geplant",
};

const NLB_STATUS_LABELS = {
  [NLB_STATUS.active]: "Aktiv",
  [NLB_STATUS.restricted]: "Eingeschränkt",
  [NLB_STATUS.offline]: "Außer Betrieb",
  [NLB_STATUS.planned]: "Geplant",
};

const NLB_STATUS_COLORS = {
  [NLB_STATUS.active]: "#198754",
  [NLB_STATUS.restricted]: "#f0ad00",
  [NLB_STATUS.offline]: "#c1121f",
  [NLB_STATUS.planned]: "#0d6efd",
};

const NLB_DEFAULT_CENTER = { lat: 48.7419, lon: 9.3046 };
const NLB_DEFAULT_PAGE_SIZE = 20;
const NLB_DEFAULT_ZOOM = 12;
const NLB_DEFAULT_MIN_ACTIVE_PER_DISTRICT = 1;
const NLB_DEFAULT_OVERDUE_AFTER_DAYS = 180;
const NLB_ASSETS = {};

// F-43: Registrierte Instanzen (Container -> State), damit der Top-Level-Hook
// onPageLeave() alle gemounteten Instanzen aufraeumen kann. Die Base ruft den
// Hook global ohne Container-Parameter auf; eine iterierbare Map ist daher das
// zur App passende Muster (Portfolio-Muster aus Task 9.1).
const nlbInstances = new Map();

function onPageLeave(page) {
  nlbInstances.forEach((state, container) => {
    state.disposed = true;
    if (state.map) {
      try {
        state.map.remove();
      } catch (error) {
        console.warn("Fehler beim Entfernen der Leaflet-Karte:", error);
      }
      state.map = null;
    }
    if (state.chart) {
      try {
        state.chart.destroy();
      } catch (error) {
        console.warn("Fehler beim Zerstören des Charts:", error);
      }
      state.chart = null;
    }
    nlbInstances.delete(container);
  });
}

function app(configdata = {}, enclosingHtmlDivElement) {
  const nlbUid = "i" + ++nlbInstanzZaehler;
  const config = normalizeEmergencyConfig(configdata);
  const state = {
    uid: nlbUid,
    config,
    host: enclosingHtmlDivElement,
    allRecords: [],
    filteredRecords: [],
    sortKey: "status",
    sortDirection: "asc",
    page: 1,
    pageSize: NLB_DEFAULT_PAGE_SIZE,
    quickFilter: "",
    showRadius: false,
    map: null,
    markerLayer: null,
    radiusLayer: null,
    chart: null,
    mapCenter: { ...NLB_DEFAULT_CENTER },
    mapZoom: NLB_DEFAULT_ZOOM,
    libraryState: {
      leaflet: false,
      markerCluster: false,
      chart: false,
    },
    disposed: false,
  };

  nlbInstances.set(enclosingHtmlDivElement, state);

  enclosingHtmlDivElement.innerHTML = renderEmergencyShell(config, nlbUid);
  bindEmergencyShell(state);
  initializeEmergencyDashboard(state);
}

function normalizeEmergencyConfig(configdata = {}) {
  const config = { ...configdata };
  config.titel = config.titel || "Notfall-Lagebild";
  config.description = deriveEmergencyDescription(config);
  config.apiurl = getOdasApiUrl(configdata, "standorte");
  config.proxyAktiv = String(configdata.proxyAktiv || "nein").trim().toLowerCase();
  config.weiterfuehrendeLinks = String(config.weiterfuehrendeLinks || "").trim();
  config.datenquelleHinweis = String(config.datenquelleHinweis || "").trim();
  config.datenStand = String(config.datenStand || "").trim();
  for (let i = 1; i <= 5; i++) {
    config["kpiKontext" + i] = String(config["kpiKontext" + i] || "").trim();
  }
  return config;
}

function renderWeitereInfos(config = {}, uid) {
  const links = String(config.weiterfuehrendeLinks || "").trim();
  if (!links) return "";
  return (
    '<section class="nlb-section nlb-weitere-infos">' +
    "<h3>Weitere Informationen</h3>" +
    "<div>" +
    links +
    "</div>" +
    "</section>"
  );
}

function renderMethodikbox(config = {}, uid) {
  const hinweis = String(config.datenquelleHinweis || "").trim();
  const stand = String(config.datenStand || "").trim();
  if (!hinweis && !stand) return "";
  const standHtml = stand
    ? `<p class="text-muted small mb-2">${escapeHtml(stand)}</p>`
    : "";
  return (
    '<section class="nlb-section nlb-methodik">' +
    '<button class="nlb-methodik-toggle collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#nlb-methodik-body-' + uid + '" aria-expanded="false" aria-controls="nlb-methodik-body-' + uid + '">' +
    '<h3 class="mb-0">Methodik &amp; Datenquelle</h3>' +
    '<span class="nlb-methodik-chevron" aria-hidden="true">&#9662;</span>' +
    "</button>" +
    '<div id="nlb-methodik-body-' + uid + '" class="collapse nlb-methodik-body">' +
    standHtml +
    hinweis +
    "</div>" +
    "</section>"
  );
}

async function initializeEmergencyDashboard(state) {
  const quelle = String(state.config.apiurl || "").trim();
  if (!quelle || /^\{\{.*\}\}$/.test(quelle) || /^<.*>$/.test(quelle)) {
    setEmergencyLoading(state, "");
    renderOdasFehler(state.host, new Error("Keine Datenquelle konfiguriert."), {
      url: quelle,
      label: "Standorte-API",
      typLabel: "Datei-Download",
      erwarteterTyp: "ckan-dl",
    });
    return;
  }
  // Variante A (F-92): Typprüfung vor dem ersten Fetch.
  const nlbTypWarn = validateUrlTypErwartung(quelle, "ckan-dl");
  if (nlbTypWarn) {
    setEmergencyLoading(state, "");
    renderOdasFehler(state.host, new Error(nlbTypWarn), {
      url: quelle,
      label: "Standorte-API",
      typLabel: "Datei-Download",
      erwarteterTyp: "ckan-dl",
    });
    return;
  }

  setEmergencyLoading(state, "Daten und Kartenbibliotheken werden geladen ...");

  const libraryPromises =
    typeof document === "undefined"
      ? []
      : [
          loadLeafletLibrary().then((loaded) => {
            state.libraryState.leaflet = loaded;
          }),
          loadMarkerClusterLibrary().then((loaded) => {
            state.libraryState.markerCluster = loaded;
          }),
          loadChartLibrary().then((loaded) => {
            state.libraryState.chart = loaded;
          }),
        ];

  try {
    const [records] = await Promise.all([loadEmergencyRecords(state.config), ...libraryPromises]);
    if (state.disposed) return;
    state.allRecords = records;
    state.mapCenter = deriveEmergencyMapCenter(records);
    populateEmergencyFilters(state);
    setEmergencyLoading(state, "");
    if (records.length === 0) {
      showEmergencyAlert(state, "Keine Datensätze in der Datenquelle gefunden.", "info");
    } else {
      showEmergencyAlert(state, "");
    }
    updateEmergencyDashboard(state);
  } catch (error) {
    if (state.disposed) return;
    console.error("Notfall-Lagebild konnte nicht geladen werden:", error);
    state.allRecords = [];
    setEmergencyLoading(state, "");
    renderOdasFehler(state.host, error, {
      url: String(state.config.apiurl || "").trim(),
      label: "Standorte-API",
      typLabel: "Datei-Download",
      erwarteterTyp: "ckan-dl",
    });
    // renderOdasFehler ersetzt die komplette App-Schale; Dashboard-Updates
    // danach waeren wirkungslos bzw. wuerfen Fehler (kein Null-Check in
    // setEmergencyLoading), daher frueher Ausstieg.
  }
}

async function loadEmergencyRecords(config) {
  if (!config.apiurl) {
    return [];
  }

  const rawText = await fetchEmergencyText(config.apiurl, config);
  const rawRecords = await parseEmergencyData(rawText);
  const records = rawRecords.map((record, index) => normalizeEmergencyRecord(record, index));

  return records;
}

async function fetchEmergencyText(url, config) {
  return fetchOdasResource(url, config);
}

function isOdasProxyEnabled(configdata = {}) {
  return String(configdata.proxyAktiv || "").trim().toLowerCase() === "ja";
}

function extractPathFromUrl(url) {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.pathname + parsedUrl.search;
  } catch (_error) {
    return String(url || "");
  }
}

function getOdasAppBasePath(pathname) {
  let appPath =
    pathname === undefined
      ? typeof window !== "undefined"
        ? window.location.pathname
        : "/"
      : String(pathname || "/");

  if (!appPath.endsWith("/")) {
    const lastSlashIndex = appPath.lastIndexOf("/");
    const lastSegment = appPath.substring(lastSlashIndex + 1);
    if (lastSegment.includes(".")) {
      appPath = appPath.substring(0, lastSlashIndex + 1);
    }
  }

  return appPath.replace(/\/+$/, "");
}

function getOdasProxyEndpoint(targetUrl, pathname) {
  const appPath = getOdasAppBasePath(pathname);
  return `${appPath}/odp-data?path=${encodeURIComponent(targetUrl)}`;
}

async function fetchViaOdasProxy(targetUrl, options = {}) {
  if (typeof isKeineDatenquelleKonfiguriert === "function" && isKeineDatenquelleKonfiguriert(targetUrl)) {
    throw new Error("Keine Datenquelle konfiguriert.");
  } else if (typeof isKeineDatenquelleKonfiguriert !== "function") {
    const v = String(targetUrl || "").trim();
    if (!v || /^\{\{.*\}\}$/.test(v) || /^<.*>$/.test(v)) throw new Error("Keine Datenquelle konfiguriert.");
  }

  const response = await fetch(getOdasProxyEndpoint(targetUrl), {
    method: "POST",
    signal: options && options.signal ? options.signal : undefined,
  });

  if (!response.ok) {
    let body = "";
    try {
      body = await response.text();
    } catch (_e) {}
    const originHint = /origin not allowed/i.test(body) ? " – URL origin not allowed" : "";
    throw new Error(`ODAS-Proxy-Fehler: HTTP ${response.status}${originHint}`);
  }

  const proxyData = await response.json();
  if (!proxyData || typeof proxyData.content !== "string") {
    throw new Error("ODAS-Proxy-Antwort enthält keinen content-String.");
  }

  return proxyData.content;
}

async function fetchOdasResource(targetUrl, configdata = {}) {
  if (isOdasProxyEnabled(configdata)) {
    return fetchViaOdasProxy(targetUrl);
  }

  try {
    const response = await fetch(targetUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.text();
  } catch (error) {
    throw new Error(
      `Direkter Datenabruf fehlgeschlagen (${error.message}). Bitte prüfen Sie die Daten-URL und die CORS-Freigabe der Datenquelle.`,
    );
  }
}

/**
 * Löst eine benannte Datenressource aus configdata.apiurls auf.
 * Neue apiurls-Form (typ: "array"); das frühere skalare apiurl wird nicht mehr gelesen.
 * @returns {string} getrimmte URL, oder "" für den Zustand "keine Quelle konfiguriert"
 */
function getOdasApiUrl(configdata, name) {
  const liste = Array.isArray(configdata && configdata.apiurls) ? configdata.apiurls : [];
  const treffer = liste.find((eintrag) => eintrag && eintrag.name === name);
  return String((treffer && treffer.url) || "").trim();
}

async function fetchOdasJson(targetUrl, configdata = {}) {
  const rawContent = await fetchOdasResource(targetUrl, configdata);
  try {
    return JSON.parse(rawContent);
  } catch (_error) {
    throw new Error(
      `Die konfigurierte Daten-URL liefert kein JSON, sondern ${describeNonJsonPayload(rawContent)}. ` +
        "Bitte in der Instanzkonfiguration den API-Endpunkt der Datenquelle eintragen, " +
        "nicht den Datensatz- oder Download-Link.",
    );
  }
}

function describeNonJsonPayload(rawContent) {
  const text = String(rawContent == null ? "" : rawContent).trim();
  if (!text) return "eine leere Antwort";
  if (text.startsWith("<")) return "eine HTML-Seite";
  const firstLine = text.split(/\r?\n/, 1)[0];
  if (/[,;]/.test(firstLine)) return "eine CSV- oder Textdatei";
  return "unlesbaren Inhalt";
}

function isKeineDatenquelleKonfiguriert(targetUrl) {
  const quelle = String(targetUrl || "").trim();
  return !quelle || /^\{\{.*\}\}$/.test(quelle) || /^<.*>$/.test(quelle);
}


const TYP_BEZEICHNUNG = {
  "ckan-dkan-ds": "Tabellen-API mit Daten-ID",
  "ckan-ps": "Datensatz-API",
  "ckan-dl": "Datei-Download",
  "ods21": "Open-Data-Suche (API v2.1)",
  "wfs": "Kartendienst (WFS)",
  "sparql": "Wissensdatenbank (SPARQL)",
  "csv-zip": "Statische Datei"
};

function validateUrlTypErwartung(url, erwarteterTyp) {
  const u = String(url || "");
  if (!erwarteterTyp || isKeineDatenquelleKonfiguriert(u)) return null;
  const checks = {
    "ckan-dkan-ds": /\/api\/3\/action\/datastore_search\?resource_id=/i,
    "ckan-ps": /\/api\/3\/action\/package_show\?id=/i,
    "ckan-dl": /\/dataset\/.*\/resource\/.*\/download\//i,
    "ods21": /\/api\/explore\/v2\.1\//i,
    "wfs": /service=WFS/i,
    "sparql": /\/api\/ts\/v1\/kg\/sparql/i,
    "csv-zip": /\.(csv|json|zip)(\?|$)/i
  };
  const re = checks[erwarteterTyp];
  if (!re) return null;
  if (!re.test(u)) {
    const soll = TYP_BEZEICHNUNG[erwarteterTyp] || erwarteterTyp;
    return `Typ passt nicht: erwartet „${soll}", erhalten „${u.slice(0, 60)}…". Prüfen Sie den Hilfe-Tooltip bei „URLs zu Datenressourcen".`;
  }
  return null;
}

function classifyOdasFehler(error, kontext = {}) {
  const msg = String((error && error.message) || error || "");
  const url = String(kontext.url || "");
  const label = String(kontext.label || "Datenressource");
  const typLabel = String(kontext.typLabel || TYP_BEZEICHNUNG[kontext.erwarteterTyp] || "Datenquelle");
  if (/Keine Datenquelle konfiguriert/i.test(msg) || isKeineDatenquelleKonfiguriert(url)) {
    return {
      kind: "KEINE_QUELLE",
      titel: "Es ist keine Datenquelle konfiguriert.",
      hinweis: `Prüfen Sie unter „URLs zu Datenressourcen → ${label}" ob eine gültige ${typLabel}-URL eingetragen ist (Hilfe-Tooltip beachten).`,
      detail: msg,
      alertClass: "alert-info"
    };
  }
  if (/Typ passt nicht: erwartet/i.test(msg)) {
    return {
      kind: "TYP_MISMATCH",
      titel: msg,
      hinweis: `Diese App erwartet ${typLabel}. Korrigieren Sie die URL gemäß Hilfe-Tooltip (Beispiel dort).`,
      detail: msg,
      alertClass: "alert-danger"
    };
  }
  if (/URL origin not allowed/i.test(msg)) {
    return {
      kind: "PROXY_ORIGIN",
      titel: "ODAS-Proxy blockiert: Ziel-Origin nicht freigegeben.",
      hinweis: "Tragen Sie die Ziel-Origin als eigenen Eintrag unter „URLs zu Datenressourcen“ ein oder prüfen Sie proxyAktiv.",
      detail: msg,
      alertClass: "alert-danger"
    };
  }
  if (/ODAS-Proxy-Fehler/i.test(msg) || /kein content-String/i.test(msg)) {
    return {
      kind: "PROXY_HTTP",
      titel: msg,
      hinweis: "Prüfen Sie proxyAktiv und Erreichbarkeit im ODAS-Live-System (lokal 404 ist normal).",
      detail: msg,
      alertClass: "alert-danger"
    };
  }
  if (/Direkter Datenabruf fehlgeschlagen/i.test(msg) || /Failed to fetch/i.test(msg)) {
    const corsHint = /Failed to fetch/i.test(msg) ? " – vermutlich CORS blockiert → im ODAS-Live proxyAktiv=ja." : "";
    return {
      kind: "DIREKT_CORS_HTTP",
      titel: msg,
      hinweis: `Prüfen Sie URL und CORS der Quelle${corsHint}`,
      detail: msg,
      alertClass: "alert-danger"
    };
  }
  if (/liefert kein JSON/i.test(msg) || /HTML-Seite|CSV-|leere Antwort|unlesbaren/i.test(msg)) {
    return {
      kind: "PAYLOAD_TYP",
      titel: msg,
      hinweis: "Tragen Sie den passenden Endpunkt ein – nicht die Datensatzseite (/dataset/…) – Hilfe-Tooltip beachten.",
      detail: msg,
      alertClass: "alert-danger"
    };
  }
  if (/CKAN.*Fehler|success:false/i.test(msg)) {
    return {
      kind: "CKAN_API",
      titel: msg,
      hinweis: "Prüfen Sie Daten-ID / Datensatz-ID (existiert die Tabelle/Datei noch auf dem Portal?).",
      detail: msg,
      alertClass: "alert-danger"
    };
  }
  if (/404|Nicht gefunden/i.test(msg)) {
    return {
      kind: "HTTP_404",
      titel: msg,
      hinweis: "Ressource/Datensatz auf dem Portal nicht gefunden (404).",
      detail: msg,
      alertClass: "alert-danger"
    };
  }
  return {
    kind: "UNBEKANNT",
    titel: msg || "Unbekannter Fehler beim Laden.",
    hinweis: "Prüfen Sie Konfiguration und Erreichbarkeit der Quelle.",
    detail: msg,
    alertClass: "alert-danger"
  };
}

function renderOdasFehler(container, error, kontext = {}) {
  if (!container) return;
  const typWarn = validateUrlTypErwartung(kontext.url, kontext.erwarteterTyp);
  if (typWarn && !/Typ passt nicht/i.test(String(error && error.message))) {
    error = new Error(typWarn);
  }
  const info = classifyOdasFehler(error, kontext);
  const url = String(kontext.url || "");
  const urlZeile = url ? `<p class="mb-1 small text-muted">Konfigurierte URL: <code>${escapeHtml(url.length > 80 ? url.slice(0, 80) + "…" : url)}</code></p>` : "";
  const titel = kontext.leer ? "Keine Datensätze gefunden." : info.titel;
  const alertClass = kontext.leer ? "alert-info" : info.alertClass;
  container.innerHTML = `<div class="alert ${alertClass}" role="alert"><strong>${escapeHtml(titel)}</strong><p class="mb-1">${escapeHtml(info.hinweis)}</p>${urlZeile}<details class="small"><summary>Details</summary><code>${escapeHtml(info.detail || String(error))}</code></details></div>`;
}

function isLeerErgebnis(json) {
  if (!json) return true;
  if (Array.isArray(json) && json.length === 0) return true;
  if (Array.isArray(json.records) && json.records.length === 0) return true;
  if (Array.isArray(json.results) && json.results.length === 0) return true;
  if (json.result && Array.isArray(json.result.records) && json.result.records.length === 0) return true;
  return false;
}


async function parseEmergencyData(rawText) {
  const trimmed = String(rawText || "").trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const json = JSON.parse(trimmed);
    return extractEmergencyRecords(json);
  }

  await loadPapaparseLibrary();
  return parseEmergencyCsv(trimmed);
}

function deriveEmergencyDescription(config = {}) {
  const fallback =
    "Operatives Lagebild für kommunale Notfall-Infrastruktur, Status, Kapazitäten und räumliche Versorgung.";
  const rawDescription = Array.isArray(config.beschreibung)
    ? config.beschreibung.join("")
    : String(config.beschreibung || "");
  const trimmed = rawDescription.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (!trimmed) return fallback;
  const firstSentence = trimmed.match(/^[^.!?]+[.!?]/);
  return firstSentence ? firstSentence[0].trim() : trimmed;
}

function extractEmergencyRecords(json) {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json.records)) return json.records;
  if (Array.isArray(json.results)) return json.results;
  if (Array.isArray(json.data)) return json.data;
  if (json.result && Array.isArray(json.result.records)) return json.result.records;
  if (json.result && Array.isArray(json.result.results)) return json.result.results;
  return [];
}

function parseEmergencyCsv(csvText) {
  const result = Papa.parse(csvText, { header: true, skipEmptyLines: "greedy" });
  return Array.isArray(result.data) ? result.data : [];
}

function normalizeEmergencyRecord(rawRecord = {}, index = 0) {
  const maxCapacity = parseInteger(
    pickValue(rawRecord, ["kapazitaet_max", "kapazitaetMax", "capacity_max", "max_capacity"]),
    0
  );
  const freeCapacity = parseInteger(
    pickValue(rawRecord, [
      "kapazitaet_verfuegbar",
      "kapazitaetVerfuegbar",
      "capacity_available",
      "free_capacity",
    ]),
    0
  );
  const suppliedUtilization = pickValue(rawRecord, [
    "auslastung_prozent",
    "auslastungProzent",
    "utilization_percent",
  ]);
  const utilization = Number.isFinite(parseFiniteNumber(suppliedUtilization, NaN))
    ? parseInteger(suppliedUtilization, 0)
    : maxCapacity > 0
      ? Math.max(0, Math.min(100, Math.round(((maxCapacity - freeCapacity) / maxCapacity) * 100)))
      : 0;

  const normalized = {
    id: String(pickValue(rawRecord, ["id", "kennung", "objectid"]) || `NLB-${index + 1}`),
    name: String(pickValue(rawRecord, ["name", "bezeichnung", "title"]) || "Unbenannter Standort"),
    typ: String(pickValue(rawRecord, ["typ", "type", "kategorie"]) || "Sonstiger Standort"),
    untertyp: String(pickValue(rawRecord, ["untertyp", "subtype", "unterkategorie"]) || ""),
    status: normalizeEmergencyStatus(pickValue(rawRecord, ["status", "zustand"]) || NLB_STATUS.planned),
    kapazitaet_max: maxCapacity,
    kapazitaet_verfuegbar: freeCapacity,
    auslastung_prozent: utilization,
    strasse: String(pickValue(rawRecord, ["strasse", "strasze", "street"]) || ""),
    plz: String(pickValue(rawRecord, ["plz", "zip", "postal_code"]) || ""),
    ort: String(pickValue(rawRecord, ["ort", "city", "kommune"]) || ""),
    stadtteil: String(pickValue(rawRecord, ["stadtteil", "bezirk", "district"]) || "Nicht zugeordnet"),
    lat: parseFiniteNumber(pickValue(rawRecord, ["lat", "latitude", "y"]), NaN),
    lon: parseFiniteNumber(pickValue(rawRecord, ["lon", "lng", "longitude", "x"]), NaN),
    barrierefrei: parseBoolean(pickValue(rawRecord, ["barrierefrei", "accessible"])),
    stromversorgung_notstrom: parseBoolean(
      pickValue(rawRecord, ["stromversorgung_notstrom", "notstrom", "emergency_power"])
    ),
    wasser_verfuegbar: parseBoolean(pickValue(rawRecord, ["wasser_verfuegbar", "wasser", "water"])),
    sanitaer_verfuegbar: parseBoolean(
      pickValue(rawRecord, ["sanitaer_verfuegbar", "sanitaer", "sanitary"])
    ),
    betreiber: String(pickValue(rawRecord, ["betreiber", "operator", "traeger"]) || ""),
    ansprechpartner: String(pickValue(rawRecord, ["ansprechpartner", "contact"]) || ""),
    letzte_pruefung: String(pickValue(rawRecord, ["letzte_pruefung", "letztePruefung", "last_check"]) || ""),
    prioritaet: normalizePriority(pickValue(rawRecord, ["prioritaet", "priority"]) || "mittel"),
    hinweis: String(pickValue(rawRecord, ["hinweis", "note", "beschreibung"]) || ""),
  };

  normalized._searchText = normalizeSearchText(
    [
      normalized.id,
      normalized.name,
      normalized.typ,
      normalized.untertyp,
      normalized.status,
      normalized.strasse,
      normalized.plz,
      normalized.ort,
      normalized.stadtteil,
      normalized.betreiber,
      normalized.ansprechpartner,
      normalized.prioritaet,
      normalized.hinweis,
    ].join(" ")
  );

  return normalized;
}

function pickValue(record, keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key) && record[key] !== null && record[key] !== "") {
      return record[key];
    }
  }
  return "";
}

function normalizeEmergencyStatus(value) {
  const normalized = normalizeSearchText(value);
  if (["aktiv", "active", "einsatzbereit"].includes(normalized)) return NLB_STATUS.active;
  if (["eingeschraenkt", "eingeschrankt", "restricted", "stoerung", "storung"].includes(normalized)) {
    return NLB_STATUS.restricted;
  }
  if (
    [
      "ausser betrieb",
      "ausserbetrieb",
      "außer betrieb",
      "offline",
      "inaktiv",
      "nicht einsatzfaehig",
      "nicht einsatzfahig",
    ].includes(normalized)
  ) {
    return NLB_STATUS.offline;
  }
  if (["geplant", "planned", "planung"].includes(normalized)) return NLB_STATUS.planned;
  return String(value || NLB_STATUS.planned);
}

function normalizePriority(value) {
  const normalized = normalizeSearchText(value);
  if (["hoch", "high", "1"].includes(normalized)) return "hoch";
  if (["niedrig", "low", "3"].includes(normalized)) return "niedrig";
  return "mittel";
}

function parseBoolean(value) {
  if (typeof value === "boolean") return value;
  const normalized = normalizeSearchText(value);
  return ["ja", "j", "yes", "true", "1", "x", "vorhanden"].includes(normalized);
}

function parseInteger(value, fallback = 0) {
  const number = parseFiniteNumber(value, fallback);
  return Number.isFinite(number) ? Math.round(number) : fallback;
}

function parseFiniteNumber(value, fallback = 0) {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  const cleaned = String(value ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace(",", ".");
  if (!cleaned) return fallback;
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : fallback;
}

function deriveEmergencyMapCenter(records) {
  const coordinates = records.filter(
    (record) => Number.isFinite(record.lat) && Number.isFinite(record.lon)
  );

  if (!coordinates.length) {
    return { ...NLB_DEFAULT_CENTER };
  }

  const lats = coordinates.map((record) => record.lat);
  const lons = coordinates.map((record) => record.lon);

  return {
    lat: (Math.min(...lats) + Math.max(...lats)) / 2,
    lon: (Math.min(...lons) + Math.max(...lons)) / 2,
  };
}

function calculateEmergencyMetrics(records, options = {}) {
  const minActivePerDistrict = parseInteger(
    options.minActivePerDistrict,
    NLB_DEFAULT_MIN_ACTIVE_PER_DISTRICT
  );
  const overdueAfterDays = parseInteger(
    options.overdueAfterDays,
    NLB_DEFAULT_OVERDUE_AFTER_DAYS
  );
  const referenceDate = options.referenceDate || new Date();
  const districts = new Set();
  const activeByDistrict = {};

  let activeLocations = 0;
  let disruptedLocations = 0;
  let freeCapacity = 0;
  let overdueChecks = 0;

  records.forEach((record) => {
    const district = record.stadtteil || "Nicht zugeordnet";
    districts.add(district);
    freeCapacity += parseInteger(record.kapazitaet_verfuegbar, 0);

    if (record.status === NLB_STATUS.active) {
      activeLocations += 1;
      activeByDistrict[district] = (activeByDistrict[district] || 0) + 1;
    }

    if ([NLB_STATUS.restricted, NLB_STATUS.offline].includes(record.status)) {
      disruptedLocations += 1;
    }

    if (isEmergencyCheckOverdue(record, overdueAfterDays, referenceDate)) {
      overdueChecks += 1;
    }
  });

  const underservedDistricts = [...districts].filter(
    (district) => (activeByDistrict[district] || 0) < minActivePerDistrict
  ).length;

  return {
    activeLocations,
    disruptedLocations,
    freeCapacity,
    underservedDistricts,
    overdueChecks,
  };
}

function isEmergencyCheckOverdue(
  record,
  overdueAfterDays = NLB_DEFAULT_OVERDUE_AFTER_DAYS,
  referenceDate = new Date()
) {
  if (!record.letzte_pruefung) return false;
  const checkedAt = new Date(record.letzte_pruefung);
  if (Number.isNaN(checkedAt.getTime())) return false;
  const ageMs = referenceDate.getTime() - checkedAt.getTime();
  return ageMs > overdueAfterDays * 24 * 60 * 60 * 1000;
}

function filterEmergencyRecords(records, filters = {}) {
  const searchTerm = normalizeSearchText(filters.search || "");
  const wantedNotstrom = normalizeBooleanFilter(filters.notstrom);
  const wantedBarrierefrei = normalizeBooleanFilter(filters.barrierefrei);

  return records.filter((record) => {
    if (filters.typ && record.typ !== filters.typ) return false;
    if (filters.untertyp && record.untertyp !== filters.untertyp) return false;
    if (filters.status && record.status !== normalizeEmergencyStatus(filters.status)) return false;
    if (filters.stadtteil && record.stadtteil !== filters.stadtteil) return false;
    if (filters.betreiber && record.betreiber !== filters.betreiber) return false;
    if (filters.prioritaet && record.prioritaet !== filters.prioritaet) return false;
    if (wantedBarrierefrei !== null && record.barrierefrei !== wantedBarrierefrei) return false;
    if (wantedNotstrom !== null && record.stromversorgung_notstrom !== wantedNotstrom) return false;
    if (searchTerm && !record._searchText.includes(searchTerm)) return false;
    return true;
  });
}

function normalizeBooleanFilter(value) {
  if (!value) return null;
  const normalized = normalizeSearchText(value);
  if (["ja", "true", "1"].includes(normalized)) return true;
  if (["nein", "false", "0"].includes(normalized)) return false;
  return null;
}

function renderEmergencyShell(config, uid) {
  return `
    <section class="nlb-app" aria-label="Notfall-Lagebild">
      <div class="nlb-toolbar">
        <div>
          <p class="nlb-eyebrow mb-1">Kommunales Lagebild</p>
          <h2 class="mb-2">${escapeHtml(config.titel)}</h2>
          <p class="nlb-lead mb-0">${escapeHtml(config.description)}</p>
          <p class="text-muted small mt-2 mb-0" id="nlb-data-status-${uid}">Datenstand wird geladen ...</p>
        </div>
        <div class="nlb-toolbar-actions">
          <button type="button" class="btn btn-outline-secondary" id="nlb-reset-filters-${uid}">Filter zurücksetzen</button>
        </div>
      </div>

      <div class="alert alert-warning d-none" id="nlb-alert-${uid}" role="alert"></div>
      <div class="nlb-loading" id="nlb-loading-${uid}" aria-live="polite"></div>

      <div class="nlb-kpi-grid" id="nlb-kpis-${uid}">
        ${renderKpiCard("active", "Aktive Standorte", "0", "Einsatzbereit", config.kpiKontext1, uid)}
        ${renderKpiCard("disrupted", "Gestörte Standorte", "0", "Eingeschränkt oder außer Betrieb", config.kpiKontext2, uid)}
        ${renderKpiCard("capacity", "Freie Gesamtkapazität", "0", "Verfügbare Plätze", config.kpiKontext3, uid)}
        ${renderKpiCard("underserved", "Unterversorgte Stadtteile", "0", "Aktive Standorte unter Schwelle", config.kpiKontext4, uid)}
        ${renderKpiCard("overdue", "Prüfungen überfällig", "0", "Älter als Grenzwert", config.kpiKontext5, uid)}
      </div>

      <section class="nlb-filters" aria-label="Filter">
        <div class="row g-3">
          ${renderFilterSelect("typ", "Typ", uid)}
          ${renderFilterSelect("untertyp", "Untertyp", uid)}
          ${renderFilterSelect("status", "Status", uid)}
          ${renderFilterSelect("stadtteil", "Stadtteil", uid)}
          ${renderFilterSelect("betreiber", "Betreiber", uid)}
          ${renderFilterSelect("barrierefrei", "Barrierefrei", uid)}
          ${renderFilterSelect("notstrom", "Notstrom", uid)}
          ${renderFilterSelect("prioritaet", "Priorität", uid)}
          <div class="col-12 col-lg-4">
            <label class="form-label" for="nlb-filter-search-${uid}">Suche</label>
            <input class="form-control" id="nlb-filter-search-${uid}" type="search" placeholder="Name, Adresse, Hinweis">
          </div>
        </div>
        <div class="nlb-filter-note" id="nlb-filter-note-${uid}"></div>
      </section>

      <div class="row g-4 align-items-stretch">
        <div class="col-12 col-xl-8">
          <section class="nlb-panel h-100" aria-label="Karte">
            <div class="nlb-panel-head">
              <h3>Karte</h3>
              <div class="btn-group">
                <button type="button" class="btn btn-sm btn-outline-secondary" id="nlb-zoom-results-${uid}">Treffer zentrieren</button>
                <button type="button" class="btn btn-sm btn-outline-secondary" id="nlb-toggle-radius-${uid}">1 km Radius</button>
              </div>
            </div>
            <div id="nlb-map-${uid}" class="nlb-map" role="application" aria-label="Standortkarte"></div>
            <div class="nlb-map-legend" id="nlb-map-legend-${uid}"></div>
          </section>
        </div>
        <div class="col-12 col-xl-4">
          <section class="nlb-panel h-100" aria-label="Diagramm">
            <div class="nlb-panel-head">
              <h3>Standorte nach Typ</h3>
            </div>
            <div class="nlb-chart-wrap" id="nlb-chart-wrap-${uid}">
              <canvas id="nlb-type-chart-${uid}"></canvas>
            </div>
          </section>
        </div>
      </div>

      <section class="nlb-panel mt-4" aria-label="Tabelle">
        <div class="nlb-panel-head">
          <h3>Operative Standortliste</h3>
          <span class="nlb-result-count" id="nlb-result-count-${uid}">0 Treffer</span>
        </div>
        <div class="table-responsive">
          <table class="table table-hover align-middle nlb-table">
            <thead id="nlb-table-head-${uid}"></thead>
            <tbody id="nlb-table-body-${uid}"></tbody>
          </table>
        </div>
        <div class="nlb-pagination">
          <button type="button" class="btn btn-sm btn-outline-secondary" id="nlb-prev-page-${uid}">Zurück</button>
          <span id="nlb-page-info-${uid}">Seite 1 von 1</span>
          <button type="button" class="btn btn-sm btn-outline-secondary" id="nlb-next-page-${uid}">Weiter</button>
        </div>
      </section>

      ${renderMethodikbox(config, uid)}
      ${renderWeitereInfos(config, uid)}
    </section>
  `;
}

function renderKpiCard(id, label, value, hint, kontext, uid) {
  const k = String(kontext || "").trim();
  const kontextHtml = k
    ? `<button class="nlb-kpi-info-toggle collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#nlb-kpi-kontext-${id}-${uid}" aria-expanded="false" aria-controls="nlb-kpi-kontext-${id}-${uid}" aria-label="Erklärung zu diesem Wert"><span class="nlb-kpi-info-icon" aria-hidden="true">ⓘ</span></button><div id="nlb-kpi-kontext-${id}-${uid}" class="collapse"><div class="nlb-kpi-kontext">${escapeHtml(k)}</div></div>`
    : "";
  return `
    <div class="nlb-kpi-wrap">
      <button type="button" class="nlb-kpi" data-quickfilter="${id}">
        <span>${label}</span>
        <strong id="nlb-kpi-${id}-${uid}">${value}</strong>
        <small>${hint}</small>
      </button>
      ${kontextHtml}
    </div>
  `;
}

function renderFilterSelect(id, label, uid) {
  return `
    <div class="col-12 col-md-6 col-lg-3">
      <label class="form-label" for="nlb-filter-${id}-${uid}">${label}</label>
      <select class="form-select nlb-filter" id="nlb-filter-${id}-${uid}" data-filter="${id}">
        <option value="">Alle</option>
      </select>
    </div>
  `;
}

function bindEmergencyShell(state) {
  state.host.querySelector(`#nlb-reset-filters-${state.uid}`).addEventListener("click", () => {
    state.quickFilter = "";
    state.page = 1;
    state.host.querySelectorAll(".nlb-filter").forEach((element) => {
      element.value = "";
    });
    state.host.querySelector(`#nlb-filter-search-${state.uid}`).value = "";
    updateEmergencyDashboard(state);
  });

  state.host.querySelector(`#nlb-zoom-results-${state.uid}`).addEventListener("click", () => fitEmergencyMap(state));
  state.host.querySelector(`#nlb-toggle-radius-${state.uid}`).addEventListener("click", () => {
    state.showRadius = !state.showRadius;
    state.host.querySelector(`#nlb-toggle-radius-${state.uid}`).classList.toggle("active", state.showRadius);
    updateEmergencyMap(state);
  });

  state.host.querySelector(`#nlb-prev-page-${state.uid}`).addEventListener("click", () => {
    state.page = Math.max(1, state.page - 1);
    renderEmergencyTable(state);
  });

  state.host.querySelector(`#nlb-next-page-${state.uid}`).addEventListener("click", () => {
    const maxPage = Math.max(1, Math.ceil(state.filteredRecords.length / state.pageSize));
    state.page = Math.min(maxPage, state.page + 1);
    renderEmergencyTable(state);
  });

  state.host.querySelectorAll("[data-quickfilter]").forEach((element) => {
    element.addEventListener("click", () => {
      state.quickFilter = element.dataset.quickfilter || "";
      state.page = 1;
      updateEmergencyDashboard(state);
    });
  });

  state.host.querySelectorAll(".nlb-filter").forEach((element) => {
    element.addEventListener("change", () => {
      state.quickFilter = "";
      state.page = 1;
      updateEmergencyDashboard(state);
    });
  });

  state.host.querySelector(`#nlb-filter-search-${state.uid}`).addEventListener("input", () => {
    state.quickFilter = "";
    state.page = 1;
    updateEmergencyDashboard(state);
  });
}

function populateEmergencyFilters(state) {
  setSelectOptions(state, "typ", uniqueValues(state.allRecords, "typ"));
  setSelectOptions(state, "untertyp", uniqueValues(state.allRecords, "untertyp"));
  setSelectOptions(
    state,
    "status",
    Object.values(NLB_STATUS).map((status) => ({ value: status, label: NLB_STATUS_LABELS[status] }))
  );
  setSelectOptions(state, "stadtteil", uniqueValues(state.allRecords, "stadtteil"));
  setSelectOptions(state, "betreiber", uniqueValues(state.allRecords, "betreiber"));
  setSelectOptions(state, "barrierefrei", [
    { value: "ja", label: "Ja" },
    { value: "nein", label: "Nein" },
  ]);
  setSelectOptions(state, "notstrom", [
    { value: "ja", label: "Ja" },
    { value: "nein", label: "Nein" },
  ]);
  setSelectOptions(state, "prioritaet", ["hoch", "mittel", "niedrig"]);
}

function setSelectOptions(state, id, values) {
  const select = state.host.querySelector(`#nlb-filter-${id}-${state.uid}`);
  const currentValue = select.value;
  const entries = values
    .filter((value) => {
      if (typeof value === "string") return value.trim().length > 0;
      return value && value.value;
    })
    .map((value) => (typeof value === "string" ? { value, label: value } : value));

  select.innerHTML = `<option value="">Alle</option>${entries
    .map((entry) => `<option value="${escapeHtml(entry.value)}">${escapeHtml(entry.label)}</option>`)
    .join("")}`;
  select.value = entries.some((entry) => entry.value === currentValue) ? currentValue : "";
}

function uniqueValues(records, key) {
  return [...new Set(records.map((record) => record[key]).filter(Boolean))].sort((a, b) =>
    String(a).localeCompare(String(b), "de")
  );
}

function updateEmergencyDashboard(state) {
  const filters = collectEmergencyFilters(state);
  let filteredRecords = filterEmergencyRecords(state.allRecords, filters);
  filteredRecords = applyQuickFilter(filteredRecords, state);
  state.filteredRecords = sortEmergencyRecords(filteredRecords, state.sortKey, state.sortDirection);

  updateEmergencyStatusLine(state);
  renderEmergencyKpis(state);
  renderEmergencyLegend(state);
  updateEmergencyMap(state);
  updateEmergencyChart(state);
  renderEmergencyTable(state);
}

function collectEmergencyFilters(state) {
  const filters = {};
  state.host.querySelectorAll(".nlb-filter").forEach((element) => {
    filters[element.dataset.filter] = element.value;
  });
  filters.search = state.host.querySelector(`#nlb-filter-search-${state.uid}`).value;
  return filters;
}

function applyQuickFilter(records, state) {
  const now = new Date();
  if (state.quickFilter === "active") {
    return records.filter((record) => record.status === NLB_STATUS.active);
  }
  if (state.quickFilter === "disrupted") {
    return records.filter((record) => [NLB_STATUS.restricted, NLB_STATUS.offline].includes(record.status));
  }
  if (state.quickFilter === "capacity") {
    return records.filter((record) => record.kapazitaet_verfuegbar > 0);
  }
  if (state.quickFilter === "overdue") {
    return records.filter((record) =>
      isEmergencyCheckOverdue(record, NLB_DEFAULT_OVERDUE_AFTER_DAYS, now)
    );
  }
  if (state.quickFilter === "underserved") {
    const underserved = findUnderservedDistricts(records, NLB_DEFAULT_MIN_ACTIVE_PER_DISTRICT);
    return records.filter((record) => underserved.has(record.stadtteil));
  }
  return records;
}

function findUnderservedDistricts(records, minActivePerDistrict) {
  const districts = new Set(records.map((record) => record.stadtteil));
  const activeByDistrict = {};
  records.forEach((record) => {
    if (record.status === NLB_STATUS.active) {
      activeByDistrict[record.stadtteil] = (activeByDistrict[record.stadtteil] || 0) + 1;
    }
  });
  return new Set(
    [...districts].filter((district) => (activeByDistrict[district] || 0) < minActivePerDistrict)
  );
}

function updateEmergencyStatusLine(state) {
  const statusElement = state.host.querySelector(`#nlb-data-status-${state.uid}`);
  const maxDate = state.allRecords
    .map((record) => record.letzte_pruefung)
    .filter(Boolean)
    .sort()
    .pop();
  const apiurl = safeHttpUrl(state.config.apiurl);
  const apiurlHtml = apiurl
    ? `<a href="${escapeHtml(apiurl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(apiurl)}</a>`
    : state.config.apiurl ? escapeHtml(state.config.apiurl) : "-";
  const dateStr = maxDate ? formatDate(maxDate) : "nicht angegeben";
  statusElement.innerHTML = `Datenquelle: ${apiurlHtml} | ${state.allRecords.length.toLocaleString("de-DE")} Standorte | Datenstand: ${escapeHtml(dateStr)}`;

  const note = state.host.querySelector(`#nlb-filter-note-${state.uid}`);
  note.textContent = state.quickFilter
    ? `Schnellfilter aktiv: ${quickFilterLabel(state.quickFilter)}`
    : "Alle Filter wirken gleichzeitig auf Kennzahlen, Karte, Diagramm und Tabelle.";
}

function quickFilterLabel(value) {
  const labels = {
    active: "aktive Standorte",
    disrupted: "gestörte Standorte",
    capacity: "Standorte mit freier Kapazität",
    underserved: "unterversorgte Stadtteile",
    overdue: "überfällige Prüfungen",
  };
  return labels[value] || value;
}

function renderEmergencyKpis(state) {
  const metrics = calculateEmergencyMetrics(state.filteredRecords, {
    minActivePerDistrict: NLB_DEFAULT_MIN_ACTIVE_PER_DISTRICT,
    overdueAfterDays: NLB_DEFAULT_OVERDUE_AFTER_DAYS,
    referenceDate: new Date(),
  });

  setText(state, `nlb-kpi-active-${state.uid}`, metrics.activeLocations.toLocaleString("de-DE"));
  setText(state, `nlb-kpi-disrupted-${state.uid}`, metrics.disruptedLocations.toLocaleString("de-DE"));
  setText(state, `nlb-kpi-capacity-${state.uid}`, metrics.freeCapacity.toLocaleString("de-DE"));
  setText(state, `nlb-kpi-underserved-${state.uid}`, metrics.underservedDistricts.toLocaleString("de-DE"));
  setText(state, `nlb-kpi-overdue-${state.uid}`, metrics.overdueChecks.toLocaleString("de-DE"));

  state.host.querySelectorAll(".nlb-kpi").forEach((element) => {
    element.classList.toggle("active", element.dataset.quickfilter === state.quickFilter);
  });
}

function setText(state, id, text) {
  const element = state.host.querySelector(`#${id}`);
  if (element) element.textContent = text;
}

function renderEmergencyLegend(state) {
  const legend = state.host.querySelector(`#nlb-map-legend-${state.uid}`);
  legend.innerHTML = Object.values(NLB_STATUS)
    .map(
      (status) =>
        `<span><i style="background:${NLB_STATUS_COLORS[status]}"></i>${escapeHtml(
          NLB_STATUS_LABELS[status]
        )}</span>`
    )
    .join("");
}

function updateEmergencyMap(state) {
  const mapElement = state.host.querySelector(`#nlb-map-${state.uid}`);
  if (!state.libraryState.leaflet || typeof L === "undefined") {
    renderFallbackEmergencyMap(state, mapElement);
    return;
  }

  if (!state.map) {
    mapElement.classList.remove("nlb-map-fallback-mode");
    state.map = L.map(mapElement).setView(
      [state.mapCenter.lat, state.mapCenter.lon],
      state.mapZoom
    );
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap-Mitwirkende",
    }).addTo(state.map);
  }

  if (state.markerLayer) state.markerLayer.remove();
  if (state.radiusLayer) state.radiusLayer.remove();

  state.markerLayer =
    state.libraryState.markerCluster && L.markerClusterGroup
      ? L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 45 })
      : L.layerGroup();
  state.radiusLayer = L.layerGroup();

  state.filteredRecords.forEach((record) => {
    if (!Number.isFinite(record.lat) || !Number.isFinite(record.lon)) return;
    const marker = L.marker([record.lat, record.lon], {
      icon: L.divIcon({
        className: "",
        html: `<span class="nlb-map-marker ${statusClass(record.status)}">${typeInitial(record.typ)}</span>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15],
      }),
      title: record.name,
    });
    marker.bindPopup(renderEmergencyPopup(record));
    state.markerLayer.addLayer(marker);

    if (state.showRadius) {
      L.circle([record.lat, record.lon], {
        radius: 1000,
        color: NLB_STATUS_COLORS[record.status] || "#6c757d",
        fillColor: NLB_STATUS_COLORS[record.status] || "#6c757d",
        fillOpacity: 0.05,
        weight: 1,
      }).addTo(state.radiusLayer);
    }
  });

  state.markerLayer.addTo(state.map);
  if (state.showRadius) state.radiusLayer.addTo(state.map);
  fitEmergencyMap(state);
}

function renderEmergencyPopup(record) {
  return `
    <div class="nlb-popup">
      <strong>${escapeHtml(record.name)}</strong>
      <dl>
        <dt>Typ</dt><dd>${escapeHtml(record.typ)}</dd>
        <dt>Status</dt><dd>${escapeHtml(NLB_STATUS_LABELS[record.status] || record.status)}</dd>
        <dt>Kapazität</dt><dd>${record.kapazitaet_verfuegbar} / ${record.kapazitaet_max}</dd>
        <dt>Betreiber</dt><dd>${escapeHtml(record.betreiber || "-")}</dd>
        <dt>Letzte Prüfung</dt><dd>${escapeHtml(formatDate(record.letzte_pruefung))}</dd>
      </dl>
    </div>
  `;
}

function fitEmergencyMap(state) {
  if (!state.map || !state.markerLayer || typeof L === "undefined") return;
  const coordinates = state.filteredRecords
    .filter((record) => Number.isFinite(record.lat) && Number.isFinite(record.lon))
    .map((record) => [record.lat, record.lon]);

  if (!coordinates.length) {
    state.map.setView([state.mapCenter.lat, state.mapCenter.lon], state.mapZoom);
    return;
  }

  const bounds = L.latLngBounds(coordinates);
  state.map.fitBounds(bounds.pad(0.12), { maxZoom: 15 });
}

function updateEmergencyChart(state) {
  const chartWrap = state.host.querySelector(`#nlb-chart-wrap-${state.uid}`);
  if (!state.libraryState.chart || typeof Chart === "undefined") {
    renderFallbackEmergencyChart(state, chartWrap);
    return;
  }

  if (!state.host.querySelector(`#nlb-type-chart-${state.uid}`)) {
    chartWrap.innerHTML = `<canvas id="nlb-type-chart-${state.uid}"></canvas>`;
  }

  const canvas = state.host.querySelector(`#nlb-type-chart-${state.uid}`);

  const byType = aggregateByKey(state.filteredRecords, "typ");
  const labels = Object.keys(byType).sort((a, b) => byType[b] - byType[a]).slice(0, 10);
  const values = labels.map((label) => byType[label]);

  if (state.chart) {
    state.chart.destroy();
  }

  state.chart = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Standorte",
          data: values,
          backgroundColor: ["#2563eb", "#198754", "#f0ad00", "#c1121f", "#6f42c1", "#0f766e"],
          borderRadius: 4,
        },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
      },
      scales: {
        x: { beginAtZero: true, ticks: { precision: 0 } },
      },
    },
  });
}

function renderFallbackEmergencyMap(state, mapElement) {
  mapElement.classList.add("nlb-map-fallback-mode");
  const records = state.filteredRecords.filter(
    (record) => Number.isFinite(record.lat) && Number.isFinite(record.lon)
  );

  if (!records.length) {
    mapElement.innerHTML = `<div class="nlb-map-fallback">Keine kartierbaren Standorte fuer die aktuellen Filter.</div>`;
    return;
  }

  const lats = records.map((record) => record.lat);
  const lons = records.map((record) => record.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const latRange = maxLat - minLat || 0.01;
  const lonRange = maxLon - minLon || 0.01;
  const visibleRecords = records.slice(0, 650);

  const points = visibleRecords
    .map((record) => {
      const x = 40 + ((record.lon - minLon) / lonRange) * 920;
      const y = 460 - ((record.lat - minLat) / latRange) * 420;
      const radius = record.status === NLB_STATUS.active ? 4.5 : 6;
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${radius}" fill="${
        NLB_STATUS_COLORS[record.status] || "#6c757d"
      }"><title>${escapeHtml(record.name)}</title></circle>`;
    })
    .join("");

  mapElement.innerHTML = `
    <svg class="nlb-svg-map" viewBox="0 0 1000 520" role="img" aria-label="Schematische Standortkarte">
      <rect x="1" y="1" width="998" height="518" rx="18" fill="#eef6ff" stroke="#c7d7ea"/>
      <path d="M90 390 C210 300 310 340 430 255 S700 155 910 115" fill="none" stroke="#cbd5e1" stroke-width="36" stroke-linecap="round"/>
      <path d="M110 190 C245 245 360 170 505 230 S745 310 890 255" fill="none" stroke="#d9e2ec" stroke-width="28" stroke-linecap="round"/>
      <g opacity="0.18" stroke="#64748b">
        <path d="M130 70v380M300 45v430M470 55v405M640 45v420M810 70v360"/>
        <path d="M90 115h820M70 225h850M95 335h790M130 445h740"/>
      </g>
      <g>${points}</g>
      <text x="36" y="40" fill="#334155" font-size="22" font-weight="700">Lokale Karten-Vorschau</text>
      <text x="36" y="68" fill="#64748b" font-size="16">${records.length.toLocaleString(
        "de-DE"
      )} Standorte, Leaflet wird bei verfuegbarer Bibliothek automatisch genutzt</text>
    </svg>
  `;
}

function renderFallbackEmergencyChart(state, chartWrap) {
  const byType = aggregateByKey(state.filteredRecords, "typ");
  const labels = Object.keys(byType).sort((a, b) => byType[b] - byType[a]).slice(0, 10);
  const maxValue = Math.max(1, ...labels.map((label) => byType[label]));

  chartWrap.innerHTML = `
    <div class="nlb-fallback-bars" role="img" aria-label="Standorte nach Typ">
      ${labels
        .map((label) => {
          const value = byType[label];
          const width = Math.max(3, Math.round((value / maxValue) * 100));
          return `
            <div class="nlb-fallback-bar">
              <div class="nlb-fallback-bar-label">
                <span>${escapeHtml(label)}</span>
                <strong>${value.toLocaleString("de-DE")}</strong>
              </div>
              <div class="nlb-fallback-bar-track">
                <i style="width:${width}%"></i>
              </div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function aggregateByKey(records, key) {
  return records.reduce((result, record) => {
    const value = record[key] || "Nicht zugeordnet";
    result[value] = (result[value] || 0) + 1;
    return result;
  }, {});
}

function renderEmergencyTable(state) {
  const columns = [
    ["name", "Name"],
    ["typ", "Typ"],
    ["stadtteil", "Stadtteil"],
    ["status", "Status"],
    ["kapazitaet_max", "Max."],
    ["kapazitaet_verfuegbar", "Frei"],
    ["barrierefrei", "Barrierefrei"],
    ["stromversorgung_notstrom", "Notstrom"],
    ["letzte_pruefung", "Letzte Prüfung"],
    ["betreiber", "Betreiber"],
  ];
  const maxPage = Math.max(1, Math.ceil(state.filteredRecords.length / state.pageSize));
  state.page = Math.min(state.page, maxPage);
  const start = (state.page - 1) * state.pageSize;
  const pageRows = state.filteredRecords.slice(start, start + state.pageSize);

  state.host.querySelector(`#nlb-table-head-${state.uid}`).innerHTML = `<tr>${columns
    .map(([key, label]) => {
      const active = state.sortKey === key ? ` aria-sort="${state.sortDirection === "asc" ? "ascending" : "descending"}"` : "";
      return `<th scope="col"${active}><button type="button" class="nlb-sort" data-sort="${key}">${label}</button></th>`;
    })
    .join("")}</tr>`;

  state.host.querySelector(`#nlb-table-body-${state.uid}`).innerHTML =
    pageRows
      .map(
        (record) => `
        <tr data-record-id="${escapeHtml(record.id)}">
          <td><strong>${escapeHtml(record.name)}</strong><span>${escapeHtml(record.hinweis || "")}</span></td>
          <td>${escapeHtml(record.typ)}</td>
          <td>${escapeHtml(record.stadtteil)}</td>
          <td><span class="badge ${statusBadgeClass(record.status)}">${escapeHtml(
            NLB_STATUS_LABELS[record.status] || record.status
          )}</span></td>
          <td>${formatNumber(record.kapazitaet_max)}</td>
          <td>${formatNumber(record.kapazitaet_verfuegbar)}</td>
          <td>${formatBoolean(record.barrierefrei)}</td>
          <td>${formatBoolean(record.stromversorgung_notstrom)}</td>
          <td>${escapeHtml(formatDate(record.letzte_pruefung))}</td>
          <td>${escapeHtml(record.betreiber)}</td>
        </tr>
      `
      )
      .join("") || `<tr><td colspan="10" class="text-center text-muted py-4">Keine Treffer fuer die aktuellen Filter.</td></tr>`;

  state.host.querySelectorAll(".nlb-sort").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.sort;
      if (state.sortKey === key) {
        state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
      } else {
        state.sortKey = key;
        state.sortDirection = "asc";
      }
      state.page = 1;
      updateEmergencyDashboard(state);
    });
  });

  state.host.querySelectorAll(`#nlb-table-body-${state.uid} tr[data-record-id]`).forEach((row) => {
    row.addEventListener("click", () => focusEmergencyRecord(state, row.dataset.recordId));
  });

  state.host.querySelector(`#nlb-result-count-${state.uid}`).textContent = `${state.filteredRecords.length.toLocaleString(
    "de-DE"
  )} Treffer`;
  state.host.querySelector(`#nlb-page-info-${state.uid}`).textContent = `Seite ${state.page} von ${maxPage}`;
  state.host.querySelector(`#nlb-prev-page-${state.uid}`).disabled = state.page <= 1;
  state.host.querySelector(`#nlb-next-page-${state.uid}`).disabled = state.page >= maxPage;
}

function sortEmergencyRecords(records, key, direction) {
  const sorted = [...records].sort((a, b) => {
    const left = a[key];
    const right = b[key];
    if (typeof left === "number" && typeof right === "number") {
      return left - right;
    }
    return String(left || "").localeCompare(String(right || ""), "de", { numeric: true });
  });
  return direction === "desc" ? sorted.reverse() : sorted;
}

function focusEmergencyRecord(state, recordId) {
  const record = state.filteredRecords.find((entry) => entry.id === recordId);
  if (!record || !state.map || !Number.isFinite(record.lat) || !Number.isFinite(record.lon)) return;
  state.map.setView([record.lat, record.lon], 16);
}

function statusClass(status) {
  return `nlb-marker-${normalizeSearchText(status).replace(/\s+/g, "-")}`;
}

function statusBadgeClass(status) {
  if (status === NLB_STATUS.active) return "text-bg-success";
  if (status === NLB_STATUS.restricted) return "text-bg-warning";
  if (status === NLB_STATUS.offline) return "text-bg-danger";
  if (status === NLB_STATUS.planned) return "text-bg-primary";
  return "text-bg-secondary";
}

function typeInitial(type) {
  const normalized = normalizeSearchText(type);
  if (normalized.includes("aed")) return "A";
  if (normalized.includes("sirene")) return "S";
  if (normalized.includes("feuerwehr")) return "F";
  if (normalized.includes("wasser")) return "W";
  if (normalized.includes("unterkunft")) return "U";
  return "P";
}

function setEmergencyLoading(state, message) {
  const element = state.host.querySelector(`#nlb-loading-${state.uid}`);
  element.textContent = message;
  element.classList.toggle("d-none", !message);
}

function showEmergencyAlert(state, message, type = "danger") {
  const element = state.host.querySelector(`#nlb-alert-${state.uid}`);
  if (!element) return;
  element.textContent = message;
  element.className = `alert alert-${type} ${message ? "" : "d-none"}`;
}

function formatBoolean(value) {
  return value ? "Ja" : "Nein";
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("de-DE");
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("de-DE");
}

function normalizeSearchText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeHttpUrl(value) {
  const s = String(value || "").trim();
  return /^https?:\/\//i.test(s) ? s : "";
}

function loadStyleOnce(id, href) {
  if (typeof document === "undefined") return Promise.resolve(false);
  if (document.getElementById(id)) return Promise.resolve(true);
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
  return Promise.resolve(true);
}

function loadScriptOnce(id, src, isLoaded) {
  if (typeof document === "undefined") return Promise.resolve(false);
  if (isLoaded()) return Promise.resolve(true);
  if (NLB_ASSETS[id]) return NLB_ASSETS[id];

  NLB_ASSETS[id] = new Promise((resolve) => {
    const script = document.createElement("script");
    script.id = id;
    script.src = src;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });

  return NLB_ASSETS[id];
}

async function loadLeafletLibrary() {
  await loadStyleOnce("nlb-leaflet-css", "vendor/leaflet/leaflet.css");
  return loadScriptOnce("nlb-leaflet-js", "vendor/leaflet/leaflet.js", () =>
    typeof L !== "undefined"
  );
}

async function loadMarkerClusterLibrary() {
  const leafletLoaded = await loadLeafletLibrary();
  if (!leafletLoaded) return false;
  await loadStyleOnce(
    "nlb-markercluster-css",
    "vendor/markercluster/MarkerCluster.css"
  );
  await loadStyleOnce(
    "nlb-markercluster-default-css",
    "vendor/markercluster/MarkerCluster.Default.css"
  );
  return loadScriptOnce(
    "nlb-markercluster-js",
    "vendor/markercluster/leaflet.markercluster.js",
    () => typeof L !== "undefined" && Boolean(L.markerClusterGroup)
  );
}

function loadChartLibrary() {
  return loadScriptOnce("nlb-chart-js", "vendor/chartjs/chart.umd.min.js", () =>
    typeof Chart !== "undefined"
  );
}

function loadPapaparseLibrary() {
  return loadScriptOnce("nlb-papaparse-js", "vendor/papaparse/papaparse.min.js", () =>
    typeof Papa !== "undefined"
  );
}

function addToHead() {}

if (typeof window !== "undefined") {
  window.NotfallLagebild = {
    normalizeEmergencyRecord,
    calculateEmergencyMetrics,
    filterEmergencyRecords,
    deriveEmergencyMapCenter,
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    normalizeEmergencyRecord,
    calculateEmergencyMetrics,
    filterEmergencyRecords,
    deriveEmergencyMapCenter,
    deriveEmergencyDescription,
    parseEmergencyCsv,
    parseEmergencyData,
  };
}
