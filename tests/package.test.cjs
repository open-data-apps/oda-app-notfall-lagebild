const fs=require("node:fs"),path=require("node:path");
const assert=require("node:assert/strict"),test=require("node:test");
const {loadApp}=require("./helpers/load-app.cjs");const c=loadApp();
const root=path.join(__dirname,"..");
const pkg=JSON.parse(fs.readFileSync(path.join(root,"app-package.json"),"utf8"));
const config=JSON.parse(fs.readFileSync(path.join(root,"odas-config/config.json"),"utf8"));
test("source link derivation uses actual config and rejects unsafe or missing levels",()=>{
 const links=c.getEmergencySourceLinks({urlDaten:"https://zweite.example/dataset/a",apiurls:[{name:"standorte",url:"https://other.example/a.csv"}]});
 assert.equal(links.portal,"https://zweite.example");assert.equal(links.dataset,"https://zweite.example/dataset/a");assert.equal(links.resource,"https://other.example/a.csv");
 const none=c.getEmergencySourceLinks({urlDaten:"javascript:alert(1)",apiurls:[{name:"standorte",url:"https://"}]});
 assert.equal(none.portal,null);assert.equal(none.dataset,null);assert.equal(none.resource,null);
 assert.equal(c.renderEmergencySourceLinks({}).includes('href=""'),false);
});
test("package compatibility retains config ownership and matching description values",()=>{
 assert.deepEqual(pkg.beschreibung,pkg["instanz-config"].beschreibung.default);
 assert.equal(pkg["app-package-version"],"2");assert.equal(pkg["api-version"],"1");
 const keys=['seitentitel','titel','icon','kontakt','beschreibung','impressum','datenschutz','urlDaten','fusszeile','proxyAktiv','apiurls','weiterfuehrendeLinks','datenquelleHinweis','datenStand','kpiKontext1','kpiKontext2','kpiKontext3','kpiKontext4','kpiKontext5','sprache','brandingCSS','brandingCSSFile'].sort();
 assert.deepEqual(Object.keys(pkg["instanz-config"]).sort(),keys);assert.deepEqual(Object.keys(config).sort(),keys);
 for(const [key,field] of Object.entries(pkg["instanz-config"])) {
  assert.ok(["allgemein","beschreibung","datenherkunft","kontakt-rechtliches","sonstiges"].includes(field.category),key);
  assert.notEqual(field.format.typ,"number");
 }
 for(const file of [...pkg.screenshots,pkg["odas-app-icon"],pkg["app-icon"],pkg.daten.schema]) assert.ok(fs.existsSync(path.join(root,file)),file);
});
test("KPI editor labels and help match the implemented meanings",()=>{
 const fields=pkg["instanz-config"];
 for(const [key,title] of [["kpiKontext3","Gemeldete freie Plätze"],["kpiKontext4","Stadtteile ohne aktiven Standort"],["kpiKontext5","Letzte Prüfung vor mehr als 180 Tagen"]]) {
  assert.equal(fields[key].label,"KPI-Erklärung: "+title);
  assert.ok(fields[key].hilfe.includes(title));
 }
 assert.match(fields.kpiKontext3.hilfe,/getrennt.*Typ/);
 assert.match(fields.kpiKontext4.hilfe,/kein Nachweis.*Unterversorgung/);
 assert.match(fields.kpiKontext5.hilfe,/Keine verbindliche Prüffrist/);
});
test("release package and changelog identify the same updated delivery",()=>{
 assert.equal(pkg["app-version"],"1.29.1");
 const top=fs.readFileSync(path.join(root,"CHANGELOG.md"),"utf8").match(/^## (\d+\.\d+\.\d+) - (\d{4}-\d{2}-\d{2})/m);
 assert.ok(top);assert.equal(top[1],pkg["app-version"]);
});
