// Pruebas del núcleo de cálculo. Sin dependencias:  node tests/calc.test.js
'use strict';
var assert = require('node:assert');
var path = require('node:path');
var C = require(path.join(__dirname, '..', 'core.js'));

var TOL = 0.1;                 // puntos porcentuales
var failed = 0, passed = 0;
function near(actual, expected, tol, msg){
  assert.ok(Math.abs(actual-expected) <= tol, msg+': esperado '+expected+' ± '+tol+', obtenido '+actual);
}
function test(name, fn){
  try{ fn(); passed++; console.log('  ok  '+name); }
  catch(e){ failed++; console.log('  FALLA  '+name+'\n        '+e.message); }
}

// Condiciones en las que el método de la app equivale a Q·ΔP/36 con la potencia dada como potencia al eje:
// kW medidos directos, η motor = η transmisión = 100 %, Δz = 0 y diámetros de aspiración e impulsión iguales.
function pump(tag, Q, Ps, Pd, kW, extra){
  var P = { tag:tag, train:0,
    pump:{ tipo:'simple', clase:'le300', etapas:2, rpm:2950, motorKW:null, Qbep:null, Hbep:null, etaBep:null, etaMdef:100, etaT:100, fund:'rigid', curve:[] },
    inst:{ Ds:150, Dd:150, dz:0 },
    points:[{ Q:Q, Ps:Ps, Pd:Pd, V:null, I:null, cos:null, kW:kW, etaM:100, etaRef:null, Href:null, NPSHr:null, vib:{} }] };
  if(extra) for(var k in extra) P.pump[k]=extra[k];
  return P;
}
function system(arr, pumps){
  return { arr:arr, mode:'kw', units:{ Q:'m3h', P:'bar', D:'mm', RHO:'kgm3', VISC:'cst' },
    fluid:{ rho:998, visc:1.0, T:20, Pv:null, Patm:1.013, applyVisc:true },
    unc:{ Q:2, P:0.5, FS:10, W:1, rho:0.5, etaM:1.5 }, econ:{ price:null, hours:8000 },
    sys:{ pumps:pumps, active:0, qMode:'each' } };
}

console.log('Fórmula directa');
test('Ph = Q·ΔP/36', function(){
  near(C.hydKW(118, 8.7), 28.5167, 1e-3, 'Ph P-1');
  near(C.hydKW(100, 22), 61.111, 1e-3, 'Ph principal');
});
test('número con coma decimal', function(){
  assert.strictEqual(C.num('9,9'), 9.9);
  assert.strictEqual(C.num('1.234,5'), 1234.5);
  assert.strictEqual(C.num('1,234.5'), 1234.5);
  assert.ok(isNaN(C.num('abc')));
});

console.log('Paralelo (succión 1,2 bar, descarga 9,9 bar)');
var par = C.sysCalc(system('parallel', [ pump('P-1', 118, 1.2, 9.9, 41.6), pump('P-2', 62, 1.2, 9.9, 29.0) ]), 0);
test('P-1: 118 m³/h, 41,6 kW → 68,6 %', function(){ near(par.pumps[0].r.eta, 68.6, TOL, 'η P-1'); });
test('P-2: 62 m³/h, 29,0 kW → 51,7 %', function(){ near(par.pumps[1].r.eta, 51.7, TOL, 'η P-2'); });
test('grupo: 180 m³/h', function(){ assert.ok(par.complete); near(par.g.Q, 180, 1e-9, 'Q grupo'); });
test('grupo: 61,6 %', function(){ near(par.g.eta, 61.6, TOL, 'η grupo'); });
test('grupo: 0,392 kWh/m³', function(){ near(par.g.Eesp, 0.392, 0.0005, 'energía específica'); });
test('Ph de la app = Q·ΔP/36', function(){ near(par.pumps[0].r.Ph, C.hydKW(118, 8.7), 1e-9, 'Ph'); });
test('sin aviso de descargas distintas', function(){ assert.ok(!par.warns.some(function(w){ return /descarga/.test(w.t); })); });

