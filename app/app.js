const NLB_STATUS = {
  active: "aktiv",
  restricted: "eingeschraenkt",
  offline: "ausser Betrieb",
  planned: "geplant",
};

const NLB_STATUS_LABELS = {
  [NLB_STATUS.active]: "Aktiv",
  [NLB_STATUS.restricted]: "Eingeschraenkt",
  [NLB_STATUS.offline]: "Ausser Betrieb",
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

function app(configdata = {}, enclosingHtmlDivElement) {
  const config = normalizeEmergencyConfig(configdata);
  const state = {
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
  };

  enclosingHtmlDivElement.innerHTML = renderEmergencyShell(config);
  bindEmergencyShell(state);
  initializeEmergencyDashboard(state);
}

function normalizeEmergencyConfig(configdata = {}) {
  const config = { ...configdata };
  config.titel = config.titel || config.title || "Notfall-Lagebild";
  config.description = deriveEmergencyDescription(config);
  config.apiurl = String(config.apiurl || config.apiUrl || "").trim();
  config.useProxy = String(config.useProxy || config.odasProxy || "").toLowerCase() === "ja";
  return config;
}

async function initializeEmergencyDashboard(state) {
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
    state.allRecords = records;
    state.mapCenter = deriveEmergencyMapCenter(records);
    populateEmergencyFilters(state);
    setEmergencyLoading(state, "");
    showEmergencyAlert(state, "");
    updateEmergencyDashboard(state);
  } catch (error) {
    console.error("Notfall-Lagebild konnte nicht geladen werden:", error);
    state.allRecords = [];
    populateEmergencyFilters(state);
    showEmergencyAlert(
      state,
      `Die konfigurierte Datenquelle konnte nicht geladen werden: ${error.message || "Unbekannter Fehler"}`
    );
    setEmergencyLoading(state, "");
    updateEmergencyDashboard(state);
  }
}

async function loadEmergencyRecords(config) {
  if (!config.apiurl) {
    throw new Error("Keine Datenquelle konfiguriert (apiurl fehlt).");
  }

  const rawText = await fetchEmergencyText(config.apiurl, config);
  const records = parseEmergencyData(rawText).map((record, index) =>
    normalizeEmergencyRecord(record, index)
  );

  if (!records.length) {
    throw new Error("Die Datenquelle enthaelt keine verwertbaren Datensaetze.");
  }

  return records;
}

async function fetchEmergencyText(url, config) {
  const localBrowserSession =
    typeof window !== "undefined" && isLocalHost(window.location.hostname);

  if (config.useProxy && !localBrowserSession) {
    return fetchViaOdasProxy(url);
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.text();
  } catch (error) {
    if (typeof window !== "undefined" && !isLocalHost(window.location.hostname)) {
      return fetchViaOdasProxy(url);
    }
    throw error;
  }
}

function isLocalHost(hostname) {
  return ["127.0.0.1", "localhost", "::1"].includes(hostname);
}

function extractPathFromUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.pathname + parsed.search;
  } catch (error) {
    return url;
  }
}

async function fetchViaOdasProxy(targetUrl) {
  const path = typeof window === "undefined" ? "" : window.location.pathname.replace(/\/+$/, "");
  const apiPath = extractPathFromUrl(targetUrl);
  const proxyEndpoint = `${path}/odp-data?path=${encodeURIComponent(apiPath)}`;
  const response = await fetch(proxyEndpoint, { method: "POST" });

  if (!response.ok) {
    throw new Error(`ODAS-Proxy-Fehler: HTTP ${response.status}`);
  }

  const proxyData = await response.json();
  return proxyData.content || "";
}

function parseEmergencyData(rawText) {
  const trimmed = String(rawText || "").trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const json = JSON.parse(trimmed);
    return extractEmergencyRecords(json);
  }

  return parseEmergencyCsv(trimmed);
}

function deriveEmergencyDescription(config = {}) {
  const fallback =
    "Operatives Lagebild fuer kommunale Notfall-Infrastruktur, Status, Kapazitaeten und raeumliche Versorgung.";
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
  const lines = csvText.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];

  const delimiter = lines[0].includes(";") ? ";" : ",";
  const headers = splitCsvLine(lines[0], delimiter).map((header) => header.trim());

  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line, delimiter);
    return headers.reduce((record, header, index) => {
      record[header] = values[index] || "";
      return record;
    }, {});
  });
}

