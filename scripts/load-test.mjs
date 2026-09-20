#!/usr/bin/env node
/*
  Load test for sistema-gestion.
  Node 18+ only; no external dependencies.
  Does NOT bypass Vercel Preview Protection.

  Examples:
    BASE_URL=https://... SESSION_COOKIE='session=...' USERS=50 DURATION=300 node scripts/load-test.mjs
    BASE_URL=https://... SESSION_COOKIE='session=...' USERS=200 DURATION=900 SCENARIO=election node scripts/load-test.mjs

  SESSION_COOKIE may be a single cookie reused by all virtual users or a JSON array
  of cookies for independent sessions:
    SESSION_COOKIES='["session=...","session=..."]'
*/
const BASE_URL = String(process.env.BASE_URL || '').replace(/\/$/,'');
const USERS = Math.max(1, Number(process.env.USERS || 50));
const DURATION = Math.max(10, Number(process.env.DURATION || 120));
const SCENARIO = process.env.SCENARIO || 'election';
const COOKIES = process.env.SESSION_COOKIES ? JSON.parse(process.env.SESSION_COOKIES) : null;
const SINGLE = process.env.SESSION_COOKIE || '';
if(!BASE_URL) { console.error('BASE_URL requerido'); process.exit(2); }
if(!SINGLE && !COOKIES?.length) { console.error('SESSION_COOKIE o SESSION_COOKIES requerido'); process.exit(2); }

const endpoints = [
  ['/api/mesas/miembros','read',1],
  ['/api/centros','read',1],
  ['/api/mesas','read',1],
];
const writable = [
  ['/api/mesas/miembros','write',1],
  ['/api/mesas/miembros','write',1],
  ['/api/verificaciones','write',1],
];

const stats={total:0,ok:0,errors:0,byStatus:{},lat:[],timeouts:0,start:Date.now()};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function percentile(a,p){ if(!a.length)return 0; const b=[...a].sort((x,y)=>x-y); return b[Math.min(b.length-1,Math.floor((p/100)*(b.length-1)))]; }
function cookieFor(i){ return COOKIES?.[i%COOKIES.length] || SINGLE; }

async function hit(path,kind,vu){
  const t=performance.now();
  try{
    const r=await fetch(BASE_URL+path,{
      method: kind==='write' ? 'POST':'GET',
      headers:{'Cookie':cookieFor(vu),'Content-Type':'application/json','Accept':'application/json'},
      body: kind==='write' ? JSON.stringify({loadTest:true,virtualUser:vu,timestamp:Date.now()}):undefined,
      signal:AbortSignal.timeout(10000)
    });
    const ms=performance.now()-t;
    stats.total++; stats.lat.push(ms);
    stats.byStatus[r.status]=(stats.byStatus[r.status]||0)+1;
    if(r.ok || (kind==='write' && [400,409,422].includes(r.status))) stats.ok++; else stats.errors++;
  }catch(e){
    stats.total++; stats.errors++; if(e?.name==='TimeoutError')stats.timeouts++;
  }
}

async function virtualUser(i,end){
  while(Date.now()<end){
    // Model the election-day pattern: bursts every ~15 min with long quiet periods.
    const cycle=(Date.now()-stats.start)%900000;
    const burst=cycle<120000; // first 2 min of each 15-min window
    const isMetric=i%3===0;
    if(SCENARIO==='election' && !burst && !isMetric){ await sleep(5000); continue; }
    const list=isMetric ? endpoints : (burst ? [...endpoints,...writable] : endpoints);
    for(const e of list) await hit(e[0],e[1],i);
    await sleep(isMetric ? 2000 : (burst ? 1000 : 4000));
  }
}

(async()=>{
  console.log(JSON.stringify({baseUrl:BASE_URL,users:USERS,durationSeconds:DURATION,scenario:SCENARIO,started:new Date().toISOString()}));
  const end=Date.now()+DURATION*1000;
  await Promise.all(Array.from({length:USERS},(_,i)=>virtualUser(i,end)));
  console.log(JSON.stringify({
    totalRequests:stats.total,successLike:stats.ok,errors:stats.errors,timeouts:stats.timeouts,
    status:stats.byStatus,
    latencyMs:{p50:Math.round(percentile(stats.lat,50)),p95:Math.round(percentile(stats.lat,95)),p99:Math.round(percentile(stats.lat,99)),max:Math.round(Math.max(...stats.lat,0))},
    requestsPerSecond:Number((stats.total/(DURATION)).toFixed(2)),
    completedAt:new Date().toISOString()
  },null,2));
})();
