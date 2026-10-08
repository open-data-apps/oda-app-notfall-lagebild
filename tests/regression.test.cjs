const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const appPath = path.join(__dirname, "..", "app", "app.js");
const appSource = fs.readFileSync(appPath, "utf8");
const appContext = vm.createContext({
  AbortController,
  console,
  URL,
  window: { location: { href: "https://example.test/app/" } },
});
vm.runInContext(appSource, appContext, { filename: appPath });

const demoUrl =
  "https://open-data-musterstadt.ckan.de/dataset/demo/resource/demo/download/notfall-lagebild-demo.json";

function renderShell(apiurl) {
  return appContext.renderEmergencyShell(
    { titel: "Notfall-Lagebild", description: "Kommunale Standortdaten", apiurl },
    "i-test",
  );
}

test("renders a demo warning for the known example resource", () => {
  const html = renderShell(demoUrl);

  assert.ok(html.includes("Demo-Daten – keine realen Einsatzdaten"));
  assert.ok(
    html.includes(
      "Die dargestellten Standorte und Kapazitäten sind Anschauungsbeispiele und keine Notfallentscheidungsgrundlage.",
    ),
  );
});

test("recognizes the demo resource from its URL path even with a query string", () => {
  const html = renderShell(`${demoUrl}?download=1&format=json`);

  assert.ok(html.includes("Demo-Daten – keine realen Einsatzdaten"));
});

test("does not label a different data source as demo when its query mentions the demo filename", () => {
  const html = renderShell(
    "https://daten.example.test/standorte.json?hinweis=notfall-lagebild-demo.json",
  );

  assert.ok(!html.includes("Demo-Daten – keine realen Einsatzdaten"));
});

test("keeps the demo warning in the shell, separate from filtering and fetch errors", () => {
  const html = renderShell(demoUrl);
  const warningIndex = html.indexOf("Demo-Daten – keine realen Einsatzdaten");
  const filterIndex = html.indexOf('class="nlb-filters"');
  const alert = { textContent: "", className: "" };
  const queriedSelectors = [];

  appContext.showEmergencyAlert(
    {
      uid: "i-test",
      host: {
        querySelector(selector) {
          queriedSelectors.push(selector);
          return alert;
        },
      },
    },
    "Die Daten konnten nicht geladen werden.",
  );

  assert.ok(warningIndex >= 0 && warningIndex < filterIndex);
  assert.ok(html.includes('id="nlb-alert-i-test"'));
  assert.deepEqual(queriedSelectors, ["#nlb-alert-i-test"]);
  assert.equal(alert.textContent, "Die Daten konnten nicht geladen werden.");
  assert.ok(html.includes("Demo-Daten – keine realen Einsatzdaten"));
});

test("uses distinct N and M marker symbols while preserving existing type initials", () => {
  const cases = [
    ["Notfall-Anlaufstelle", "N"],
    ["Mobile Versorgungsstelle", "M"],
    ["AED-Standort", "A"],
    ["Sirenenstandort", "S"],
    ["Feuerwehrstandort", "F"],
    ["Wasserstelle", "W"],
    ["Notunterkunft", "U"],
  ];

  for (const [type, symbol] of cases) {
    assert.equal(appContext.typeInitial(type), symbol, type);
  }
});

test("renders status colors and escaped labels for the data types shown on the map", () => {
  const legend = { innerHTML: "" };
  appContext.renderEmergencyLegend({
    uid: "i-test",
    host: {
      querySelector(selector) {
        assert.equal(selector, "#nlb-map-legend-i-test");
        return legend;
      },
    },
    allRecords: [
      { typ: "Notfall-Anlaufstelle" },
      { typ: "Mobile Versorgungsstelle" },
      { typ: "<img src=x onerror=alert(1)>" },
      { typ: "Notfall-Anlaufstelle" },
    ],
  });

  assert.ok(legend.innerHTML.includes("#198754"));
  assert.ok(legend.innerHTML.includes("#f0ad00"));
  assert.ok(legend.innerHTML.includes("#c1121f"));
  assert.ok(legend.innerHTML.includes("#0d6efd"));
  assert.ok(legend.innerHTML.includes("Typen:"));
  assert.ok(legend.innerHTML.includes("Notfall-Anlaufstelle"));
  assert.ok(legend.innerHTML.includes("Mobile Versorgungsstelle"));
  assert.ok(legend.innerHTML.includes("&lt;img src=x onerror=alert(1)&gt;"));
  assert.ok(!legend.innerHTML.includes("<img src=x"));
  assert.ok(legend.innerHTML.includes(">N</span>"));
  assert.ok(legend.innerHTML.includes(">M</span>"));
});

test("explains that the optional radius is 1 km around each filtered site, not verified coverage", () => {
  const html = renderShell(demoUrl);

  assert.ok(html.includes("1 km um jeden gefilterten Standort"));
  assert.ok(html.includes("keine geprüfte Versorgungsreichweite"));
});
