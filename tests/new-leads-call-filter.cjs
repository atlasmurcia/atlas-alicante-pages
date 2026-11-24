const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const isMurcia=fs.existsSync('app/page.tsx');
let source,helper,board;
if(isMurcia){
 const ts=require('typescript');source=fs.readFileSync('app/page.tsx','utf8');
 const compiled=ts.transpileModule(source.slice(source.indexOf('function LeadBoard('),source.indexOf('\nfunction sourceIcon(')),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS}}).outputText;
 helper=ts.transpileModule(fs.readFileSync('lib/call-preference.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText+'\nvar classify=callPreference;';board=compiled+'\nvar renderBoard=LeadBoard;';
}else{
 source=fs.readFileSync('flowatlas/assets/index-e_Mf-3Ab.js','utf8');
 helper=source.slice(source.indexOf('function Ke(e){let t=e.metadata'),source.indexOf('function qe({lead:'))+source.slice(source.indexOf('function atlasCallPreference('),source.indexOf('function bt({openFollowUp:'))+'\nvar classify=atlasCallPreference;';
 board=source.slice(source.indexOf('function bt({openFollowUp:'),source.indexOf('function L({icon:'))+'\nvar renderBoard=bt;';
}
const jsx=(type,props,key)=>({type,props:props||{},key});let state=[],cursor=0;
const hooks={useState(value){const i=cursor++;if(!(i in state))state[i]=value;return[state[i],value=>state[i]=value]},useRef(value){return{current:value}}};
const columns=[{stage:'new_lead',label:'Nuevos leads',theme:'new'},{stage:'call_pending',label:'Pendientes de llamar',theme:'call'},{stage:'second_call',label:'2ª llamada',theme:'second'}];
const stage=lead=>lead.metadata?.funnel_stage;
const ctx={exports:{},require:()=>({jsx,jsxs:jsx,Fragment:'fragment'}),C:hooks,I:{jsx,jsxs:jsx,Fragment:'fragment'},...hooks,it:columns,leadColumns:columns,Et:stage,pipelineStage:stage,Ze:()=>null,whatsappLeadState:()=>null,jt:()=>'',leadCampaign:()=>'',Ot:()=>'',formatDate:()=>'',xt:'title',Title:'title',D:'icon',Activity:'icon',N:'icon',Users:'icon',window:{setTimeout(){}}};vm.createContext(ctx);vm.runInContext(helper,ctx);ctx.leadCallPreference=ctx.classify;vm.runInContext(board,ctx);
const preference=(value,metadata={})=>({metadata:{...metadata,...(value===undefined?{}:{preferred_call_time:value})}});
for(const [value,expected] of [['Por la MAÑANA','morning'],['por_las_mañanas','morning'],['Por las tardes, de 16:00 a 18:00','afternoon'],['tarde','afternoon'],['Sin preferencia','none'],['Me da igual','none'],['mañana y tarde','none'],['Cualquier horario','none'],['','none'],[undefined,'none'],['Después de las 18','other']])assert.equal(ctx.classify(preference(value)),expected,value);
assert.equal(ctx.classify(preference(undefined,{meta_form_fields:[{name:'¿Cuándo prefieres que te llamemos?',values:['Por las tardes']}]})),'afternoon');
assert.equal(ctx.classify(preference('Mañana',{meta_form_fields:[{name:'hora_llamada',values:['Tarde']}]})),'morning');
const leads=['Mañana','Tarde',undefined,'Sin preferencia','Mañana y tarde'].map((value,i)=>({id:'synthetic-new-'+i,first_name:'Prueba',metadata:{...preference(value).metadata,funnel_stage:'new_lead'}}));
leads.push({id:'synthetic-other',first_name:'Prueba',metadata:{funnel_stage:'call_pending',preferred_call_time:'Tarde'}},{id:'synthetic-second',first_name:'Prueba',metadata:{funnel_stage:'second_call',preferred_call_time:'Mañana'}});
const original=JSON.stringify(leads);
function nodes(tree,predicate,result=[]){if(Array.isArray(tree)){tree.forEach(item=>nodes(item,predicate,result));return result}if(!tree||typeof tree!=='object')return result;if(predicate(tree))result.push(tree);nodes(tree.props?.children,predicate,result);return result}
const render=(rows=leads)=>{cursor=0;return ctx.renderBoard({leads:rows,loading:false,error:'',context:{clinicId:'synthetic'},refresh:async()=>{},moveLeadStage:async()=>({ok:true})})};
const cards=column=>nodes(column,n=>n.type==='article').map(n=>n.key);
let tree=render();assert.equal(nodes(tree,n=>n.type==='select').length,1);const select=nodes(tree,n=>n.type==='select')[0];assert.deepEqual(nodes(select,n=>n.type==='option').map(n=>n.props.children),['Todos','Mañana','Tarde','Sin preferencia']);
const otherBefore=nodes(tree,n=>n.type==='section'&&n.key&&n.key!=='new_lead').map(cards);
for(const [value,expected] of [['morning',['synthetic-new-0']],['afternoon',['synthetic-new-1']],['none',['synthetic-new-2','synthetic-new-3','synthetic-new-4']],['all',leads.slice(0,5).map(n=>n.id)]]){
 nodes(tree,n=>n.type==='select')[0].props.onChange({target:{value}});tree=render();assert.deepEqual(cards(nodes(tree,n=>n.key==='new_lead')[0]),expected);
 assert.deepEqual(nodes(tree,n=>n.type==='section'&&n.key&&n.key!=='new_lead').map(cards),otherBefore);
}
select.props.onChange({target:{value:'morning'}});tree=render(leads.filter(n=>n.id!=='synthetic-new-0'));assert.equal(cards(nodes(tree,n=>n.key==='new_lead')[0]).length,0);assert.equal(nodes(tree,n=>n.props.className==='pipeline-empty'&&String(n.props.children).includes('horario')).length,1);
assert.equal(JSON.stringify(leads),original,'Filtering never mutates lead records');
console.log('PASS: preferences, form fallback, select interaction, reset, combined upstream filtering, empty results, unchanged other columns and immutable records.');