function splitCsvLine(line, delimiter) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  values.push(current);
  return values;
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

function renderEmergencyShell(config) {
  return `
    <section class="nlb-app" aria-label="Notfall-Lagebild">
      <div class="nlb-toolbar">
        <div>
          <p class="nlb-eyebrow mb-1">Kommunales Lagebild</p>
          <h2 class="mb-2">${escapeHtml(config.titel)}</h2>
          <p class="nlb-lead mb-0">${escapeHtml(config.description)}</p>
          <p class="text-muted small mt-2 mb-0" id="nlb-data-status">Datenstand wird geladen ...</p>
        </div>
        <div class="nlb-toolbar-actions">
          <button type="button" class="btn btn-outline-secondary" id="nlb-reset-filters">Filter zuruecksetzen</button>
        </div>
      </div>

      <div class="alert alert-warning d-none" id="nlb-alert" role="alert"></div>
      <div class="nlb-loading" id="nlb-loading" aria-live="polite"></div>

      <div class="nlb-kpi-grid" id="nlb-kpis">
        ${renderKpiCard("active", "Aktive Standorte", "0", "Einsatzbereit")}
        ${renderKpiCard("disrupted", "Gestoerte Standorte", "0", "Eingeschraenkt oder ausser Betrieb")}
        ${renderKpiCard("capacity", "Freie Gesamtkapazitaet", "0", "Verfuegbare Plaetze")}
        ${renderKpiCard("underserved", "Unterversorgte Stadtteile", "0", "Aktive Standorte unter Schwelle")}
        ${renderKpiCard("overdue", "Pruefungen ueberfaellig", "0", "Aelter als Grenzwert")}
      </div>

      <section class="nlb-filters" aria-label="Filter">
        <div class="row g-3">
          ${renderFilterSelect("typ", "Typ")}
          ${renderFilterSelect("untertyp", "Untertyp")}
          ${renderFilterSelect("status", "Status")}
          ${renderFilterSelect("stadtteil", "Stadtteil")}
          ${renderFilterSelect("betreiber", "Betreiber")}
          ${renderFilterSelect("barrierefrei", "Barrierefrei")}
          ${renderFilterSelect("notstrom", "Notstrom")}
          ${renderFilterSelect("prioritaet", "Prioritaet")}
          <div class="col-12 col-lg-4">
            <label class="form-label" for="nlb-filter-search">Suche</label>
            <input class="form-control" id="nlb-filter-search" type="search" placeholder="Name, Adresse, Hinweis">
          </div>
        </div>
        <div class="nlb-filter-note" id="nlb-filter-note"></div>
      </section>

      <div class="row g-4 align-items-stretch">
        <div class="col-12 col-xl-8">
          <section class="nlb-panel h-100" aria-label="Karte">
            <div class="nlb-panel-head">
              <h3>Karte</h3>
              <div class="btn-group">
                <button type="button" class="btn btn-sm btn-outline-secondary" id="nlb-zoom-results">Treffer zentrieren</button>
                <button type="button" class="btn btn-sm btn-outline-secondary" id="nlb-toggle-radius">1 km Radius</button>
              </div>
            </div>
            <div id="nlb-map" class="nlb-map" role="application" aria-label="Standortkarte"></div>
            <div class="nlb-map-legend" id="nlb-map-legend"></div>
          </section>
        </div>
        <div class="col-12 col-xl-4">
          <section class="nlb-panel h-100" aria-label="Diagramm">
            <div class="nlb-panel-head">
              <h3>Standorte nach Typ</h3>
            </div>
            <div class="nlb-chart-wrap" id="nlb-chart-wrap">
              <canvas id="nlb-type-chart"></canvas>
            </div>
          </section>
        </div>
      </div>

      <section class="nlb-panel mt-4" aria-label="Tabelle">
        <div class="nlb-panel-head">
          <h3>Operative Standortliste</h3>
          <span class="nlb-result-count" id="nlb-result-count">0 Treffer</span>
        </div>
        <div class="table-responsive">
          <table class="table table-hover align-middle nlb-table">
            <thead id="nlb-table-head"></thead>
            <tbody id="nlb-table-body"></tbody>
          </table>
        </div>
        <div class="nlb-pagination">
          <button type="button" class="btn btn-sm btn-outline-secondary" id="nlb-prev-page">Zurueck</button>
          <span id="nlb-page-info">Seite 1 von 1</span>
          <button type="button" class="btn btn-sm btn-outline-secondary" id="nlb-next-page">Weiter</button>
        </div>
      </section>
    </section>
  `;
}

