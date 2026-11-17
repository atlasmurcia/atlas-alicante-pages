const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const agenda = fs.readFileSync('modules/agenda.html', 'utf8');
for (const path of ['modules/agenda.html', 'index.html']) {
 for (const script of fs.readFileSync(path, 'utf8').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
  if (!/type=["']application\/json/.test(script[1])) new vm.Script(script[2]);
 }
}
new vm.Script(fs.readFileSync('appointment-duplicates.js', 'utf8'));

const start = agenda.indexOf("document.getElementById('openPatientBodyMapBtn').onclick=async function(){");
const handlerEnd = agenda.indexOf('\n};', start) + 3;
assert.ok(start >= 0 && handlerEnd > start, 'Body map handler exists');
const handler = agenda.slice(start, handlerEnd);

async function check(mode) {
 const appointment = {id: 'test-appointment', patientRemoteId: 'test-patient', patientCode: 'TEST'};
 let resolvePatient;
 const pending = new Promise(resolve => { resolvePatient = resolve; });
 const button = { disabled: false }, routes = [], alerts = [], classes = new Set(['open']);
 const context = {
  appointments: [appointment], selectedId: appointment.id,
  document: {getElementById(id) {return id === 'openPatientBodyMapBtn' ? button : {classList: {remove(value) {classes.delete(value);}}};}},
  resolvePatientForAppointment(value) {assert.equal(value, appointment); return pending;},
  async openPatientRecord(code, panel) {routes.push({code, panel});},
  alert(message) {alerts.push(message);},
 };
 vm.createContext(context);
 vm.runInContext(handler, context);
 const operation = button.onclick();
 assert.equal(button.disabled, true, 'Waits for the patient lookup');
 assert.equal(routes.length, 0, 'Does not open a map before resolving the linked patient');
 if (mode === 'changed') context.selectedId = 'another-appointment';
 resolvePatient(mode === 'missing' ? null : {code: 'TEST', remoteId: 'test-patient'});
 await operation;
 assert.equal(button.disabled, false, 'Can retry after success or failure');
 assert.deepEqual(routes, mode === 'success' ? [{code: 'TEST', panel: 'mapaCorporal'}] : []);
 assert.equal(alerts.length, mode === 'missing' ? 1 : 0);
 assert.equal(classes.has('open'), mode !== 'success', 'Only closes the correct selected appointment after resolution');
}

(async () => {
 await check('success'); await check('changed'); await check('missing');
 console.log('Synthetic body-map checks passed: delayed patient loading, selection changes, failed resolution and script syntax.');
})().catch(error => {console.error(error); process.exitCode = 1;});
