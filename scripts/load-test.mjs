#!/usr/bin/env node
/*
  Authenticated election-day load test.
  Uses only real API routes + real HTTP methods/payload shapes.
  Optional real fixture variables:
    LOAD_TEST_CENTRO, LOAD_TEST_CEDULA, LOAD_TEST_MESA
  If they are not supplied, write endpoints are exercised through their
  real validation paths (no fake loadTest payloads and no fake routes).
*/
const BASE_URL=String(process.env.BASE_URL||'').replace(/\/$/,'');
const USERS=Math.max(1,Number(process.env.USERS||50));
const DURATION=Math.max(10,Number(process.env.DURATION||120));
const SCENARIO=process.env.SCENARIO||'election';
const COOKIES=process.env.SESSION_COOKIES?JSON.parse(process.env.SESSION_COOKIES):null;
const SINGLE=process.env.SESSION_COOKIE||'';
const CENTRO=String(process.env.LOAD_TEST_CENTRO||'').trim();
const CEDULA=String(process.env.LOAD_TEST_CEDULA||'').replace(/\D/g,'');
const MESA=String(process.env.LOAD_TEST_MESA||'1').trim();
if(!BASE_URL) throw new Error('BASE_URL requerido');
if(!SINGLE&&!COOKIES?.length) throw new Error('SESSION_COOKIE o SESSION_COOKIES requerido');

const stats={total:0,ok:0,errors:0,byStatus:{},lat:[],timeouts:0,start:Date.now()};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const percentile=(a,p)=>{if(!a.length)return 0;const b=[...a].sort((x,y)=>x-y);return b[Math.min(b.length-1,Math.floor((p/100)*(b.length-1)))]};
const cookieFor=i=>COOKIES?.[i%COOKIES.length]||SINGLE;

function requestSpec(i){
  const specs=[
    {path:'/api/health',method:'GET',expected:[200],public:true},
    {path:'/api/auth/session',method:'GET',expected:[200,401]},
    {path:'/api/mesas/miembros',method:'POST',expected:[200,400,404,409],body:CENTRO?{accion:'historial_maquina',centro_codigo:CENTRO,mesa:MESA}:{accion:'historial_maquina'}},
    {path:'/api/cortes',method:'POST',expected:[201,400,404],body:CENTRO?{centro_codigo:CENTRO,etiqueta:'LOAD-TEST'}:{centro_codigo:''}},
    {path:'/api/actas',method:'POST',expected:[201,400,404,409],body:CENTRO?{centro_codigo:CENTRO,mesa:MESA,votos_partido:0}:{centro_codigo:'',mesa:'1',votos_partido:0}},
    {path:'/api/verificaciones',method:'POST',expected:[201,400,404,409],body:CENTRO&&CEDULA?{cedula:CEDULA,centro_codigo:CENTRO,mesa:MESA}:{cedula:'',centro_codigo:'',mesa:''}}
  ];
  const metric=i%3===0;
  const burst=(Date.now()-stats.start)%900000<120000;
  if(!metric&&!burst) return specs.slice(0,2);
  return specs;
}

async function hit(spec,vu){
  const t=performance.now();
  try{
    const opts={method:spec.method,headers:{'Cookie':cookieFor(vu),'Accept':'application/json'},signal:AbortSignal.timeout(10000)};
    if(spec.body){opts.headers['Content-Type']='application/json';opts.body=JSON.stringify(spec.body)}
    const r=await fetch(BASE_URL+spec.path,opts);
    const ms=performance.now()-t;
    stats.total++;stats.lat.push(ms);stats.byStatus[r.status]=(stats.byStatus[r.status]||0)+1;
    if(spec.expected.includes(r.status))stats.ok++;else stats.errors++;
  }catch(e){stats.total++;stats.errors++;if(e?.name==='TimeoutError')stats.timeouts++}
}

async function virtualUser(i,end){
  while(Date.now()<end){
    const burst=(Date.now()-stats.start)%900000<120000;
    const metric=i%3===0;
    if(SCENARIO==='election'&&!burst&&!metric){await sleep(5000);continue}
    for(const spec of requestSpec(i))await hit(spec,i);
    await sleep(metric?2000:(burst?1000:4000));
  }
}

(async()=>{
  console.log(JSON.stringify({baseUrl:BASE_URL,users:USERS,durationSeconds:DURATION,scenario:SCENARIO,fixtureConfigured:Boolean(CENTRO),started:new Date().toISOString()}));
  const end=Date.now()+DURATION*1000;
  await Promise.all(Array.from({length:USERS},(_,i)=>virtualUser(i,end)));

  // Never spread a large latency array into Math.max: at 300/400 VUs this can
  // overflow the JS argument stack and silently suppress the final report.
  const maxLatency=stats.lat.reduce((max,v)=>v>max?v:max,0);
  console.log(JSON.stringify({
    totalRequests:stats.total,acceptedResponses:stats.ok,unexpectedResponses:stats.errors,
    timeouts:stats.timeouts,status:stats.byStatus,
    latencyMs:{p50:Math.round(percentile(stats.lat,50)),p95:Math.round(percentile(stats.lat,95)),p99:Math.round(percentile(stats.lat,99)),max:Math.round(maxLatency)},
    requestsPerSecond:Number((stats.total/DURATION).toFixed(2)),completedAt:new Date().toISOString()
  },null,2));
  if(stats.errors||stats.timeouts)process.exitCode=1;
})();