const assert = require("node:assert/strict");
const test = require("node:test");
const { loadApp } = require("./helpers/load-app.cjs");
const c = loadApp();
const now = new Date(2026,9,12,12);
test("source URLs allow complete files without CKAN download paths", () => {
  for (const url of ["https://fixture.test/standorte.json","https://fixture.test/data.csv?download=1"]) assert.equal(c.validateEmergencySourceUrl(url),null);
  for (const url of ["","{{missing}}","javascript:alert(1)","file:///tmp/a","https://fixture.test/api/3/action/datastore_search?resource_id=x"]) assert.ok(c.validateEmergencySourceUrl(url),url);
});
test("six JSON envelopes preserve the complete list", async () => {
  const rows = [{id:"A",name:"Ort"}];
  for (const body of [rows,{records:rows},{results:rows},{data:rows},{result:{records:rows}},{result:{results:rows}}]) {
    const data = await c.parseEmergencyData(JSON.stringify(body)); assert.equal(data.rows[0].id,"A"); assert.equal(data.rejectedRows,0);
  }
});
test("empty lists differ from empty or broken responses", async () => {
  assert.equal((await c.parseEmergencyData("[]")).rows.length,0);
  for (const body of [" ","null","4",'"hello"',"true","<html>failed</html>",'{"unexpected":true}','{"success":false,"records":[]}']) await assert.rejects(c.parseEmergencyData(body),undefined,body);
});
test("partial response metadata rejects incomplete snapshots", async () => {
  for (const body of [{records:[],total:20},{result:{total_count:4,records:[]}},{data:[{name:"A"}],next:"?page=2"},{result:{records:[]},total:10}]) await assert.rejects(c.parseEmergencyData(JSON.stringify(body)),/Ausschnitt/);
  assert.equal((await c.parseEmergencyData('{"total":1,"records":[{"name":"A"}]}')).rows.length,1);
});
test("CSV quoting, BOM and CRLF preserve actual values", async () => {
  for (const delim of [",",";"]) {
    const body = '\uFEFFid'+delim+'name'+delim+'hinweis\r\nA'+delim+'"Ort, Nord"'+delim+'"Zeile 1\nZeile ""2"""';
    const d = await c.parseEmergencyData(body); assert.equal(d.rows.length,1); assert.equal(d.rows[0].name,"Ort, Nord"); assert.equal(d.rows[0].hinweis,'Zeile 1\nZeile "2"');
  }
  assert.equal((await c.parseEmergencyData("id;name\n")).rows.length,0);
  await assert.rejects(c.parseEmergencyData("error;message\n500;failed"));
  await assert.rejects(c.parseEmergencyData('id,name\nA,"unclosed'));
  const partial = await c.parseEmergencyData("id;name\nA;Ort\nB;Ort;extra");
  assert.equal(partial.rows.length,1); assert.equal(partial.rejectedRows,1);
});
test("invalid rows are counted while usable sparse records survive", () => {
  const d = c.normalizeEmergencyRecords([null,42,[],{}, {other:"text"}, {id:"A"}, {name:"B"}],now);
  assert.equal(d.quality.total,7); assert.equal(d.quality.usable,2); assert.equal(d.quality.discarded,5);
  assert.match(d.records[0].name,/A/); assert.equal(d.records[1]._sourceId,null);
  assert.equal(c.normalizeEmergencyRecords([],now).records.length,0);
  assert.throws(()=>c.normalizeEmergencyRecords([null,{}],now),/auswertbaren/);
});
test("unknown values are not invented status priority or boolean facts", () => {
  const r = c.normalizeEmergencyRecord({name:"Ort"},0,now);
  assert.equal(r.status,"unbekannt"); assert.equal(r.prioritaet,null); assert.equal(r.barrierefrei,null); assert.equal(r.stromversorgung_notstrom,null); assert.equal(r.kapazitaet_verfuegbar,null);
  assert.equal(c.formatBoolean(null),"Unbekannt"); assert.equal(c.formatNumber(null),"Unbekannt"); assert.equal(c.formatBoolean(false),"Nein"); assert.equal(c.formatNumber(0),"0");
});
test("true false and source aliases survive without truthy coercion", () => {
  for (const value of [true,"ja","TRUE","1",1,"vorhanden"]) assert.equal(c.normalizeEmergencyRecord({name:"A",accessible:value}).barrierefrei,true);
  for (const value of [false,"nein","FALSE","0",0,"no"]) assert.equal(c.normalizeEmergencyRecord({name:"A",accessible:value}).barrierefrei,false);
  for (const value of ["?",[],{},null]) assert.equal(c.normalizeEmergencyRecord({name:"A",accessible:value}).barrierefrei,null);
  const r = c.normalizeEmergencyRecord({kennung:0,title:"Name",latitude:"48,7",longitude:"9,3",zustand:"Störung",priority:"high"});
  assert.equal(r._sourceId,"0"); assert.equal(r.lat,48.7); assert.equal(r.status,"stoerung"); assert.equal(r.prioritaet,"hoch");
});
test("capacity keeps actual zero and rejects invalid or contradictory quantities", () => {
  for (const v of [-1,1.5,true,false,"many",{},[]]) assert.equal(c.normalizeEmergencyRecord({name:"A",kapazitaet_verfuegbar:v}).kapazitaet_verfuegbar,null,String(v));
  for (const v of [0,"0"]) assert.equal(c.normalizeEmergencyRecord({name:"A",kapazitaet_verfuegbar:v}).kapazitaet_verfuegbar,0);
  const r=c.normalizeEmergencyRecord({name:"A",kapazitaet_max:2,kapazitaet_verfuegbar:3});
  assert.equal(r.kapazitaet_verfuegbar,null); assert.ok(r._issues.some(i=>i.field==="kapazitaet_verfuegbar"&&i.reason==="invalid"));
});
test("duplicate identities retain both distinct records", () => {
  const d=c.normalizeEmergencyRecords([{id:"A",name:"One"},{id:"A",name:"Two"},{id:0,name:"Zero"}],now);
  assert.equal(d.quality.duplicateIds,2); assert.equal(new Set(d.records.map(r=>r._key)).size,3); assert.equal(d.records[2]._sourceId,"0");
});
test("coordinate bounds include legitimate zeros and exclude missing pairs", () => {
  for(const p of [{lat:0,lon:0},{lat:-90,lon:-180},{lat:90,lon:180}]) assert.equal(c.hasEmergencyCoordinates(c.normalizeEmergencyRecord({name:"A",...p})),true);
  for(const p of [{},{lat:91,lon:181},{lat:48.7},{lat:[],lon:9}]) assert.equal(c.hasEmergencyCoordinates(c.normalizeEmergencyRecord({name:"A",...p})),false);
  assert.equal(c.normalizeEmergencyRecords([{name:"A"},{name:"B",lat:0,lon:0}],now).quality.unmapped,1);
});
test("malformed scalar fields cannot abort otherwise usable records",()=>{
 const malformed=JSON.parse('{"toString":null,"valueOf":null}');
 const d=c.normalizeEmergencyRecords([{name:"Good",status:"aktiv"},{name:"Bad fields",status:malformed,stadtteil:malformed,prioritaet:malformed,barrierefrei:malformed,wasser_verfuegbar:[]}],now);
 assert.equal(d.records.length,2);assert.equal(d.records[1].status,"unbekannt");
 assert.equal(d.records[1].stadtteil,null);assert.equal(d.records[1].barrierefrei,null);
 assert.ok(d.records[1]._issues.some(i=>i.field==="wasser_verfuegbar"&&i.reason==="invalid"));
});
test("strict calendar dates never roll over or treat future as fresh", () => {
  for(const d of ["2026-02-30","2026-13-01","12.10.2026","2026-10-13","",null]) {
    assert.equal(c.getEmergencyCheckAgeDays(d,now),null,String(d));
    assert.equal(c.normalizeEmergencyRecord({name:"A",letzte_pruefung:d},0,now).letzte_pruefung,null);
  }
  assert.equal(c.getEmergencyCheckAgeDays("2024-02-29",new Date(2024,2,1,12)),1);
  assert.equal(c.getEmergencyCheckAgeDays("2026-10-12",now),0);
});
