const assert=require('node:assert/strict');
const {calculateActuals,calculateCompletedActivity,resolveTargets}=require('../modules/team-goals-parent.js');

const periods=['2026-11','2026-12'];
const actuals=calculateActuals({
  periods,
  invoices:[
    {issue_date:'2026-11-05',total:70000,status:'issued',original_invoice_id:null},
    {issue_date:'2026-11-20',total:2000,status:'issued',original_invoice_id:'original'}
  ],
  budgets:[{id:'b1',total:1000,created_at:'2026-11-01'}],
  lines:[
    {budget_id:'b1',service_name:'MBST OSTEOSPIN',sessions:250,metadata:{}},
    {budget_id:'b1',service_name:'Bomba Diamagnética',sessions:100,metadata:{}}
  ],
  payments:[
    {id:'p1',budget_id:'b1',amount:400,status:'completed',paid_at:'2026-11-10',deleted_at:null},
    {id:'p2',budget_id:'b1',amount:600,status:'cancelled',paid_at:'2026-11-28',cancelled_at:'2026-12-03',deleted_at:null}
  ],
  services:[
    {name:'MBST OSTEOSPIN',category:'MBST'},
    {name:'Bomba Diamagnética',category:'BOMBA DIAMAGNETICA'}
  ]
});

assert.equal(actuals['2026-11'].team_net_invoicing,68000);
assert.equal(actuals['2026-11'].team_mbst_paid_sessions,250);
assert.equal(actuals['2026-11'].team_bomba_paid_sessions,100);
assert.equal(actuals['2026-12'].team_mbst_paid_sessions,-250);
assert.equal(actuals['2026-12'].team_bomba_paid_sessions,-100);

const completed=calculateCompletedActivity({periods,appointments:[
  {status:'completed',starts_at:'2026-11-03T10:00:00Z',services:['Tracción'],resources:[],metadata:{}},
  {status:'completed',starts_at:'2026-11-04T10:00:00Z',services:['MBST OSTEOSPIN'],resources:[],metadata:{}},
  {status:'completed',starts_at:'2026-11-05T10:00:00Z',services:[],resources:['Bomba Diamagnética'],metadata:{}},
  {status:'pending',starts_at:'2026-11-06T10:00:00Z',services:['Tracción'],resources:[],metadata:{}}
]});
assert.equal(completed['2026-11'].team_traction_paid_sessions,1);
assert.equal(completed['2026-11'].team_mbst_paid_sessions,1);
assert.equal(completed['2026-11'].team_bomba_paid_sessions,1);

const targets=resolveTargets({periods,actuals,rows:[
  {period:'2026-11-01',metric:'team_net_invoicing',target_value:65000,notes:'{"active":true,"step":5000}'},
  {period:'2026-11-01',metric:'team_mbst_paid_sessions',target_value:250,notes:'{"active":true,"step":10}'},
  {period:'2026-11-01',metric:'team_bomba_paid_sessions',target_value:100,notes:'{"active":true,"step":10}'},
  {period:'2026-11-01',metric:'team_traction_paid_sessions',target_value:110,notes:'{"active":true,"step":10}'},
  {period:'2026-11-01',metric:'team_brains_paid_sessions',target_value:0,notes:'{"active":false,"step":10}'}
]});

assert.equal(targets['2026-12'].team_net_invoicing.target,73000);
assert.equal(targets['2026-12'].team_mbst_paid_sessions.target,260);
assert.equal(targets['2026-12'].team_bomba_paid_sessions.target,110);
assert.equal(targets['2026-12'].team_traction_paid_sessions.target,110);
assert.equal(targets['2026-12'].team_brains_paid_sessions.active,false);

console.log('team goals core: ok');
