// Separate module: keep the captured React bundle untouched.
(function () {
  'use strict';
  const fields = {first_name:'Nombre',last_name:'Apellidos',phone:'Teléfono',email:'Correo',assigned_name:'Responsable',source_detail:'Origen / campaña',notes:'Notas'};
  const pending = new Map();
  let context, leads = [], busy = false, dialog, button;
  const normalPhone = value => {
    let digits=String(value||'').replace(/\D/g,'').replace(/^00/,'');
    if (/^[6789]\d{8}$/.test(digits)) digits='34'+digits;
    return digits.length>=9 ? digits : '';
  };
  const normalEmail = value => String(value||'').trim().toLowerCase();
  function match(a,b) {
    const p=normalPhone(a.phone),e=normalEmail(a.email);
    return Boolean(a.id!==b.id && ((p && p===normalPhone(b.phone)) || (e && e===normalEmail(b.email))));
  }
  // Exposed pure functions support synthetic tests; never merges automatically.
  window.AtlasLeadMerge = {normalPhone,normalEmail,match};
  const el=(tag,text,attrs={})=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;Object.assign(n,attrs);return n;};
  function request(action,payload={}) {
    return new Promise((resolve,reject)=>{
      if (!context || window.parent===window) return reject(new Error('Abre Leads desde ATLAS Alicante.'));
      const requestId='lead-merge-'+crypto.randomUUID();
      const timer=setTimeout(()=>{pending.delete(requestId);reject(new Error('No se ha confirmado la operación. Actualiza antes de repetirla.'));},30000);
      pending.set(requestId,{resolve,reject,timer});
      window.parent.postMessage({type:'atlas:central-db-request',requestId,action,payload},location.origin);
    });
  }
  window.addEventListener('message',event=>{
    if(event.source!==window.parent||event.origin!==location.origin)return;
    const m=event.data||{};
    if(m.type==='atlas:central-ready') {context=m; if(button)button.disabled=!canWrite();}
    if(m.type==='atlas:central-db-response'&&pending.has(m.requestId)) {
      const p=pending.get(m.requestId);clearTimeout(p.timer);pending.delete(m.requestId);
      m.ok?p.resolve(m.data):p.reject(new Error(m.error||'No se pudo guardar.'));
    }
  });
  function canWrite(){return context?.clinicId==='bb64ef32-ae0a-478f-bc30-bf6ce554567a'&&(context.ownerAccess||context.managementAccess||context.permissions?.patients_write===true);}
  async function load(){leads=await request('leads:list');if(!Array.isArray(leads))throw new Error('Respuesta de leads no válida.');}
  function open(){
    if(dialog?.open)return;
    dialog=el('dialog');dialog.className='atlas-lead-merge';
    dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
    const title=el('h2','Comparar y fusionar leads');
    const close=el('button','Cerrar',{type:'button'});close.onclick=()=>{if(!busy)dialog.close();};
    dialog.append(title,el('p','Selecciona dos fichas de la misma persona. Elige la principal para conservar su etapa y seguimiento. Se guardan los originales y el historial de ambas.'),close);
    const content=el('div','Cargando…');dialog.append(content);document.body.append(dialog);dialog.onclose=()=>dialog.remove();dialog.showModal();
    load().then(()=>renderPicker(content)).catch(e=>content.textContent=e.message);
  }
  function renderPicker(content,selected='') {
    content.replaceChildren();
    const search=el('input',undefined,{placeholder:'Buscar por nombre, teléfono o correo',type:'search','ariaLabel':'Buscar fichas para comparar'});
    const list=el('div');content.append(search,list);
    function render(){
      list.replaceChildren();const q=search.value.toLowerCase().trim();
      const rows=leads.filter(l=>[l.first_name,l.last_name,l.phone,l.email].join(' ').toLowerCase().includes(q));
      const counts=new Map();for(const lead of leads)for(const key of [normalPhone(lead.phone)&&'p:'+normalPhone(lead.phone),normalEmail(lead.email)&&'e:'+normalEmail(lead.email)].filter(Boolean))counts.set(key,(counts.get(key)||0)+1);
      const groups=rows.filter(a=>(normalPhone(a.phone)&&(counts.get('p:'+normalPhone(a.phone))||0)>1)||(normalEmail(a.email)&&(counts.get('e:'+normalEmail(a.email))||0)>1));
      list.append(el('p',`${groups.length} fichas con coincidencias de teléfono o correo. Comprueba la identidad: varias personas pueden compartir contacto.`));
      const select=el('select',undefined,{ariaLabel:'Ficha principal'});select.append(el('option','Elige la ficha principal',{value:''}));
      for(const lead of rows)select.append(el('option',`${name(lead)} · ${lead.phone||lead.email||'sin contacto'} · ${lead.metadata?.funnel_stage||lead.status} · ${new Date(lead.created_at).toLocaleDateString('es-ES')}`,{value:lead.id}));
      list.append(select);select.value=selected;
      const matches=el('div');list.append(matches);
      select.onchange=()=>{
        matches.replaceChildren();const a=leads.find(l=>l.id===select.value);if(!a)return;
        const edit=el('button','Editar o archivar esta ficha',{type:'button'});edit.onclick=()=>renderEdit(content,a);matches.append(edit);
        const label=el('p','Segunda ficha:');const other=el('select',undefined,{ariaLabel:'Ficha duplicada'});other.append(el('option','Elige la segunda ficha',{value:''}));
        const candidates=leads.filter(l=>l.id!==a.id).sort((x,y)=>Number(match(a,y))-Number(match(a,x)));
        candidates.forEach(l=>other.append(el('option',`${match(a,l)?'Coincide contacto · ':''}${name(l)} · ${l.phone||l.email||''} · ${l.metadata?.funnel_stage||l.status}`,{value:l.id})));
        matches.append(label,other);other.onchange=()=>{const b=leads.find(l=>l.id===other.value);if(b)renderCompare(content,a,b);};
      };
      if(selected)select.onchange();
    }
    search.oninput=render;render();
  }
  function name(l){return [l.first_name,l.last_name].filter(Boolean).join(' ');}
  function originalPanel(lead,activities){
    const box=el('section');box.append(el('h3',name(lead)),el('p',`Etapa: ${lead.metadata?.funnel_stage||lead.status} · Entrada: ${new Date(lead.created_at).toLocaleString('es-ES')}`));
    const detail=el('details');detail.append(el('summary','Ver información original y fusiones anteriores'));
    const pre=el('pre',JSON.stringify(lead,null,2));detail.append(pre);box.append(detail);
    const history=el('details');history.append(el('summary',`Historial (${activities.length})`));
    activities.forEach(a=>history.append(el('p',`${a.created_at||''} · ${a.summary||''} · ${a.outcome||''}`)));box.append(history);return box;
  }
  async function renderCompare(content,a,b){
    content.replaceChildren(el('p','Cargando ambos historiales…'));
    try{
      const histories=await Promise.all([request('leads:activities',{leadId:a.id}),request('leads:activities',{leadId:b.id})]);
      content.replaceChildren();const cols=el('div');cols.className='alm-columns';cols.append(originalPanel(a,histories[0]),originalPanel(b,histories[1]));content.append(cols);
      const reverse=el('button','Cambiar cuál se conserva',{type:'button'});reverse.onclick=()=>renderCompare(content,b,a);content.append(reverse);
      if(a.patient_id&&b.patient_id&&a.patient_id!==b.patient_id){content.append(el('p','Estas fichas están vinculadas a pacientes distintos. Revisa la identidad antes de fusionar.'));return;}
      const form=el('form');const inputs={};
      Object.entries(fields).forEach(([key,label])=>{
        const wrap=el('label',label),input=el(key==='notes'?'textarea':'input');input.value=key==='notes'?[a.notes,b.notes].filter((x,i,all)=>x&&all.indexOf(x)===i).join('\n\n'):a[key]||b[key]||'';input.required=key==='first_name';inputs[key]=input;
        const source=el('select',undefined,{ariaLabel:`Elegir ${label}`});source.append(el('option','Editar valor',{value:'custom'}),el('option','Usar ficha principal',{value:'a'}),el('option','Usar segunda ficha',{value:'b'}),el('option','Vaciar campo',{value:'empty'}));
        source.onchange=()=>{if(source.value!=='custom')input.value=source.value==='a'?a[key]||'':source.value==='b'?b[key]||'':'';};wrap.append(source,input);form.append(wrap);
      });
      form.append(el('p',`Se conserva la etapa y próxima acción de ${name(a)}. «No contactar» prevalece si está marcado en cualquiera de las dos. La ficha duplicada se archiva; las actividades y tareas pasan a la principal.`));
      const confirm=el('input',undefined,{type:'checkbox',required:true});const label=el('label','He comprobado que ambas fichas son de la misma persona.');label.prepend(confirm);form.append(label);
      const error=el('p');error.setAttribute('role','status');const save=el('button','Confirmar fusión',{type:'submit'});form.append(error,save);content.append(form);
      form.onsubmit=async event=>{
        event.preventDefault();if(busy||!form.reportValidity())return;busy=true;save.disabled=true;
        try{
          const result=await request('leads:merge',{primaryId:a.id,duplicateId:b.id,primaryVersion:a.updated_at,duplicateVersion:b.updated_at,fields:Object.fromEntries(Object.entries(inputs).map(([k,n])=>[k,n.value]))});
          if(!result?.lead?.id)throw new Error('La fusión no ha sido confirmada.');
          await load();if(leads.some(l=>l.id===b.id)||!leads.some(l=>l.id===a.id))throw new Error('Revisa el resultado: el servidor aún no confirma la lista final.');
          content.replaceChildren(el('h3','Fusión guardada y comprobada'),el('p','Se conserva la ficha principal con el historial de ambas. Pulsa «Actualizar ahora» para renovar el tablero.'));
        }catch(e){error.textContent=e.message+' No repitas la fusión sin actualizar las fichas.';const refresh=el('button','Actualizar y revisar',{type:'button'});refresh.onclick=async()=>{try{await load();renderPicker(content,a.id);}catch(e){error.textContent=e.message;}};form.append(refresh);}
        finally{busy=false;save.disabled=false;}
      };
    }catch(e){content.replaceChildren(el('p',e.message));}
  }
  function renderEdit(content,a){
    content.replaceChildren(el('h3',`Editar · ${name(a)}`),el('p','Puedes corregir o vaciar campos. Se conserva una copia anterior en el historial. Archivar retira la ficha de la lista sin borrar su historial.'));
    const form=el('form'),inputs={};Object.entries(fields).forEach(([key,label])=>{const wrap=el('label',label),input=el(key==='notes'?'textarea':'input');input.value=a[key]||'';input.required=key==='first_name';inputs[key]=input;wrap.append(input);form.append(wrap);});
    const archive=el('input',undefined,{type:'checkbox'}),label=el('label','Archivar esta ficha');label.prepend(archive);form.append(label);
    const status=el('p'),save=el('button','Guardar cambios',{type:'submit'});form.append(status,save);content.append(form);
    form.onsubmit=async event=>{event.preventDefault();if(busy||!form.reportValidity())return;busy=true;save.disabled=true;try{const result=await request('leads:editAudited',{id:a.id,version:a.updated_at,fields:Object.fromEntries(Object.entries(inputs).map(([k,n])=>[k,n.value])),archive:archive.checked});if(!result?.id)throw new Error('No se confirmó el guardado.');await load();content.replaceChildren(el('h3','Cambios guardados'),el('p','Pulsa «Actualizar ahora» para renovar el tablero.'));}catch(e){status.textContent=e.message;}finally{busy=false;save.disabled=false;}};
  }
  const style=el('style',`.atlas-lead-merge{width:min(1000px,94vw);max-height:90vh;border:0;border-radius:16px;padding:24px;color:#182135;box-shadow:0 20px 80px #0004}.atlas-lead-merge::backdrop{background:#15203a88}.atlas-lead-merge label{display:grid;gap:6px;margin:14px 0}.atlas-lead-merge select,.atlas-lead-merge input:not([type=checkbox]),.atlas-lead-merge textarea{width:100%;box-sizing:border-box;padding:10px;border:1px solid #cbd3e0;border-radius:8px}.atlas-lead-merge textarea{min-height:90px}.atlas-lead-merge button{padding:10px 16px;border:1px solid #cbd3e0;border-radius:8px;cursor:pointer;margin:8px 8px 8px 0}.atlas-lead-merge button[type=submit]{background:#365cf5;color:white}.atlas-lead-merge pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}.alm-columns{display:grid;grid-template-columns:1fr 1fr;gap:20px}.alm-columns section{min-width:0;background:#f4f6fb;padding:14px;border-radius:12px}@media(max-width:650px){.alm-columns{grid-template-columns:1fr}}`);document.head.append(style);
  const observer=new MutationObserver(()=>{
    const toolbar=document.querySelector('.top-actions');if(!toolbar||document.getElementById('atlasLeadMergeButton'))return;
    button=el('button','Comparar / fusionar',{type:'button',id:'atlasLeadMergeButton',className:'sync-button',disabled:!canWrite()});button.onclick=open;toolbar.append(button);
  });observer.observe(document.body,{childList:true,subtree:true});
  window.addEventListener('pagehide',()=>observer.disconnect(),{once:true});
  window.parent.postMessage({type:'atlas:module-ready',module:'leads'},location.origin);
})();
