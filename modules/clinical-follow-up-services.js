(()=>{
 if(window.atlasClinicalFollowUpsV137||typeof therapies==='undefined'||typeof professionals==='undefined')return;
 const followUps=[
  {name:'Seguimiento readaptación',competency:'readaptación'},
  {name:'Seguimiento presencial',competency:'fisioterapia'}
 ];
 const configure=()=>{
  followUps.forEach(({name,competency})=>{
   if(!therapies.includes(name))therapies.push(name);
   const eligible=professionals.filter(professional=>(professionalCompetencies[professional]||[]).includes(competency));
   therapyDurations[name]=30;
   therapyProfessionalDurations[name]=30;
   therapiesWithoutProfessional.delete(name);
   therapyCompetencyRequirement[name]=competency;
   alicanteTherapyResources[name]=eligible;
   alicanteTherapyProfessionals[name]=eligible;
  });
  renderServiceChecks();
 };
 const baseApply=applyRuntimeSettings;
 applyRuntimeSettings=function(...args){const result=baseApply.apply(this,args);configure();return result};
 configure();
 window.atlasClinicalFollowUpsV137=true;
})();
