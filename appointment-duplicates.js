/* Independent appointment copies: never reuse server, payment or external IDs. */
(() => {
 'use strict';
 const byId = id => document.getElementById(id);
 function makeCopy(source, date, time, id) {
  const copy = {};
  for (const key of ['patient','patientCode','patientRemoteId','therapy','services','resource','resources','professional','therapists','duration','notes']) {
   if (source[key] !== undefined) copy[key] = JSON.parse(JSON.stringify(source[key]));
  }
  const end = mins(time) + Number(copy.duration);
  return Object.assign(copy, {id, date, time, endTime:timeStr(end), status:'Pendiente',
   history:[], forced:false, forceReason:'', conflictOverride:false, planConflict:false,
   duplicatedFrom:source.centralId || source.id});
 }
 const button = byId('duplicateAppointmentBtn');
 if(!button)return;
 const back = document.createElement('div');
 back.className = 'modalback';
 back.id = 'duplicateAppointmentBack';
 back.innerHTML = `<form class="modal" role="dialog" aria-modal="true" aria-labelledby="duplicateTitle" style="width:min(680px,94vw)">
  <h2 id="duplicateTitle">Duplicar cita</h2>
  <p id="duplicateSummary"></p>
  <p class="small muted">Elige uno o varios días. Cada copia conservará el paciente, los servicios, el fisioterapeuta, la duración y las observaciones. Podrás gestionarla por separado. La cita original se conserva.</p>
  <div id="duplicateRows"></div>
  <button type="button" id="duplicateAdd" style="margin:12px 0">+ Añadir otro día</button>
  <p class="callout small">Las nuevas citas se crearán como pendientes, con sus cobros y confirmaciones independientes.</p>
  <div id="duplicateStatus" class="small" role="status" aria-live="polite"></div>
  <div class="actions" style="margin-top:16px"><button type="submit" class="primary" id="duplicateSave">Crear duplicados</button><button type="button" id="duplicateClose">Cerrar</button></div>
 </form>`;
 document.body.append(back);
 const form = back.querySelector('form'), rows = byId('duplicateRows'), status = byId('duplicateStatus');
 let source = null, busy = false, returnFocus = null;
 function nextDay(date) {
  const d = new Date(date + 'T12:00:00'); d.setDate(d.getDate()+1);
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
 }
 function addRow(date, time) {
  const row = document.createElement('fieldset');
  row.style.cssText = 'border:1px solid var(--line);border-radius:12px;padding:12px;margin:10px 0;min-width:0';
  row.innerHTML = `<legend>Copia</legend><div class="grid2">
   <label class="field">Fecha<input type="date" data-date required></label>
   <label class="field">Hora de inicio<input type="time" data-time step="300" required></label>
   <label class="field full"><span><input type="checkbox" data-force> Autorizar fuera de horario</span><input type="text" data-reason placeholder="Motivo de la excepción"></label>
   <div class="field full small" data-result></div>
  </div><button type="button" data-remove>Quitar este día</button>`;
  row.querySelector('[data-date]').value=date;
  row.querySelector('[data-time]').value=time;
  row.querySelector('[data-remove]').onclick=()=>{row.remove();status.textContent='';};
  rows.append(row);
  row.querySelector('[data-date]').focus();
 }
 function close() {
  if(busy)return;
  back.classList.remove('open');
  returnFocus?.focus();
 }
 const navigateBack = window.atlasNavigateBackV136;
 if(typeof navigateBack==='function')window.atlasNavigateBackV136=function(){
  if(back.classList.contains('open')){close();return true;}
  return navigateBack.apply(this,arguments);
 };
 button.onclick=()=>{
  const selected=appointments.find(a=>String(a.id)===String(selectedId));
  if(!selected)return;
  source=JSON.parse(JSON.stringify(selected));
  returnFocus=button;
  rows.replaceChildren();status.textContent='';
  byId('duplicateSummary').textContent=source.patient+' · '+(source.services||[source.therapy]).join(' + ')+' · '+(source.professional||'Sin fisioterapeuta')+' · '+source.duration+' min · Original: '+source.date+' '+source.time;
  byId('duplicateSave').disabled=false;
  back.classList.add('open');
  addRow(nextDay(source.date),source.time);
 };
 byId('duplicateAdd').onclick=()=>{
  const last=rows.lastElementChild?.querySelector('[data-date]').value||source.date;
  addRow(nextDay(last),source.time);
 };
 byId('duplicateClose').onclick=close;
 back.addEventListener('keydown',event=>{
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}
  if(event.key==='Tab'){
   const focusable=[...form.querySelectorAll('button:not(:disabled),input:not(:disabled)')];
   const first=focusable[0],last=focusable.at(-1);
   if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
   else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  }
 });
 form.onsubmit=async event=>{
  event.preventDefault();if(busy||!source)return;
  const pending=[...rows.children].filter(row=>!row.dataset.saved);
  if(!pending.length){status.textContent='Añade al menos un día para duplicar la cita.';return;}
  busy=true;
  button.disabled=true;
  for(const element of form.querySelectorAll('button,input'))element.disabled=true;
  let created=0;
  try{
   if(typeof window.atlasPersistAppointmentCentral!=='function')throw new Error('Espera a que termine de cargar la agenda central.');
   const candidates=[];
   for(const row of pending){
    const date=row.querySelector('[data-date]').value,time=row.querySelector('[data-time]').value;
    const parsed=new Date(date+'T12:00:00');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(parsed.getTime())||date===source.date)throw new Error('Elige una fecha válida diferente de la cita original.');
    if(!/^\d{2}:\d{2}$/.test(time)||mins(time)%5||!(Number(source.duration)>0)||mins(time)+Number(source.duration)>=1440)throw new Error('Revisa la hora: usa intervalos de 5 minutos y termina antes de medianoche.');
    if([...rows.children].filter(other=>other.querySelector('[data-date]').value===date).length>1)throw new Error('Has seleccionado el mismo día más de una vez. Elige días diferentes.');
    // Retain this ID across failed requests: server client_ref makes retries idempotent.
    row.dataset.copyId ||= 'duplicate-'+crypto.randomUUID();
    const copy=makeCopy(source,date,time,row.dataset.copyId);
    // Alicante's runtime list contains active staff only. Equipment resources
    // (for example MBST) are not professionals; use the agenda's assignments.
    const inactive=appointmentTherapists(copy).filter(name=>!professionals.includes(name));
    if(inactive.length)throw new Error(date+': profesional de baja: '+[...new Set(inactive)].join(', ')+'.');
    const blocked=blockFor(copy);
    if(blocked)throw new Error(date+': horario bloqueado. '+(blocked.reason||''));
    const schedule=appointmentWithinAllTherapistSchedules(copy);
    if(!schedule.ok){
     const reason=row.querySelector('[data-reason]').value.trim();
     if(!row.querySelector('[data-force]').checked||!reason)throw new Error(date+': '+schedule.prof+' está fuera de horario. Ajusta la fecha u hora, o autoriza la excepción indicando el motivo.');
     copy.forced=true;copy.forceReason=reason;
    }
    const conflicts=conflictsInSet(copy,[...appointments,...candidates.map(item=>item.copy)]);
    if(conflicts.length){
     if(!confirm(date+' '+time+': se solapa con '+conflicts.map(a=>a.patient+' '+a.time).join(', ')+'. ¿Autorizar el solapamiento de esta copia?'))throw new Error('Ajusta la fecha u hora de la copia con conflicto.');
     copy.forced=true;copy.conflictOverride=true;copy.forceReason='Solapamiento autorizado al duplicar cita';
    }
    copy.history.push({at:new Date().toISOString(),user:agendaActorName(),action:'Cita duplicada desde '+source.date+' '+source.time});
    candidates.push({row,copy});
   }
   for(const {row,copy} of candidates){
    status.textContent='Guardando copia del '+copy.date+' a las '+copy.time+'…';
    await window.atlasPersistAppointmentCentral(copy);
    const existing=appointments.findIndex(item=>String(item.id)===String(copy.id)||String(item.centralId||'')===String(copy.centralId));
    if(existing<0)appointments.push(copy);else appointments[existing]=copy;
    row.dataset.saved='true';created++;
    row.querySelector('[data-result]').textContent='✓ Cita guardada de forma independiente';
    logAgenda('Cita duplicada',copy);
   }
   status.textContent='✓ '+created+' cita'+(created===1?' creada':'s creadas')+'. La cita original se conserva.';
  }catch(error){
   status.textContent=(created?created+' copia(s) guardada(s). ':'')+'No se han guardado las copias restantes: '+(error.message||error)+ ' Puedes corregirlas y volver a intentarlo.';
  }finally{
   // Only confirmed copies enter the local agenda or its synchronization queue.
   if(created){save();render();}
   busy=false;
   button.disabled=false;
   for(const element of form.querySelectorAll('button,input'))element.disabled=!!element.closest('fieldset')?.dataset.saved;
   byId('duplicateSave').disabled=![...rows.children].some(row=>!row.dataset.saved);
  }
 };
})();
