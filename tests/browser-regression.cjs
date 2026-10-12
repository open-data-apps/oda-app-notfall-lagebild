const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test, before, after } = require("node:test");
const modulePath = process.env.NLB_PLAYWRIGHT_MODULE;
if (!modulePath) throw new Error("NLB_PLAYWRIGHT_MODULE must point to an installed Playwright module; browser tests are not skipped.");
const { chromium } = require(modulePath);
const baseURL = process.env.NLB_BASE_URL || "http://127.0.0.1:5501/app/";
const sourceURL = "https://fixture.test/dataset/a/resource/b/download/standorte.json";
let browser;
before(async () => { browser = await chromium.launch({executablePath: process.env.NLB_CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true}); });
after(async () => { if (browser) await browser.close(); });
async function openApp(t, rows, options = {}) {
  const context = await browser.newContext({viewport: options.viewport || {width:1440,height:1000}, reducedMotion:"reduce"});
  t.after(() => context.close());
  const page = await context.newPage(); page.setDefaultTimeout(7000);
  const errors = []; page.on("pageerror", e => errors.push(e.message));
  const config = JSON.parse(fs.readFileSync(path.join(__dirname,"../odas-config/config.json"),"utf8"));
  config.apiurls = [{name:"standorte",url:sourceURL}];
  Object.assign(config, options.config || {});
  let calls = 0;
  await page.route("**/*", async route => {
    const url = route.request().url();
    if (url.endsWith("/odas-config/config.json")) return route.fulfill({json:config});
    if (url === config.apiurls[0]?.url) {
      calls++;
      if (options.respond) return options.respond(route, calls);
      return route.fulfill({json:rows});
    }
    if (options.libraryGate && url.includes(options.libraryGate.match)) {
      await options.libraryGate.promise;
      return route.continue().catch(()=>{});
    }
    if (options.block && options.block.some(part => url.includes(part))) return route.abort();
    if (new URL(url).origin === new URL(baseURL).origin) return route.continue();
    return route.abort();
  });
  await page.goto(baseURL + (options.hash || ""), {waitUntil: options.ready === false ? "domcontentloaded" : "networkidle"});
  if (options.ready !== false && !options.hash) await page.waitForFunction(() => {
    const s = [...nlbInstances.values()][0]; return s && (s.hasSuccessfulLoad || s.allRecords.length > 0);
  });
  return {page, errors, calls:()=>calls};
}
async function snapshot(page) {
  return page.evaluate(() => {
    const s = [...nlbInstances.values()][0];
    return {count:s.filteredRecords.length, selection:s.selection,
      metrics:s.view?.metrics, lastFetch:s.lastSuccessfulFetch?.toISOString(),
      keys:s.filteredRecords.map(r=>r._key), loading:s.loading, error:s.loadError};
  });
}
const fixture = require("./fixtures/standorte.json");
const action = (page, name) => page.locator('[data-nlb-action="' + name + '"]');
test("card action and filter transitions preserve counts and scope", async t => {
  const {page,errors}=await openApp(t,fixture);
  assert.equal(await page.locator("button.nlb-kpi").count(),0);
  await action(page,"disrupted").click();
  assert.equal((await snapshot(page)).count,3);
  assert.equal((await snapshot(page)).metrics.activeLocations,2);
  assert.equal(await action(page,"disrupted").getAttribute("aria-pressed"),"true");
  await action(page,"active").click();
  assert.equal((await snapshot(page)).count,2);
  await action(page,"active").click(); assert.equal((await snapshot(page)).count,7);
  await action(page,"disrupted").click();
  await page.locator('[data-filter="stadtteil"]').selectOption("Mitte");
  assert.equal((await snapshot(page)).selection,"disrupted"); assert.equal((await snapshot(page)).count,1);
  await action(page,"clear-selection").click();
  assert.equal((await snapshot(page)).count,3);
  assert.equal(await page.locator('[data-filter="stadtteil"]').inputValue(),"Mitte");
  await page.locator('[data-filter="status"]').selectOption("offline");
  assert.equal((await snapshot(page)).count,0);
  await action(page,"capacity").click();
  assert.equal((await snapshot(page)).count,1);
  assert.equal(await page.locator('[data-filter="status"]').inputValue(),"");
  await page.locator('[id^="nlb-filter-search-"]').fill("xyz");
  assert.equal((await snapshot(page)).selection,"capacity");
  assert.equal((await snapshot(page)).count,0);
  assert.equal(await action(page,"capacity").isEnabled(),true);
  await action(page,"capacity").click(); assert.equal((await snapshot(page)).selection,"");
  assert.deepEqual(errors,[]);
});
test("quality and zero states distinguish unknown from no", async t => {
  const {page}=await openApp(t,[null,...fixture]);
  assert.match(await page.locator('[id^="nlb-quality-"]').innerText(),/Teilbestand.*1.*ausgeschlossen/);
  await page.locator('[data-nlb-action="extra-filters"]').click();
  await page.locator('[data-filter="barrierefrei"]').selectOption("nein");
  assert.equal((await snapshot(page)).count,1);
  await page.locator('[data-filter="barrierefrei"]').selectOption("__unknown__");
  assert.equal((await snapshot(page)).count,5);
  assert.match(await page.locator('[id^="nlb-result-count-"]').innerText(),/auf der Karte/);
});
test("mobile filters offer direct navigation and accessible targets", async t => {
  const {page}=await openApp(t,fixture,{viewport:{width:375,height:812}});
  assert.equal(await page.locator('[data-filter="betreiber"]').isVisible(),false);
  assert.equal(await page.locator('[data-filter="typ"]').isVisible(),true);
  for (const a of ["active","extra-filters"]) {
    const box=await action(page,a).boundingBox(); assert.ok(box.height>=44,a);
  }
  assert.equal(await page.locator('[data-nlb-jump="map"]').isVisible(),true);
  await page.locator('[data-nlb-jump="map"]').click();
  assert.equal(await page.locator('[id^="nlb-map-panel-"]').evaluate(e=>document.activeElement===e),true);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.setViewportSize({width:812,height:375});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
});
test("details distinguish missing from invalid values without losing zero or false", async t => {
  const labels=["Typ","Stadtteil","Status","Gemeldete maximale Plätze","Gemeldete freie Plätze","Barrierefrei","Notstrom","Wasser","Sanitär","Letzte Prüfung","Priorität"];
  const cases=[
    [{name:"Fehlend",kapazitaet_max:null,barrierefrei:"",wasser_verfuegbar:"   "},
      Object.fromEntries(labels.map(label=>[label,"Nicht angegeben"]))],
    [{name:"Ungültig",typ:{},stadtteil:[],status:"?",prioritaet:"?",kapazitaet_max:10,kapazitaet_verfuegbar:11,
      barrierefrei:"?",stromversorgung_notstrom:"?",wasser_verfuegbar:"?",sanitaer_verfuegbar:"?",letzte_pruefung:"2026-02-30"},
      {...Object.fromEntries(labels.map(label=>[label,"Unbekannt"])),"Gemeldete maximale Plätze":"10"}],
    [{...fixture[0],name:"Gültig",kapazitaet_max:0,kapazitaet_verfuegbar:0,barrierefrei:false,
      stromversorgung_notstrom:false,wasser_verfuegbar:true,sanitaer_verfuegbar:false,letzte_pruefung:"2020-02-29"},
      {"Gemeldete maximale Plätze":"0","Gemeldete freie Plätze":"0","Barrierefrei":"Nein","Notstrom":"Nein","Wasser":"Ja","Sanitär":"Nein","Letzte Prüfung":"29.2.2020"}],
  ];
  const {page,errors}=await openApp(t,cases.map(([row])=>row));
  for(const [row,expected] of cases) {
    await page.getByRole("button",{name:"Details zu "+row.name,exact:true}).click();
    await page.locator(".nlb-details.show").waitFor();
    const fields=await page.locator(".nlb-detail-fields dt").evaluateAll(nodes=>Object.fromEntries(nodes.map(e=>[e.textContent,e.nextElementSibling.textContent])));
    for(const [label,value] of Object.entries(expected)) assert.equal(fields[label],value,row.name+": "+label);
    await action(page,"close-details").click();await page.waitForFunction(()=>!document.querySelector(".nlb-details.show"));
  }
  assert.deepEqual(errors,[]);
});
test("details preserve identity full text and focus with duplicate source IDs", async t => {
  const hint="Vollständiger Hinweis ".repeat(50)+'<img src=x onerror="window.detail_xss=1">';
  const rows=[{...fixture[0],id:"same",name:"Erster Ort",hinweis:hint},{...fixture[1],id:"same",name:"Zweiter Ort",lat:null,lon:null,hinweis:"Zweiter Hinweis"}];
  const {page,errors}=await openApp(t,rows);
  const first=page.locator('[data-nlb-action="details"]').filter({hasText:"Erster Ort"});
  await first.focus(); await page.keyboard.press("Enter");
  await page.locator(".nlb-details.show").waitFor();
  assert.ok((await page.locator(".nlb-details-body").innerText()).includes(hint));
  assert.match(await page.locator(".nlb-details-body").innerText(),/Teststraße 1/);
  assert.equal(await page.evaluate(()=>document.activeElement.closest(".nlb-details")!==null),true);
  assert.equal(await page.evaluate(()=>window.detail_xss),undefined);
  await page.locator('[data-nlb-action="close-details"]').click();
  await page.waitForFunction(()=>!document.querySelector(".nlb-details.show"));
  assert.equal(await first.evaluate(e=>document.activeElement===e),true);
  await page.locator('[data-nlb-action="details"]').filter({hasText:"Zweiter Ort"}).click();
  await page.locator(".nlb-details.show").waitFor();
  assert.match(await page.locator(".nlb-details-body").innerText(),/Zweiter Hinweis/);
  assert.equal(await action(page,"show-on-map").isDisabled(),true);
  await action(page,"close-details").click();
  await page.locator('[data-sort="name"]').focus(); await page.keyboard.press("Enter");
  assert.equal(await page.locator('[data-sort="name"]').evaluate(e=>document.activeElement===e),true);
  await first.click(); await page.locator(".nlb-details.show").waitFor();
  await action(page,"show-on-map").click();
  await page.waitForFunction(()=>document.querySelector(".leaflet-popup"));
  assert.match(await page.locator(".leaflet-popup").innerText(),/Erster Ort/);
  const zoom=await page.evaluate(()=>[...nlbInstances.values()][0].map.getZoom());
  await page.locator('[id^="nlb-toggle-radius-"]').click();
  assert.equal(await page.evaluate(()=>[...nlbInstances.values()][0].map.getZoom()),zoom);
  assert.deepEqual(errors,[]);
});
for (const [file,key] of [["/leaflet.js","leaflet"],["leaflet.markercluster.js","markerCluster"],["chart.umd.min.js","chart"]]) {
  test("pending optional "+key+" does not block data or filters", async t => {
    let release; const gate=new Promise(r=>{release=r});t.after(()=>release());
    const {page,errors}=await openApp(t,fixture,{ready:false,libraryGate:{match:file,promise:gate}});
    await page.waitForFunction(()=>[...nlbInstances.values()][0]?.hasSuccessfulLoad);
    assert.equal((await snapshot(page)).count,7);
    assert.equal(await action(page,"reload").isEnabled(),true);
    assert.equal(await page.evaluate(k=>[...nlbInstances.values()][0].libraryState[k],key),false);
    await action(page,"active").click();assert.equal((await snapshot(page)).count,2);
    if(key!=="leaflet") await page.waitForFunction(()=>[...nlbInstances.values()][0]?.map);
    const camera=await page.evaluate(()=>{const s=[...nlbInstances.values()][0];if(!s.map)return null;s.map.setView([48.5,9.5],12);return {...s.map.getCenter(),zoom:s.map.getZoom()}});
    release();
    await page.waitForFunction(k=>[...nlbInstances.values()][0]?.libraryState[k],key);
    if(key==="chart") await page.waitForFunction(()=>[...nlbInstances.values()][0]?.chart);
    else await page.waitForFunction(()=>[...nlbInstances.values()][0]?.map);
    assert.equal((await snapshot(page)).count,2);
    if(camera) assert.deepEqual(await page.evaluate(()=>{const m=[...nlbInstances.values()][0].map;return {...m.getCenter(),zoom:m.getZoom()}}),camera);
    assert.deepEqual(errors,[]);
  });
}
test("late library completion cannot render into a disposed instance", async t => {
  let release;const gate=new Promise(r=>{release=r});t.after(()=>release());
  const {page,errors}=await openApp(t,fixture,{ready:false,libraryGate:{match:"chart.umd.min.js",promise:gate}});
  await page.waitForFunction(()=>[...nlbInstances.values()][0]?.hasSuccessfulLoad);
  await page.evaluate(()=>{window.oldInstance=[...nlbInstances.values()][0];location.hash="#kontakt"});
  await page.waitForFunction(()=>!document.querySelector(".nlb-app"));
  await page.evaluate(()=>location.hash="#startseite");
  await page.waitForFunction(()=>[...nlbInstances.values()][0]?.hasSuccessfulLoad);
  release();await page.waitForFunction(()=>[...nlbInstances.values()][0]?.chart);
  assert.deepEqual(await page.evaluate(async()=>{await oldInstance.librariesReady;return {disposed:oldInstance.disposed,chart:oldInstance.chart,loaded:oldInstance.libraryState.chart,size:nlbInstances.size}}),{disposed:true,chart:null,loaded:false,size:1});
  assert.deepEqual(errors,[]);
});
test("mobile detail close is a 44px target even without coordinates", async t => {
  const {page}=await openApp(t,[{...fixture[0],lat:null,lon:null}],{viewport:{width:375,height:812}});
  await action(page,"details").click();await page.locator(".nlb-details.show").waitFor();
  assert.equal(await action(page,"show-on-map").isDisabled(),true);
  const box=await action(page,"close-details").boundingBox();
  assert.ok(box.width>=44&&box.height>=44,JSON.stringify(box));
});
test("map unavailable remains usable for all 720 records", async t => {
  const rows=Array.from({length:720},(_,i)=>({...fixture[0],id:String(i),name:"Standort "+i}));
  const {page,errors}=await openApp(t,rows,{block:["/leaflet.js"]});
  assert.match(await page.locator(".nlb-map").innerText(),/nicht verfügbar/);
  assert.equal(await page.locator(".nlb-svg-map").count(),0);
  assert.equal((await snapshot(page)).count,720);
  assert.equal(await page.locator('[data-nlb-action="details"]').count(),20);
  await page.locator('[id^="nlb-next-page-"]').click();
  assert.match(await page.locator('[id^="nlb-page-info-"]').innerText(),/2 von 36/);
  await page.locator('[data-nlb-action="details"]').first().click();
  await page.locator(".nlb-details.show").waitFor();
  assert.equal(await action(page,"show-on-map").isDisabled(),true);
  await page.evaluate(()=>location.hash="#kontakt");
  await page.waitForFunction(()=>!document.querySelector(".nlb-app"));
  await page.waitForFunction(()=>!document.querySelector(".offcanvas-backdrop")&&document.body.style.overflow!=="hidden");
  assert.deepEqual(errors,[]);
});
test("cluster and chart semantics never imply healthy offline locations", async t => {
  const rows=Array.from({length:11},(_,i)=>({...fixture[0],id:String(i),status:"offline",typ:"Typ "+i}));
  const {page,errors}=await openApp(t,rows);
  await page.locator(".nlb-cluster-marker").first().waitFor();
  assert.equal(await page.locator(".marker-cluster-small,.marker-cluster-medium,.marker-cluster-large").count(),0);
  assert.match(await page.locator('[id^="nlb-chart-title-"]').innerText(),/10.*1 weitere/);
  const colors=await page.evaluate(()=>[...nlbInstances.values()][0].chart.data.datasets[0].backgroundColor);
  assert.equal(typeof colors,"string");
  await page.evaluate(()=>{const s=[...nlbInstances.values()][0];s.libraryState.chart=false;updateEmergencyChart(s)});
  assert.match(await page.locator('[id^="nlb-chart-title-"]').innerText(),/10.*1 weitere/);
  assert.deepEqual(errors,[]);
});
test("markercluster and chart failure keep native markers and text chart usable", async t => {
  const {page,errors}=await openApp(t,fixture.slice(0,2),{block:["leaflet.markercluster.js","chart.umd.min.js"]});
  assert.equal(await page.locator(".nlb-fallback-bars").count(),1);
  await action(page,"details").first().click();
  await page.locator(".nlb-details.show").waitFor();
  await action(page,"show-on-map").click();
  await page.waitForFunction(()=>document.querySelector(".leaflet-popup"));
  assert.deepEqual(errors,[]);
});
async function reload(page) {
  await action(page,"reload").click();
  await page.waitForFunction(()=>{const s=[...nlbInstances.values()][0];return s&&!s.loading});
}
test("reload states distinguish stale failure partial response and valid empty", async t => {
  const {page,errors}=await openApp(t,fixture,{respond:async(route,n)=>{
    if(n===2) return route.fulfill({status:503,body:"unavailable"});
    if(n===3) return route.fulfill({json:{total:99,records:fixture}});
    if(n===4) return route.fulfill({json:[]});
    return route.fulfill({json:fixture});
  }});
  const initial=await snapshot(page);
  await reload(page);
  let s=await snapshot(page);
  assert.equal(s.count,7); assert.equal(s.lastFetch,initial.lastFetch);
  assert.match(await page.locator('[id^="nlb-alert-"]').innerText(),/Aktualisierung fehlgeschlagen.*letzter erfolgreicher Abruf/is);
  await reload(page); s=await snapshot(page);
  assert.equal(s.count,7); assert.equal(s.lastFetch,initial.lastFetch);
  assert.match(await page.locator('[id^="nlb-alert-"]').innerText(),/Ausschnitt/);
  await reload(page); s=await snapshot(page);
  assert.equal(s.count,0); assert.notEqual(s.lastFetch,initial.lastFetch);
  assert.match(await page.locator('[id^="nlb-alert-"]').innerText(),/Keine Standorte/);
  await reload(page); assert.equal((await snapshot(page)).count,7);
  assert.deepEqual(errors,[]);
});
test("reload reconciles vanished filters but keeps selection and sorting", async t => {
  const changed=[{...fixture[0],id:"NEW",name:"Neue Unterkunft",stadtteil:"Süd",typ:"Neuer Typ"}];
  const {page,errors}=await openApp(t,fixture,{respond:(r,n)=>r.fulfill({json:n===1?fixture:changed})});
  await page.locator('[data-filter="stadtteil"]').selectOption("Mitte");
  await page.locator('[data-filter="typ"]').selectOption("Notunterkunft");
  await action(page,"active").click();
  await page.locator('[data-sort="name"]').click(); await page.locator('[data-sort="name"]').click();
  await reload(page);
  assert.equal((await snapshot(page)).selection,"active");assert.equal((await snapshot(page)).count,1);
  assert.equal(await page.locator('[data-filter="stadtteil"]').inputValue(),"");
  assert.equal(await page.locator('[data-filter="typ"]').inputValue(),"");
  assert.equal(await page.evaluate(()=>[...nlbInstances.values()][0].sortDirection),"desc");
  assert.match(await page.locator('[id^="nlb-alert-"]').innerText(),/aufgehoben.*Typ.*Stadtteil|aufgehoben.*Stadtteil.*Typ/);
  assert.deepEqual(errors,[]);
});
test("source-empty initial failure leaves a retry path without zero facts", async t => {
  const {page,errors}=await openApp(t,fixture,{ready:false,respond:(r,n)=>n===1?r.fulfill({status:500,body:"failed"}):r.fulfill({json:fixture})});
  await page.waitForFunction(()=>{const s=[...nlbInstances.values()][0];return s&&!s.loading});
  assert.equal(await action(page,"reload").count(),1);
  assert.equal(await page.locator(".nlb-kpi strong").first().innerText(),"—");
  await reload(page); assert.equal((await snapshot(page)).count,7);
  assert.deepEqual(errors,[]);
});
test("late response after page leave cannot revive the old app", async t => {
  let release;
  const gate=new Promise(r=>{release=r}); t.after(()=>release());
  const {page,errors}=await openApp(t,fixture,{ready:false,respond:async(r,n)=>{
    if(n===1) await gate;
    await r.fulfill({json:n===1?[fixture[0]]:fixture}).catch(()=>{});
  }});
  await page.waitForFunction(()=>[...nlbInstances.values()][0]?.loading===true);
  await page.evaluate(()=>location.hash="#kontakt"); await page.waitForFunction(()=>!document.querySelector(".nlb-app"));
  release();
  await page.evaluate(()=>location.hash="#startseite");
  await page.waitForFunction(()=>[...nlbInstances.values()][0]?.hasSuccessfulLoad);
  assert.equal((await snapshot(page)).count,7); assert.deepEqual(errors,[]);
});
test("reload is single flight and re-app removes prior root listeners", async t => {
  let release;
  const gate=new Promise(r=>{release=r});t.after(()=>release());
  const {page,errors,calls}=await openApp(t,fixture,{respond:async(r,n)=>{
    if(n===2) await gate;
    await r.fulfill({json:fixture}).catch(()=>{});
  }});
  await action(page,"reload").click();
  await page.waitForFunction(()=>[...nlbInstances.values()][0].loading);
  assert.equal(await action(page,"reload").isDisabled(),true);
  await action(page,"reload").evaluate(e=>e.click());
  assert.equal(calls(),2);
  release(); await page.waitForFunction(()=>![...nlbInstances.values()][0].loading);
  await page.evaluate(()=>app(configData,document.querySelector("#main-content")));
  await page.waitForFunction(()=>[...nlbInstances.values()][0]?.hasSuccessfulLoad);
  await reload(page);
  assert.equal(calls(),4);
  assert.equal(await page.evaluate(()=>nlbInstances.size),1);
  assert.deepEqual(errors,[]);
});
test("reenter after failed libraries does not wait for an already failed script", async t => {
  const {page,errors}=await openApp(t,fixture,{block:["/leaflet.js","chart.umd.min.js"]});
  await page.evaluate(()=>location.hash="#kontakt");
  await page.waitForFunction(()=>!document.querySelector(".nlb-app"));
  await page.evaluate(()=>location.hash="#startseite");
  await page.waitForFunction(()=>[...nlbInstances.values()][0]?.hasSuccessfulLoad);
  assert.equal((await snapshot(page)).count,7); assert.deepEqual(errors,[]);
});
test("reload restores details only by an unambiguous source ID", async t => {
  let changed=[fixture[1],{...fixture[0],hinweis:"Aktualisierter Hinweis"}];
  const {page,errors}=await openApp(t,fixture,{respond:(r,n)=>r.fulfill({json:n===1?fixture:changed})});
  await action(page,"details").filter({hasText:fixture[0].name}).click();await page.locator(".nlb-details.show").waitFor();
  await page.evaluate(()=>refreshEmergencyDashboard([...nlbInstances.values()][0]));
  assert.match(await page.locator(".nlb-details-body").innerText(),/Aktualisierter Hinweis/);
  changed=[{...fixture[0],id:"duplicate"},{...fixture[0],id:"duplicate"}];
  await page.evaluate(()=>refreshEmergencyDashboard([...nlbInstances.values()][0]));
  await page.waitForFunction(()=>!document.querySelector(".nlb-details.show"));
  assert.equal(await page.evaluate(()=>[...nlbInstances.values()][0].selectedRecordKey),null);
  assert.deepEqual(errors,[]);
});
test("single-type capacity distinguishes no active sites from measured zero and unknown", async t => {
  for (const [record,want] of [
    [{...fixture[0],status:"offline"},"Keine aktiven Standorte"],
    [{...fixture[0],kapazitaet_verfuegbar:0},"0"],
    [{...fixture[0],kapazitaet_verfuegbar:null},"Unbekannt"]
  ]) {
    const {page}=await openApp(t,[record]);
    assert.equal(await page.locator('[id^="nlb-kpi-capacity-"]').innerText(),want);
  }
  const {page}=await openApp(t,[fixture[4]]);
  assert.match(await page.locator('[id^="nlb-quality-"]').innerText(),/Status unbekannt: 1/);
});
test("source links follow configuration even on direct description entry", async t => {
  const config={urlDaten:"https://zweite.example/dataset/standorte",apiurls:[{name:"standorte",url:"https://andere.example/standorte.json"}]};
  const {page,errors}=await openApp(t,fixture,{hash:"#beschreibung",config});
  const links=page.locator(".nlb-source-links a");
  assert.deepEqual(await links.evaluateAll(es=>es.map(e=>e.href)),[
    "https://zweite.example/","https://zweite.example/dataset/standorte","https://andere.example/standorte.json"]);
  assert.match(await page.locator("#main-content").innerText(),/Methodik/);
  assert.equal(await page.locator('#main-content a[href*="open-data-musterstadt"]').count(),0);
  assert.equal(await page.locator('#main-content a[href=""]').count(),0);
  await page.evaluate(()=>location.hash="#startseite");
  await page.waitForFunction(()=>[...nlbInstances.values()][0]?.hasSuccessfulLoad);
  assert.equal(await page.locator(".nlb-methodik .nlb-source-links a").count(),3);
  assert.deepEqual(errors,[]);
});
test("source links omit missing levels without destroying editorial description", async t => {
  const {page}=await openApp(t,[],{hash:"#beschreibung",config:{
    urlDaten:"",apiurls:[],beschreibung:"<p>Redaktioneller Einführungstext.</p><h2>Methodik</h2><p>Eigene Methodik.</p>"
  }});
  assert.match(await page.locator("#main-content").innerText(),/Redaktioneller Einführungstext.*Eigene Methodik/s);
  assert.equal(await page.locator(".nlb-source-links a").count(),0);
  assert.equal(await page.locator('#main-content a[href=""]').count(),0);
});
test("table keeps type words legible and confines horizontal scrolling", async t => {
  const {page}=await openApp(t,[{...fixture[0],name:"Notunterkunft Pliensauvorstadt 1",stadtteil:"Pliensauvorstadt",betreiber:"Technisches Hilfswerk",hinweis:"Zugang über Nordseite, Schlüssel im Stabsraum hinterlegt"}]);
  const lines=await page.locator('tbody tr td:nth-child(2)').first().evaluate(e=>{const r=document.createRange();r.selectNodeContents(e);return r.getClientRects().length});
  assert.equal(lines,1);
  await page.setViewportSize({width:375,height:812});
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  assert.ok(await page.locator(".table-responsive").evaluate(e=>e.scrollWidth>e.clientWidth));
});
test("marker source text cannot execute", async t => {
  const {page, errors} = await openApp(t,[{id:"X",name:"Prüfstandort",typ:"Notunterkunft",lat:48.7,lon:9.3,status:'"><img/src="x"/onerror="window.nlb_xss=1">'}]);
  assert.equal(await page.evaluate(()=>window.nlb_xss),undefined);
  assert.equal(await page.locator(".leaflet-marker-pane img, .leaflet-marker-pane svg").count(),0);
  assert.deepEqual(errors,[]);
});
