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
const hooks={useState(value){const i=cursor++;if(!(i in state))state[i]=value;return[state[i],value=>state[i]=typeof value==='function'?value(state[i]):value]},useRef(value){return{current:value}}};
const columns=vm.runInNewContext(isMurcia?source.slice(source.indexOf('[]=[',source.indexOf('const leadColumns'))+3,source.indexOf('];',source.indexOf('const leadColumns'))+1):source.slice(source.indexOf('it=[{stage:')+3,source.indexOf('],at=',source.indexOf('it=[{stage:'))+1));
assert.equal(columns.length,10);
const stage=lead=>lead.metadata?.funnel_stage;
const ctx={exports:{},require:()=>({jsx,jsxs:jsx,Fragment:'fragment'}),C:hooks,I:{jsx,jsxs:jsx,Fragment:'fragment'},...hooks,it:columns,leadColumns:columns,Et:stage,pipelineStage:stage,Ze:()=>null,whatsappLeadState:()=>null,jt:()=>'',leadCampaign:()=>'',Ot:()=>'',formatDate:()=>'',xt:'title',Title:'title',D:'icon',Activity:'icon',N:'icon',Users:'icon',window:{setTimeout(){}}};vm.createContext(ctx);vm.runInContext(helper,ctx);ctx.leadCallPreference=ctx.classify;vm.runInContext(board,ctx);
const preference=(value,metadata={})=>({metadata:{...metadata,...(value===undefined?{}:{preferred_call_time:value})}});
for(const [value,expected] of [['Por la MAÑANA','morning'],['por_las_mañanas','morning'],['Por las tardes, de 16:00 a 18:00','afternoon'],['tarde','afternoon'],['Sin preferencia','none'],['Me da igual','none'],['mañana y tarde','none'],['Cualquier horario','none'],['','none'],[undefined,'none'],['Después de las 18','other']])assert.equal(ctx.classify(preference(value)),expected,value);
assert.equal(ctx.classify(preference(undefined,{meta_form_fields:[{name:'¿Cuándo prefieres que te llamemos?',values:['Por las tardes']}]})),'afternoon');
assert.equal(ctx.classify(preference('Mañana',{meta_form_fields:[{name:'hora_llamada',values:['Tarde']}]})),'morning');
const leads=columns.flatMap(column=>['Mañana','Tarde',undefined,'Sin preferencia','Mañana y tarde'].map((value,i)=>({id:`synthetic-${column.stage}-${i}`,first_name:'Prueba',metadata:{...preference(value).metadata,funnel_stage:column.stage}})));
const original=JSON.stringify(leads);
function nodes(tree,predicate,result=[]){if(Array.isArray(tree)){tree.forEach(item=>nodes(item,predicate,result));return result}if(!tree||typeof tree!=='object')return result;if(predicate(tree))result.push(tree);nodes(tree.props?.children,predicate,result);return result}
const render=(rows=leads)=>{cursor=0;return ctx.renderBoard({leads:rows,loading:false,error:'',context:{clinicId:'synthetic'},refresh:async()=>{},moveLeadStage:async()=>({ok:true})})};
const cards=column=>nodes(column,n=>n.type==='article').map(n=>n.key);

let tree=render();assert.equal(nodes(tree,n=>n.type==='select').length,columns.length);
for(const column of columns){
 const findColumn=()=>nodes(tree,n=>n.type==='section'&&n.key===column.stage)[0];
 const select=nodes(findColumn(),n=>n.type==='select')[0];assert.equal(select.props['aria-label'],`Horario de llamada · ${column.label}`);
 assert.deepEqual(nodes(select,n=>n.type==='option').map(n=>n.props.children),['Todos','Mañana','Tarde','Sin preferencia']);
 const otherBefore=nodes(tree,n=>n.type==='section'&&n.key&&n.key!==column.stage).map(cards);
 for(const [value,indexes] of [['morning',[0]],['afternoon',[1]],['none',[2,3,4]],['all',[0,1,2,3,4]]]){
  select.props.onChange({target:{value}});tree=render();assert.deepEqual(cards(findColumn()),indexes.map(i=>`synthetic-${column.stage}-${i}`));
  assert.deepEqual(nodes(tree,n=>n.type==='section'&&n.key&&n.key!==column.stage).map(cards),otherBefore,'A column filter must not change other columns');
 }
}
// Independent simultaneous filters must survive another column changing or resetting.
const change=(stage,value)=>{nodes(nodes(tree,n=>n.key===stage)[0],n=>n.type==='select')[0].props.onChange({target:{value}});tree=render()};
change('new_lead','morning');change('second_call','afternoon');
assert.deepEqual(cards(nodes(tree,n=>n.key==='new_lead')[0]),['synthetic-new_lead-0']);
assert.deepEqual(cards(nodes(tree,n=>n.key==='second_call')[0]),['synthetic-second_call-1']);
change('second_call','all');assert.equal(cards(nodes(tree,n=>n.key==='new_lead')[0]).length,1);
tree=render(leads.filter(n=>n.id!=='synthetic-new_lead-0'));assert.equal(cards(nodes(tree,n=>n.key==='new_lead')[0]).length,0);assert.equal(nodes(tree,n=>n.props.className==='pipeline-empty'&&String(n.props.children).includes('horario')).length,1);
assert.equal(JSON.stringify(leads),original,'Filtering never mutates lead records');
console.log('PASS: all 10 column dropdowns, independent simultaneous filtering, reset, preferences, form fallback, upstream filters, empty results and immutable records.');
