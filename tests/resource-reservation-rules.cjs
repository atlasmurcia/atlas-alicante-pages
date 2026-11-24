const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const html=fs.readFileSync(new URL('../modules/agenda.html',`file://${__filename}`),'utf8');
const match=html.match(/<script id="atlas-resource-reservation-rules-v227">([\s\S]*?)<\/script>/);
assert(match,'protected resource rules script exists');

const normalizeSearch=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const professionals=['Fisioterapeuta'];
const resources=['Traccion','Bomba Diamagnética'];
const equipment=[...resources];
const context={
 normalizeSearch,professionals,resources,equipment,
 therapyDurations:{},therapyProfessionalDurations:{},therapiesWithoutProfessional:new Set(),
 therapyCompetencyRequirement:{},alicanteTherapyProfessionals:{},alicanteTherapyResources:{},equipmentTherapyOptions:{},
 applyRuntimeSettings(){},
 professionalDuration(a){return a.professional?Number(a.duration||0):0},
 professionalReservationLabel(){return 'legacy'},
 appointmentTherapists(a){return a.professionals||[]},
 planAppointmentPool(){return this.pool||[]},
 conflictsInSet(a,rows,ignoreId=null){
  const overlaps=(startA,durA,startB,durB)=>startA<startB+durB&&startB<startA+durA;
  return rows.filter(b=>b.id!==ignoreId&&b.date===a.date&&(
   (a.resources||[]).some(r=>(b.resources||[]).includes(r))&&overlaps(a.time,a.duration,b.time,b.duration)||
   (a.professionals||[]).some(p=>(b.professionals||[]).includes(p))&&this.professionalDuration(a)>0&&this.professionalDuration(b)>0&&overlaps(a.time,this.professionalDuration(a),b.time,this.professionalDuration(b))
  ));
 },window:{}
};
context.window=context;
vm.runInNewContext(match[1],context);

const old={id:'old-camilla',date:'2026-12-09',time:'12:45',duration:15,therapy:'Camilla FD',services:['Camilla FD'],resource:'Fisioterapeuta',resources:['Fisioterapeuta'],professional:'Fisioterapeuta',professionals:['Fisioterapeuta'],professional_minutes:0};
context.pool=[old];
const checked=context.planAppointmentPool([],old.date)[0];
assert(checked.resources.includes('Traccion'),'legacy camilla reserves the shared equipment in checks');
assert.equal(checked.professional_minutes,15,'legacy camilla reserves the therapist for 15 minutes');
assert.equal(old.resources.includes('Traccion'),false,'the saved appointment object is not mutated');
assert.equal(old.professional_minutes,0,'saved appointment metadata is not rewritten');
const traction={id:'new-traction',date:old.date,time:old.time,duration:30,therapy:'Tracción',services:['Tracción'],resource:'Traccion',resources:['Traccion'],professional:'Fisioterapeuta',professionals:['Fisioterapeuta']};
assert.equal(context.conflictsInSet(traction,[old]).length,1,'conflict checks detect both machine and therapist occupancy');
assert.equal(context.professionalReservationLabel('Tracción'),'Poner tracción');
assert.equal(context.professionalReservationLabel('Bomba Diamagnética dinámica'),'Poner bomba');
assert.equal(context.ATLAS_RESOURCE_RESERVATION_RULES_V227.traction.total,30);
assert.equal(context.ATLAS_RESOURCE_RESERVATION_RULES_V227.traction.professional,5);
assert.equal(context.ATLAS_RESOURCE_RESERVATION_RULES_V227.dynamicPump.total,45);
assert.equal(context.ATLAS_RESOURCE_RESERVATION_RULES_V227.dynamicPump.professional,15);
assert.equal(context.ATLAS_RESOURCE_RESERVATION_RULES_V227.table.total,15);
assert.equal(context.ATLAS_RESOURCE_RESERVATION_RULES_V227.table.professional,15);
console.log('PASS protected rules are restored and stale booked rows reserve their canonical therapist and equipment without changing stored appointment data');
