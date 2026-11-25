// Prueba aislada de Alicante con cuentas y borrador ficticios; sin conexiones.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const shell=fs.readFileSync('index.html','utf8'),agenda=fs.readFileSync('modules/agenda.html','utf8');
const policy=shell.match(/<script id="atlas-session-policy-v1">([\s\S]*?)<\/script>/)?.[1];assert(policy);
assert.doesNotMatch(shell+agenda,/atlas:security-lock|resetIdle|let idleTimer/);
assert.match(shell,/sessionPolicy=20261125/);assert.match(shell,/persistSession:true,autoRefreshToken:true/);
assert.match(agenda,/Sesión sin cierre por inactividad/);assert.doesNotMatch(agenda,/La sesión se cerrará tras 30 minutos/);
const logout=shell.match(/atlasLogout\.onclick=async\(\)=>\{[^\n]+?\};/)[0];
(async()=>{
 for(const role of ['owner','administrator','therapist','reception','assistant','custom']){
  const handlers={},timers=[],calls={logout:0,reload:0},draft={value:'Borrador ficticio pendiente de guardar'},ctx={window:{ATLAS_CENTRAL_CONTEXT:{role},addEventListener:(type,fn)=>(handlers[type]||=[]).push(fn)},db:{auth:{signOut:async()=>calls.logout++}},atlasLogout:{},document:{getElementById:id=>id==='clinicalDraft'?draft:null},location:{reload:()=>calls.reload++},setTimeout:(fn,ms)=>timers.push({fn,ms}),setInterval:(fn,ms)=>timers.push({fn,ms})};vm.createContext(ctx);vm.runInContext(policy+'\n'+logout,ctx);
  for(let minute=0;minute<120;minute++){// Avisos de la agenda antigua aun en caché.
   for(const fn of handlers.message||[])await fn({data:{type:'atlas:security-lock'}});
   for(const t of timers)if((minute+1)*60000>=t.ms)await t.fn();
  }
  assert.equal(calls.logout,0,role);assert.equal(calls.reload,0,role);assert.equal(draft.value,'Borrador ficticio pendiente de guardar');assert(ctx.window.ATLAS_CENTRAL_CONTEXT);
  await ctx.atlasLogout.onclick();assert.equal(calls.logout,1);assert.equal(calls.reload,1);
 }
 for(const path of ['index.html','modules/agenda.html']){let n=0;for(const [,attrs,code] of fs.readFileSync(path,'utf8').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){if(/src=|application\/json/.test(attrs))continue;new vm.Script(code);n++}console.log(path+': '+n+' scripts válidos')}
 console.log('OK Alicante: dos horas inactivo para seis roles, avisos antiguos ignorados, borrador intacto y cierre manual conservado.');
})().catch(error=>{console.error(error);process.exitCode=1});
