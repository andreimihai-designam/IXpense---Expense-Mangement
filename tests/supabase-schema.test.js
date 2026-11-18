import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const doc={version:1,transactions:[],categories:[],budgets:{}};
test('Supabase SQL enforces account isolation, denies anonymous/direct writes and rejects stale saves',async()=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;insert into auth.users values('${A}'),('${B}');`);
 const sql=await readFile(new URL('../supabase/schema.sql',import.meta.url),'utf8');await db.exec(sql);await db.exec(sql);
 await db.exec('set role anon');await assert.rejects(db.query('select * from public.ixpence_documents'),/permission denied/);await assert.rejects(db.query('select public.ixpence_save(0,$1::jsonb)',[JSON.stringify(doc)]),/permission denied/);
 await db.exec(`reset role;set role authenticated;select set_config('request.jwt.claim.sub','${A}',false);`);
 let result=await db.query('select public.ixpence_save(0,$1::jsonb) as saved',[JSON.stringify(doc)]);assert.equal(result.rows[0].saved.version,1);
 await assert.rejects(db.query('select public.ixpence_save(0,$1::jsonb)',[JSON.stringify(doc)]),/IXPENCE_CONFLICT/);
 result=await db.query('select public.ixpence_save(1,$1::jsonb) as saved',[JSON.stringify({...doc,budgets:{'2026-11':500000}})]);assert.equal(result.rows[0].saved.version,2);
 await assert.rejects(db.query('select public.ixpence_save(1,$1::jsonb)',[JSON.stringify(doc)]),/IXPENCE_CONFLICT/);
 await assert.rejects(db.query('select public.ixpence_save(2,$1::jsonb)',[JSON.stringify({version:1,transactions:'wrong',categories:[],budgets:{}})]),/IXPENCE_INVALID_DOCUMENT/);
 await assert.rejects(db.query(`insert into public.ixpence_documents(user_id,payload) values('${B}',$1::jsonb)`,[JSON.stringify(doc)]),/permission denied/);
 await assert.rejects(db.query('update public.ixpence_documents set version=99'),/permission denied/);await assert.rejects(db.query('delete from public.ixpence_documents'),/permission denied/);
 await db.exec(`select set_config('request.jwt.claim.sub','${B}',false)`);assert.deepEqual((await db.query('select * from public.ixpence_documents')).rows,[]);
 await db.query('select public.ixpence_save(0,$1::jsonb)',[JSON.stringify(doc)]);assert.equal((await db.query('select * from public.ixpence_documents')).rows[0].user_id,B);
 assert.deepEqual((await db.query('select * from public.ixpence_documents where user_id=$1',[A])).rows,[]);
 await db.exec(`select set_config('request.jwt.claim.sub','',false)`);await assert.rejects(db.query('select public.ixpence_save(0,$1::jsonb)',[JSON.stringify(doc)]),/IXPENCE_UNAUTHENTICATED/);
 }finally{await db.close();}
});
