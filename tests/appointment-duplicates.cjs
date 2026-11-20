// Real Alicante agenda and duplicate dialog. Only local assets and synthetic data;
// all external requests are blocked, and central writes are simulated in memory.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const root=path.join(__dirname,'..');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.ATLAS_CHROME_EXECUTABLE||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':undefined)});
 try{
  const page=await browser.newPage({viewport:{width:1400,height:1100}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{
   const url=new URL(route.request().url());
   if(url.origin!=='https://synthetic-alicante.invalid')return route.abort();
   const file=path.join(root,url.pathname);
   if(!file.startsWith(root+path.sep)||!/[.](html|js)$/.test(file)||!fs.existsSync(file))return route.abort();
   return route.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.js')?'text/javascript':'text/html'});
  });
  await page.goto('https://synthetic-alicante.invalid/modules/agenda.html');
  await page.waitForFunction(()=>typeof document.getElementById('duplicateAppointmentBtn')?.onclick==='function');
  // Existing permissions hook references a configuration-private function on
  // startup. Record it separately; duplication must introduce no new errors.
  const startupErrors=errors.slice();
  assert(startupErrors.every(message=>message==='applyRuntimeSettings is not defined'));
  await page.evaluate(()=>{
   window.ATLAS_CHILD_CENTRAL_CONTEXT={profileName:'Recepción ficticia'};
   window.testServer=new Map();window.testCalls=[];window.testFailure=0;window.testPause=false;window.testConfirm=true;
   window.confirm=()=>testConfirm;window.alert=()=>{};
   professionals.splice(0,professionals.length,'Profesional ficticio A','Profesional ficticio B');
   equipment.splice(0,equipment.length,'MBST OSTEOSPIN','Equipo ficticio');
   resources.splice(0,resources.length,...professionals,...equipment);
   Object.keys(schedules).forEach(key=>delete schedules[key]);
   professionals.forEach(name=>schedules[name]=Object.fromEntries([0,1,2,3,4,5,6].map(day=>[day,[[480,1320]]])));
   agendaBlocks=[];agendaAvailabilityOverrides=[];
   Object.assign(window.atlasAgendaConfig(),{holidays:[],hours:Object.fromEntries([0,1,2,3,4,5,6].map(day=>[day,[['08:00','22:00']]]))});
   // Keep the real validation functions; intercept only persistence and rendering.
   window.testSaves=0;save=()=>testSaves++;render=()=>{};
   window.atlasPersistAppointmentCentral=async copy=>{
    testCalls.push(JSON.parse(JSON.stringify(copy)));
    if(testPause)await new Promise(resolve=>window.testResume=resolve);
    if(!testServer.has(copy.id))testServer.set(copy.id,'server-'+copy.id);
    if(testFailure===testCalls.length)throw new Error('Respuesta perdida simulada');
    copy.centralId=testServer.get(copy.id);copy.centralRef='atlas-'+copy.id;
   };
   window.testOpen=(kind='equipment',extra={})=>{
    document.getElementById('duplicateClose').click();
    const isEquipment=kind==='equipment',professional=isEquipment?'':'Profesional ficticio A';
    window.testOriginal={id:'original',centralId:'server-original',patient:'Paciente ficticio',patientCode:'SYN-1',patientRemoteId:'synthetic-patient',date:'2026-11-30',time:'17:00',duration:60,therapy:isEquipment?'MBST OSTEOSPIN Artrosis':'Fisioterapia',services:[isEquipment?'MBST OSTEOSPIN Artrosis':'Fisioterapia'],resource:isEquipment?'MBST OSTEOSPIN':professional,resources:[isEquipment?'MBST OSTEOSPIN':professional],professional,therapists:isEquipment?{}:{Fisioterapia:professional},notes:'Observación ficticia',status:'Realizada',externalId:'external-original',centralPaymentId:'payment-original',appointmentReminder:{confirmed:true},planId:'old-plan',history:[{action:'Original'}],...extra};
    window.testSnapshot=JSON.stringify(testOriginal);appointments=[testOriginal];selectedId=testOriginal.id;
    testCalls=[];testServer.clear();testFailure=0;testPause=false;testConfirm=true;agendaBlocks=[];agendaAvailabilityOverrides=[];
    document.getElementById('duplicateAppointmentBtn').click();
    document.querySelector('#duplicateRows [data-date]').value='2026-12-02';
   };
  });
  const submit=()=>page.evaluate(()=>document.querySelector('#duplicateAppointmentBack form').onsubmit({preventDefault(){}}));
  const status=()=>page.locator('#duplicateStatus').innerText();
  let checks=0;const check=async(label,fn)=>{await fn();checks++;console.log('PASS '+label)};
  await check('MBST without a therapist duplicates with real agenda functions',async()=>{
   await page.evaluate(()=>testOpen());await submit();assert.match(await status(),/1 cita creada/);
   assert.deepEqual(await page.evaluate(()=>({count:appointments.length,staff:appointments[1].professional,resource:appointments[1].resource,time:appointments[1].time,date:appointments[1].date})),{count:2,staff:'',resource:'MBST OSTEOSPIN',time:'17:00',date:'2026-12-02'});
  });
  await check('active therapist, independent copies and original preserved',async()=>{
   await page.evaluate(()=>{testOpen('staff');document.getElementById('duplicateAdd').click()});await submit();
   assert.match(await status(),/2 citas creadas/);
   assert(await page.evaluate(()=>JSON.stringify(testOriginal)===testSnapshot&&appointments.length===3&&appointments.slice(1).every(a=>a.status==='Pendiente'&&!a.externalId&&!a.centralPaymentId&&!a.appointmentReminder&&!a.planId&&a.centralId!==testOriginal.centralId&&a.notes===testOriginal.notes)));
   assert(await page.evaluate(()=>{appointments[1].services.push('Solo copia');appointments[1].status='Cancelada';return appointments[2].services.length===1&&appointments[2].status==='Pendiente'&&JSON.stringify(testOriginal)===testSnapshot}));
  });
  await check('inactive therapist rejected even with schedule override',async()=>{
   await page.evaluate(()=>{testOpen('staff',{professional:'Profesional ficticio de baja',therapists:{Fisioterapia:'Profesional ficticio de baja'}});document.querySelector('[data-force]').checked=true;document.querySelector('[data-reason]').value='Prueba'});await submit();
   assert.match(await status(),/profesional de baja/);assert.equal(await page.evaluate(()=>testCalls.length),0);
  });
  await check('secondary therapist is checked',async()=>{
   await page.evaluate(()=>testOpen('staff',{therapists:{Fisioterapia:'Profesional ficticio A',Otra:'Profesional ficticio de baja'}}));await submit();assert.match(await status(),/profesional de baja/);assert.equal(await page.evaluate(()=>testCalls.length),0);
  });
  await check('equipment block rejects all copies before writing',async()=>{
   await page.evaluate(()=>{testOpen();document.getElementById('duplicateAdd').click();agendaBlocks=[{date:'2026-12-03',resources:['MBST OSTEOSPIN'],type:'day',reason:'Mantenimiento ficticio'}]});await submit();assert.match(await status(),/horario bloqueado/);assert.equal(await page.evaluate(()=>testCalls.length),0);
  });
  await check('out of hours requires explicit reason',async()=>{
   await page.evaluate(()=>{testOpen('staff');schedules['Profesional ficticio A'][3]=[[480,600]]});await submit();assert.match(await status(),/fuera de horario/);assert.equal(await page.evaluate(()=>testCalls.length),0);
   await page.evaluate(()=>{document.querySelector('[data-force]').checked=true;document.querySelector('[data-reason]').value='Excepción ficticia'});await submit();assert.match(await status(),/1 cita creada/);assert(await page.evaluate(()=>appointments[1].forced&&appointments[1].forceReason==='Excepción ficticia'));
   await page.evaluate(()=>schedules['Profesional ficticio A'][3]=[[480,1320]]);
  });
  await check('equipment conflict requires confirmation',async()=>{
   await page.evaluate(()=>{testOpen();appointments.push({...testOriginal,id:'busy',patientCode:'SYN-2',date:'2026-12-02'});testConfirm=false});await submit();assert.match(await status(),/conflicto/);assert.equal(await page.evaluate(()=>testCalls.length),0);
   await page.evaluate(()=>testConfirm=true);await submit();assert.match(await status(),/1 cita creada/);assert(await page.evaluate(()=>appointments.at(-1).conflictOverride));
  });
  await check('same original date and repeated dates rejected',async()=>{
   await page.evaluate(()=>{testOpen();document.querySelector('[data-date]').value='2026-11-30'});await submit();assert.match(await status(),/fecha válida diferente/);
   await page.evaluate(()=>{document.querySelector('[data-date]').value='2026-12-02';document.getElementById('duplicateAdd').click();document.querySelectorAll('[data-date]')[1].value='2026-12-02'});await submit();assert.match(await status(),/mismo día/);assert.equal(await page.evaluate(()=>testCalls.length),0);
  });
  await check('partial failure and retry keep stable IDs without extra copies',async()=>{
   await page.evaluate(()=>{testOpen();document.getElementById('duplicateAdd').click();testFailure=2});await submit();assert.match(await status(),/1 copia\(s\) guardada/);
   const id=await page.evaluate(()=>document.getElementById('duplicateRows').children[1].dataset.copyId);
   await page.evaluate(()=>testFailure=0);await submit();assert.match(await status(),/1 cita creada/);
   assert.deepEqual(await page.evaluate(()=>({rows:appointments.length,server:testServer.size,last:appointments.at(-1).id,original:JSON.stringify(testOriginal)===testSnapshot})),{rows:3,server:2,last:id,original:true});
  });
  await check('double submit waits for confirmation and creates one copy',async()=>{
   await page.evaluate(()=>{testOpen();testPause=true;window.testPending=document.querySelector('#duplicateAppointmentBack form').onsubmit({preventDefault(){}})});
   assert.equal(await page.locator('#duplicateSave').isDisabled(),true);await submit();assert.equal(await page.evaluate(()=>testCalls.length),1);assert.equal(await page.evaluate(()=>appointments.length),1);
   await page.evaluate(async()=>{testResume();await testPending});assert.equal(await page.evaluate(()=>appointments.length),2);
  });
  const screenshot=process.env.ATLAS_DUPLICATE_SCREENSHOT;
  if(screenshot)await page.screenshot({path:screenshot});
  await check('original isolated fixture still passes its copy and retry checks',async()=>{
   await page.goto('https://synthetic-alicante.invalid/tests/appointment-duplicates.html');
   await page.waitForFunction(()=>/TODAS LAS PRUEBAS CORRECTAS|FALLO:/.test(document.getElementById('results')?.textContent||''));
   assert.match(await page.locator('#results').innerText(),/TODAS LAS PRUEBAS CORRECTAS/);
  });
  assert.deepEqual(errors,startupErrors);console.log(`${checks} real-agenda duplication checks passed; no new page errors. Startup errors: ${JSON.stringify(startupErrors)}`);
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
