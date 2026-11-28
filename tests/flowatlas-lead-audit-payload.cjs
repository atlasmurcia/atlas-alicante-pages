const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');

const source=fs.readFileSync('index.html','utf8');
const helper=source.match(/function mapLeadListActivity\([^\n]+/);
assert(helper,'Flow lead activity mapper exists');
const context={Map};
vm.createContext(context);
vm.runInContext(helper[0],context);

const leads=[
 {id:'lead-a',updated_by:'user-a',updated_at:'2026-11-28T10:00:00Z',metadata:{workflow:'inbound'}},
 {id:'lead-b',updated_by:'user-b',updated_at:'2026-11-28T09:00:00Z',metadata:{workflow:'inbound'}},
 {id:'lead-c',updated_by:null,updated_at:'2026-11-28T08:00:00Z',metadata:{workflow:'inbound'}}
];
const activities=[
 {lead_id:'lead-a',actor_name:'Ana',created_at:'2026-11-28T11:00:00Z'},
 {lead_id:'lead-a',actor_name:'Rubén',created_at:'2026-11-28T10:30:00Z'},
 {lead_id:'lead-c',actor_name:null,created_at:'2026-11-28T08:30:00Z'}
];
const result=context.mapLeadListActivity(leads,activities,{ 'user-a':'Perfil Ana','user-b':'Perfil Gely' });
assert.deepEqual(JSON.parse(JSON.stringify(result.map(row=>[row.last_actor_name,row.last_activity_at]))),[
 ['Ana','2026-11-28T11:00:00Z'],
 ['Perfil Gely','2026-11-28T09:00:00Z'],
 [null,'2026-11-28T08:30:00Z']
]);
assert(source.includes(".select('lead_id,actor_name:metadata->>actor_name,created_at')"),'Activity query returns only required metadata key and timestamp');
assert(!source.includes(".select('lead_id,metadata,created_at')"),'Activity query does not return full metadata objects');
assert(source.includes(".eq('organization_id',context.organizationId).eq('clinic_id',context.clinicId).order('created_at',{ascending:false}).limit(5000)"),'Activity query remains scoped to the active organization and clinic');
assert(source.includes("l.metadata?.workflow||'')!=='appointment_cancellation_rebook'"),'Appointment cancellation rebook leads remain excluded');
console.log('PASS: synthetic Flow activity attribution, timestamp fallback, latest activity, clinic scope and minimized JSON payload.');
