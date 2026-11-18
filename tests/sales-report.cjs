'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

module.exports = async function run({ chromium, executablePath }) {
  const root = path.join(__dirname, '..');
  const shell = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const agenda = fs.readFileSync(path.join(root, 'modules/agenda.html'), 'utf8');
  const block = shell.slice(shell.indexOf("else if(m.action==='invoices:listRectifications')"), shell.indexOf("else if(m.action==='invoices:listForPayment')"));
  assert.ok(block.length > 1000, 'The central dispatcher must implement the operation');
  const handler = new vm.Script('(async()=>{let result;const m={action:"invoices:listRectifications",payload};if(false){}' + block + ';return result})()');
  const context = {organizationId:'org', clinicId:'clinic'};
  const rect = {id:'r', organization_id:'org', clinic_id:'clinic', original_invoice_id:'original', payment_id:'payment', status:'issued', issue_date:'2026-11-18', invoice_number:'R-1', total:-20, lines:[{description:'Servicio ficticio',total:-20}]};
  const original = {...rect, id:'original', original_invoice_id:null, invoice_number:'F-1', status:'rectified', issue_date:'2026-10-01'};
  const tables = {
    sales_invoices:[rect,original,{...rect,id:'other-clinic',clinic_id:'other'},{...rect,id:'other-org',organization_id:'other'},{...rect,id:'cancelled',status:'cancelled'},{...rect,id:'before',issue_date:'2026-10-31'},{...rect,id:'after',issue_date:'2026-12-01'}],
    payments:[{id:'payment',organization_id:'org',clinic_id:'clinic',patient_id:'patient',method:'card',receipt_number:17,metadata:{actor_name:'Equipo ficticio'}}],
    patients:[{id:'patient',organization_id:'org',clinic_id:'clinic',first_name:'Paciente',last_name_1:'Ficticio',patient_number:7,dni_nie:'DEMO'}]
  };
  let queries=[], failTable='', failOffset=-1;
  const db={from(table){let filters=[],orders=[],range=null;const q={
    select(){return q},eq(k,v){filters.push(row=>row[k]===v);return q},not(k,op,v){assert.equal(op,'is');assert.equal(v,null);filters.push(row=>row[k]!=null);return q},
    gte(k,v){filters.push(row=>row[k]>=v);return q},lte(k,v){filters.push(row=>row[k]<=v);return q},in(k,values){filters.push(row=>values.includes(row[k]));return q},
    order(k){orders.push(k);return q},range(a,b){range=[a,b];return q},
    then(resolve,reject){queries.push({table,range});if(table===failTable || (range&&range[0]===failOffset))return Promise.resolve({data:null,error:{message:'Synthetic read failure'}}).then(resolve,reject);let rows=tables[table].filter(row=>filters.every(f=>f(row)));rows.sort((a,b)=>{for(const k of orders){const c=String(a[k]).localeCompare(String(b[k]));if(c)return c}return 0});if(range)rows=rows.slice(range[0],range[1]+1);return Promise.resolve({data:rows,error:null}).then(resolve,reject)}
  };return q}};
  const invoke=(payload={from:'2026-11-01',to:'2026-11-18'})=>handler.runInNewContext({db,context,payload,atlasPatientNameDisplay:String});
  const result=await invoke();assert.equal(result.data.length,1);const row=result.data[0];assert.equal(row.patient,'Paciente Ficticio');assert.equal(row.dni_nie,'DEMO');assert.equal(row.original_invoice_number,'F-1');assert.equal(row.payment_method,'card');assert.equal(row.receipt_number,17);assert.equal(row.service,'Servicio ficticio');assert.equal(row.total,-20);
  assert.equal((await invoke({})).data.length,3,'The unfiltered cash query includes all issued rectifications');
  for(const payload of [{from:'2026-02-30'},{from:'2026-11-19',to:'2026-11-18'},{to:'invalid'}]){queries=[];await assert.rejects(invoke(payload),/periodo/);assert.equal(queries.length,0)}
  const saved=tables.sales_invoices;tables.sales_invoices=[original,...Array.from({length:501},(_,i)=>({...rect,id:'r'+String(i).padStart(4,'0')}))];queries=[];assert.equal((await invoke()).data.length,501);assert.ok(queries.some(q=>q.range?.[0]===500));
  failOffset=500;await assert.rejects(invoke(),error=>error.message==='Synthetic read failure');failOffset=-1;tables.sales_invoices=saved;
  for(const table of ['sales_invoices','payments','patients']){failTable=table;await assert.rejects(invoke(),error=>error.message==='Synthetic read failure')}failTable='';
  tables.sales_invoices=[{...rect,payment_id:null},original];assert.equal((await invoke()).data[0].patient,'Paciente Ficticio','Resolve the original payment when necessary');tables.sales_invoices=saved;
  let syntax=0;for(const doc of [shell,agenda])for(const match of doc.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)){if(!/application\/json/.test(match[1])){new vm.Script(match[2]);syntax++}}
  console.log('Central query: scope, dates, linked data, 501 records, errors and syntax passed ('+syntax+' scripts).');

  const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{channel:'chrome'})});
  try{
    const page=await browser.newPage({viewport:{width:1250,height:800}});await page.route('**/*',route=>route.abort());
    await page.setContent('<div id="cashSearchBack"><div class="atlas-sales-filter"><input id="cashSearchFrom" value="2026-11-01"><input id="cashSearchTo" value="2026-11-18"><input id="cashSearchInput"><select id="cashSearchMethod"><option value="">Todas</option><option>Tarjeta</option></select></div><table><thead><tr></tr></thead><tbody id="cashSearchBody"></tbody></table></div>');
    await page.evaluate(()=>{
      window.cashSearchMode='sales';window.cashMovements=[];window.normalizeSearch=s=>String(s).toLowerCase();window.cashToday=()=> '2026-11-18';window.ATLAS_CHILD_CENTRAL_CONTEXT={ownerAccess:true};window.renderCashSearch=()=>{};window.alerts=[];window.alert=s=>alerts.push(s);window.exports=[];window.downloadCashExcelCsv=(rows,name)=>exports.push({rows,name});window.failRectifications=false;window.failSales=false;
      window.atlasCentralRequest=async action=>{if(action==='sales:report'){if(failSales)throw Error('Fallo ventas ficticio');return [{id:'payment',paid_at:'2026-11-18T09:00:00Z',patient:'Paciente Ficticio',amount:100,method:'card',service:'Servicio ficticio',invoice_number:null}]}if(action==='invoices:listRectifications'){if(failRectifications)throw Error('Fallo rectificativas ficticio');return [{id:'r',issue_date:'2026-11-18',patient:'Paciente Ficticio',total:-20,payment_method:'card',invoice_number:'R-1',lines:[]}]}throw Error('Unexpected action '+action)};
    });
    const script=id=>agenda.match(new RegExp('<script id="'+id+'">([\\s\\S]*?)</script>'))[1];
    await page.addScriptTag({content:script('atlas-complete-sales-report')});await page.addScriptTag({content:script('atlas-sales-line-export-v309')});
    await page.evaluate(()=>renderCashSearch());assert.equal(await page.locator('#cashSearchBody tr').count(),2);assert.match(await page.locator('#atlasSalesCount').innerText(),/80,00/);
    assert.equal(await page.locator('#atlasInvoiceFilteredReceipts').isDisabled(),false);
    await page.evaluate(()=>atlasExportSalesSearch());let exported=await page.evaluate(()=>exports.at(-1));assert.equal(exported.rows.at(-1)[7],80);assert.ok(exported.rows.some(row=>row[5]==='Factura rectificativa'));
    await page.evaluate(async()=>{failRectifications=true;dispatchEvent(new Event('atlas:cash-edited'))});await page.waitForFunction(()=>document.getElementById('atlasSalesCount').textContent.includes('AVISO'));
    assert.equal(await page.locator('#cashSearchBody tr').count(),1);assert.match(await page.locator('#atlasSalesCount').innerText(),/Total parcial de ventas/);assert.doesNotMatch(await page.locator('#atlasSalesCount').innerText(),/Total del periodo/);assert.equal(await page.locator('#atlasInvoiceFilteredReceipts').isDisabled(),true);
    await page.evaluate(()=>atlasExportSalesSearch());assert.equal(await page.evaluate(()=>exports.length),1,'No incomplete spreadsheet may be downloaded');assert.match(await page.evaluate(()=>alerts.at(-1)),/No se pudo preparar/);
    await page.evaluate(async()=>{failRectifications=false;await renderCashSearch()});assert.equal(await page.locator('#cashSearchBody tr').count(),2);assert.doesNotMatch(await page.locator('#atlasSalesCount').innerText(),/AVISO/);
    await page.evaluate(()=>{failSales=true;dispatchEvent(new Event('atlas:cash-edited'))});await page.waitForFunction(()=>document.getElementById('cashSearchBody').textContent.includes('No se pudieron cargar'));
    assert.match(await page.locator('#atlasSalesCount').innerText(),/Fallo ventas ficticio/);
    console.log('Browser: sales and rectifications, total 80 EUR, export, partial warning, disabled billing, retry and sales failure passed. No external requests allowed.');
  }finally{await browser.close()}
};

if(require.main===module){
  const playwright=require(process.env.PLAYWRIGHT_MODULE||'playwright');
  module.exports({chromium:playwright.chromium,executablePath:process.env.CHROME_PATH}).catch(error=>{console.error(error);process.exitCode=1});
}
