const fs = require('node:fs');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const source = fs.readFileSync('modules/agenda.html', 'utf8');
const start = source.indexOf('async function loadCentral(anchor=currentDate');
const end = source.indexOf('\n const baseCentralRender', start);
assert.notEqual(start, -1, 'Agenda central loader exists');
assert.notEqual(end, -1, 'Agenda central loader boundary exists');
const patientScript = source.match(/<script id="atlas-central-patients-v10">([\s\S]*?)<\/script>/)?.[1] || '';
assert.match(patientScript, /window\.ATLAS_PATIENTS_READY_PROMISE=new Promise/);
assert.match(patientScript, /resolveInitialPatientLoad\?\.\(true\)/);
const loader = source.slice(start, end).trim();
assert.match(loader, /const appointmentRequest=request\('appointments:list'/);
assert.match(loader, /Promise\.all\(\[appointmentRequest,patientLoad\]\)/);

let resolvePatients;
let resolveAppointments;
let appointmentRequestStarted = false;
const patientLoad = new Promise(resolve => { resolvePatients = resolve; });
const appointmentRequest = new Promise(resolve => { resolveAppointments = resolve; });
const context = {
  Event: class Event { constructor(type) { this.type = type; } },
  console,
  moduleVisible: true,
  ready: false,
  loading: false,
  syncing: false,
  cancelling: false,
  dirtyRefs: new Set(),
  currentDate: '2026-11-17',
  addDays(date, count) { const value = new Date(`${date}T12:00:00`); value.setDate(value.getDate() + count); return value.toISOString().slice(0, 10); },
  isoStart(date) { return date; },
  tell() {},
  request(action) { assert.equal(action, 'appointments:list'); appointmentRequestStarted = true; return appointmentRequest; },
  window: { ATLAS_PATIENTS_READY_PROMISE: patientLoad, dispatchEvent() {} },
  remoteByRef: new Map(),
  appointments: [],
  fromRow(row) { return { id: row.id, centralRef: row.client_ref, patientRemoteId: row.patient_id }; },
  clientRef(row) { return row.centralRef; },
  sameAppointmentSlot() { return false; },
  toRow(row) { return { client_ref: row.centralRef }; },
  fingerprint() { return ''; },
  baseSave() {},
  render() {},
  lastCentralSignature: '',
  lastCentralRefreshAt: 0,
  loadedWindowStart: '',
  loadedWindowEnd: '',
  syncRequested: false,
  remoteRefreshPending: false,
  queueSync() {},
};
vm.createContext(context);
vm.runInContext(`${loader}\nglobalThis.runLoadCentral=loadCentral;`, context);

(async () => {
  const loading = context.runLoadCentral();
  assert.equal(appointmentRequestStarted, true, 'Appointment fetch starts before patient data resolves');
  resolveAppointments([{ id: 'synthetic-appointment', client_ref: 'synthetic-ref', patient_id: 'synthetic-patient', updated_at: '2026-11-17T10:00:00Z' }]);
  await Promise.resolve();
  assert.equal(context.ready, false, 'Agenda waits to map rows until patient data is ready');
  resolvePatients(true);
  await loading;
  assert.equal(context.ready, true, 'Agenda becomes ready after both loads finish');
  assert.equal(context.appointments[0].patientRemoteId, 'synthetic-patient');
  console.log('Synthetic agenda check passed: appointment fetch overlaps patient loading and rendering waits for patient data.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
