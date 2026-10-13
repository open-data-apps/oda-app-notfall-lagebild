const assert = require("node:assert/strict");
const test = require("node:test");
const { loadApp } = require("./helpers/load-app.cjs");

function fakeHost() {
  const elements = {};
  const element = () => ({ textContent: "", className: "", innerHTML: "", disabled: false, setAttribute() {}, classList: { toggle() {} } });
  const host = { innerHTML: "SHELL", querySelector: selector => elements[selector] || (elements[selector] = element()) };
  return { host, elements };
}

test("keine Quelle zeigt die Portfolio-Standardinfo statt eines Ladefehlers", async () => {
  const c = loadApp();
  const host = { innerHTML: "" };
  await c.initializeEmergencyDashboard({ uid: "t1", config: { apiurl: "" }, host, libraryState: {}, disposed: false });
  assert.match(host.innerHTML, /class="alert alert-info"/);
  assert.match(host.innerHTML, /Es ist keine Datenquelle konfiguriert\./);
  assert.match(host.innerHTML, /URLs zu Datenressourcen → Vollständige Standortdaten \(JSON\/CSV\)/);
});

test("erster Abruffehler nutzt die Standardfehlerbox und behält den Neu-laden-Weg", async () => {
  const c = loadApp({ fetch: async () => ({ ok: false, status: 500, text: async () => "failed" }) });
  const { host, elements } = fakeHost();
  const state = { uid: "t2", config: { apiurl: "https://fixture.test/standorte.json", proxyAktiv: "nein" }, host,
    requestId: 0, allRecords: [], hasSuccessfulLoad: false, loading: false, controller: null, disposed: false };
  await c.refreshEmergencyDashboard(state);
  assert.equal(host.innerHTML, "SHELL");
  const slot = elements["#nlb-alert-t2"].innerHTML;
  assert.match(slot, /class="alert alert-danger"/);
  assert.match(slot, /HTTP 500/);
  assert.match(slot, /Konfigurierte URL: <code>https:\/\/fixture\.test\/standorte\.json<\/code>/);
  assert.equal(elements["#nlb-data-status-t2"].textContent, "Kein erfolgreich geladener Datenbestand.");
});
