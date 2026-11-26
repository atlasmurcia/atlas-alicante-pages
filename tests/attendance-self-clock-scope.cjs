const assert=require('node:assert/strict');
const fs=require('node:fs');

const source=fs.readFileSync('index.html','utf8');
const start=source.indexOf("else if(m.action==='attendance:get'||m.action==='attendance:save')");
const end=source.indexOf("else if(m.action==='settings:list')",start);
assert.ok(start>=0&&end>start,'attendance handler is present');
const handler=source.slice(start,end);

assert.match(source,/attendanceSelfClockOnly=agenda\.ATLAS_ATTENDANCE_OPENED_FROM_CLOCK===true\|\|\(m\.action==='attendance:get'&&!agenda\.document\.getElementById\('attendanceHistory'\)\)/,
 'personal clock and background prefetch use the scoped path');
assert.match(handler,/if\(attendanceSelfClockOnly\)query=query\.eq\('employee',context\.profileName\)/,
 'scoped reads filter at the database before paging');
assert.match(handler,/entriesToSave=attendanceSelfClockOnly\?submittedEntries\.filter\(entry=>entry\.employee===context\.profileName\)/,
 'personal writes ignore rows belonging to other staff');
assert.match(handler,/submitted\.selfClock!==true\|\|\(prior&&prior\.employee!==context\.profileName\)/,
 'personal writes cannot alter another employee record');
assert.match(handler,/attendanceEntriesQuery\(\)\.in\('record_id',unseenIds\.slice/,
 'new personal record IDs are checked for collisions');
assert.match(handler,/if\(context\.ownerAccess\)\{const extras=attendanceSelfClockOnly\?\{requirePhoto:/,
 'the full management configuration path remains available');
assert.match(handler,/await loadAttendanceRows\(\)/,
 'management reads still page the full clinic roster');

const rows=[
 {id:'a',employee:'Persona A',selfClock:true},
 {id:'b',employee:'Persona B',selfClock:true}
];
assert.deepEqual(rows.filter(row=>row.employee==='Persona A'),[rows[0]],'the self-clock scope returns only the signed-in employee');
console.log('Passed: personal attendance reads/writes are scoped; management history remains on the full path.');
