const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {JSDOM}=require(process.env.ATLAS_JSDOM_MODULE||'jsdom');
const code=fs.readFileSync('flowatlas/lead-merge.js','utf8');
for(const file of ['index.html','flowatlas/index.html'])for(const s of fs.readFileSync(file,'utf8').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g))if(!/type=["']application\/json/.test(s[1]))new vm.Script(s[2]);
const pause=()=>new Promise(r=>setTimeout(r,5));
(async()=>{
 const dom=new JSDOM('<html><head></head><body><div class="top-actions"></div></body></html>',{url:'https://synthetic.invalid/flowatlas/',runScripts:'outside-only'});
 const w=dom.window,requests=[];let fail=false;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
 let rows=[{id:'primary',first_name:'Persona',last_name:'Prueba',phone:'+34600000000',notes:'Antigua',status:'contacted',metadata:{funnel_stage:'call_back'},created_at:'2026-10-01',updated_at:'v1'}, {id:'source',first_name:'Persona',last_name:'Prueba',phone:'600 000 000',notes:'Nueva <img src=x onerror=alert(1)>',status:'new',metadata:{campaign_name:'Campaña ficticia'},created_at:'2026-11-01',updated_at:'v2'}];
 const host={postMessage(m){if(m.type==='atlas:module-ready')return;
  requests.push(m);setTimeout(()=>{
   let data,error;
   if(m.action==='leads:list')data=rows;
   else if(m.action==='leads:activities')data=[{summary:'Llamada ficticia',created_at:'2026-10-01'}];
   else if(m.action==='leads:merge'){if(fail)error='Ficha modificada';else{rows=[{...rows[0],...m.payload.fields}];data={lead:rows[0]};}}
   else if(m.action==='leads:editAudited'){rows=rows.map(r=>r.id===m.payload.id?{...r,...m.payload.fields}:r);data=rows.find(r=>r.id===m.payload.id);}
   w.dispatchEvent(new w.MessageEvent('message',{source:host,origin:w.location.origin,data:{type:'atlas:central-db-response',requestId:m.requestId,ok:!error,error,data}}));
  },0);
 }};Object.defineProperty(w,'parent',{value:host});w.eval(code);
 w.document.body.append(w.document.createElement('div'));await pause();
 const button=w.document.getElementById('atlasLeadMergeButton');assert.ok(button.disabled);
 const ready={type:'atlas:central-ready',clinicId:'bb64ef32-ae0a-478f-bc30-bf6ce554567a',permissions:{patients_write:true}};
 w.dispatchEvent(new w.MessageEvent('message',{source:host,origin:'https://evil.invalid',data:ready}));assert.ok(button.disabled,'Foreign origin ignored');
 w.dispatchEvent(new w.MessageEvent('message',{source:host,origin:w.location.origin,data:ready}));assert.equal(button.disabled,false);button.click();await pause();await pause();
 const choose=(label,value)=>{const s=w.document.querySelector(`[aria-label="${label}"]`);assert.ok(s,label);s.value=value;s.dispatchEvent(new w.Event('change'));};
 choose('Ficha principal','primary');choose('Ficha duplicada','source');await pause();await pause();
 assert.equal(w.document.querySelectorAll('.alm-columns section').length,2);assert.equal(w.document.querySelectorAll('img').length,0,'Original strings are text, not executable HTML');
 let form=w.document.querySelector('form');assert.equal(form.querySelector('textarea').value,rows.map(l=>l.notes).join('\n\n'));
 form.querySelector('input[type=checkbox]').checked=true;fail=true;form.dispatchEvent(new w.Event('submit',{cancelable:true}));await pause();await pause();assert.match(form.textContent,/Ficha modificada/);assert.equal(rows.length,2,'Failed merge leaves both cards');
 const refresh=[...form.querySelectorAll('button')].find(x=>x.textContent==='Actualizar y revisar');refresh.click();await pause();await pause();choose('Ficha duplicada','source');await pause();await pause();form=w.document.querySelector('form');form.querySelector('input[type=checkbox]').checked=true;fail=false;form.dispatchEvent(new w.Event('submit',{cancelable:true}));await pause();await pause();await pause();assert.match(w.document.body.textContent,/Fusión guardada y comprobada/);assert.equal(rows.length,1);
 const req=requests.find(x=>x.action==='leads:merge');assert.equal(req.payload.primaryVersion,'v1');assert.equal(req.payload.duplicateVersion,'v2');assert.equal(req.payload.primaryId,'primary');assert.equal(req.payload.duplicateId,'source');
 assert.equal(w.AtlasLeadMerge.normalPhone('0034 600-000-000'),'34600000000');assert.equal(w.AtlasLeadMerge.match({id:'a',phone:''},{id:'b',phone:''}),false);assert.equal(w.AtlasLeadMerge.match({id:'a',email:'A@EXAMPLE.invalid'},{id:'b',email:'a@example.invalid'}),true);
 w.dispatchEvent(new w.Event('pagehide'));dom.window.close();console.log('Passed: clinic and origin checks, compare both originals and histories, safe text rendering, versioned confirmation, failure recovery and verified success, contact normalization.');
})().catch(e=>{console.error(e);process.exitCode=1});
