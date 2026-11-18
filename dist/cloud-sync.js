import {createBackup,parseBackup} from './features.js?v=cloud-20261118';

export function cloudPayload(state){const {theme,collapsed,...data}=state;return data;}
export function stable(value){if(Array.isArray(value))return '['+value.map(stable).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';return JSON.stringify(value);}
export function validateCloudDocument(payload,appearance={}){return {...parseBackup(createBackup(payload)),theme:appearance.theme||'dark',collapsed:!!appearance.collapsed};}
export const hasLocalData=s=>s.transactions.length>0||s.categories.length>0||['budgets','categoryBudgets','mealVouchers','mealAllocations','monthClosures'].some(k=>Object.keys(s[k]||{}).length>0)||(s.bills||[]).length>0||(s.goals||[]).length>0;
const message=error=>/PGRST20[25]|42P01|ixpence_documents.*(exist|schema)/i.test([error?.code,error?.message].join(' '))?'Configurarea Supabase nu este completă. Rulează scriptul SQL și apasă Reîncearcă.':error?.message||'Conexiunea cu Supabase nu este disponibilă.';

export class CloudSync{
 constructor({client,storage,cache,onState=()=>{},onStatus=()=>{},canPull=()=>true,setTimer=(fn,ms)=>setTimeout(fn,ms),clearTimer=id=>clearTimeout(id)}){
  Object.assign(this,{client,storage,cache,onState,onStatus,canPull,setTimer,clearTimer});this.user=null;this.session=null;this.phase='loading';this.canEdit=false;this.meta={version:0,pending:false,initialized:false};this.current=null;this.remote=null;this.epoch=0;this.busy=false;this.timer=null;this.detail='';
 }
 status(phase,detail=''){this.phase=phase;this.detail=detail;this.onStatus(this);}
 metaKey(){return 'ixpence-cloud-meta:'+this.user.id;}
 readMeta(){try{return JSON.parse(this.cache.getItem(this.metaKey()))||{version:0,pending:false,initialized:false};}catch{throw Error('Metadatele sincronizării nu pot fi citite. Datele locale au fost păstrate.');}}
 writeMeta(meta){this.cache.setItem(this.metaKey(),JSON.stringify(meta));this.meta=meta;}
 apply(state){this.current=state;this.onState(state);}
 store(state){this.storage.save(state);this.cached=true;this.apply(state);}
 async start(){
  const {data,error}=await this.client.auth.getSession();if(error)throw error;
  await this.setSession(data.session);
  this.authSubscription=this.client.auth.onAuthStateChange((_event,session)=>{queueMicrotask(()=>this.setSession(session).catch(e=>this.status('error',message(e))));}).data.subscription;
 }
 async setSession(session){
  if(session?.user?.id===this.user?.id&&this.current){this.session=session;return;}
  this.epoch++;this.clearTimer(this.timer);this.timer=null;this.busy=false;this.session=session;this.user=session?.user||null;this.canEdit=false;this.remote=null;
  if(!this.user){this.storage.scope(null);this.apply(this.storage.load());this.canEdit=true;this.status('local');return;}
  const appearance=this.current;this.storage.scope(this.user.id);this.cached=this.storage.exists?this.storage.exists():true;this.meta=this.readMeta();this.current=this.storage.load();if(!this.cached&&appearance){this.current.theme=appearance.theme;this.current.collapsed=appearance.collapsed;}this.apply(this.current);this.status('loading');
  await this.synchronize(true);
 }
 async readRemote(){const {data,error}=await this.client.from('ixpence_documents').select('version,payload').eq('user_id',this.user.id).maybeSingle();if(error)throw error;if(data&&(!Number.isSafeInteger(data.version)||data.version<1))throw Error('Versiunea datelor din cloud este invalidă.');if(data)data.state=validateCloudDocument(data.payload,this.current);return data;}
 adopt(remote){
  this.storage.save(remote.state);this.cached=true;this.writeMeta({version:remote.version,pending:false,initialized:true});this.apply(remote.state);this.remote=null;this.canEdit=true;this.status('synced');
 }
 schedule(delay=500){this.clearTimer(this.timer);this.timer=this.setTimer(()=>this.synchronize().catch(e=>this.status('error',message(e))),delay);}
 prepareSave(next){
  if(!this.canEdit)throw Error(this.phase==='conflict'?'Există modificări pe alt dispozitiv. Rezolvă conflictul din Setări înainte de a continua.':'Așteaptă încărcarea datelor sau finalizează conectarea din Setări.');
  if(!this.user)return false;
  const changed=stable(cloudPayload(next))!==stable(cloudPayload(this.current));if(!changed)return false;
  const actual=this.readMeta();if(stable(actual)!==stable(this.meta))throw Error('Datele au fost modificate în altă filă. Reîncarcă pagina înainte de a salva.');
  this.writeMeta({...this.meta,pending:true,nonce:globalThis.crypto.randomUUID()});return true;
 }
 saved(next,changed){this.current=next;if(this.user&&changed){this.status('pending');this.schedule();}}
 async synchronize(initial=false){
  if(!this.user||this.busy||(!initial&&['choose-import','conflict'].includes(this.phase)))return;
  if(!initial&&!this.meta.pending&&!this.canPull())return;
  const epoch=this.epoch;this.busy=true;
  try{
   const remote=await this.readRemote();if(epoch!==this.epoch)return;
   this.remote=remote;
   if(!this.meta.initialized){
    if(remote){this.adopt(remote);return;}
    this.canEdit=false;this.status('choose-import');return;
   }
   if(!remote){this.canEdit=false;this.status('conflict','Documentul din cloud nu mai există. Datele locale au fost păstrate.');return;}
   if(this.meta.pending){
    if(remote.version!==this.meta.version){this.canEdit=false;this.status('conflict','Alt dispozitiv a salvat între timp. Alege explicit varianta de păstrat.');return;}
    await this.push(this.meta.version,epoch);return;
   }
   if(remote.version!==this.meta.version||initial){this.adopt(remote);}else{this.canEdit=true;this.status('synced');}
  }catch(error){
   if(epoch!==this.epoch)return;
   if(String(error?.message).includes('IXPENCE_CONFLICT')){
    this.canEdit=false;try{this.remote=await this.readRemote();if(epoch!==this.epoch)return;}catch{}this.status('conflict','Alt dispozitiv a salvat între timp. Datele locale nu au fost suprascrise.');
   }else{this.canEdit=!!this.meta.initialized&&this.cached;this.status(this.meta.initialized?'offline':'error',message(error));}
  }finally{
   if(epoch===this.epoch){this.busy=false;if(this.user&&!['conflict','choose-import'].includes(this.phase))this.schedule(this.meta.pending&&this.phase==='synced'?500:10000);}
  }
 }
 async push(expectedVersion,epoch=this.epoch){
  const payload=cloudPayload(this.current),sent=stable(payload);
  this.status('pending');
  const {data,error}=await this.client.rpc('ixpence_save',{p_expected_version:expectedVersion,p_payload:payload});if(epoch!==this.epoch)return;if(error)throw error;
  if(!Number.isSafeInteger(data?.version)||data.version!==expectedVersion+1)throw Error('Confirmarea salvării în cloud nu este validă.');
  const pending=stable(cloudPayload(this.current))!==sent;
  this.writeMeta({version:data.version,pending,initialized:true});this.remote=null;this.canEdit=true;this.status(pending?'pending':'synced');if(pending)this.schedule();
 }
 async initialize(useLocal){
  if(this.phase!=='choose-import'||this.busy)throw Error('Așteaptă verificarea datelor din cloud.');
  const epoch=this.epoch;this.busy=true;
  try{
   const next=useLocal?this.storage.anonymous():this.storage.empty();
   const validated=validateCloudDocument(cloudPayload(next),next);
   // Persist a recoverable copy before attempting the first upload.
   this.writeMeta({version:0,pending:true,initialized:true});this.store(validated);await this.push(0,epoch);
  }catch(error){if(epoch===this.epoch){this.canEdit=false;if(String(error?.message).includes('IXPENCE_CONFLICT')){this.remote=await this.readRemote();this.status('conflict','Contul a primit deja date de pe alt dispozitiv.');}else this.status('error',message(error));}}
  finally{if(epoch===this.epoch){this.busy=false;if(this.meta.pending)this.schedule(10000);}}
 }
 async useCloud(){
  if(this.phase!=='conflict'||this.busy)throw Error('Nu există un conflict de rezolvat.');const epoch=this.epoch;this.busy=true;
  try{const remote=await this.readRemote();if(epoch!==this.epoch)return;if(!remote){this.status('conflict','Cloudul este gol. Poți salva explicit varianta locală.');return;}this.adopt(remote);}catch(e){this.status('conflict',message(e));}finally{if(epoch===this.epoch)this.busy=false;}
 }
 async useDevice(){
  if(this.phase!=='conflict'||this.busy)throw Error('Nu există un conflict de rezolvat.');const version=this.remote?.version||0,epoch=this.epoch;this.busy=true;
  try{await this.push(version,epoch);}catch(e){if(epoch===this.epoch){try{this.remote=await this.readRemote();}catch{}this.canEdit=false;this.status('conflict',String(e?.message).includes('IXPENCE_CONFLICT')?'Cloudul s-a schimbat din nou. Verifică și confirmă din nou varianta dorită.':message(e));}}finally{if(epoch===this.epoch)this.busy=false;}
 }
 async retry(){if(this.phase==='conflict')return;await this.synchronize(true);}
 async logout(){await this.client.auth.signOut({scope:'local'}).then(({error})=>{if(error)throw error;});await this.setSession(null);}
 dispose(){this.epoch++;this.clearTimer(this.timer);this.authSubscription?.unsubscribe();}
}
