const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const sql=fs.readFileSync(path.join(root,'server-proposals/objectives-celebrations-alicante/restrict-celebrations.sql'),'utf8');
const panel=fs.readFileSync(path.join(root,'modules/team-goals-panel.js'),'utf8');

assert.match(sql,/a\.total>1300 and a\.net_paid>=a\.total/,'el cierre debe superar 1.300 € y estar totalmente liquidado');
assert.doesNotMatch(sql,/insert into public\.objective_notifications[\s\S]{0,300}'hourly_progress'/,'no se deben crear felicitaciones horarias');
assert.match(sql,/from \(select distinct unnest\(array\[v_budget\.valuation_user_id,v_budget\.presenter_id\]\)/,'el reconocimiento se dirige a valoración y cierre');
assert.doesNotMatch(sql,/v_budget\.first_name|v_budget\.last_name/,'la felicitación no debe revelar datos del paciente');
assert.match(panel,/findIndex\(item=>item\.kind==='goal_reached'\)/,'solo los objetivos alcanzados abren la fiesta visual');

console.log('celebration rules: ok');
