const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
let syntax=0;for(const file of ['index.html','modules/agenda.html'])for(const m of fs.readFileSync(path.join(root,file),'utf8').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi))if(!/src=/.test(m[1])&&m[2].trim()){new vm.Script(m[2],{filename:file});syntax++}
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:1000},timezoneId:'Europe/Madrid'}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{
   const u=new URL(route.request().url());if(u.origin!=='http://atlas.test')return route.abort();
   const file=path.resolve(root,'.'+u.pathname);
   if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404,body:''});
   return route.fulfill({contentType:file.endsWith('.js')?'application/javascript':'text/html',body:fs.readFileSync(file)});
  });
  await page.goto('http://atlas.test/modules/agenda.html');
  await page.evaluate(()=>{
   window.waUrls=[];window.waAlerts=[];window.waCalls=[];window.waHistory=false;window.waResolved=null;
   window.alert=text=>waAlerts.push(text);
   window.open=url=>{waUrls.push(url);return {opener:{},location:{replace(url){waUrls.push(url)},set href(url){waUrls.push(url)}},close(){waUrls.push('closed')}}};
   window.atlasCentralRequest=async(action,payload)=>{
    if(!['patients:resolve','appointments:hasPriorAttendance'].includes(action))return [];
    waCalls.push({action,payload});
    if(action==='patients:resolve'){if(waResolved instanceof Error)throw waResolved;return waResolved}
    if(waHistory instanceof Error)throw waHistory;return waHistory;
   };
   window.waPatient={remoteId:'synthetic-correct',code:'TEST-1',name:'Paciente ficticio',phone:'600000001',active:true};
   patientMaster.splice(0,patientMaster.length,{remoteId:'synthetic-other',code:'TEST-OTHER',name:'Paciente ficticio',phone:'600000002'},waPatient);
   appointments=[{id:'synthetic-appointment',patientRemoteId:waPatient.remoteId,patientCode:waPatient.code,patient:'Paciente ficticio',date:'2026-11-20',time:'08:30',start:'08:30',duration:60,therapy:'Servicio ficticio',services:['Servicio ficticio'],resource:'Profesional ficticio',resources:['Profesional ficticio'],professional:'Profesional ficticio',history:[],notes:'',status:'Pendiente'}];
   openDrawer('synthetic-appointment');
  });
  const clear=()=>page.evaluate(()=>{waUrls.length=0;waAlerts.length=0;waCalls.length=0});
  const open=async()=>{await clear();await page.evaluate(()=>window.openAppointmentWhatsapp());return page.evaluate(()=>({urls:waUrls,alerts:waAlerts,calls:waCalls}))};
  const states=['Pendiente','Confirmada','Ha llegado','Realizada','No se presentó','Cancelada'];
  for(const state of states)for(const prior of [false,true]){
   await clear();await page.evaluate(({state,prior})=>{appointments[0].status=state;waHistory=prior},{state,prior});
   await page.locator('#waAppointmentBtn').click();await page.waitForFunction(()=>waUrls.length===2);
   const r=await page.evaluate(()=>({urls:waUrls,calls:waCalls,alerts:waAlerts})),u=new URL(r.urls[1]);
   assert.equal(u.pathname,'/34600000001');assert.equal(u.searchParams.get('text'),await page.evaluate(prior=>atlasAppointmentWhatsappCopy.render(prior?'returning':'first',appointments[0],waPatient),prior));
   assert.deepEqual(r.calls,[{action:'appointments:hasPriorAttendance',payload:{patientId:'synthetic-correct',before:'2026-11-20T07:30:00.000Z'}}]);assert.deepEqual(r.alerts,[]);
  }
  // Stable ID wins over an absent code, a conflicting code and same-name patients.
  for(const code of [null,'TEST-OTHER']){
   await page.evaluate(code=>{if(code===null)delete appointments[0].patientCode;else appointments[0].patientCode=code},code);
   assert.equal(new URL((await open()).urls[1]).pathname,'/34600000001');
  }
  await page.evaluate(()=>{appointments[0].patientCode='TEST-1';delete appointments[0].patientRemoteId});
  assert.equal(new URL((await open()).urls[1]).pathname,'/34600000001');
  await page.evaluate(()=>{appointments[0].patient_id='synthetic-correct';delete appointments[0].patientCode});
  assert.equal(new URL((await open()).urls[1]).pathname,'/34600000001');
  // Missing cache: resolve strictly by ID, then query attendance for that ID.
  await page.evaluate(()=>{patientMaster.splice(1,1);waResolved={id:'synthetic-correct',patient_number:'TEST-1',first_name:'Paciente',last_name_1:'ficticio',phone:'600000003'};waHistory=true});
  let r=await open();assert.equal(new URL(r.urls[1]).pathname,'/34600000003');assert.match(new URL(r.urls[1]).searchParams.get('text'),/¡Te esperamos!/);
  assert.deepEqual(r.calls.map(x=>x.action),['patients:resolve','appointments:hasPriorAttendance']);assert.deepEqual(r.calls[0].payload,{id:'synthetic-correct'});
  await page.evaluate(()=>{waResolved={id:'synthetic-wrong',phone:'600000004'}});r=await open();assert.deepEqual(r.urls,['about:blank','closed']);assert.match(r.alerts[0],/ficha vinculada/);
  await page.evaluate(()=>{waResolved=new Error('Error sintético de ficha')});r=await open();assert.deepEqual(r.urls,['about:blank','closed']);
  // Ambiguous names never open WhatsApp; do not fall back from a missing stable ID.
  await page.evaluate(()=>{patientMaster.push(waPatient);delete appointments[0].patient_id;delete appointments[0].patientCode});r=await open();assert.deepEqual(r.urls,[]);assert.match(r.alerts[0],/inequívoca/);
  await page.evaluate(()=>{appointments[0].patientRemoteId='synthetic-correct';appointments[0].patientCode='TEST-1';waHistory=new Error('Historial no disponible')});r=await open();assert.deepEqual(r.urls,['about:blank','closed']);assert.match(r.alerts[0],/Historial no disponible/);
  await page.evaluate(()=>{waHistory=null});r=await open();assert.deepEqual(r.urls,['about:blank','closed']);assert.match(r.alerts[0],/comprobar/);
  await page.evaluate(()=>{waHistory=false;waPatient.phone='';appointments[0].phone='600000002'});r=await open();assert.deepEqual(r.urls,['about:blank','closed']);assert.match(r.alerts[0],/no tiene un teléfono/);
  await page.evaluate(()=>{waPatient.phone='600000001';appointments[0].start='hora errónea'});r=await open();assert.deepEqual(r.urls,['about:blank','closed']);assert.match(r.alerts[0],/hora de la cita no es válida/);
  await page.evaluate(()=>{appointments[0].start='08:30';waHistory=false});
  for(const [phone,expected] of [['600 000 001','34600000001'],['0034 600000001','34600000001'],['+44 7700 900123','447700900123']]){await page.evaluate(phone=>waPatient.phone=phone,phone);r=await open();assert.equal(new URL(r.urls[1]).pathname,'/'+expected)}
  // Close a reserved window if the selected appointment changes while loading.
  await clear();await page.evaluate(()=>{waPatient.phone='600000001';window.atlasCentralRequest=()=>new Promise(resolve=>window.finishWaHistory=resolve);window.waPending=window.openAppointmentWhatsapp()});
  await page.evaluate(()=>window.openAppointmentWhatsapp());assert.deepEqual(await page.evaluate(()=>waUrls),['about:blank']);
  await page.evaluate(async()=>{selectedId='another-appointment';finishWaHistory(true);await waPending});assert.deepEqual(await page.evaluate(()=>waUrls),['about:blank','closed']);
  await page.evaluate(()=>{selectedId='synthetic-appointment';window.open=()=>null});r=await open();assert.deepEqual(r.urls,[]);assert.match(r.alerts[0],/bloqueado/);
  await page.evaluate(()=>{appointments[0].status='Pendiente';openDrawer('synthetic-appointment')});
  const out=process.env.WHATSAPP_TEST_OUTPUT||path.join(root,'audit');fs.mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,'corrected-appointment-synthetic.png')});
  // Existing published issue outside this fix, independently recorded in the audit.
  const unrelated=errors.filter(e=>e==='applyRuntimeSettings is not defined');assert.deepEqual(errors.filter(e=>e!=='applyRuntimeSettings is not defined'),[]);
  const report={passed:true,syntaxScripts:syntax,states,firstAndReturningTemplates:true,identityAndHomonyms:true,uncachedPatient:true,historyErrorsStopOpening:true,staleSelectionAndDoubleClick:true,unrelatedExistingPageErrors:unrelated,externalRequestsBlocked:true,realMessagesSent:false};
  fs.writeFileSync(path.join(out,'correction-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
