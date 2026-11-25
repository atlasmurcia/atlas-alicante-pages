const assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require(process.env.ATLAS_JSDOM_MODULE||'jsdom');
const source=fs.readFileSync('modules/agenda.html','utf8');
const script=id=>{const block=source.match(new RegExp('<script id="'+id+'">([\\s\\S]*?)</script>'));assert.ok(block,id);return block[1];};
function scenario(name,existing,personal=true){
 const dom=new JSDOM('<html><body><button id="clockNav">Fichar</button><button id="configurationNav">Configuración</button><div id="cfgBody"><select id="attendanceFilter"><option value="">Todos</option></select><select id="atEmployee"></select><select id="abEmployee"></select></div><h2 id="cfgTitle">Control asistencial</h2></body></html>',{url:'https://synthetic.invalid',runScripts:'outside-only'}),w=dom.window;
 let count=0;const observers=[];w.MutationObserver=class{constructor(callback){this.callback=callback}observe(){observers.push(this)}disconnect(){}};
 // Drive observer rounds explicitly so the old add/remove loop fails instead of hanging the test process.
 w.queueMicrotask=callback=>callback();w.setTimeout=()=>0;w.parent.postMessage=()=>{};
 w.employeeRows=()=>existing.map(name=>({name,active:true}));w.openAtlasAttendance=()=>{};w.ATLAS_CHILD_CENTRAL_CONTEXT={profileName:name};
 w.eval(script('atlas-v136-attendance-complete-roster'));w.eval(script('atlas-v136-personal-clock'));
 w.dispatchEvent(new w.MessageEvent('message',{data:{type:'atlas:central-ready',profileName:name,role:'reception',permissions:{}}}));
 if(personal)w.document.getElementById('clockNav').click();
 // A select's option values before/after each observer is sufficient to detect the cycle.
 let stable=false;
 for(let round=0;round<20;round++){
  let changes=0;
  for(const observer of observers){const before=w.document.getElementById('cfgBody').innerHTML;observer.callback([]);const after=w.document.getElementById('cfgBody').innerHTML;if(before!==after)changes++;}
  count+=changes;if(changes===0){stable=true;break;}
 }
 assert.ok(stable,`Roster observers must settle for ${name}; ${count} repeated DOM updates`);
 for(const id of ['attendanceFilter','atEmployee','abEmployee']){
  const select=w.document.getElementById(id);
  if(personal){assert.deepEqual([...select.options].map(o=>o.value),[name],id+' only authenticated identity');assert.ok(select.disabled,id+' cannot select another employee');}
  else assert.ok(select.options.length>1,'Management roster remains available');
 }
 // Exercise the actual entry/exit form with a synthetic central-save boundary.
 if(personal){
  const start=source.indexOf(' function attendanceEntryForm(mode)'),end=source.indexOf(' function attendanceAbsenceForm()',start);
  assert.ok(start>=0&&end>start);w.body=w.document.getElementById('cfgBody');
  w.others={attendance:{entries:[{id:'other-record',employee:'Otra persona',entryAt:'2026-11-18T08:00:00',exitAt:''}],requirePhoto:false}};
  w.esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
  w.otherView=()=>{};const saved=[];w.atlasSaveAttendance=()=>saved.push(JSON.parse(JSON.stringify(w.others.attendance)));
  w.atlasAlicanteAttendanceNow=()=>saved.length?'2026-11-18T22:00:00':'2026-11-18T14:30:00';
  const alerts=[];w.alert=message=>alerts.push(message);w.eval(source.slice(start,end));
  w.attendanceEntryForm('entry');observers.forEach(o=>o.callback([]));
  assert.deepEqual([...w.document.getElementById('atEmployee').options].map(o=>o.value),[name]);
  w.document.getElementById('saveAttendanceEntry').click();assert.equal(saved.length,1);assert.equal(alerts.length,0);
  assert.equal(saved[0].entries[1].employee,name);assert.equal(saved[0].entries[1].selfClock,true);
  w.attendanceEntryForm('exit');observers.forEach(o=>o.callback([]));w.document.getElementById('saveAttendanceEntry').click();
  assert.equal(saved.length,2);assert.equal(saved[1].entries[1].exitAt,'2026-11-18T22:00:00');assert.equal(saved[1].entries[0].exitAt,'','Other employee untouched');
 }
 // A fresh form inserted later must converge as well.
 const field=w.document.getElementById('atEmployee');field.innerHTML='<option>Otra persona</option>';
 if(personal){for(let round=0;round<3;round++)observers.forEach(o=>o.callback([]));assert.deepEqual([...field.options].map(o=>o.value),[name]);}
 dom.window.close();
}
scenario('Trabajadora Nueva Apellido',[]);
scenario('Empleado Conocido',['Empleado Conocido']);
scenario('Recepción Incorporación Reciente',['Persona anterior']);
scenario('Gestión Prueba',['Persona anterior'],false);
console.log('Passed: dynamic authenticated employee, known employee, reopened forms, own-profile restriction, roster observers settle, management list retained.');
