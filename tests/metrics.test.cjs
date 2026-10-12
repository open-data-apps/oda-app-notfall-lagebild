const assert=require("node:assert/strict");
const test=require("node:test");
const {loadApp}=require("./helpers/load-app.cjs");
const rows=require("./fixtures/standorte.json");
const c=loadApp(), now=new Date(2026,9,12,12);
const records=c.normalizeEmergencyRecords(rows,now).records;
test("scope versus selection preserves truthful KPI previews",()=>{
 const all=c.buildEmergencyView(records,{},"",now), d=c.buildEmergencyView(records,{},"disrupted",now);
 assert.equal(all.metrics.activeLocations,2); assert.equal(d.filteredRecords.length,3);
 assert.equal(d.metrics.activeLocations,2); assert.equal(d.actionCounts.active,2); assert.equal(d.actionCounts.capacity,1);
 assert.equal(c.buildEmergencyView(records,{stadtteil:"Mitte"},"disrupted",now).filteredRecords.length,1);
});
test("stable district baseline ignores search and type restrictions",()=>{
 for(const f of [{},{typ:"AED"},{search:"geschlossen"}]) {
  const v=c.buildEmergencyView(records,f,"disrupted",now); assert.equal(v.metrics.districtCount,1); assert.deepEqual(Array.from(v.districts),["Nord"]);
 }
 assert.equal(c.buildEmergencyView(records,{typ:"AED"},"districts",now).filteredRecords.length,0);
 assert.equal(c.buildEmergencyView(records,{stadtteil:"Mitte"},"",now).metrics.districtCount,0);
 assert.equal(c.findEmergencyDistrictsWithoutActive(c.normalizeEmergencyRecords([{name:"Unassigned",status:"offline"}],now).records).size,0);
});
test("capacity by type and status excludes unavailable and unspecified disturbance",()=>{
 const m=c.buildEmergencyView(records,{},"",now).metrics;
 const shelter=m.capacityByType.find(x=>x.typ==="Notunterkunft");
 assert.equal(shelter.active.sum,8); assert.equal(shelter.restricted.sum,3);
 assert.equal(m.capacityByType.find(x=>x.typ==="Anlaufstelle").planned.sum,5);
 assert.equal(m.capacityByType.find(x=>x.typ==="AED").active.sum,0);
 const incomplete=c.normalizeEmergencyRecords([{name:"A",typ:"T",status:"aktiv"},{name:"B",typ:"T",status:"aktiv",kapazitaet_verfuegbar:0}],now).records;
 let bucket=c.buildEmergencyView(incomplete,{},"",now).metrics.capacityByType[0].active;
 assert.equal(bucket.sum,0); assert.equal(bucket.knownCount,1); assert.equal(bucket.unknownCount,1);
 bucket=c.buildEmergencyView(incomplete.slice(0,1),{},"",now).metrics.capacityByType[0].active;
 assert.equal(bucket.sum,null);
});
test("calendar threshold uses more than 180 actual calendar days",()=>{
 for(const [date,age] of [["2026-04-16",179],["2026-04-15",180],["2026-04-14",181]]) assert.equal(c.getEmergencyCheckAgeDays(date,now),age);
 assert.equal(c.buildEmergencyView(records,{},"old-check",now).filteredRecords.length,1);
 assert.equal(c.buildEmergencyView(records,{},"",now).metrics.unknownChecks,4);
 assert.equal(c.getEmergencyCheckAgeDays("2026-03-28",new Date(2026,2,30,12)),2);
 assert.equal(c.getEmergencyCheckAgeDays("2026-10-24",new Date(2026,9,26,12)),2);
});
test("unknown filters do not match explicit no or zero",()=>{
 assert.equal(c.filterEmergencyAreaRecords(records,{barrierefrei:"nein"}).length,1);
 assert.equal(c.filterEmergencyAreaRecords(records,{barrierefrei:"__unknown__"}).length,5);
 assert.equal(c.buildEmergencyView(records,{},"unknown",now).filteredRecords.length,1);
 assert.equal(c.buildEmergencyView(records,{},"unspecified",now).filteredRecords.length,1);
});
test("unknown grouping keys are treated as source labels not object prototypes",()=>{
 const rs=c.normalizeEmergencyRecords([{name:"A",typ:"__proto__",stadtteil:"constructor",status:"offline"},{name:"B",typ:"constructor",stadtteil:"__proto__",status:"aktiv",kapazitaet_verfuegbar:4}],now).records;
 const v=c.buildEmergencyView(rs,{},"",now); assert.equal(v.metrics.capacityByType.length,2);assert.deepEqual(Array.from(v.districts),["constructor"]);
});
test("date-only display does not shift a calendar day across time zones",()=>{ assert.equal(c.formatDate("2026-10-12"),"12.10.2026"); });
test("sorting retains real zero and keeps unknown last in both directions",()=>{
 const rs=[{id:"u",kapazitaet_verfuegbar:null},{id:"z",kapazitaet_verfuegbar:0},{id:"t",kapazitaet_verfuegbar:10}];
 assert.equal(c.sortEmergencyRecords(rs,"kapazitaet_verfuegbar","asc").map(r=>r.id).join(","),"z,t,u");
 assert.equal(c.sortEmergencyRecords(rs,"kapazitaet_verfuegbar","desc").map(r=>r.id).join(","),"t,z,u");
});
