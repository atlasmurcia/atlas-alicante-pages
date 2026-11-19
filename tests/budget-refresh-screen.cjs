const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const root=path.join(__dirname,'..'),index=fs.readFileSync(path.join(root,'index.html'),'utf8'),ficha=fs.readFileSync(path.join(root,'modules/ficha.html'),'utf8');
const poll=index.split('\n').find(l=>l.trim().startsWith('async function checkCentralChanges('));
const freshBranch=index.split('\n').find(l=>l.includes("else if(m.action==='budgets:list')")).replace('else if','if');
const returnRefresh=index.slice(index.indexOf(' function refreshOpenBudgets(){'),index.indexOf(' async function atlasRestSelect('));
const base=process.env.ATLAS_BUDGET_ASSET_ROOT||root;
const screenshots=process.env.ATLAS_BUDGET_SCREENSHOT_DIR||root;
const fixture={id:'synthetic-budget-a',budget_number:10,patient_id:'synthetic-a',client_ref:'budget-synthetic-a-1',name:'Presupuesto de prueba entre equipos',status:'draft',discount:5,total:266,created_at:'2026-11-19T08:00:00Z',updated_at:'r1',payment_terms:{method:'Tarjeta',terms:'single',notes:'Datos ficticios'},metadata:{local_id:'1',valuation_professional:'Profesional ficticio'},budget_lines:[{id:'line-a',line_order:1,service_name:'Servicio sintético A',sessions:3,unit_price:80,discount:0,metadata:{}},{id:'line-b',line_order:2,service_name:'Servicio sintético B',sessions:2,unit_price:20,discount:0,metadata:{}}]};
const parent=`<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#f5f7f8;font:16px Arial}h2{margin:14px}iframe{width:100%;height:900px;border:0}</style><h2>Alicante · comprobación con paciente ficticio</h2><iframe id="fichaFrame" src="/modules/ficha.html"></iframe><script>
var serverRows=[],revision=null,requests=[],failBudgets=false,cacheReads=0,context={organizationId:'synthetic-org',clinicId:'synthetic-clinic'},centralRefreshInFlight=false,lastAppointmentRevision='',lastSettingsRevision='',lastInvoiceRevision='',lastBudgetRevision=null;
var agendaFrame={contentWindow:{postMessage(){}}},appointmentListCache=new Map();function clearPatientReadCache(){};
var db={from(table){return{select(){return this},eq(){return this},is(){return this},order(){return this},limit(){return this},maybeSingle(){return Promise.resolve({data:table==='budgets'?revision:null,error:null})},then(resolve,reject){return Promise.resolve(table==='budgets'?{data:serverRows,error:failBudgets?{message:'Conexión de prueba interrumpida'}:null}:{data:[],error:null}).then(resolve,reject)}}}};
async function cachedPatientRead(key,loader){cacheReads++;return loader()}
${poll}
${returnRefresh}
var sent=false;function openFixture(){if(sent)return;sent=true;const frame=document.getElementById('fichaFrame');frame.contentWindow.postMessage({type:'atlas:central-ready',...context,profileName:'Profesional ficticio',role:'owner',ownerAccess:true,permissions:['patients','administrative','clinical','consents','budgets']},'*');frame.contentWindow.postMessage({type:'atlas:load-patient',patient:{remoteId:'synthetic-a',code:'SYN-A',name:'Paciente Ficticio Alicante'},appointments:[],targetPanel:'presupuestos'},'*');checkCentralChanges()}
window.addEventListener('message',async e=>{const m=e.data||{};if(m.type==='atlas:module-ready')setTimeout(openFixture,30);if(m.type!=='atlas:central-db-request')return;requests.push({action:m.action,payload:m.payload});let result={data:[],error:null};${freshBranch};e.source.postMessage({type:'atlas:central-db-response',requestId:m.requestId,ok:!result.error,data:result.data,error:result.error?.message||''},'*')});
document.getElementById('fichaFrame').addEventListener('load',()=>setTimeout(openFixture,80));
</script>`;
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.ATLAS_CHROME_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});try{
 const page=await browser.newPage({viewport:{width:1500,height:1100}}),errors=[],blocked=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',dialog=>dialog.dismiss());
 await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin!=='https://synthetic-alicante.invalid'){blocked.push(u.origin);return route.abort()}
 let body,type='text/html';if(u.pathname==='/')body=parent;else if(u.pathname==='/modules/ficha.html')body=ficha;else if(/^\/modules\/(appointment-record-kind|care-finance-model|patient-payment-highlight|patient-financial-history)\.js$/.test(u.pathname)){body=fs.readFileSync(path.join(base,u.pathname),'utf8');type='text/javascript'}else return route.abort();return route.fulfill({contentType:type,body})});
 await page.goto('https://synthetic-alicante.invalid/');const frame=page.frames().find(f=>f.url().includes('/modules/ficha.html'));await frame.waitForFunction(()=>document.getElementById('atlasBudgetRefreshState')?.textContent.includes('No hay presupuestos guardados'));
 await frame.locator('[data-t="presupuestos"]').first().click();
 assert.match(await frame.locator('#budgetCards').innerText(),/Presupuesto inicial/);
 // Another device saves after the receptionist opened an empty patient profile.
 await page.evaluate(row=>{serverRows=[row];revision={id:row.id,updated_at:row.updated_at,deleted_at:null};return checkCentralChanges()},fixture);
 await frame.waitForFunction(()=>document.getElementById('budgetCards').textContent.includes('Presupuesto de prueba entre equipos'));
 assert.match(await frame.locator('#budgetCards').innerText(),/266,00/);assert.equal(await frame.locator('#budgetLines .line').count(),2);assert.equal(await frame.locator('#bValuationProfessional').inputValue(),'Profesional ficticio');
 await page.screenshot({path:path.join(screenshots,'budget-refresh-synthetic.png'),fullPage:true});
 // Keep unsaved text while external changes arrive and when Update is clicked.
 await frame.locator('#bName').fill('Edición pendiente ficticia');await frame.locator('#bName').dispatchEvent('change');
 await page.evaluate(()=>{serverRows[0].name='Cambio externo ficticio';serverRows[0].updated_at='r2';revision.updated_at='r2';return checkCentralChanges()});await page.waitForTimeout(850);
 await frame.locator('#atlasBudgetRefreshButton').click();assert.equal(await frame.locator('#bName').inputValue(),'Edición pendiente ficticia');assert.match(await frame.locator('#atlasBudgetRefreshState').innerText(),/cambios sin guardar/);
 // Once the edit guard is released, the deferred read applies the remote revision.
 await frame.evaluate(()=>{window.atlasBudgetEditorDirty=false});await frame.waitForFunction(()=>document.getElementById('bName').value==='Cambio externo ficticio');
 // Network errors remain visible, keep the current form, and allow a retry.
 await page.evaluate(()=>{failBudgets=true});await frame.locator('#atlasBudgetRefreshButton').click();await frame.waitForFunction(()=>document.getElementById('atlasBudgetRefreshState').textContent.includes('No se pudieron cargar'));
 assert.equal(await frame.locator('#bName').inputValue(),'Cambio externo ficticio');
 await page.screenshot({path:path.join(screenshots,'budget-refresh-retry-synthetic.png'),fullPage:true});
 await page.evaluate(()=>{failBudgets=false});await frame.locator('#atlasBudgetRefreshButton').click();await frame.waitForFunction(()=>document.getElementById('atlasBudgetRefreshState').textContent.includes('actualizados desde el servidor'));
 // Return to the app: its parent focus handler refreshes the iframe even if the poll revision is unchanged.
 await page.evaluate(()=>{serverRows[0].name='Actualizado al volver';window.dispatchEvent(new Event('focus'))});await frame.waitForFunction(()=>document.getElementById('bName').value==='Actualizado al volver');
 const writes=await page.evaluate(()=>requests.filter(r=>!/(?:list|resolve|assignees|hasPriorAttendance|:get|financialSummary)/i.test(r.action)));
 assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);
 console.log('Real patient sheet in Chrome: external save, original lines/total, editing guard, retry and return-to-app refresh verified. All data synthetic; outside traffic blocked; zero mutations.');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