console.log('Serie con 100 m³/h');
var ser = C.sysCalc(system('series', [ pump('Booster', 100, 1.0, 5.0, 16), pump('Principal', 100, 5.0, 27.0, 98) ]), 0);
test('Booster: ΔP 4 bar, 16 kW → 69,4 %', function(){ near(ser.pumps[0].dP, 4, 1e-9, 'ΔP'); near(ser.pumps[0].r.eta, 69.4, TOL, 'η booster'); });
test('Principal: ΔP 22 bar, 98 kW → 62,4 %', function(){ near(ser.pumps[1].dP, 22, 1e-9, 'ΔP'); near(ser.pumps[1].r.eta, 62.4, TOL, 'η principal'); });
test('grupo: ΔP total 26 bar', function(){ near(ser.g.dP, 26, 1e-9, 'ΔP total'); });
test('grupo: caudal común 100 m³/h', function(){ near(ser.g.Q, 100, 1e-9, 'Q grupo'); });
test('grupo: 63,3 %', function(){ near(ser.g.eta, 63.3, TOL, 'η grupo'); });
test('grupo: 1,14 kWh/m³', function(){ near(ser.g.Eesp, 1.14, 0.0005, 'energía específica'); });

console.log('Validaciones');
test('serie: caudales que difieren más de 5 % generan aviso', function(){
  var r = C.sysCalc(system('series', [ pump('A', 100, 1, 5, 16), pump('B', 110, 5, 27, 98) ]), 0);
  assert.ok(r.warns.some(function(w){ return /difieren/.test(w.t) && /serie/i.test(w.t); }));
});
test('paralelo: descargas que difieren más de 5 % generan aviso', function(){
  var r = C.sysCalc(system('parallel', [ pump('A', 118, 1.2, 9.9, 41.6), pump('B', 62, 1.2, 8.9, 29) ]), 0);
  assert.ok(r.warns.some(function(w){ return /descarga/.test(w.t); }));
});
test('descarga menor que succión: error y grupo incompleto', function(){
  var r = C.sysCalc(system('parallel', [ pump('A', 118, 9.9, 1.2, 41.6), pump('B', 62, 1.2, 9.9, 29) ]), 0);
  assert.ok(!r.complete); assert.ok(r.errors.some(function(e){ return /ΔP ≤ 0/.test(e); }));
});
test('η > 100 % pide revisar los datos', function(){
  var r = C.sysCalc(system('parallel', [ pump('A', 118, 1.2, 9.9, 20), pump('B', 62, 1.2, 9.9, 29) ]), 0);
  assert.ok(!r.ok); assert.ok(r.errors.some(function(e){ return /revise/i.test(e); }));
});
test('fuera de 70–120 % del BEP: advertencia', function(){
  var r = C.sysCalc(system('parallel', [ pump('A', 118, 1.2, 9.9, 41.6, { Qbep:120 }), pump('B', 62, 1.2, 9.9, 29, { Qbep:120 }) ]), 0);
  assert.ok(r.warns.some(function(w){ return /^B opera al 52 %/.test(w.t); }));
  assert.ok(!r.warns.some(function(w){ return /^A opera/.test(w.t); }));
});

console.log('Curvas y estimación de reparto');
var CUR = [{ Q:0, H:100 }, { Q:100, H:90 }, { Q:200, H:60 }];
test('serie suma alturas a igual caudal', function(){
  var c = C.seriesCurve([CUR, CUR]); near(c[0].H, 200, 1e-9, 'H a Q=0'); near(c[c.length-1].H, 120, 1e-9, 'H a Q=200');
});
test('paralelo suma caudales a igual altura', function(){
  var c = C.parallelCurve([CUR, CUR]);
  var at90 = c.filter(function(p){ return Math.abs(p.H-90)<1e-9; })[0]; near(at90.Q, 200, 1e-9, 'Q a H=90');
});
test('reparto estimado con caudal total (marcado como estimación)', function(){
  var S = system('parallel', [ pump('A', null, 0, 9.0, 30, { curve:CUR }), pump('B', null, 0, 9.0, 30, { curve:CUR }) ]);
  S.sys.qMode='total'; S.sys.pumps[0].points[0].Qtot=200;
  var r = C.sysCalc(S, 0);
  assert.ok(r.est); near(r.pumps[0].r.Q, 100, 1e-9, 'Q A'); near(r.g.Q, 200, 1e-9, 'Q grupo');
});

console.log('Bomba individual (método existente, sin cambios)');
test('calcPoint con Pe eléctrica y η motor 93 %', function(){
  var S = system('single', []);
  S.pump = pump('x', 0, 0, 0, 0).pump; S.pump.etaMdef = null; S.inst = { Ds:150, Dd:150, dz:0 };
  var r = C.calcPoint(S, { Q:118, Ps:1.2, Pd:9.9, kW:41.6, vib:{} });
  near(r.eta, 28.5167/(41.6*0.93)*100, 1e-3, 'η con η motor por defecto');
});

console.log('\n'+passed+' correctas, '+failed+' fallidas');
if(failed) process.exit(1);
