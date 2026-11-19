// Solo lectura y color: nunca modifica pacientes, pagos, tarifas o presupuestos.
(()=>{
 const byId=new Map(),byCode=new Map();let snapshot=null;
 const total=patient=>{if(!patient)return null;const cached=patient.remoteId?byId.get(String(patient.remoteId)):byCode.get(String(patient.code||''));return cached??patient.collectedTotal??patient.income??null};
 const eligible=patient=>total(patient)!=null&&Number(total(patient))>=1300;
 window.atlasPatientPaymentHighlight=eligible;
 function accept(rows){byId.clear();byCode.clear();for(const row of rows){if(!Number.isFinite(Number(row.total)))continue;byId.set(String(row.id),Number(row.total));if(row.code)byCode.set(String(row.code),Number(row.total))}snapshot=rows}
 const changes=['atlas:payment-recorded','atlas:budget-payment-recorded','atlas:direct-sale-recorded','atlas:central-payments-changed','atlas:central-invoices-changed','atlas:central-cash-changed','atlas:server-recovered'];
 if(document.getElementById('agendaFrame')){
  const send=()=>{if(snapshot)fichaFrame.contentWindow?.postMessage({type:'atlas:patient-payment-totals',rows:snapshot},'*')};
  const paint=()=>{if(typeof selected==='undefined'||!selected?.patient)return;patientLabel.style.color=eligible(selected.patient)?'#b42318':'';patientLabel.style.fontWeight=eligible(selected.patient)?'900':''};
  window.addEventListener('message',event=>{const m=event.data||{};
   if(m.type==='atlas:patient-payment-totals'&&event.source===agendaFrame.contentWindow&&Array.isArray(m.rows)){accept(m.rows);send();paint()}
   if(m.type==='atlas:patient-selected'){send();paint()}
   if(m.type==='atlas:central-module-ready'&&event.source===fichaFrame.contentWindow)send();
   if(changes.includes(m.type)&&[agendaFrame.contentWindow,fichaFrame.contentWindow].includes(event.source))agendaFrame.contentWindow?.postMessage({type:'atlas:refresh-payment-highlight'},'*');
  });return;
 }
 if(document.getElementById('patientsTableBody')){
  let timer,busy=false,again=false,ready=false;
  function paint(){renderPatientsTable();render();const appointment=appointments.find(a=>String(a.id)===String(selectedId)),name=document.getElementById('dName');if(name&&appointment)name.classList.toggle('patient-invoice-alert',eligible(patientForAppointment(appointment)))}
  async function refresh(){
   if(!ready||document.hidden||typeof window.atlasCentralRequest!=='function')return;
   if(busy){again=true;return}busy=true;
   try{const rows=await window.atlasCentralRequest('patients:list',{paymentTotalsOnly:true});const totals=(rows||[]).map(row=>({id:String(row.id),code:String(row.patient_number||''),total:row.income}));accept(totals);paint();parent.postMessage({type:'atlas:patient-payment-totals',rows:totals},'*')}
   catch(error){console.warn('No se pudo actualizar el color por pagos acumulados',error)}
   finally{busy=false;if(again){again=false;schedule()}}
  }
  function schedule(){clearTimeout(timer);timer=setTimeout(refresh,350)}
  window.addEventListener('message',event=>{const m=event.data||{};if(m.type==='atlas:central-ready')ready=true;if(m.type==='atlas:central-ready'||m.type==='atlas:refresh-payment-highlight'||changes.includes(m.type))schedule()});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule()});window.addEventListener('focus',schedule);
  setInterval(schedule,60000);
  parent.postMessage({type:'atlas:central-module-ready',module:'agenda'},'*');return;
 }
 let patient=null;
 function paint(){const title=document.querySelector('.identity h1');if(title)title.classList.toggle('patient-invoice-alert',eligible(patient))}
 window.addEventListener('message',event=>{const m=event.data||{};
  if(m.type==='atlas:load-patient'&&m.patient){patient=m.patient;paint()}
  if(m.type==='atlas:patient-payment-totals'&&event.source===parent&&Array.isArray(m.rows)){accept(m.rows);paint()}
  if(m.type==='atlas:patient-deleted'){patient=null;paint()}
 });
 parent.postMessage({type:'atlas:central-module-ready',module:'ficha'},'*');
})();
