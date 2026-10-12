let nlbInstanzZaehler = 0;

const NLB_STATUS = {
  active: "aktiv",
  restricted: "eingeschraenkt",
  offline: "ausser Betrieb",
  planned: "geplant",
  unspecified: "stoerung",
  unknown: "unbekannt",
};

const NLB_STATUS_LABELS = {
  [NLB_STATUS.active]: "Aktiv",
  [NLB_STATUS.restricted]: "Eingeschränkt",
  [NLB_STATUS.offline]: "Außer Betrieb",
  [NLB_STATUS.planned]: "Geplant",
  [NLB_STATUS.unspecified]: "Störung (Ausmaß unbekannt)",
  [NLB_STATUS.unknown]: "Unbekannt",
};

const NLB_STATUS_COLORS = {
  [NLB_STATUS.active]: "#198754",
  [NLB_STATUS.restricted]: "#f0ad00",
  [NLB_STATUS.offline]: "#c1121f",
  [NLB_STATUS.planned]: "#0d6efd",
  [NLB_STATUS.unspecified]: "#b77900",
  [NLB_STATUS.unknown]: "#64748b",
};

const NLB_DEFAULT_CENTER = { lat: 48.7419, lon: 9.3046 };
const NLB_DEFAULT_PAGE_SIZE = 20;
const NLB_DEFAULT_ZOOM = 12;
const NLB_DEFAULT_OVERDUE_AFTER_DAYS = 180;
const NLB_ASSETS = {};

// F-43: Registrierte Instanzen (Container -> State), damit der Top-Level-Hook
// onPageLeave() alle gemounteten Instanzen aufraeumen kann. Die Base ruft den
// Hook global ohne Container-Parameter auf; eine iterierbare Map ist daher das
// zur App passende Muster (Portfolio-Muster aus Task 9.1).
const nlbInstances = new Map();

// NLB-B1: Der Teardown ist ausgelagert, damit ihn auch der Re-App-Pfad fuer die
// Vorgaenger-Instanz nutzen kann (vorher ueberschrieb app() den Registry-Eintrag
// ohne Aufraeumen — Karte und Chart der alten Instanz blieben aktiv).
function teardownNotfallInstanz(state, container) {
  state.disposed = true;
  if (state.controller) state.controller.abort();
  if (state.events) state.events.abort();
  if (state.detailPanel) {
    const panel = state.detailPanel, element = state.detailElement;
    if (element && ["show","showing","hiding"].some(name => element.classList.contains(name))) {
      element.addEventListener("hidden.bs.offcanvas", () => panel.dispose(), {once:true});
      if (!element.classList.contains("hiding")) panel.hide();
    } else panel.dispose();
    state.detailPanel = null;
  }
  if (state.map) {state.map.remove();state.map = null;}
  if (state.chart) {state.chart.destroy();state.chart = null;}
  if (state.markersByKey) state.markersByKey.clear();
  nlbInstances.delete(container);
}

function onPageLeave(page) {
  [...nlbInstances.entries()].forEach(([container, state]) => {
    try {
      teardownNotfallInstanz(state, container);
    } catch (error) {
      console.warn("Fehler beim Abraeumen der Notfall-Lagebild-Instanz:", error);
    }
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
    selection: "",
    dataset: null,
    view: null,
    hasSuccessfulLoad: false,
    lastSuccessfulFetch: null,
    loading: false,
    loadError: "",
    requestId: 0,
    events: new AbortController(),
    selectedRecordKey: null,
    detailTrigger: null,
    detailPanel: null,
    detailElement: null,
    markersByKey: new Map(),
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
    controller: new AbortController(), // NLB-B3: laufender Abruf ist abbrechbar
  };

  // NLB-B1: Vorgaenger-Instanz desselben Containers zuerst abraeumen.
  const nlbVorheriger = nlbInstances.get(enclosingHtmlDivElement);
  if (nlbVorheriger) {
    try {
      teardownNotfallInstanz(nlbVorheriger, enclosingHtmlDivElement);
    } catch (_e) {}
  }
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
  const sources = renderEmergencySourceLinks(config);
  if (!hinweis && !stand && !sources) return "";
  const standHtml = stand
    ? `<p class="text-muted small mb-2">Quellenangabe (manuell): ${escapeHtml(stand)}</p>`
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
    sources +
    "</div>" +
    "</section>"
  );
}

async function initializeEmergencyDashboard(state) {
  const load = (key, loader) => loader().then(loaded => {
    if (state.disposed) return;
    state.libraryState[key] = loaded;
    // Optionale Ansichten dürfen den Datenbestand nicht aufhalten oder später die Karte zurücksetzen.
    if (loaded && state.hasSuccessfulLoad) {
      if (key === "chart") updateEmergencyChart(state);
      else updateEmergencyMap(state,{fit:!state.map});
    }
  });
  state.librariesReady = typeof document === "undefined" || validateEmergencySourceUrl(state.config.apiurl) ?
    Promise.resolve() : Promise.all([
      load("leaflet",loadLeafletLibrary), load("markerCluster",loadMarkerClusterLibrary), load("chart",loadChartLibrary),
    ]);
  await refreshEmergencyDashboard(state);
}

async function refreshEmergencyDashboard(state) {
  if (state.disposed || state.loading) return;
  const requestId = ++state.requestId;
  if (state.controller) state.controller.abort();
  state.controller = new AbortController();
  state.loading = true;
  const button = state.host.querySelector('[data-nlb-action="reload"]');
  button.disabled = true;
  state.host.querySelector(".nlb-app").setAttribute("aria-busy","true");
  setEmergencyLoading(state,state.hasSuccessfulLoad ?
    "Neue Daten werden geladen – angezeigt bleibt der letzte erfolgreiche Bestand." : "Standortdaten werden geladen …");
  try {
    const dataset = await loadEmergencyRecords(state.config,state.controller.signal);
    if (state.disposed || requestId !== state.requestId) return;
    const previousFilters = collectEmergencyFilters(state);
    const selected = state.allRecords.find(record => record._key===state.selectedRecordKey);
    const sourceId = selected && selected._sourceId != null &&
      state.allRecords.filter(record => record._sourceId===selected._sourceId).length===1 ? selected._sourceId : null;
    const wasOpen = state.detailElement && state.detailElement.classList.contains("show");
    state.selectedRecordKey = null;
    state.dataset = dataset; state.allRecords = dataset.records;
    state.hasSuccessfulLoad = true; state.lastSuccessfulFetch = new Date(); state.loadError = "";
    state.mapCenter = deriveEmergencyMapCenter(dataset.records); state.page = 1;
    populateEmergencyFilters(state);
    const removed = Object.entries(previousFilters).filter(([key,value]) => key!=="search" && value &&
      state.host.querySelector(`#nlb-filter-${key}-${state.uid}`).value !== value).map(([key]) =>
        state.host.querySelector(`label[for="nlb-filter-${key}-${state.uid}"]`).textContent);
    updateEmergencyDashboard(state);
    const matches = sourceId == null ? [] : state.allRecords.filter(record => record._sourceId===sourceId);
    const restored = matches.length===1 && state.filteredRecords.find(record => record._key===matches[0]._key);
    if (restored) {
      state.selectedRecordKey = restored._key;
      if (wasOpen) openEmergencyDetails(state,restored._key,
        state.host.querySelector(`[data-nlb-action="details"][data-record-key="${restored._key}"]`));
    } else if (state.detailPanel) closeEmergencyDetails(state);
    const notices = [];
    if (!dataset.records.length) notices.push("Keine Standorte in der Quelle.");
    if (removed.length) notices.push("Auswahl aufgehoben, da nicht mehr vorhanden: " + removed.join(", ") + ".");
    showEmergencyAlert(state,notices.join(" "),"info");
  } catch (error) {
    if (state.disposed || requestId !== state.requestId) return;
    if (error && error.name === "AbortError") return;
    state.loadError = String(error.message || error);
    if (state.hasSuccessfulLoad) {
      showEmergencyAlert(state,`Aktualisierung fehlgeschlagen – letzter erfolgreicher Abruf: ${state.lastSuccessfulFetch.toLocaleString("de-DE")}. ${state.loadError}`);
    } else {
      showEmergencyAlert(state,`Standortdaten konnten nicht geladen werden. ${state.loadError}`,
        isKeineDatenquelleKonfiguriert(state.config.apiurl) ? "info" : "danger");
      setText(state,`nlb-data-status-${state.uid}`,"Kein erfolgreich geladener Datenbestand.");
    }
  } finally {
    if (!state.disposed && requestId === state.requestId) {
      state.loading = false; button.disabled = false;
      state.host.querySelector(".nlb-app").setAttribute("aria-busy","false");
      setEmergencyLoading(state,"");
    }
  }
}

