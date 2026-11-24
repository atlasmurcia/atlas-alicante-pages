const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {chromium}=require('playwright');
const html=fs.readFileSync(new URL('../modules/agenda.html',`file://${__filename}`),'utf8');
function sourceBetween(start,end){const a=html.indexOf(start),b=html.indexOf(end,a);assert(a>=0&&b>a,`source section ${start}`);return html.slice(a,b)}
const functions=sourceBetween('function calendarReservationMetrics','function shortPatient')+
 sourceBetween('function shortPatient','function mergeIntervals');
const mins=value=>{const [h,m]=String(value).split(':').map(Number);return h*60+m};
const context={
 professionals:['Fisio'],mins,normalizeSearch:value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase(),
 appointmentStartSlot(a){return Math.floor(mins(a.time)/15)*15},
 appointmentTherapists(a){return a.professionals||[]},
 professionalDuration(a){return a.therapy==='Tracción'?5:Number(a.professional_minutes||a.duration||0)},
 professionalReservationLabel:s=>s==='Tracción'?'Poner tracción':s,
 effectiveStatus:a=>a.status||'Pendiente',patientInvoiceClassForAppointment:()=>'',shortPatient:s=>s,
 hesc:s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
 patientByCode:()=>null,window:{atlasPumpPlanning:{label:()=>''}}
};
vm.runInNewContext(functions,context);
const traction={id:'synthetic',patient:'Paciente de prueba',patientCode:'TEST',date:'2026-12-01',time:'11:15',duration:30,therapy:'Tracción',services:['Tracción'],status:'Pendiente',professional:'Fisio',professionals:['Fisio'],therapists:{'Tracción':'Fisio'},resources:['Fisio','Traccion']};
const therapistHtml=context.professionalHoldHtml(traction,'Fisio');
const equipmentHtml=context.apptHtml(traction,false,'Traccion');
assert.match(therapistHtml,/height:8px/,'the therapist block represents 5 minutes at agenda scale');
assert.match(therapistHtml,/5m/,'the therapist block visibly shows its own reservation');
assert.match(equipmentHtml,/height:60px/,'the traction resource remains reserved for the full 30 minutes');
const next={...traction,id:'synthetic-next',time:'11:20',therapy:'Fisioterapia',services:['Fisioterapia'],duration:30,professional_minutes:30,therapists:{'Fisioterapia':'Fisio'}};
const firstMetrics=context.calendarReservationMetrics(traction,5),nextMetrics=context.calendarReservationMetrics(next,30);
assert(firstMetrics.top+firstMetrics.height<=nextMetrics.top,'a following therapist appointment can start after the 5-minute reservation without visual overlap');
assert.equal(therapistHtml.includes('data-id="synthetic"'),true,'real therapist reservation remains clickable');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try{
  const page=await browser.newPage();
  await page.setContent('<!doctype html><style>*{box-sizing:border-box}.cell{height:32px;width:120px;padding:3px;position:relative;overflow:visible}.appt{position:absolute;left:3px;right:3px;top:3px;padding:5px 6px;overflow:hidden}</style><div class="cell"></div>');
  await page.locator('.cell').evaluate((cell,content)=>cell.innerHTML=content,therapistHtml+context.professionalHoldHtml(next,'Fisio'));
  const rects=await page.locator('.appt').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return{top:r.top,bottom:r.bottom,height:r.height}}));
  assert.equal(rects[0].height,8);
  assert(rects[0].bottom<=rects[1].top,'the next appointment is rendered after the 5-minute block');
 }finally{await browser.close()}
 console.log('PASS agenda shows 5 minutes in the therapist column and 30 minutes on the Traction resource, with precise within-slot positioning');
})().catch(error=>{console.error(error);process.exitCode=1});
