import test from 'node:test';
import assert from 'node:assert/strict';
import {CloudSync,cloudPayload,stable} from '../dist/cloud-sync.js';
import {initialState} from '../dist/storage.js';
const clone=value=>structuredClone(value);
const account=id=>({user:{id,email:id+'@example.com'}});
const seed=()=>({...initialState(),localCategories:true,budgets:{'2026-11':500000},transactions:[{id:'salary',name:'Salariu',type:'income',amount:500000,date:'2026-11-01',category:'uncategorized',paymentSource:'cash',salaryMonth:'2026-11',description:''}]});
class Cache{constructor(){this.data=new Map();}getItem(k){return this.data.get(k)||null;}setItem(k,v){this.data.set(k,v);}}
function server(){return {documents:new Map(),writes:0};}
function device(remote,{id='user-a',anonymous=seed(),memory=new Map(),cache=new Cache()}={}){
 const session=id?account(id):null;
 let scope='anonymous',offline=false,barrier=null,holdWrite=null;const statuses=[];if(!memory.has('anonymous'))memory.set('anonymous',clone(anonymous));
 const storage={scope:id=>{scope=id||'anonymous';},load:()=>clone(memory.get(scope)||initialState()),save:s=>memory.set(scope,clone(s)),anonymous:()=>clone(memory.get('anonymous')),empty:initialState};
 const client={auth:{getSession:async()=>({data:{session},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>({error:null})},from:()=>({select:()=>({eq:(_key,userId)=>({maybeSingle:async()=>{if(barrier)await barrier;if(offline)throw Error('offline');return {data:clone(remote.documents.get(userId)||null),error:null};}})})}),rpc:async(_name,{p_expected_version,p_payload})=>{if(holdWrite)await holdWrite;if(offline)throw Error('offline');const current=remote.documents.get(sync.user.id);if((current?.version||0)!==p_expected_version)return {data:null,error:{message:'IXPENCE_CONFLICT'}};const version=p_expected_version+1;remote.documents.set(sync.user.id,{version,payload:clone(p_payload)});remote.writes++;return {data:{version},error:null};}};
 const sync=new CloudSync({client,storage,cache,onStatus:s=>statuses.push(s.phase),onState:()=>{},setTimer:()=>1,clearTimer:()=>{}});
 const edit=fn=>{const next=clone(sync.current);fn(next);const changed=sync.prepareSave(next);storage.save(next);sync.saved(next,changed);};
 return {sync,storage,cache,memory,edit,statuses,setOffline:v=>{offline=v;},holdRead:p=>{barrier=p;},holdWrite:p=>{holdWrite=p;}};
}
const expense=id=>({id,name:id,type:'expense',amount:1000,date:'2026-11-18',category:'uncategorized',paymentSource:'cash',description:''});
test('Anonymous mode remains local; first import is explicit and never changes the original browser data',async()=>{
 const remote=server(),local=device(remote,{id:null});await local.sync.start();assert.equal(local.sync.phase,'local');local.edit(s=>s.transactions.push(expense('local')));assert.equal(remote.writes,0);
 const d=device(remote);await d.sync.start();assert.equal(d.sync.phase,'choose-import');assert.equal(d.sync.canEdit,false);assert.equal(remote.writes,0);assert.throws(()=>d.edit(s=>s.transactions=[]));await d.sync.initialize(true);assert.equal(d.sync.phase,'synced');assert.deepEqual(remote.documents.get('user-a').payload,cloudPayload(seed()));assert.deepEqual(d.memory.get('anonymous'),seed());
});
test('Existing cloud loads on a new device without uploading or overwriting its anonymous data',async()=>{
 const remote=server();remote.documents.set('user-a',{version:3,payload:cloudPayload(seed())});const local=seed();local.transactions.push(expense('anonymous-only'));const d=device(remote,{anonymous:local});await d.sync.start();assert.equal(d.sync.meta.version,3);assert.equal(d.sync.current.transactions.length,1);assert.deepEqual(d.memory.get('anonymous'),local);assert.equal(remote.writes,0);
 d.edit(s=>{s.theme='light';s.collapsed=true;});assert.equal(d.sync.meta.pending,false);d.edit(s=>s.transactions.push(expense('new')));assert.equal(d.sync.meta.pending,true);await d.sync.synchronize();assert.equal(d.sync.phase,'synced');assert.equal(remote.documents.get('user-a').payload.transactions.length,2);assert.equal(remote.documents.get('user-a').payload.theme,undefined);
});
test('Offline edits survive restarting the client and upload once when online',async()=>{
 const remote=server(),d=device(remote);await d.sync.start();await d.sync.initialize(true);d.setOffline(true);d.edit(s=>s.transactions.push(expense('offline')));await d.sync.synchronize();assert.equal(d.sync.phase,'offline');assert.equal(d.sync.meta.pending,true);assert.equal(d.sync.canEdit,true);
 const next=device(remote,{memory:d.memory,cache:d.cache});await next.sync.start();assert.equal(next.sync.phase,'synced');assert.equal(remote.documents.get('user-a').payload.transactions.filter(t=>t.id==='offline').length,1);const writes=remote.writes;await next.sync.synchronize();assert.equal(remote.writes,writes);
});
test('Simultaneous devices stop on conflict; cloud choice is explicit and retains the anonymous copy',async()=>{
 const remote=server(),a=device(remote);await a.sync.start();await a.sync.initialize(true);const b=device(remote);await b.sync.start();a.edit(s=>s.transactions.push(expense('A')));b.edit(s=>s.transactions.push(expense('B')));await b.sync.synchronize();await a.sync.synchronize();assert.equal(a.sync.phase,'conflict');assert.equal(a.sync.canEdit,false);assert.ok(a.sync.current.transactions.some(t=>t.id==='A'));assert.ok(remote.documents.get('user-a').payload.transactions.some(t=>t.id==='B'));assert.throws(()=>a.edit(s=>s.transactions=[]));await a.sync.useCloud();assert.equal(a.sync.phase,'synced');assert.ok(a.sync.current.transactions.some(t=>t.id==='B'));assert.deepEqual(a.memory.get('anonymous'),seed());
});
test('Keeping the device copy uses compare-and-swap and cannot overwrite an unseen newer save',async()=>{
 const remote=server(),a=device(remote);await a.sync.start();await a.sync.initialize(true);const b=device(remote);await b.sync.start();a.edit(s=>s.transactions.push(expense('A')));b.edit(s=>s.transactions.push(expense('B')));await b.sync.synchronize();await a.sync.synchronize();b.edit(s=>s.transactions.push(expense('B2')));await b.sync.synchronize();await a.sync.useDevice();assert.equal(a.sync.phase,'conflict');assert.ok(remote.documents.get('user-a').payload.transactions.some(t=>t.id==='B2'));await a.sync.useDevice();assert.equal(a.sync.phase,'synced');assert.ok(remote.documents.get('user-a').payload.transactions.some(t=>t.id==='A'));
});
test('Two first-time imports cannot duplicate or silently replace each other',async()=>{
 const remote=server(),a=device(remote),b=device(remote);await a.sync.start();await b.sync.start();await a.sync.initialize(true);await b.sync.initialize(true);assert.equal(b.sync.phase,'conflict');assert.equal(remote.writes,1);assert.equal(remote.documents.get('user-a').payload.transactions.length,1);
});
test('Edits arriving during an upload remain pending and are sent against the next version',async()=>{
 const remote=server(),d=device(remote);await d.sync.start();await d.sync.initialize(true);d.edit(s=>s.transactions.push(expense('first')));let release;d.holdWrite(new Promise(r=>release=r));const push=d.sync.synchronize();await new Promise(r=>setTimeout(r,0));d.edit(s=>s.transactions.push(expense('second')));release();await push;assert.equal(d.sync.meta.pending,true);d.holdWrite(null);await d.sync.synchronize();assert.equal(d.sync.meta.pending,false);assert.equal(remote.documents.get('user-a').payload.transactions.length,3);
});
test('Open forms defer remote pulls so a stale edit is detected instead of overwriting a newer remote transaction',async()=>{
 const remote=server(),d=device(remote);await d.sync.start();await d.sync.initialize(true);d.sync.canPull=()=>false;remote.documents.set('user-a',{version:2,payload:cloudPayload(seed())});await d.sync.synchronize();assert.equal(d.sync.meta.version,1);d.edit(s=>s.transactions.push(expense('draft')));await d.sync.synchronize();assert.equal(d.sync.phase,'conflict');
});
test('Logout restores anonymous data; separate accounts never receive each other’s cached financial data',async()=>{
 const remote=server(),d=device(remote);await d.sync.start();await d.sync.initialize(true);d.edit(s=>s.transactions.push(expense('private-A')));await d.sync.synchronize();await d.sync.logout();assert.deepEqual(d.sync.current,seed());await d.sync.setSession(account('user-b'));assert.equal(d.sync.phase,'choose-import');await d.sync.initialize(false);assert.equal(d.sync.current.transactions.length,0);assert.equal(remote.documents.get('user-a').payload.transactions.length,2);
});
test('A delayed account response after logout cannot replace anonymous data',async()=>{
 const remote=server();remote.documents.set('user-a',{version:1,payload:cloudPayload(seed())});const d=device(remote);let release;d.holdRead(new Promise(r=>release=r));const login=d.sync.start();await new Promise(r=>setTimeout(r,0));await d.sync.setSession(null);release();await login;assert.equal(d.sync.user,null);assert.equal(d.sync.phase,'local');assert.deepEqual(d.sync.current,seed());
});
test('Invalid cloud data and missing schema preserve local data and block an unsafe import',async()=>{
 const remote=server();remote.documents.set('user-a',{version:1,payload:{version:1,transactions:'invalid'}});const d=device(remote);await d.sync.start();assert.equal(d.sync.phase,'error');assert.equal(d.sync.canEdit,false);assert.deepEqual(d.memory.get('anonymous'),seed());assert.equal(remote.writes,0);
});
test('Stable payload comparison ignores object-key order but retains every financial field',()=>{assert.equal(stable({a:1,b:2}),stable({b:2,a:1}));assert.equal(cloudPayload({...seed(),theme:'light',collapsed:true}).theme,undefined);assert.deepEqual(cloudPayload(seed()).budgets,seed().budgets);});