async function loadEmergencyRecords(config, signal, referenceDate = new Date()) {
  const warning = validateEmergencySourceUrl(config.apiurl);
  if (warning) throw new Error(warning);
  const rawText = await fetchEmergencyText(config.apiurl, config, signal);
  const parsed = await parseEmergencyData(rawText);
  return normalizeEmergencyRecords(parsed.rows, referenceDate, parsed.rejectedRows);
}

async function fetchEmergencyText(url, config, signal) {
  return fetchOdasResource(url, config, { signal });
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

async function fetchOdasResource(targetUrl, configdata = {}, options = {}) {
  if (isOdasProxyEnabled(configdata)) {
    return fetchViaOdasProxy(targetUrl, options);
  }

  try {
    const response = await fetch(targetUrl, {
      cache: "no-store",
      signal: options && options.signal ? options.signal : undefined,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.text();
  } catch (error) {
    if (error && error.name === "AbortError") throw error;
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

async function fetchOdasJson(targetUrl, configdata = {}, options = {}) {
  const rawContent = await fetchOdasResource(targetUrl, configdata, options);
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


function validateEmergencySourceUrl(url) {
  if (isKeineDatenquelleKonfiguriert(url)) return "Keine Datenquelle konfiguriert.";
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return "Bitte eine vollständige HTTP(S)-JSON-/CSV-Ressource konfigurieren.";
    if (/\/api\/3\/action\/datastore_search(?:_sql)?\/?$/i.test(parsed.pathname)) {
      return "Bitte einen vollständigen JSON-/CSV-Export statt einer CKAN-Datastore-API konfigurieren.";
    }
    return null;
  } catch (_error) {
    return "Bitte eine gültige vollständige HTTP(S)-JSON-/CSV-Ressource konfigurieren.";
  }
}

async function parseEmergencyData(rawText) {
  const trimmed = String(rawText || "").trim();
  if (!trimmed) throw new Error("Die Datenquelle liefert eine leere Antwort statt einer Standortliste.");
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    let json;
    try { json = JSON.parse(trimmed); }
    catch (_error) { throw new Error("Die Datenquelle liefert kein lesbares JSON."); }
    return { rows: extractEmergencyRecords(json), rejectedRows: 0 };
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
  if (!json || json.success === false) throw new Error("Unbekanntes Antwortformat: Standortliste erwartet.");
  if (Array.isArray(json)) return json;
  const envelopes = [json, json.result].filter(value => value && typeof value === "object");
  const envelope = envelopes.find(value =>
    ["records", "results", "data"].some(key => Array.isArray(value[key])));
  if (!envelope) throw new Error("Unbekanntes Antwortformat: Standortliste erwartet.");
  const rows = ["records", "results", "data"].map(key => envelope[key]).find(Array.isArray);
  for (const value of envelopes) {
    const partial = ["total", "total_count"].some(key =>
      value[key] != null && Number.isFinite(Number(value[key])) && Number(value[key]) > rows.length);
    if (partial || value.next) {
      throw new Error("Die Quelle liefert nur einen Ausschnitt. Bitte eine vollständige JSON-/CSV-Ressource konfigurieren.");
    }
  }
  return rows;
}

function parseEmergencyCsv(csvText) {
  const result = Papa.parse(csvText, {
    header: true, skipEmptyLines: "greedy", transformHeader: value => value.trim(),
  });
  const fields = result.meta.fields || [];
  if (!fields.some(field => ["id", "kennung", "objectid", "name", "bezeichnung", "title"].includes(field))) {
    throw new Error("Die CSV-Datei enthält keine erkennbaren Standortfelder (Name oder Kennung).");
  }
  if (result.errors.some(error => error.type !== "FieldMismatch" && error.type !== "Delimiter")) {
    throw new Error("Die CSV-Datei ist nicht lesbar. Bitte Anführungszeichen und Zeilenstruktur prüfen.");
  }
  const rejected = new Set(result.errors.filter(error => error.type === "FieldMismatch").map(error => error.row));
  return { rows: result.data.filter((_row, index) => !rejected.has(index)), rejectedRows: rejected.size };
}

function emergencyText(value) {
  return (typeof value === "string" || (typeof value === "number" && Number.isFinite(value))) ? String(value).trim() : "";
}

function normalizeEmergencyRecord(rawRecord, index = 0, referenceDate = new Date()) {
  if (!rawRecord || typeof rawRecord !== "object" || Array.isArray(rawRecord)) return null;
  const sourceId = emergencyText(pickValue(rawRecord, ["id", "kennung", "objectid"])) || null;
  const name = emergencyText(pickValue(rawRecord, ["name", "bezeichnung", "title"]));
  if (!sourceId && !name) return null;
  const issues = [];
  const field = (key, aliases, parse) => {
    const raw = pickValue(rawRecord, aliases);
    const value = parse(raw);
    if (value == null || (key === "status" && value === NLB_STATUS.unknown)) {
      issues.push({ field: key, reason: raw == null || (typeof raw === "string" && raw.trim() === "") ? "missing" : "invalid" });
    }
    return value;
  };
  const count = value => {
    if (!["number", "string"].includes(typeof value)) return null;
    const n = parseFiniteNumber(value, NaN);
    return Number.isInteger(n) && n >= 0 ? n : null;
  };
  const coordinate = (value, bound) => {
    if (!["number", "string"].includes(typeof value)) return null;
    const n = parseFiniteNumber(value, NaN);
    return Number.isFinite(n) && Math.abs(n) <= bound ? n : null;
  };
  const max = field("kapazitaet_max", ["kapazitaet_max","kapazitaetMax","capacity_max","max_capacity"], count);
  const free = field("kapazitaet_verfuegbar", ["kapazitaet_verfuegbar","kapazitaetVerfuegbar","capacity_available","free_capacity"], value => {
    const n = count(value);
    return n != null && max != null && n > max ? null : n;
  });
  const suppliedUtilization = pickValue(rawRecord, ["auslastung_prozent","auslastungProzent","utilization_percent"]);
  const utilization = count(suppliedUtilization);
  const rawStatus = pickValue(rawRecord, ["status","zustand"]);
  const record = {
    id: sourceId || `NLB-${index + 1}`, _sourceId: sourceId, _key: `row-${index}`,
    name: name || `Standort ${sourceId}`,
    typ: field("typ", ["typ","type","kategorie"], value => emergencyText(value) || null),
    untertyp: emergencyText(pickValue(rawRecord, ["untertyp","subtype","unterkategorie"])),
    status: field("status", ["status","zustand"], normalizeEmergencyStatus),
    _rawStatus: emergencyText(rawStatus),
    kapazitaet_max: max, kapazitaet_verfuegbar: free,
    auslastung_prozent: utilization != null && utilization <= 100 ? utilization :
      (max > 0 && free != null ? Math.round((max - free) / max * 100) : null),
    strasse: emergencyText(pickValue(rawRecord, ["strasse","strasze","street"])),
    plz: emergencyText(pickValue(rawRecord, ["plz","zip","postal_code"])),
    ort: emergencyText(pickValue(rawRecord, ["ort","city","kommune"])),
    stadtteil: field("stadtteil", ["stadtteil","bezirk","district"], value =>
      normalizeSearchText(value) === "nicht zugeordnet" ? null : emergencyText(value) || null),
    lat: field("lat", ["lat","latitude","y"], value => coordinate(value,90)),
    lon: field("lon", ["lon","lng","longitude","x"], value => coordinate(value,180)),
    barrierefrei: field("barrierefrei", ["barrierefrei","accessible"], parseBoolean),
    stromversorgung_notstrom: field("stromversorgung_notstrom", ["stromversorgung_notstrom","notstrom","emergency_power"], parseBoolean),
    wasser_verfuegbar: field("wasser_verfuegbar", ["wasser_verfuegbar","wasser","water"], parseBoolean),
    sanitaer_verfuegbar: field("sanitaer_verfuegbar", ["sanitaer_verfuegbar","sanitaer","sanitary"], parseBoolean),
    betreiber: emergencyText(pickValue(rawRecord, ["betreiber","operator","traeger"])),
    ansprechpartner: emergencyText(pickValue(rawRecord, ["ansprechpartner","contact"])),
    letzte_pruefung: field("letzte_pruefung", ["letzte_pruefung","letztePruefung","last_check"], value =>
      getEmergencyCheckAgeDays(value,referenceDate) == null ? null : emergencyText(value)),
    prioritaet: field("prioritaet", ["prioritaet","priority"], normalizePriority),
    hinweis: emergencyText(pickValue(rawRecord, ["hinweis","note","beschreibung"])),
    _issues: issues,
  };
  if (!sourceId) issues.push({field:"id",reason:"missing"});
  if (!name) issues.push({field:"name",reason:"missing"});
  record._searchText = normalizeSearchText([
    record.id, record.name, record.typ, record.untertyp, record.status, record._rawStatus,
    record.strasse, record.plz, record.ort, record.stadtteil, record.betreiber,
    record.ansprechpartner, record.prioritaet, record.hinweis,
  ].join(" "));
  return record;
}

function normalizeEmergencyRecords(rows, referenceDate = new Date(), rejectedRows = 0) {
  const records = rows.map((row,index) => normalizeEmergencyRecord(row,index,referenceDate)).filter(Boolean);
  const quality = {
    total: rows.length + rejectedRows, usable: records.length,
    discarded: rows.length - records.length + rejectedRows, duplicateIds: 0,
    unmapped: 0, unknown: Object.create(null), invalid: Object.create(null),
  };
  if (quality.total && !records.length) throw new Error("Die Quelle enthält keine auswertbaren Standorte.");
  const ids = new Map();
  records.forEach(record => {
    if (record._sourceId != null) ids.set(record._sourceId, (ids.get(record._sourceId) || 0) + 1);
  });
  records.forEach(record => {
    if (record._sourceId != null && ids.get(record._sourceId) > 1) {
      quality.duplicateIds++;
      record._issues.push({field:"id",reason:"duplicate"});
    }
    if (!hasEmergencyCoordinates(record)) quality.unmapped++;
    record._issues.forEach(issue => {
      if (issue.reason === "duplicate") return;
      quality.unknown[issue.field] = (quality.unknown[issue.field] || 0) + 1;
      if (issue.reason === "invalid") quality.invalid[issue.field] = (quality.invalid[issue.field] || 0) + 1;
    });
  });
  return {records, quality};
}

function hasEmergencyCoordinates(record) {
  return Number.isFinite(record.lat) && Math.abs(record.lat) <= 90 &&
    Number.isFinite(record.lon) && Math.abs(record.lon) <= 180;
}

function getEmergencyCheckAgeDays(value, referenceDate = new Date()) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return null;
  const [year, month, day] = value.trim().split("-").map(Number);
  const checked = new Date(0);
  checked.setUTCFullYear(year, month - 1, day);
  checked.setUTCHours(0,0,0,0);
  if (checked.getUTCFullYear() !== year || checked.getUTCMonth() !== month - 1 || checked.getUTCDate() !== day) return null;
  const today = new Date(0);
  today.setUTCFullYear(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
  today.setUTCHours(0,0,0,0);
  const days = (today.getTime() - checked.getTime()) / 86400000;
  return Number.isFinite(days) && days >= 0 ? days : null;
}

function renderEmergencyQuality(state) {
  const element = state.host.querySelector(`#nlb-quality-${state.uid}`);
  if (!element || !state.dataset) return;
  const q = state.dataset.quality;
  const incomplete = state.dataset.records.filter(record => record._issues.length > 0).length;
  element.textContent = [
    q.discarded ? `Teilbestand: ${q.discarded} unbrauchbare Einträge ausgeschlossen.` : "",
    `Datenqualität im Gesamtbestand: ${q.usable} Standorte ausgewertet; ${q.unmapped} ohne gültige Kartenposition.`,
    incomplete ? `${incomplete} Standorte mit fehlenden oder ungültigen Angaben.` : "",
    q.unknown.status ? `Status unbekannt: ${q.unknown.status}.` : "",
    q.unknown.kapazitaet_verfuegbar ? `Freie Kapazität unbekannt/ungültig: ${q.unknown.kapazitaet_verfuegbar}.` : "",
    q.duplicateIds ? `${q.duplicateIds} Standorte mit mehrfacher Quellkennung.` : "",
  ].filter(Boolean).join(" ");
  element.className = "nlb-quality " + (q.discarded || incomplete ? "alert alert-warning" : "text-muted small");
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
  if (["eingeschraenkt", "eingeschrankt", "restricted"].includes(normalized)) {
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
  if (["gestoert", "gestort", "stoerung", "storung"].includes(normalized)) return NLB_STATUS.unspecified;
  return NLB_STATUS.unknown;
}

function isEmergencyDisrupted(status) {
  return [NLB_STATUS.restricted, NLB_STATUS.offline, NLB_STATUS.unspecified].includes(status);
}

function normalizePriority(value) {
  const normalized = normalizeSearchText(value);
  if (["hoch", "high", "1"].includes(normalized)) return "hoch";
  if (["mittel", "medium", "2"].includes(normalized)) return "mittel";
  if (["niedrig", "low", "3"].includes(normalized)) return "niedrig";
  return null;
}

function parseBoolean(value) {
  if (typeof value === "boolean") return value;
  if (!["string", "number"].includes(typeof value)) return null;
  const normalized = normalizeSearchText(value);
  if (["ja", "j", "yes", "true", "1", "x", "vorhanden"].includes(normalized)) return true;
  if (["nein", "n", "no", "false", "0", "nicht vorhanden"].includes(normalized)) return false;
  return null;
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

function filterEmergencyAreaRecords(records, filters = {}) {
  const search = normalizeSearchText(filters.search || "");
  return records.filter(record => {
    for (const key of ["typ","untertyp","stadtteil","betreiber"]) {
      if (filters[key] && record[key] !== filters[key]) return false;
    }
    if (filters.prioritaet && record.prioritaet !== (filters.prioritaet === "__unknown__" ? null : filters.prioritaet)) return false;
    for (const [filter, field] of [["barrierefrei","barrierefrei"],["notstrom","stromversorgung_notstrom"]]) {
      if (!filters[filter]) continue;
      const wanted = filters[filter] === "__unknown__" ? null : filters[filter] === "ja";
      if (record[field] !== wanted) return false;
    }
    return !search || record._searchText.includes(search);
  });
}

function findEmergencyDistrictsWithoutActive(records, selectedDistrict = "") {
  const districts = new Set(), active = new Set();
  records.forEach(record => {
    if (!record.stadtteil || (selectedDistrict && record.stadtteil !== selectedDistrict)) return;
    districts.add(record.stadtteil);
    if (record.status === NLB_STATUS.active) active.add(record.stadtteil);
  });
  return new Set([...districts].filter(district => !active.has(district)));
}

function selectEmergencyRecords(records, selection, districts, referenceDate) {
  return records.filter(record => {
    if (Object.prototype.hasOwnProperty.call(NLB_STATUS, selection)) return record.status === NLB_STATUS[selection];
    if (selection === "disrupted") return isEmergencyDisrupted(record.status);
    if (selection === "capacity") return record.status === NLB_STATUS.active && record.kapazitaet_verfuegbar > 0;
    if (selection === "old-check") return getEmergencyCheckAgeDays(record.letzte_pruefung, referenceDate) > NLB_DEFAULT_OVERDUE_AFTER_DAYS;
    if (selection === "districts") return districts.has(record.stadtteil);
    return true;
  });
}

function calculateEmergencyScopeMetrics(records, districts, referenceDate = new Date()) {
  const groups = new Map();
  const metrics = {activeLocations:0, disruptedLocations:0, capacityByType:[],
    olderChecks:0, unknownChecks:0, districtCount:districts.size};
  records.forEach(record => {
    if (record.status === NLB_STATUS.active) metrics.activeLocations++;
    if (isEmergencyDisrupted(record.status)) metrics.disruptedLocations++;
    const age = getEmergencyCheckAgeDays(record.letzte_pruefung,referenceDate);
    if (age == null) metrics.unknownChecks++;
    else if (age > NLB_DEFAULT_OVERDUE_AFTER_DAYS) metrics.olderChecks++;
    if (!groups.has(record.typ)) {
      const bucket = () => ({sum:0,knownCount:0,unknownCount:0});
      groups.set(record.typ, {typ:record.typ,active:bucket(),restricted:bucket(),planned:bucket()});
    }
    const group = groups.get(record.typ);
    for (const key of ["active","restricted","planned"]) {
      if (record.status !== NLB_STATUS[key]) continue;
      const bucket = group[key];
      // Ohne Standorttyp ist auch die Vergleichbarkeit der Plätze unbekannt.
      if (record.kapazitaet_verfuegbar == null || !record.typ) bucket.unknownCount++;
      else { bucket.sum += record.kapazitaet_verfuegbar; bucket.knownCount++; }
    }
  });
  metrics.capacityByType = [...groups.values()].sort((a,b) => String(a.typ || "").localeCompare(String(b.typ || ""),"de"));
  metrics.capacityByType.forEach(group => {
    for (const key of ["active","restricted","planned"]) {
      if (!group[key].knownCount && group[key].unknownCount) group[key].sum = null;
    }
  });
  return metrics;
}

function buildEmergencyView(records, filters = {}, selection = "", referenceDate = new Date()) {
  const scopeRecords = filterEmergencyAreaRecords(records, filters);
  const districts = findEmergencyDistrictsWithoutActive(records, filters.stadtteil);
  const actionCounts = {};
  for (const key of ["", ...Object.keys(NLB_STATUS), "disrupted","capacity","old-check","districts"]) {
    actionCounts[key] = selectEmergencyRecords(scopeRecords,key,districts,referenceDate).length;
  }
  const filteredRecords = selectEmergencyRecords(scopeRecords,selection,districts,referenceDate);
  return {scopeRecords, filteredRecords, districts, actionCounts,
    metrics:calculateEmergencyScopeMetrics(scopeRecords,districts,referenceDate),
    mappedCount:filteredRecords.filter(hasEmergencyCoordinates).length};
}

function isKnownNotfallDemoUrl(url) {
  if (!url) return false;
  try {
    return new URL(String(url), window.location.href).pathname.endsWith("/notfall-lagebild-demo.json");
  } catch (_error) {
    return false;
  }
}

function renderEmergencyShell(config, uid) {
  return `
    <section class="nlb-app" aria-label="Notfall-Lagebild">
      ${isKnownNotfallDemoUrl(config.apiurl) ? `
        <div class="alert alert-warning" role="note">
          <strong>Demo-Daten – keine realen Einsatzdaten</strong>
          <p class="mb-0">Die dargestellten Standorte und Kapazitäten sind Anschauungsbeispiele und keine Notfallentscheidungsgrundlage.</p>
        </div>` : ""}
      <div class="nlb-toolbar">
        <div><p class="nlb-eyebrow mb-1">Kommunale Standortübersicht</p>
          <h2 class="mb-2">${escapeHtml(config.titel)}</h2>
          <p class="nlb-lead mb-0">${escapeHtml(config.description)}</p>
          <p class="text-muted small mt-2 mb-0" id="nlb-data-status-${uid}">Daten werden geladen …</p>
        </div>
        <div class="nlb-toolbar-actions">
          <button class="btn btn-outline-secondary" type="button" data-nlb-action="reload">Daten neu laden</button>
          <button class="btn btn-outline-secondary" type="button" id="nlb-reset-filters-${uid}">Filter zurücksetzen</button>
        </div>
      </div>
      <div class="alert alert-warning d-none" id="nlb-alert-${uid}" role="alert"></div>
      <div class="nlb-loading" id="nlb-loading-${uid}" role="status"></div>
      <div id="nlb-quality-${uid}" role="status"></div>
      <section class="nlb-filters" aria-label="Filter">
        <div class="row g-3">
          <div class="col-12 col-lg-3">
            <label class="form-label" for="nlb-filter-search-${uid}">Suche</label>
            <input class="form-control" id="nlb-filter-search-${uid}" type="search" placeholder="Name, Adresse, Hinweis">
          </div>
          ${renderFilterSelect("typ","Typ",uid)}
          ${renderFilterSelect("status","Status / Schnellauswahl",uid)}
          ${renderFilterSelect("stadtteil","Stadtteil",uid)}
        </div>
        <div class="nlb-filter-actions">
          <button class="btn btn-outline-secondary" type="button" data-nlb-action="extra-filters" data-bs-toggle="collapse"
            data-bs-target="#nlb-extra-filters-${uid}" aria-expanded="false" aria-controls="nlb-extra-filters-${uid}">Weitere Filter</button>
          <a class="btn btn-outline-secondary" href="#nlb-map-panel-${uid}" data-nlb-jump="map">Zur Karte</a>
          <a class="btn btn-outline-secondary" href="#nlb-list-panel-${uid}" data-nlb-jump="list">Zur Standortliste</a>
        </div>
        <div class="collapse" id="nlb-extra-filters-${uid}"><div class="row g-3 mt-1">
          ${renderFilterSelect("untertyp","Untertyp",uid)}
          ${renderFilterSelect("betreiber","Betreiber",uid)}
          ${renderFilterSelect("barrierefrei","Barrierefrei",uid)}
          ${renderFilterSelect("notstrom","Notstrom",uid)}
          ${renderFilterSelect("prioritaet","Priorität",uid)}
        </div></div>
        <div class="nlb-filter-note" id="nlb-filter-note-${uid}" role="status"></div>
      </section>
      <p class="nlb-scope-note">Kennzahlen für den gewählten Datenbereich – ohne Status-/Schnellauswahl. Die Stadtteilzahl bezieht sich auf den Gesamtbestand bzw. den gewählten Stadtteil.</p>
      <div class="nlb-kpi-grid" id="nlb-kpis-${uid}">
        ${renderKpiCard("active","Aktive Standorte","—","Als aktiv gemeldet",config.kpiKontext1,uid)}
        ${renderKpiCard("disrupted","Gestörte Standorte","—","Eingeschränkt, außer Betrieb oder Störung",config.kpiKontext2,uid)}
        ${renderKpiCard("capacity","Gemeldete freie Plätze","—","Aktive Standorte · nach Typ",config.kpiKontext3,uid)}
        ${renderKpiCard("districts","Stadtteile ohne aktiven Standort","—","im Datenbestand",config.kpiKontext4,uid)}
        ${renderKpiCard("old-check","Letzte Prüfung vor mehr als 180 Tagen","—","Keine verbindliche Prüffrist",config.kpiKontext5,uid)}
      </div>
      <div class="row g-4 align-items-stretch">
        <div class="col-12 col-xl-8">
          <section class="nlb-panel h-100" id="nlb-map-panel-${uid}" tabindex="-1" aria-label="Karte">
            <div class="nlb-panel-head"><h3>Karte</h3><div class="btn-group">
              <button class="btn btn-sm btn-outline-secondary" type="button" id="nlb-zoom-results-${uid}">Treffer zentrieren</button>
              <button class="btn btn-sm btn-outline-secondary" type="button" id="nlb-toggle-radius-${uid}" aria-pressed="false"
                title="1 km um jeden gefilterten Standort, keine geprüfte Versorgungsreichweite.">1 km Radius</button>
            </div></div>
            <div id="nlb-map-${uid}" class="nlb-map" aria-label="Standortkarte"></div>
            <div class="nlb-map-legend" id="nlb-map-legend-${uid}"></div>
            <p class="text-muted small mt-2 mb-0">Der optionale Radius umfasst 1 km um jeden gefilterten Standort und ist keine geprüfte Versorgungsreichweite.</p>
          </section>
        </div>
        <div class="col-12 col-xl-4">
          <section class="nlb-panel h-100" aria-label="Diagramm">
            <div class="nlb-panel-head"><h3 id="nlb-chart-title-${uid}">Standorte nach Typ</h3></div>
            <div class="nlb-chart-wrap" id="nlb-chart-wrap-${uid}"><canvas id="nlb-type-chart-${uid}" role="img" aria-label="Standorte nach Typ; Zahlen in der Standortliste"></canvas></div>
          </section>
        </div>
      </div>
      <section class="nlb-panel mt-4" id="nlb-list-panel-${uid}" tabindex="-1" aria-label="Standortliste">
        <div class="nlb-panel-head"><h3>Standortliste</h3><span class="nlb-result-count" id="nlb-result-count-${uid}" role="status">Noch keine Daten</span></div>
        <div class="table-responsive" tabindex="0" role="region" aria-label="Standorttabelle, horizontal scrollbar"><table class="table table-hover align-middle nlb-table">
          <thead id="nlb-table-head-${uid}"></thead><tbody id="nlb-table-body-${uid}"></tbody>
        </table></div>
        <div class="nlb-pagination">
          <button type="button" class="btn btn-sm btn-outline-secondary" id="nlb-prev-page-${uid}" disabled>Zurück</button>
          <span id="nlb-page-info-${uid}">Seite 1 von 1</span>
          <button type="button" class="btn btn-sm btn-outline-secondary" id="nlb-next-page-${uid}" disabled>Weiter</button>
        </div>
      </section>
      <div class="offcanvas offcanvas-end nlb-details" tabindex="-1" id="nlb-details-${uid}" aria-labelledby="nlb-details-title-${uid}">
        <div class="offcanvas-header"><h2 class="h5" id="nlb-details-title-${uid}">Standortdetails</h2>
          <button type="button" class="btn-close" data-nlb-action="close-details" aria-label="Standortdetails schließen"></button>
        </div>
        <div class="offcanvas-body">
          <button type="button" class="btn btn-outline-secondary mb-2" data-nlb-action="show-on-map">Auf Karte zeigen</button>
          <div class="nlb-details-body" id="nlb-details-body-${uid}"></div>
        </div>
      </div>
      ${renderMethodikbox(config,uid)}
      ${renderWeitereInfos(config,uid)}
    </section>`;
}

function renderKpiCard(id, label, value, hint, kontext, uid) {
  const text = String(kontext || "").trim();
  return `<div class="nlb-kpi-wrap"><article class="nlb-kpi">
    <h3>${escapeHtml(label)}</h3><strong id="nlb-kpi-${id}-${uid}">${value}</strong>
    <small>${escapeHtml(hint)}</small>
    ${id === "capacity" ? `<div id="nlb-capacity-values-${uid}"></div>` : ""}
    ${id === "old-check" ? `<p class="small" id="nlb-unknown-checks-${uid}"></p>` : ""}
    ${id === "districts" ? `<p class="small" id="nlb-district-scope-${uid}">Gesamtbestand</p>` : ""}
    <button type="button" class="btn btn-outline-secondary nlb-kpi-action" data-nlb-action="${id}" aria-pressed="false" disabled>Standorte anzeigen</button>
    ${text ? `<details class="nlb-kpi-context"><summary>Erklärung: ${escapeHtml(label)}</summary><p>${escapeHtml(text)}</p></details>` : ""}
  </article></div>`;
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

function getEmergencySelectionLabels() {
  return {"":"Alle", active:"Aktive Standorte", disrupted:"Gestörte Standorte (alle Störungsarten)",
    restricted:"Eingeschränkt", offline:"Außer Betrieb", planned:"Geplant",
    unspecified:"Störung (Ausmaß unbekannt)", unknown:"Unbekannter Status",
    capacity:"Aktive Standorte mit gemeldeten freien Plätzen",
    "old-check":"Letzte Prüfung vor mehr als 180 Tagen",
    districts:"Standorte in Stadtteilen ohne aktive Standortmeldung"};
}

function setEmergencySelection(state, selection, {toggle = false} = {}) {
  if (!Object.prototype.hasOwnProperty.call(getEmergencySelectionLabels(),selection)) return;
  state.selection = toggle && state.selection === selection ? "" : selection;
  state.page = 1;
  updateEmergencyDashboard(state);
}

function bindEmergencyShell(state) {
  state.host.querySelector(`#nlb-reset-filters-${state.uid}`).addEventListener("click", () => {
    state.selection = ""; state.page = 1;
    state.host.querySelectorAll(".nlb-filter").forEach(element => {element.value = "";});
    state.host.querySelector(`#nlb-filter-search-${state.uid}`).value = "";
    updateEmergencyDashboard(state);
  });
  state.host.querySelector(`#nlb-zoom-results-${state.uid}`).addEventListener("click", () => fitEmergencyMap(state));
  state.host.querySelector(`#nlb-toggle-radius-${state.uid}`).addEventListener("click", event => {
    state.showRadius = !state.showRadius;
    event.currentTarget.classList.toggle("active",state.showRadius);
    event.currentTarget.setAttribute("aria-pressed",String(state.showRadius));
    updateEmergencyMap(state,{fit:false});
  });
  state.host.querySelector(`#nlb-prev-page-${state.uid}`).addEventListener("click", () => {
    state.page = Math.max(1,state.page - 1); renderEmergencyTable(state);
  });
  state.host.querySelector(`#nlb-next-page-${state.uid}`).addEventListener("click", () => {
    state.page = Math.min(Math.max(1,Math.ceil(state.filteredRecords.length/state.pageSize)),state.page+1);
    renderEmergencyTable(state);
  });
  state.host.addEventListener("click", event => {
    if (state.disposed) return;
    const button = event.target.closest("[data-nlb-action]");
    if (button && state.host.contains(button)) {
      const action = button.dataset.nlbAction;
      if (action === "reload") refreshEmergencyDashboard(state);
      else if (action === "details") openEmergencyDetails(state,button.dataset.recordKey,button);
      else if (action === "close-details") closeEmergencyDetails(state);
      else if (action === "show-on-map") focusEmergencyRecord(state,state.selectedRecordKey);
      else if (action === "clear-selection") setEmergencySelection(state,"");
      else if (Object.prototype.hasOwnProperty.call(getEmergencySelectionLabels(),action)) setEmergencySelection(state,action,{toggle:true});
    }
    const jump = event.target.closest("[data-nlb-jump]");
    if (jump && state.host.contains(jump)) {
      event.preventDefault();
      const target = state.host.querySelector(`#nlb-${jump.dataset.nlbJump}-panel-${state.uid}`);
      if (target) {target.scrollIntoView({block:"start"});target.focus({preventScroll:true});}
    }
  }, {signal:state.events.signal});
  state.host.querySelectorAll(".nlb-filter").forEach(element => {
    element.addEventListener("change", () => {
      if (element.dataset.filter === "status") setEmergencySelection(state,element.value);
      else {state.page = 1;updateEmergencyDashboard(state);}
    });
  });
  state.host.querySelector(`#nlb-filter-search-${state.uid}`).addEventListener("input", () => {
    state.page = 1; updateEmergencyDashboard(state);
  });
}

function populateEmergencyFilters(state) {
  for (const key of ["typ","untertyp","stadtteil","betreiber"]) setSelectOptions(state,key,uniqueValues(state.allRecords,key));
  const labels = getEmergencySelectionLabels();
  setSelectOptions(state,"status", ["active","disrupted","restricted","offline","planned","unspecified","unknown"].map(value => ({value,label:labels[value]})));
  for (const key of ["barrierefrei","notstrom"]) setSelectOptions(state,key,[
    {value:"ja",label:"Ja"}, {value:"nein",label:"Nein"}, {value:"__unknown__",label:"Unbekannt"}]);
  setSelectOptions(state,"prioritaet",[{value:"hoch",label:"Hoch"},{value:"mittel",label:"Mittel"},{value:"niedrig",label:"Niedrig"},{value:"__unknown__",label:"Unbekannt"}]);
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
  if (!state.hasSuccessfulLoad || state.disposed) return;
  const filters = collectEmergencyFilters(state);
  state.view = buildEmergencyView(state.allRecords,filters,state.selection,new Date());
  state.filteredRecords = sortEmergencyRecords(state.view.filteredRecords,state.sortKey,state.sortDirection);
  state.host.querySelector(`#nlb-filter-status-${state.uid}`).value =
    ["active","disrupted","restricted","offline","planned","unspecified","unknown"].includes(state.selection) ? state.selection : "";
  if (state.selectedRecordKey && !state.filteredRecords.some(record => record._key===state.selectedRecordKey)) closeEmergencyDetails(state);
  updateEmergencyStatusLine(state);
  renderEmergencyQuality(state);
  renderEmergencyKpis(state);
  renderEmergencyLegend(state);
  updateEmergencyMap(state);
  updateEmergencyChart(state);
  renderEmergencyTable(state);
}

function collectEmergencyFilters(state) {
  const filters = {};
  state.host.querySelectorAll(".nlb-filter").forEach(element => {
    if (element.dataset.filter !== "status") filters[element.dataset.filter] = element.value;
  });
  filters.search = state.host.querySelector(`#nlb-filter-search-${state.uid}`).value;
  return filters;
}

function updateEmergencyStatusLine(state) {
  const date = state.allRecords.map(record => record.letzte_pruefung).filter(Boolean).sort().pop();
  const url = safeHttpUrl(state.config.apiurl);
  const source = url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Datenressource ansehen</a>` : "Keine Quelle";
  state.host.querySelector(`#nlb-data-status-${state.uid}`).innerHTML =
    `${source} · ${state.allRecords.length} Standorte · Jüngste Standortprüfung: ${escapeHtml(date ? formatDate(date) : "unbekannt")}` +
    (state.lastSuccessfulFetch ? ` · Letzter erfolgreicher Abruf: ${escapeHtml(state.lastSuccessfulFetch.toLocaleString("de-DE"))}` : "");
  const filters = collectEmergencyFilters(state);
  const extra = ["untertyp","betreiber","barrierefrei","notstrom","prioritaet"].filter(key => filters[key]);
  const note = state.host.querySelector(`#nlb-filter-note-${state.uid}`);
  note.innerHTML = (state.selection ?
    `<span>Schnellauswahl: ${escapeHtml(getEmergencySelectionLabels()[state.selection])}</span> <button class="btn btn-sm btn-outline-secondary" type="button" data-nlb-action="clear-selection">Schnellauswahl entfernen</button>` :
    "Keine Status-/Schnellauswahl aktiv.") +
    (extra.length ? `<p class="mb-0">Weitere Filter aktiv: ${extra.map(key => {
      const el = state.host.querySelector(`#nlb-filter-${key}-${state.uid}`);
      const label = state.host.querySelector(`label[for="nlb-filter-${key}-${state.uid}"]`).textContent;
      return escapeHtml(label + ": " + el.selectedOptions[0].textContent);
    }).join(" · ")}</p>` : "");
}

function renderEmergencyKpis(state) {
  const {metrics,actionCounts} = state.view;
  const values = {active:metrics.activeLocations, disrupted:metrics.disruptedLocations,
    districts:metrics.districtCount, "old-check":metrics.olderChecks};
  for (const [key,value] of Object.entries(values)) setText(state,`nlb-kpi-${key}-${state.uid}`,formatNumber(value));
  const groups = metrics.capacityByType;
  const activeBucket = groups.length === 1 ? groups[0].active : null;
  setText(state,`nlb-kpi-capacity-${state.uid}`,activeBucket ?
    (!activeBucket.knownCount && !activeBucket.unknownCount ? "Keine aktiven Standorte" : formatNumber(activeBucket.sum)) :
    groups.length ? `${groups.length} Typen` : "Keine Standorte");
  const bucketText = bucket => {
    if (!bucket.knownCount && !bucket.unknownCount) return "keine Standorte";
    return `${formatNumber(bucket.sum)} gemeldete Plätze${bucket.unknownCount ? ` · ${bucket.unknownCount} nicht auswertbare Angaben` : ""}`;
  };
  state.host.querySelector(`#nlb-capacity-values-${state.uid}`).innerHTML = groups.length ?
    `<details class="nlb-capacity-details"><summary>Nach Typ und Status</summary>${groups.map(group =>
      `<div class="nlb-capacity-group"><b>${escapeHtml(group.typ || "Typ nicht angegeben")}</b>
       <div>Aktiv: ${bucketText(group.active)}</div><div>Eingeschränkt: ${bucketText(group.restricted)}</div>
       <div>Geplant: ${bucketText(group.planned)}</div></div>`).join("")}</details>` : "";
  setText(state,`nlb-unknown-checks-${state.uid}`,`${metrics.unknownChecks} Prüfdaten unbekannt/ungültig`);
  const district = collectEmergencyFilters(state).stadtteil;
  setText(state,`nlb-district-scope-${state.uid}`,district ? `Bestand: ${district}` : "Gesamtbestand");
  state.host.querySelectorAll(".nlb-kpi-action").forEach(button => {
    const key = button.dataset.nlbAction, active = state.selection === key;
    button.textContent = active ? "Schnellauswahl aufheben" : `${actionCounts[key]} Standorte anzeigen`;
    button.disabled = !active && actionCounts[key] === 0;
    button.setAttribute("aria-pressed",String(active));
    button.closest(".nlb-kpi").classList.toggle("active",active);
  });
}

function setText(state, id, text) {
  const element = state.host.querySelector(`#${id}`);
  if (element) element.textContent = text;
}

function renderEmergencyLegend(state) {
  const legend = state.host.querySelector(`#nlb-map-legend-${state.uid}`);
  const types = Array.from(
    new Set(
      (state.allRecords || [])
        .map((record) => String((record && record.typ) || "").trim())
        .filter(Boolean),
    ),
  );
  const typeLegend = types.length
    ? `<span><strong>Typen:</strong></span>${types
        .map(
          (type) =>
            `<span class="nlb-map-type-item"><span class="nlb-map-marker nlb-map-type-marker" aria-hidden="true">${escapeHtml(
              typeInitial(type),
            )}</span><span>${escapeHtml(type)}</span></span>`,
        )
        .join("")}`
    : "";

  legend.innerHTML =
    Object.values(NLB_STATUS)
      .map(
        (status) =>
          `<span><i style="background:${NLB_STATUS_COLORS[status]}"></i>${escapeHtml(
            NLB_STATUS_LABELS[status],
          )}</span>`,
      )
      .join("") + typeLegend;
}

function updateEmergencyMap(state, {fit = true} = {}) {
  const mapElement = state.host.querySelector(`#nlb-map-${state.uid}`);
  const mapped = state.filteredRecords.filter(hasEmergencyCoordinates);
  const available = state.libraryState.leaflet && typeof L !== "undefined" && mapped.length > 0;
  for (const prefix of ["nlb-zoom-results-","nlb-toggle-radius-"]) {
    const control = state.host.querySelector("#" + prefix + state.uid);
    if (control) control.disabled = !available;
  }
  if (!available) {
    if (state.map) state.map.remove();
    state.map = null; state.markerLayer = null; state.radiusLayer = null;
    state.markersByKey.clear();
    renderFallbackEmergencyMap(state,mapElement);
    return;
  }
  if (!state.map) {
    mapElement.innerHTML = "";
    mapElement.classList.remove("nlb-map-fallback-mode");
    const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    state.map = L.map(mapElement,{zoomAnimation:!reduced,markerZoomAnimation:!reduced}).setView(
      [state.mapCenter.lat,state.mapCenter.lon],state.mapZoom);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom:19, attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap-Mitwirkende</a>',
    }).addTo(state.map);
  }
  if (state.markerLayer) state.markerLayer.remove();
  if (state.radiusLayer) state.radiusLayer.remove();
  state.markersByKey.clear();
  state.markerLayer = state.libraryState.markerCluster && L.markerClusterGroup ?
    L.markerClusterGroup({
      showCoverageOnHover:false, maxClusterRadius:45, animate:false,
      iconCreateFunction: cluster => L.divIcon({className:"nlb-cluster-marker",iconSize:[40,40],
        html:`<span>${cluster.getChildCount()}<span class="visually-hidden"> zusammengefasste Standorte</span></span>`}),
    }) : L.layerGroup();
  state.radiusLayer = L.layerGroup();
  mapped.forEach(record => {
    const marker = L.marker([record.lat,record.lon],{
      icon:L.divIcon({className:"",html:`<span class="nlb-map-marker ${statusClass(record.status)}">${typeInitial(record.typ)}</span>`,iconSize:[30,30],iconAnchor:[15,15]}),
      title:record.name,
    });
    marker.bindPopup(renderEmergencyPopup(record));
    marker.on("click",() => openEmergencyDetails(state,record._key,marker.getElement()));
    state.markersByKey.set(record._key,marker);
    state.markerLayer.addLayer(marker);
    if (state.showRadius) L.circle([record.lat,record.lon],{
      radius:1000,color:NLB_STATUS_COLORS[record.status],fillOpacity:0.05,weight:1,
    }).addTo(state.radiusLayer);
  });
  state.markerLayer.addTo(state.map);
  if (state.showRadius) state.radiusLayer.addTo(state.map);
  if (fit) fitEmergencyMap(state);
}

function renderEmergencyPopup(record) {
  return `
    <div class="nlb-popup">
      <strong>${escapeHtml(record.name)}</strong>
      <dl>
        <dt>Typ</dt><dd>${escapeHtml(record.typ)}</dd>
        <dt>Status</dt><dd>${escapeHtml(NLB_STATUS_LABELS[record.status] || record.status)}</dd>
        <dt>Gemeldete Plätze (frei / max.)</dt><dd>${formatNumber(record.kapazitaet_verfuegbar)} / ${formatNumber(record.kapazitaet_max)}</dd>
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
  const count = new Set(state.filteredRecords.map(record => record.typ)).size;
  setText(state,`nlb-chart-title-${state.uid}`,count > 10 ? `10 häufigste Standorttypen – ${count - 10} weitere Typen` : "Standorte nach Typ");
  const chartWrap = state.host.querySelector(`#nlb-chart-wrap-${state.uid}`);
  if (!state.libraryState.chart || typeof Chart === "undefined") {
    if (state.chart) {state.chart.destroy();state.chart=null;}
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
          backgroundColor: "#486581",
          borderRadius: 4,
        },
      ],
    },
    options: {
      animation: !(typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches),
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
  const unavailable = !state.libraryState.leaflet || typeof L === "undefined";
  mapElement.innerHTML = `<div class="nlb-map-fallback" role="status">${unavailable ?
    "Die Karte ist derzeit nicht verfügbar. Alle auswertbaren Standorte bleiben in der Liste und den Details zugänglich." :
    "Keine kartierbaren Standorte für die aktuelle Auswahl. Die Standortliste bleibt nutzbar."}</div>`;
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
  const result = new Map();
  records.forEach(record => {
    const value = record[key] || "Nicht angegeben";
    result.set(value,(result.get(value) || 0) + 1);
  });
  return Object.fromEntries(result);
}

function renderEmergencyTable(state) {
  const columns = [["name","Name / Details"],["typ","Typ"],["stadtteil","Stadtteil"],["status","Status"],
    ["kapazitaet_max","Max."],["kapazitaet_verfuegbar","Frei"],["barrierefrei","Barrierefrei"],
    ["stromversorgung_notstrom","Notstrom"],["letzte_pruefung","Letzte Prüfung"],["betreiber","Betreiber"]];
  const maxPage = Math.max(1,Math.ceil(state.filteredRecords.length/state.pageSize));
  state.page = Math.min(state.page,maxPage);
  const rows = state.filteredRecords.slice((state.page-1)*state.pageSize,state.page*state.pageSize);
  state.host.querySelector(`#nlb-table-head-${state.uid}`).innerHTML = `<tr>${columns.map(([key,label]) =>
    `<th scope="col"${state.sortKey===key ? ` aria-sort="${state.sortDirection==="asc" ? "ascending" : "descending"}"` : ""}>
      <button type="button" class="nlb-sort" data-sort="${key}">${label}</button></th>`).join("")}</tr>`;
  state.host.querySelector(`#nlb-table-body-${state.uid}`).innerHTML = rows.map(record => `
    <tr data-record-key="${record._key}">
      <td><button class="nlb-details-link" type="button" data-nlb-action="details" data-record-key="${record._key}"
        aria-label="Details zu ${escapeHtml(record.name)}">${escapeHtml(record.name)}</button><span>${escapeHtml(record.hinweis)}</span></td>
      <td>${escapeHtml(record.typ || "Nicht angegeben")}</td><td>${escapeHtml(record.stadtteil || "Nicht zugeordnet")}</td>
      <td><span class="badge ${statusBadgeClass(record.status)}">${escapeHtml(NLB_STATUS_LABELS[record.status])}</span></td>
      <td>${formatNumber(record.kapazitaet_max)}</td><td>${formatNumber(record.kapazitaet_verfuegbar)}</td>
      <td>${formatBoolean(record.barrierefrei)}</td><td>${formatBoolean(record.stromversorgung_notstrom)}</td>
      <td>${escapeHtml(formatDate(record.letzte_pruefung))}</td><td>${escapeHtml(record.betreiber || "Nicht angegeben")}</td>
    </tr>`).join("") || '<tr><td colspan="10" class="text-center text-muted py-4">Keine Treffer für die aktuelle Filterauswahl.</td></tr>';
  state.host.querySelectorAll(".nlb-sort").forEach(button => button.addEventListener("click", () => {
    const key = button.dataset.sort;
    state.sortDirection = state.sortKey===key && state.sortDirection==="asc" ? "desc" : "asc";
    state.sortKey = key; state.page = 1;
    state.filteredRecords = sortEmergencyRecords(state.view.filteredRecords,key,state.sortDirection);
    renderEmergencyTable(state);
    state.host.querySelector(`[data-sort="${key}"]`).focus({preventScroll:true});
  }));
  setText(state,`nlb-result-count-${state.uid}`,`${state.filteredRecords.length} Treffer · ${state.filteredRecords.filter(hasEmergencyCoordinates).length} auf der Karte`);
  setText(state,`nlb-page-info-${state.uid}`,`Seite ${state.page} von ${maxPage}`);
  state.host.querySelector(`#nlb-prev-page-${state.uid}`).disabled = state.page<=1;
  state.host.querySelector(`#nlb-next-page-${state.uid}`).disabled = state.page>=maxPage;
}

function sortEmergencyRecords(records, key, direction) {
  return [...records].sort((a, b) => {
    const left = a[key], right = b[key];
    if (left == null && right == null) return 0;
    if (left == null) return 1;
    if (right == null) return -1;
    const comparison = typeof left === "number" && typeof right === "number" ? left - right :
      String(left).localeCompare(String(right), "de", {numeric:true});
    return direction === "desc" ? -comparison : comparison;
  });
}

function renderEmergencyDetails(record, uid) {
  const absent = value => value == null || value === "" ? "Nicht angegeben" : value;
  const detailValue = (key, format = value => value) => {
    const issue = record._issues.find(item => item.field === key);
    if (issue && issue.reason === "missing") return "Nicht angegeben";
    if (issue && issue.reason === "invalid") return "Unbekannt";
    return format(record[key]);
  };
  const rows = [
    ["Quellkennung",record._sourceId],["Typ",detailValue("typ")],["Untertyp",record.untertyp],
    ["Adresse",[record.strasse,[record.plz,record.ort].filter(Boolean).join(" ")].filter(Boolean).join(", ")],
    ["Stadtteil",detailValue("stadtteil")],["Status",detailValue("status",value => NLB_STATUS_LABELS[value])],
    ["Statusangabe der Quelle",record._rawStatus],
    ["Gemeldete maximale Plätze",detailValue("kapazitaet_max",formatNumber)],
    ["Gemeldete freie Plätze",detailValue("kapazitaet_verfuegbar",formatNumber)],
    ["Barrierefrei",detailValue("barrierefrei",formatBoolean)],["Notstrom",detailValue("stromversorgung_notstrom",formatBoolean)],
    ["Wasser",detailValue("wasser_verfuegbar",formatBoolean)],["Sanitär",detailValue("sanitaer_verfuegbar",formatBoolean)],
    ["Betreiber",record.betreiber],["Veröffentlichte Ansprechstelle",record.ansprechpartner],
    ["Letzte Prüfung",detailValue("letzte_pruefung",formatDate)],["Priorität",detailValue("prioritaet")],
    ["Hinweis",record.hinweis],
  ];
  return `<dl class="nlb-detail-fields">${rows.map(([label,value]) =>
    `<dt>${label}</dt><dd>${escapeHtml(absent(value))}</dd>`).join("")}</dl>` +
    (record._issues.length ? '<p class="alert alert-warning">Dieser Standort enthält fehlende, ungültige oder nicht eindeutige Angaben. Unbekannt bedeutet nicht Nein oder Null.</p>' : "");
}

function ensureEmergencyDetailPanel(state) {
  if (state.detailPanel) return;
  const element = state.host.querySelector(`#nlb-details-${state.uid}`);
  state.detailElement = element;
  state.detailPanel = new bootstrap.Offcanvas(element);
  element.addEventListener("hidden.bs.offcanvas", () => {
    if (state.disposed) return;
    let target = state.detailReturnTarget || state.detailTrigger;
    if (!target || !target.isConnected || !target.getClientRects().length) {
      target = state.host.querySelector(`#nlb-list-panel-${state.uid}`);
    }
    if (target) target.focus({preventScroll:true});
    state.detailReturnTarget = null;
  });
}

function openEmergencyDetails(state, recordKey, triggerElement) {
  if (state.disposed) return;
  const record = state.filteredRecords.find(row => row._key===recordKey);
  if (!record) return;
  ensureEmergencyDetailPanel(state);
  state.selectedRecordKey = recordKey;
  state.detailTrigger = triggerElement;
  setText(state,`nlb-details-title-${state.uid}`,record.name);
  state.host.querySelector(`#nlb-details-body-${state.uid}`).innerHTML = renderEmergencyDetails(record,state.uid);
  state.host.querySelector('[data-nlb-action="show-on-map"]').disabled = !hasEmergencyCoordinates(record) || !state.map;
  state.detailPanel.show();
}

function closeEmergencyDetails(state) {
  state.selectedRecordKey = null;
  if (state.detailPanel) state.detailPanel.hide();
}

function focusEmergencyRecord(state, recordKey) {
  const record = state.filteredRecords.find(row => row._key===recordKey);
  if (!record || !state.map || !hasEmergencyCoordinates(record)) return;
  const panel = state.host.querySelector(`#nlb-map-panel-${state.uid}`);
  const reveal = () => {
    if (state.disposed || !state.map) return;
    const marker = state.markersByKey.get(recordKey);
    if (!marker) return;
    panel.scrollIntoView({block:"start"}); panel.focus({preventScroll:true});
    const open = () => {
      if (state.disposed || !state.map || state.markersByKey.get(recordKey)!==marker) return;
      marker.openPopup();
      const icon = marker.getElement();
      if (icon) {icon.classList.add("nlb-selected-marker");icon.focus({preventScroll:true});}
    };
    if (state.markerLayer.zoomToShowLayer) state.markerLayer.zoomToShowLayer(marker,open);
    else {state.map.setView([record.lat,record.lon],16,{animate:false});open();}
  };
  if (state.detailElement && state.detailElement.classList.contains("show")) {
    state.detailReturnTarget = panel;
    state.detailElement.addEventListener("hidden.bs.offcanvas",reveal,{once:true});
    state.detailPanel.hide();
  } else reveal();
}

function statusClass(status) {
  const classes = {
    [NLB_STATUS.active]: "nlb-marker-aktiv",
    [NLB_STATUS.restricted]: "nlb-marker-eingeschraenkt",
    [NLB_STATUS.offline]: "nlb-marker-ausser-betrieb",
    [NLB_STATUS.planned]: "nlb-marker-geplant",
    [NLB_STATUS.unspecified]: "nlb-marker-stoerung",
    [NLB_STATUS.unknown]: "nlb-marker-unbekannt",
  };
  return classes[normalizeEmergencyStatus(status)];
}

function statusBadgeClass(status) {
  if (status === NLB_STATUS.active) return "text-bg-success";
  if ([NLB_STATUS.restricted, NLB_STATUS.unspecified].includes(status)) return "text-bg-warning";
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
  if (normalized.includes("notfall-anlaufstelle")) return "N";
  if (normalized.includes("mobile versorgungsstelle")) return "M";
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
  return value == null ? "Unbekannt" : value ? "Ja" : "Nein";
}

function formatNumber(value) {
  return value == null ? "Unbekannt" : Number(value).toLocaleString("de-DE");
}

function formatDate(value) {
  if (!value) return "Unbekannt";
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!parts) return "Ungültiges Datum";
  const date = new Date(0);
  date.setFullYear(Number(parts[1]),Number(parts[2])-1,Number(parts[3]));
  date.setHours(12,0,0,0);
  return date.toLocaleDateString("de-DE");
}

function normalizeSearchText(value) {
  return emergencyText(value)
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
  try {
    const url = new URL(s);
    return ["http:","https:"].includes(url.protocol) && url.hostname ? s : "";
  } catch (_error) { return ""; }
}

function getEmergencySourceLinks(config = {}) {
  const dataset = safeHttpUrl(config.urlDaten) || null;
  const resource = safeHttpUrl(getOdasApiUrl(config,"standorte")) || null;
  return {portal:dataset ? new URL(dataset).origin : null,dataset,resource};
}

function renderEmergencySourceLinks(config = {}) {
  const links = getEmergencySourceLinks(config);
  const labels = {portal:"Open Data Portal",dataset:"Datensatz",resource:"Ressource"};
  const items = Object.entries(links).filter(([_key,url]) => url).map(([key,url]) =>
    `<li><strong>${labels[key]}:</strong> <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(new URL(url).hostname)} – ${labels[key]} ansehen</a></li>`);
  return items.length ? `<ul class="nlb-source-links">${items.join("")}</ul>` : "";
}

function renderPageOverride(page) {
  if (page !== "beschreibung" || typeof configData === "undefined") return null;
  const root = document.createElement("div");
  const supplied = configData.beschreibung;
  root.innerHTML = Array.isArray(supplied) ? supplied.filter(value => value !== "_multiline_").join("\n") : String(supplied || "");
  const heading = [...root.querySelectorAll("h2")].find(element => element.textContent.trim().toLowerCase() === "datenquelle");
  const links = renderEmergencySourceLinks(configData);
  if (heading) {
    // Nur die strukturierte Quellen-Linkliste ersetzen, redaktionelle Erläuterungen erhalten.
    let next = heading.nextElementSibling;
    while (next && next.tagName !== "H2") {
      const following = next.nextElementSibling;
      if (["UL","OL"].includes(next.tagName)) {
        const labels = [...next.querySelectorAll("li > strong")].map(element => element.textContent.trim().toLowerCase());
        if (labels.length && labels.every(label => /^(open data portal|datensatz|ressourcen?):?$/.test(label))) next.remove();
      }
      next = following;
    }
    if (links) heading.insertAdjacentHTML("afterend",links);
  } else if (links) {
    root.insertAdjacentHTML("beforeend","<h2>Datenquelle</h2>" + links);
  }
  return '<section class="nlb-description" aria-label="Über diese App"><h2>Über diese App</h2>' + root.innerHTML + "</section>";
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
    script.onerror = () => {
      // NLB-B2: Fehlversuch NICHT cachen. Vorher blieb die (mit false
      // aufgeloeste) Promise fuer die ganze Sitzung im Modulcache — die
      // Bibliothek war danach dauerhaft gesperrt, auch in anderen Instanzen,
      // ohne neuen Ladeversuch.
      delete NLB_ASSETS[id];
      resolve(false);
    };
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

function addToHead() {
  return ``;
}

if (typeof window !== "undefined") {
  window.NotfallLagebild = {
    normalizeEmergencyRecord,
    buildEmergencyView,
    filterEmergencyAreaRecords,
    deriveEmergencyMapCenter,
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    normalizeEmergencyRecord,
    buildEmergencyView,
    filterEmergencyAreaRecords,
    deriveEmergencyMapCenter,
    deriveEmergencyDescription,
    parseEmergencyCsv,
    parseEmergencyData,
  };
}
