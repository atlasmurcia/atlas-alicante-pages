const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('flowatlas/assets/index-e_Mf-3Ab.js','utf8');
const start=source.indexOf('M=(0,C.useCallback)((silent=!1)=>');assert(start>=0);const end=source.indexOf('},[n,j]);',start)+'},[n,j]);'.length;
const refresh=source.slice(start,end);
const transition=source.match(/r\((previous=>JSON.stringify\(previous\)===JSON.stringify\(t\)\?previous:t)\)/)[1];
let state={clinicId:'synthetic-alicante',userId:'qa',organizationId:'qa-org'},changes=0;
const accept=vm.runInNewContext('('+transition+')',{t:{...state}});assert.equal(accept(state),state);
for(let i=0;i<34;i++){const fn=vm.runInNewContext('('+transition+')',{t:{...state}});const next=fn(state);if(next!==state)changes++;state=next}assert.equal(changes,0,'Repeated handshake must not retrigger React effects');
assert.notEqual(vm.runInNewContext('('+transition+')',{t:{...state,userId:'another-user'}})(state),state);
let resolve,reject,calls=0,rows=[{id:'old-synthetic'}],error='',busy=false;
const ctx={C:{useCallback:fn=>fn},n:state,atlasLeadLoad:{current:null},Promise,Date,Error,JSON,window:{setTimeout(){}},j:()=>{calls++;return new Promise((a,b)=>{resolve=a;reject=b})},t:value=>rows=value,w(){},_:value=>error=value,h(){},y:value=>busy=value,x(){}};vm.createContext(ctx);vm.runInContext(refresh,ctx);
(async()=>{
 const first=ctx.M();for(let i=0;i<34;i++)assert.equal(ctx.M(),first);assert.equal(calls,1);assert.equal(busy,true);resolve([{id:'new-synthetic'}]);await first;assert.equal(rows[0].id,'new-synthetic');assert.equal(busy,false);
 const second=ctx.M();reject(new Error('Atlas no ha respondido.'));await second;assert.equal(rows[0].id,'new-synthetic','Failed refresh must preserve loaded leads');assert.equal(error,'Atlas no ha respondido.');
 const retry=ctx.M();resolve([{id:'retry-synthetic'}]);await retry;assert.equal(rows[0].id,'retry-synthetic');assert.equal(error,'');
 const oldLoad=ctx.M();const oldResolve=resolve;ctx.n={...state,clinicId:'another-synthetic-clinic'};const newLoad=ctx.M();resolve([{id:'new-clinic'}]);await newLoad;oldResolve([{id:'stale-clinic'}]);await oldLoad;assert.equal(rows[0].id,'new-clinic','Old responses must not replace another clinic');
 assert(source.includes('e===`leads:list`?3e4:1e4'));assert(source.includes('n&&t.length===0?'));assert(source.includes('r&&t.length===0?'));assert(source.includes('Se mantienen los últimos leads cargados.'));
 console.log('PASS: repeated handshakes, one concurrent list request, retry, preserved leads on error, stale clinic response and bounded timeout.');
})().catch(e=>{console.error(e);process.exitCode=1});
