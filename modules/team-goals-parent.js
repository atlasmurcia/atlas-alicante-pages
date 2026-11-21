(function(root){
  'use strict';

  const METRICS=[
    {key:'team_net_invoicing',step:5000,kind:'money'},
    {key:'team_traction_paid_sessions',step:10,kind:'sessions',tokens:['traccion']},
    {key:'team_mbst_paid_sessions',step:10,kind:'sessions',tokens:['mbst','osteospin']},
    {key:'team_bomba_paid_sessions',step:10,kind:'sessions',tokens:['bomba']},
    {key:'team_brains_paid_sessions',step:10,kind:'sessions',tokens:['brains','brain way','brains way']}
  ];
  const METRIC_KEYS=new Set(METRICS.map(item=>item.key));
  const norm=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const round=value=>Math.round(Number(value||0)*100)/100;
  const month=value=>String(value||'').slice(0,7);
  const monthStart=value=>/^\d{4}-\d{2}$/.test(String(value||''))?String(value)+'-01':null;
  const addMonths=(value,amount)=>{const date=new Date(value+'T12:00:00Z');date.setUTCMonth(date.getUTCMonth()+amount);return date.toISOString().slice(0,7)};
  const monthEnd=value=>addMonths(value,1)+'-01';

  function parseNotes(value){
    try{const parsed=JSON.parse(value||'{}');return parsed&&typeof parsed==='object'?parsed:{}}catch(_){return{}}
  }

  function metricForLine(line,serviceCategories){
    const service=norm(line.service_name||line.service_code),category=norm(serviceCategories.get(service)||line.metadata?.category||''),haystack=category+' '+service;
    return METRICS.find(metric=>metric.tokens?.some(token=>haystack.includes(token)))?.key||null;
  }

  function emptyActual(){return Object.fromEntries(METRICS.map(metric=>[metric.key,0]))}

  function calculateNetRevenue({periods,payments}){
    const result=Object.fromEntries((periods||[]).map(period=>[period,0]));
    for(const payment of payments||[]){
      if(payment.deleted_at||!['completed','cancelled','refunded'].includes(norm(payment.status)))continue;
      const amount=Math.abs(Number(payment.amount||0));
      if(payment.paid_at&&Object.hasOwn(result,month(payment.paid_at)))result[month(payment.paid_at)]=round(result[month(payment.paid_at)]+(norm(payment.payment_type)==='refund'?-amount:Number(payment.amount||0)));
      if(norm(payment.payment_type)!=='refund'&&payment.cancelled_at&&Object.hasOwn(result,month(payment.cancelled_at)))result[month(payment.cancelled_at)]=round(result[month(payment.cancelled_at)]-amount);
    }
    return result;
  }

  function calculateCompletedActivity({periods,appointments}){
    const completed=Object.fromEntries((periods||[]).map(period=>[period,emptyActual()]));
    for(const appointment of appointments||[]){
      if(norm(appointment.status)!=='completed')continue;
      const bucket=completed[month(appointment.starts_at)];if(!bucket)continue;
      const haystack=norm(JSON.stringify([appointment.services,appointment.resources,appointment.metadata?.therapy]));
      const metric=METRICS.find(item=>item.tokens?.some(token=>haystack.includes(token)));
      if(metric)bucket[metric.key]+=1;
    }
    return completed;
  }

  function calculateActuals({periods,invoices,budgets,lines,payments,services}){
    const actuals=Object.fromEntries(periods.map(period=>[period,emptyActual()]));
    for(const invoice of invoices||[]){
      const period=month(invoice.issue_date),bucket=actuals[period];
      if(!bucket||['draft','cancelled','canceled'].includes(norm(invoice.status)))continue;
      const value=Math.abs(Number(invoice.total||0))*(invoice.original_invoice_id?-1:1);
      bucket.team_net_invoicing=round(bucket.team_net_invoicing+value);
    }
    const serviceCategories=new Map((services||[]).map(item=>[norm(item.name),item.category||'']));
    const linesByBudget=new Map();
    for(const line of lines||[]){
      const rows=linesByBudget.get(String(line.budget_id))||[];rows.push(line);linesByBudget.set(String(line.budget_id),rows);
    }
    const paymentsByBudget=new Map();
    for(const payment of payments||[]){
      if(!payment.budget_id||payment.deleted_at)continue;
      const events=paymentsByBudget.get(String(payment.budget_id))||[],amount=Number(payment.amount||0);
      if(payment.paid_at)events.push({at:payment.paid_at,amount});
      if(['cancelled','canceled'].includes(norm(payment.status))&&payment.cancelled_at)events.push({at:payment.cancelled_at,amount:-amount});
      paymentsByBudget.set(String(payment.budget_id),events);
    }
    for(const budget of budgets||[]){
      const total=Number(budget.total||0);if(!(total>0))continue;
      const counts=emptyActual();
      for(const line of linesByBudget.get(String(budget.id))||[]){
        const key=metricForLine(line,serviceCategories);if(key)counts[key]+=Math.max(0,Number(line.sessions||0));
      }
      let balance=0;
      const events=(paymentsByBudget.get(String(budget.id))||[]).sort((a,b)=>String(a.at).localeCompare(String(b.at)));
      for(const event of events){
        const wasPaid=balance+0.005>=total;balance=round(balance+event.amount);const isPaid=balance+0.005>=total;
        if(wasPaid===isPaid)continue;
        const bucket=actuals[month(event.at)];if(!bucket)continue;
        const direction=isPaid?1:-1;
        for(const metric of METRICS.filter(item=>item.kind==='sessions'))bucket[metric.key]=round(bucket[metric.key]+direction*counts[metric.key]);
      }
    }
    return actuals;
  }

  function resolveTargets({periods,rows,actuals}){
    const explicit=new Map();
    for(const row of rows||[]){
      if(!METRIC_KEYS.has(row.metric))continue;
      const byMetric=explicit.get(month(row.period))||{};byMetric[row.metric]={value:Number(row.target_value||0),...parseNotes(row.notes)};explicit.set(month(row.period),byMetric);
    }
    const resolved={};
    for(const period of periods){
      const previous=resolved[addMonths(period,-1)]||{},overrides=explicit.get(period)||{},values={};
      for(const metric of METRICS){
        if(overrides[metric.key]){values[metric.key]={target:overrides[metric.key].value,active:overrides[metric.key].active!==false,step:Number(overrides[metric.key].step??metric.step),explicit:true};continue}
        const prior=previous[metric.key];
        if(!prior){values[metric.key]={target:0,active:false,step:metric.step,explicit:false};continue}
        const achieved=Number(actuals[addMonths(period,-1)]?.[metric.key]||0),next=prior.active&&prior.target>0&&achieved>=prior.target?achieved+prior.step:prior.target;
        values[metric.key]={target:round(next),active:prior.active,step:prior.step,explicit:false};
      }
      resolved[period]=values;
    }
    return resolved;
  }

  async function loadAll(makeQuery){
    const rows=[],size=1000;
    for(let offset=0;;offset+=size){const page=await makeQuery().range(offset,offset+size-1);if(page.error)throw page.error;rows.push(...(page.data||[]));if((page.data||[]).length<size)return rows}
  }

  async function list(db,context,payload={}){
    const selected=String(payload.period||new Date().toISOString().slice(0,7));if(!monthStart(selected))throw new Error('Mes no válido.');
    const [otherSetting,salesSetting]=await Promise.all([
      db.from('clinic_settings').select('payload,updated_at').eq('organization_id',context.organizationId).eq('clinic_id',context.clinicId).eq('section','other').maybeSingle(),
      db.from('clinic_settings').select('payload').eq('organization_id',context.organizationId).eq('clinic_id',context.clinicId).eq('section','sales').maybeSingle(),
    ]);
    if(otherSetting.error)throw otherSetting.error;if(salesSetting.error)throw salesSetting.error;
    const teamGoals=otherSetting.data?.payload?.team_goals||{},configuredPeriods=teamGoals.periods||{},targetRows=[];
    for(const [configuredPeriod,metrics] of Object.entries(configuredPeriods))for(const [metric,item] of Object.entries(metrics||{}))if(METRIC_KEYS.has(metric))targetRows.push({period:configuredPeriod+'-01',metric,target_value:Number(item?.target||0),notes:JSON.stringify({active:item?.active!==false,step:Number(item?.step||METRICS.find(def=>def.key===metric)?.step||0)})});
    targetRows.sort((a,b)=>String(a.period).localeCompare(String(b.period)));
    const eligiblePeriods=targetRows.map(row=>month(row.period)).filter(value=>value<=selected),first=eligiblePeriods[0]||selected,periods=[];for(let cursor=first;cursor<=selected;cursor=addMonths(cursor,1))periods.push(cursor);
    const start=first+'-01',end=monthEnd(selected),[invoices,budgets,payments,appointments]=await Promise.all([
      loadAll(()=>db.from('sales_invoices').select('id,total,issue_date,status,original_invoice_id').eq('organization_id',context.organizationId).eq('clinic_id',context.clinicId).gte('issue_date',start).lt('issue_date',end).order('issue_date',{ascending:true})),
      loadAll(()=>db.from('budgets').select('id,total,created_at').eq('organization_id',context.organizationId).eq('clinic_id',context.clinicId).is('deleted_at',null).lt('created_at',end).order('created_at',{ascending:true})),
      loadAll(()=>db.from('payments').select('id,budget_id,amount,status,payment_type,paid_at,cancelled_at,deleted_at').eq('organization_id',context.organizationId).eq('clinic_id',context.clinicId).lt('paid_at',end).order('paid_at',{ascending:true})),
      loadAll(()=>db.from('appointments').select('id,status,starts_at,services,resources,metadata').eq('organization_id',context.organizationId).eq('clinic_id',context.clinicId).is('deleted_at',null).eq('status','completed').gte('starts_at',start).lt('starts_at',end).order('starts_at',{ascending:true}))
    ]);
    const budgetIds=budgets.map(item=>item.id),lines=[];
    for(let offset=0;offset<budgetIds.length;offset+=100){const page=await db.from('budget_lines').select('budget_id,service_code,service_name,sessions,metadata').eq('organization_id',context.organizationId).in('budget_id',budgetIds.slice(offset,offset+100));if(page.error)throw page.error;lines.push(...(page.data||[]))}
    const paidActuals=calculateActuals({periods,invoices,budgets,lines,payments,services:salesSetting.data?.payload?.services||[]}),netRevenue=calculateNetRevenue({periods,payments}),completedByPeriod=calculateCompletedActivity({periods,appointments}),goalActuals=Object.fromEntries(periods.map(period=>[period,Object.fromEntries(METRICS.map(metric=>[metric.key,metric.kind==='sessions'?completedByPeriod[period][metric.key]:netRevenue[period]]))])),targets=resolveTargets({periods,rows:targetRows,actuals:goalActuals}),currentActual=goalActuals[selected]||emptyActual(),currentPaid=paidActuals[selected]||emptyActual(),currentTarget=targets[selected]||{};
    const metrics=Object.fromEntries(METRICS.map(metric=>{const actual=round(currentActual[metric.key]),target=currentTarget[metric.key]||{target:0,active:false,step:metric.step};return[metric.key,{actual,paid:metric.kind==='sessions'?round(currentPaid[metric.key]):null,target:round(target.target),active:target.active,step:target.step,percentage:target.active&&target.target>0?round(actual/target.target*100):null,remaining:target.active?round(Math.max(0,target.target-actual)):null,explicit:target.explicit}]}));
    const comparison=otherSetting.data?.payload?.team_goals_murcia_comparison||null;
    return{period:selected,clinic:{name:'Alicante',metrics},comparison:comparison&&comparison.period===selected?comparison:null,comparisonUpdatedAt:otherSetting.data?.updated_at||null,rule:{moneyStep:5000,sessionStep:10,paidBudgetRequired:true}};
  }

  async function saveTargets(db,context,payload={}){
    const period=month(payload.period),values=payload.metrics||{};if(!monthStart(period))throw new Error('Mes no válido.');
    const current=await db.from('clinic_settings').select('id,payload').eq('organization_id',context.organizationId).eq('clinic_id',context.clinicId).eq('section','other').maybeSingle();if(current.error)throw current.error;
    const currentPayload=current.data?.payload||{},currentGoals=currentPayload.team_goals||{};
    const metrics=Object.fromEntries(METRICS.map(metric=>{const item=values[metric.key]||{},target=Math.max(0,Number(item.target||0)),active=item.active!==false&&target>0;return[metric.key,{target,active,step:metric.step}]})),payloadValue={...currentPayload,team_goals:{...currentGoals,version:1,rule:{money_step:5000,session_step:10,paid_budget_required:true},periods:{...(currentGoals.periods||{}),[period]:metrics}}};
    const row={organization_id:context.organizationId,clinic_id:context.clinicId,section:'other',payload:payloadValue,updated_by:context.userId,updated_at:new Date().toISOString()},saved=current.data?await db.from('clinic_settings').update(row).eq('id',current.data.id).select('payload,updated_at').single():await db.from('clinic_settings').insert(row).select('payload,updated_at').single();if(saved.error)throw saved.error;return{payload:saved.data?.payload?.team_goals,updated_at:saved.data?.updated_at};
  }

  root.atlasTeamGoalsList=list;root.atlasTeamGoalsSaveTargets=saveTargets;
  root.ATLAS_TEAM_GOALS_CORE={METRICS,calculateActuals,calculateNetRevenue,calculateCompletedActivity,resolveTargets};
  if(typeof module!=='undefined'&&module.exports)module.exports=root.ATLAS_TEAM_GOALS_CORE;
})(typeof window!=='undefined'?window:globalThis);