function renderKpiCard(id, label, value, hint) {
  return `
    <button type="button" class="nlb-kpi" data-quickfilter="${id}">
      <span>${label}</span>
      <strong id="nlb-kpi-${id}">${value}</strong>
      <small>${hint}</small>
    </button>
  `;
}

function renderFilterSelect(id, label) {
  return `
    <div class="col-12 col-md-6 col-lg-3">
      <label class="form-label" for="nlb-filter-${id}">${label}</label>
      <select class="form-select nlb-filter" id="nlb-filter-${id}" data-filter="${id}">
        <option value="">Alle</option>
      </select>
    </div>
  `;
}

function bindEmergencyShell(state) {
  state.host.querySelector("#nlb-reset-filters").addEventListener("click", () => {
    state.quickFilter = "";
    state.page = 1;
    state.host.querySelectorAll(".nlb-filter").forEach((element) => {
      element.value = "";
    });
    state.host.querySelector("#nlb-filter-search").value = "";
    updateEmergencyDashboard(state);
  });

  state.host.querySelector("#nlb-zoom-results").addEventListener("click", () => fitEmergencyMap(state));
  state.host.querySelector("#nlb-toggle-radius").addEventListener("click", () => {
    state.showRadius = !state.showRadius;
    state.host.querySelector("#nlb-toggle-radius").classList.toggle("active", state.showRadius);
    updateEmergencyMap(state);
  });

  state.host.querySelector("#nlb-prev-page").addEventListener("click", () => {
    state.page = Math.max(1, state.page - 1);
    renderEmergencyTable(state);
  });

  state.host.querySelector("#nlb-next-page").addEventListener("click", () => {
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

  state.host.querySelector("#nlb-filter-search").addEventListener("input", () => {
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
  const select = state.host.querySelector(`#nlb-filter-${id}`);
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
  filters.search = state.host.querySelector("#nlb-filter-search").value;
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
  const statusElement = state.host.querySelector("#nlb-data-status");
  const maxDate = state.allRecords
    .map((record) => record.letzte_pruefung)
    .filter(Boolean)
    .sort()
    .pop();
  const apiurl = state.config.apiurl;
  const apiurlHtml = apiurl
    ? `<a href="${escapeHtml(apiurl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(apiurl)}</a>`
    : "-";
  const dateStr = maxDate ? formatDate(maxDate) : "nicht angegeben";
  statusElement.innerHTML = `Datenquelle: ${apiurlHtml} | ${state.allRecords.length.toLocaleString("de-DE")} Standorte | Datenstand: ${escapeHtml(dateStr)}`;

  const note = state.host.querySelector("#nlb-filter-note");
  note.textContent = state.quickFilter
    ? `Schnellfilter aktiv: ${quickFilterLabel(state.quickFilter)}`
    : "Alle Filter wirken gleichzeitig auf Kennzahlen, Karte, Diagramm und Tabelle.";
}

function quickFilterLabel(value) {
  const labels = {
    active: "aktive Standorte",
    disrupted: "gestoerte Standorte",
    capacity: "Standorte mit freier Kapazitaet",
    underserved: "unterversorgte Stadtteile",
    overdue: "ueberfaellige Pruefungen",
  };
  return labels[value] || value;
}

function renderEmergencyKpis(state) {
  const metrics = calculateEmergencyMetrics(state.filteredRecords, {
    minActivePerDistrict: NLB_DEFAULT_MIN_ACTIVE_PER_DISTRICT,
    overdueAfterDays: NLB_DEFAULT_OVERDUE_AFTER_DAYS,
    referenceDate: new Date(),
  });

  setText(state, "nlb-kpi-active", metrics.activeLocations.toLocaleString("de-DE"));
  setText(state, "nlb-kpi-disrupted", metrics.disruptedLocations.toLocaleString("de-DE"));
  setText(state, "nlb-kpi-capacity", metrics.freeCapacity.toLocaleString("de-DE"));
  setText(state, "nlb-kpi-underserved", metrics.underservedDistricts.toLocaleString("de-DE"));
  setText(state, "nlb-kpi-overdue", metrics.overdueChecks.toLocaleString("de-DE"));

  state.host.querySelectorAll(".nlb-kpi").forEach((element) => {
    element.classList.toggle("active", element.dataset.quickfilter === state.quickFilter);
  });
}

function setText(state, id, text) {
  const element = state.host.querySelector(`#${id}`);
  if (element) element.textContent = text;
}

function renderEmergencyLegend(state) {
  const legend = state.host.querySelector("#nlb-map-legend");
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
  const mapElement = state.host.querySelector("#nlb-map");
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
        <dt>Kapazitaet</dt><dd>${record.kapazitaet_verfuegbar} / ${record.kapazitaet_max}</dd>
        <dt>Betreiber</dt><dd>${escapeHtml(record.betreiber || "-")}</dd>
        <dt>Letzte Pruefung</dt><dd>${escapeHtml(formatDate(record.letzte_pruefung))}</dd>
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
  const chartWrap = state.host.querySelector("#nlb-chart-wrap");
  if (!state.libraryState.chart || typeof Chart === "undefined") {
    renderFallbackEmergencyChart(state, chartWrap);
    return;
  }

  if (!state.host.querySelector("#nlb-type-chart")) {
    chartWrap.innerHTML = `<canvas id="nlb-type-chart"></canvas>`;
  }

  const canvas = state.host.querySelector("#nlb-type-chart");

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
    ["letzte_pruefung", "Letzte Pruefung"],
    ["betreiber", "Betreiber"],
  ];
  const maxPage = Math.max(1, Math.ceil(state.filteredRecords.length / state.pageSize));
  state.page = Math.min(state.page, maxPage);
  const start = (state.page - 1) * state.pageSize;
  const pageRows = state.filteredRecords.slice(start, start + state.pageSize);

  state.host.querySelector("#nlb-table-head").innerHTML = `<tr>${columns
    .map(([key, label]) => {
      const active = state.sortKey === key ? ` aria-sort="${state.sortDirection === "asc" ? "ascending" : "descending"}"` : "";
      return `<th scope="col"${active}><button type="button" class="nlb-sort" data-sort="${key}">${label}</button></th>`;
    })
    .join("")}</tr>`;

  state.host.querySelector("#nlb-table-body").innerHTML =
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

  state.host.querySelectorAll("#nlb-table-body tr[data-record-id]").forEach((row) => {
    row.addEventListener("click", () => focusEmergencyRecord(state, row.dataset.recordId));
  });

  state.host.querySelector("#nlb-result-count").textContent = `${state.filteredRecords.length.toLocaleString(
    "de-DE"
  )} Treffer`;
  state.host.querySelector("#nlb-page-info").textContent = `Seite ${state.page} von ${maxPage}`;
  state.host.querySelector("#nlb-prev-page").disabled = state.page <= 1;
  state.host.querySelector("#nlb-next-page").disabled = state.page >= maxPage;
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
  const element = state.host.querySelector("#nlb-loading");
  element.textContent = message;
  element.classList.toggle("d-none", !message);
}

function showEmergencyAlert(state, message) {
  const element = state.host.querySelector("#nlb-alert");
  element.textContent = message;
  element.classList.toggle("d-none", !message);
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
  await loadStyleOnce("nlb-leaflet-css", "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css");
  return loadScriptOnce("nlb-leaflet-js", "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js", () =>
    typeof L !== "undefined"
  );
}

async function loadMarkerClusterLibrary() {
  const leafletLoaded = await loadLeafletLibrary();
  if (!leafletLoaded) return false;
  await loadStyleOnce(
    "nlb-markercluster-css",
    "https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css"
  );
  await loadStyleOnce(
    "nlb-markercluster-default-css",
    "https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css"
  );
  return loadScriptOnce(
    "nlb-markercluster-js",
    "https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js",
    () => typeof L !== "undefined" && Boolean(L.markerClusterGroup)
  );
}

function loadChartLibrary() {
  return loadScriptOnce("nlb-chart-js", "https://cdn.jsdelivr.net/npm/chart.js@4.4.9/dist/chart.umd.min.js", () =>
    typeof Chart !== "undefined"
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
