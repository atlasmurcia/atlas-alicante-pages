const assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require(process.env.ATLAS_JSDOM_MODULE||'jsdom');
const source=fs.readFileSync('modules/agenda.html','utf8');
const shared=process.env.ATLAS_SHARED_SCRIPT?fs.readFileSync(process.env.ATLAS_SHARED_SCRIPT,'utf8'):source.match(/<script id="atlas-v136-shared-attendance">([\s\S]*?)<\/script>/)[1];
const start=source.indexOf(' function attendanceView(){'),end=source.indexOf(' function attendanceEntryForm(',start),view=source.slice(start,end);
const clone=value=>JSON.parse(JSON.stringify(value));
const entries=[{id:'a-morning',employee:'Persona A',entryAt:'2026-11-26T08:20:00',exitAt:'2026-11-26T09:30:00'}, {id:'a-afternoon',employee:'Persona A',entryAt:'2026-11-26T14:00:00',exitAt:''},{id:'b-morning',employee:'Persona B',entryAt:'2026-11-26T08:30:00',exitAt:'2026-11-26T09:40:00'}, {id:'b-afternoon',employee:'Persona B',entryAt:'2026-11-26T15:00:00',exitAt:''}];
const flush=async()=>{for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve))};
function fixture({personal=false,pending=false,holdGet=false}={}){
 const dom=new JSDOM('<div id="atlasAlicanteConfigBack" class="open"><h2 id="cfgTitle">Control asistencial</h2><div id="cfgSaved"></div><div id="cfgBody"></div></div>',{url:'https://synthetic.invalid',runScripts:'outside-only'}),w=dom.window,calls=[],held=[],intervals=[];
 const store={entries:clone(entries.filter(x=>x.id.endsWith('morning')).map(x=>({...x,exitAt:''}))),absences:[],footer:'',requirePhoto:false};let central=clone(entries),rejectSave=pending,timerId=0;
 w.console={warn(){},error(){}};w.setTimeout=()=>++timerId;w.clearTimeout=()=>{};w.setInterval=fn=>{intervals.push(fn);return++timerId};
 w.body=w.document.getElementById('cfgBody');w.others={attendance:store};w.employeeRows=()=>['Persona A','Persona B'].map(name=>({name,active:true}));w.esc=text=>String(text??'').replaceAll('&','&amp;').replaceAll('<','&lt;');
 for(const name of ['attendanceEntryForm','attendanceAbsenceForm','attendanceFooterForm','exportAttendance','printAttendance'])w[name]=()=>{};
 w.ATLAS_ATTENDANCE_SIGNED_NAME=personal?'Persona A':'Gestión Prueba';w.ATLAS_ATTENDANCE_OPENED_FROM_CLOCK=personal;
 w.eval(view);w.atlasAttendanceStore=()=>store;
 w.atlasShowAttendance=()=>{w.attendanceView();w.atlasRefreshAttendance?.()};w.attendanceView();
 const key='atlasAttendancePendingV2:'+w.ATLAS_ATTENDANCE_SIGNED_NAME;
 if(pending)w.localStorage.setItem(key,JSON.stringify({entries:[clone(store.entries[0])],absences:[]}));
 w.parent.postMessage=message=>{if(message.type!=='atlas:central-db-request')return;calls.push(clone(message));const self=w.ATLAS_ATTENDANCE_OPENED_FROM_CLOCK===true||!w.document.getElementById('attendanceHistory');const reply=()=>{const ok=message.action!=='attendance:save'||!rejectSave;if(ok&&message.action==='attendance:save'){for(const row of message.payload.attendance.entries){const index=central.findIndex(entry=>entry.id===row.id);if(index<0)central.push(clone(row));else central[index]=clone(row)}}const rows=self?central.filter(x=>x.employee===w.ATLAS_ATTENDANCE_SIGNED_NAME):central;w.dispatchEvent(new w.MessageEvent('message',{data:{type:'atlas:central-db-response',requestId:message.requestId,ok,error:ok?'':'Synthetic save rejection',data:ok?{payload:{entries:clone(rows),absences:[]}}:null}}))};if(holdGet&&message.action==='attendance:get')held.push(reply);else queueMicrotask(reply)};
 w.eval(shared);
 return {w,store,calls,held,intervals,key,close:()=>w.close(),setCentral:rows=>central=clone(rows),allowSave:()=>rejectSave=false};
}
(async()=>{
 // Reproduce the reported case: manager has an old pending snapshot; its write is rejected.
 const manager=fixture({pending:true});let w=manager.w;
 w.document.getElementById('attendanceFilter').value='Persona B';w.document.getElementById('attendanceTo').value='2026-11-26';w.document.getElementById('attendanceActiveOnly').checked=false;
 await w.atlasRefreshAttendance();await flush();
 assert.equal(manager.calls.filter(x=>x.action==='attendance:get').length,1,'Rejected pending save must not block central reads');
 assert.deepEqual(clone(manager.store.entries),entries);assert(w.localStorage.getItem(manager.key),'Unconfirmed pending work must remain available');
 assert.equal(w.document.getElementById('attendanceFilter').value,'Persona B');assert.equal(w.document.getElementById('attendanceTo').value,'2026-11-26');assert.equal(w.document.getElementById('attendanceActiveOnly').checked,false);
 const openRows=[...w.document.querySelectorAll('#cfgBody .cfg-grid .cfg-card:first-child tbody tr')].filter(tr=>tr.querySelector('[data-att-exit]'));
 assert.equal(openRows.length,2);assert(openRows.every(row=>/14:00|15:00/.test(row.textContent)),'Closed morning shifts disappear from current entries');
 assert(w.document.getElementById('attendanceHistory').textContent.includes('09:40'),'Management history displays the confirmed exit');
 // Focus and the existing poll must continue to read even while the same write is pending.
 const updated=clone(entries);updated[3].exitAt='2026-11-26T21:30:00';manager.setCentral(updated);w.dispatchEvent(new w.Event('focus'));await flush();assert.equal(manager.store.entries[3].exitAt,updated[3].exitAt);
 manager.intervals[0]();await flush();assert(manager.calls.filter(x=>x.action==='attendance:get').length>=3);manager.close();
 // Personal clock obtains exactly the same central values for that employee; reads do not save.
 const personal=fixture({personal:true});await personal.w.atlasRefreshAttendance();await flush();assert.deepEqual(clone(personal.store.entries),entries.filter(x=>x.employee==='Persona A'));assert(personal.calls.every(x=>x.action==='attendance:get'));personal.close();
 // Do not replace a correction form or reset its fields during a background refresh.
 const form=fixture();form.w.document.getElementById('cfgBody').innerHTML='<input id="unsavedCorrection" value="unchanged">';await form.w.atlasRefreshAttendance();await flush();assert.equal(form.w.document.getElementById('unsavedCorrection').value,'unchanged');form.close();
 // Switching from personal clock to management while a read is in flight requests the full scope again.
 const race=fixture({personal:true,holdGet:true});race.w.atlasRefreshAttendance();await flush();race.w.ATLAS_ATTENDANCE_OPENED_FROM_CLOCK=false;race.held.shift()();await flush();assert.equal(race.store.entries.length,2,'Old local cache is not replaced by a response from the previous scope');assert.equal(race.held.length,1);race.held.shift()();await flush();assert.deepEqual(clone(race.store.entries),entries);race.close();
 // An old read arriving after a confirmed save cannot restore the pre-save display.
 const saveRace=fixture({holdGet:true});saveRace.w.atlasRefreshAttendance();await flush();const fresh=clone(entries);fresh[1].exitAt='2026-11-26T22:00:00';await saveRace.w.atlasQueueAttendanceSave({entries:fresh,absences:[]});await flush();saveRace.held.shift()();await flush();assert.equal(saveRace.held.length,1,'A new read follows a concurrent save');saveRace.held.shift()();await flush();assert.equal(saveRace.store.entries[1].exitAt,fresh[1].exitAt);saveRace.close();
 console.log('PASS: rejected pending saves no longer block shared reads; actual current/history tables agree; queue/filter/form preservation; focus/poll updates; personal scope, scope races and save races.');
})().catch(error=>{console.error(error);process.exitCode=1});
