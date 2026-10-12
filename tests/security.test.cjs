const assert = require("node:assert/strict");
const test = require("node:test");
const { loadApp } = require("./helpers/load-app.cjs");
const c = loadApp();
test("status variants retain meaning without invented usability", () => {
  const groups = {
    aktiv: ["aktiv","active","EINSATZBEREIT"],
    eingeschraenkt: ["eingeschränkt","eingeschraenkt","eingeschrankt","restricted"],
    "ausser Betrieb": ["außer Betrieb","ausser Betrieb","ausserbetrieb","offline","inaktiv","nicht einsatzfähig","nicht einsatzfaehig","nicht einsatzfahig"],
    geplant: ["geplant","planned","planung"],
    stoerung: ["gestört","gestoert","gestort","Störung","stoerung","storung"],
    unbekannt: ["",null,undefined,"aktiv vielleicht","constructor","<img/src=x>"]
  };
  for (const [expected, values] of Object.entries(groups)) for (const raw of values) {
    assert.equal(c.normalizeEmergencyStatus(raw), expected, String(raw));
  }
});
test("generic disturbance counts as disturbed, never active", () => {
  for (const value of ["eingeschraenkt","ausser Betrieb","stoerung"]) assert.equal(c.isEmergencyDisrupted(value), true);
  for (const value of ["aktiv","geplant","unbekannt"]) assert.equal(c.isEmergencyDisrupted(value), false);
});
test("marker class cannot interpolate source markup", () => {
  assert.equal(c.statusClass('"><img/src="x"/onerror="window.nlb_xss=1">'), "nlb-marker-unbekannt");
  assert.equal(c.statusClass("aktiv"), "nlb-marker-aktiv");
  assert.equal(c.statusClass("ausser Betrieb"), "nlb-marker-ausser-betrieb");
});
