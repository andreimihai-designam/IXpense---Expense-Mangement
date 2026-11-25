import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,loadState,saveState} from '../dist/storage.js';
import {monthlyFinancialSummary,categoryBudgetSummary,defaultFundingSource,validateMealPayment,transactionWarnings,setMonthlySalary,setMealVouchers} from '../dist/finance.js';
import {createBackup,parseBackup} from '../dist/features.js';
import {monthlyClosingSummary} from '../dist/planning.js';
const month='2026-11';
function setup(){const s=initialState({legacyCategories:true});setMonthlySalary(s,{month,amount:500000,date:month+'-01'});setMealVouchers(s,month,60000);s.categoryBudgets[month]={'cat-8':50000};return s;}
const entry=(id,amount,category='cat-8',paymentSource='cash')=>({id,name:id,type:'expense',amount,category,paymentSource,date:month+'-17',description:''});
const category=(s,id)=>categoryBudgetSummary(s.transactions,s.categories,s.categoryBudgets,month,s.mealAllocations[month]).find(c=>c.id===id);
test('Funding ledger covers additions, amount/category/source changes, deletion and repeated deletion',()=>{
 const s=setup(),original=structuredClone({budgets:s.budgets,categoryBudgets:s.categoryBudgets,mealVouchers:s.mealVouchers,mealAllocations:s.mealAllocations});
 s.transactions.push(entry('coffee',1000));assert.equal(category(s,'cat-8').remaining,49000);assert.equal(monthlyFinancialSummary(s,month).cash.available,499000);
 s.transactions.push(entry('lidl',10000,'cat-0','meal'));assert.equal(category(s,'cat-0').remaining,50000);assert.equal(monthlyFinancialSummary(s,month).meal.available,50000);assert.equal(monthlyFinancialSummary(s,month).cash.available,499000);
 const coffee=s.transactions.find(t=>t.id==='coffee');coffee.amount=1500;assert.equal(category(s,'cat-8').remaining,48500);
 coffee.category='cat-0';assert.equal(category(s,'cat-8').remaining,50000);assert.equal(category(s,'cat-0').spent,11500);
 coffee.paymentSource='meal';assert.equal(monthlyFinancialSummary(s,month).cash.available,500000);assert.equal(monthlyFinancialSummary(s,month).meal.available,48500);
 s.transactions.push(entry('second',500,'cat-0','meal'));assert.equal(category(s,'cat-0').spent,12000);
 for(let i=0;i<2;i++)s.transactions=s.transactions.filter(t=>t.id!=='coffee');assert.equal(monthlyFinancialSummary(s,month).meal.available,49500);
 s.transactions=s.transactions.filter(t=>!['lidl','second'].includes(t.id));assert.equal(monthlyFinancialSummary(s,month).totalAvailable,560000);
 assert.deepEqual({budgets:s.budgets,categoryBudgets:s.categoryBudgets,mealVouchers:s.mealVouchers,mealAllocations:s.mealAllocations},original);
});
test('Overspending warns for both sources and categories without blocking or inventing budgets',()=>{
 const s=setup(),cash=entry('over',510000),meal=entry('meal-over',70000,'cat-0','meal');s.transactions.push(cash,meal);assert.doesNotThrow(()=>validateMealPayment(s,meal));assert.equal(transactionWarnings(s,cash).length,2);assert.equal(transactionWarnings(s,meal).length,2);
 assert.deepEqual(monthlyFinancialSummary(s,month),{cash:{total:500000,spent:510000,available:-10000},meal:{total:60000,spent:70000,available:-10000},totalAvailable:-20000,expenses:580000});
 assert.deepEqual(monthlyFinancialSummary(s,'2026-10'),{cash:{total:0,spent:0,available:0},meal:{total:0,spent:0,available:0},totalAvailable:0,expenses:0});
 const unbudgeted=entry('health',100,'cat-5');s.transactions.push(unbudgeted);assert.equal(category(s,'cat-5').remaining,null);assert.equal(s.categoryBudgets[month]['cat-5'],undefined);
 const income={...entry('gift',1000000),type:'income'};s.transactions.push(income);assert.equal(category(s,'cat-8').spent,510000);assert.deepEqual(transactionWarnings(s,income),[]);
});
test('Food defaults are configurable and persist without rewriting existing payments or backup data',()=>{
 const s=setup();s.transactions.push(entry('old-cash',100,'cat-0'),entry('legacy',100));delete s.transactions.at(-1).paymentSource;
 assert.equal(defaultFundingSource(s,'cat-0'),'meal');s.categories.find(c=>c.id==='cat-0').defaultPaymentSource='cash';assert.equal(defaultFundingSource(s,'cat-0'),'cash');
 const before=structuredClone(s.transactions);let saved;globalThis.localStorage={getItem:()=>saved,setItem:(k,v)=>saved=v};saveState(s);const loaded=loadState();assert.deepEqual(loaded.transactions,before);assert.equal(defaultFundingSource(loaded,'cat-0'),'cash');const restored=parseBackup(createBackup(s));assert.deepEqual(restored.transactions,before.map(t=>({...t,paymentSource:t.paymentSource||'cash'})));assert.equal(defaultFundingSource(restored,'cat-0'),'cash');assert.equal(monthlyFinancialSummary(restored,month).cash.spent,200);
});
test('Custom food receives voucher allocation without duplicate categories; reports share dashboard balance',()=>{
 const s=initialState();s.categories=[{id:'shop',name:'Cumpărături',isGroup:true,color:'#123456',icon:'tag'},{id:'food',name:'Alimente',parentId:'shop',color:'#123456',icon:'tag'}];setMealVouchers(s,month,60000);assert.equal(s.categories.length,2);assert.equal(defaultFundingSource(s,'food'),'meal');const meal=entry('lidl',10000,'food','meal');validateMealPayment(s,meal);s.transactions.push(meal);assert.equal(category(s,'food').remaining,50000);assert.equal(category(s,'shop').remaining,50000);s.budgets[month]=500000;s.transactions.push(entry('cash',1000,'unknown'));assert.equal(monthlyClosingSummary(s,month).cashBalance,monthlyFinancialSummary(s,month).cash.available);
});

test('Full financial reset clears every month, preserves categories/settings and is idempotent',async()=>{
 const {resetFinancialData}=await import('../dist/features.js');const s=setup();s.transactions.push(entry('coffee',1000));s.categoryBudgets['2026-10']={'cat-8':500};s.budgets['2026-10']=200000;s.favorites=[{id:'favorite',amount:100}];s.bills=[{id:'bill',amount:100}];s.goals=[{id:'goal',targetAmount:500}];s.monthClosures={'2026-10':{totals:{income:1}}};s.indicatorTargets={'2026-11':{savings:10000}};s.theme='light';s.collapsed=true;const categories=structuredClone(s.categories);
 resetFinancialData(s);assert.deepEqual(s.categories,categories);assert.equal(s.theme,'light');assert.equal(s.collapsed,true);
 for(const key of ['transactions','favorites','bills','goals'])assert.deepEqual(s[key],[]);
 for(const key of ['budgets','categoryBudgets','mealVouchers','mealAllocations','indicatorTargets','monthClosures'])assert.deepEqual(s[key],{});
 assert.equal(monthlyFinancialSummary(s,month).totalAvailable,0);assert.equal(monthlyFinancialSummary(s,'2026-10').totalAvailable,0);const first=structuredClone(s);resetFinancialData(s);assert.deepEqual(s,first);assert.deepEqual(parseBackup(createBackup(s)),s);
});

test('Mobile subcategory spending includes every leaf, isolates months and incomes, compares actual spending without allocations',async()=>{
 const {monthlySubcategorySpending}=await import('../dist/finance.js');const s=setup();s.transactions.push(entry('one',1000,'cat-8'),entry('two',2000,'cat-8'),entry('fuel',5000,'cat-1'),{...entry('old',90000,'cat-8'),date:'2026-10-01'},{...entry('gift',10000,'cat-8'),type:'income'});
 const rows=monthlySubcategorySpending(s,month);assert.equal(rows.length,s.categories.filter(c=>!c.isGroup).length);assert.equal(rows[0].id,'cat-1');assert.equal(rows[0].percent,100);assert.equal(rows.find(c=>c.id==='cat-8').spent,3000);assert.equal(rows.find(c=>c.id==='cat-8').percent,60);assert.equal(rows.find(c=>c.id==='cat-0').percent,0);assert.equal(rows.find(c=>c.id==='cat-1').color,'#758e4f');assert.ok(rows.find(c=>c.id==='cat-8').label.includes('Diverse'));
 s.transactions.find(t=>t.id==='two').amount=3000;assert.equal(monthlySubcategorySpending(s,month).find(c=>c.id==='cat-8').spent,4000);s.transactions=s.transactions.filter(t=>t.id!=='one');assert.equal(monthlySubcategorySpending(s,month).find(c=>c.id==='cat-8').spent,3000);assert.ok(monthlySubcategorySpending(s,'2026-12').every(c=>c.percent===0));
});

test('Top five groups only the remaining positive expenses and preserves exact totals and original state',async()=>{
 const {subcategorySpendingOverview}=await import('../dist/finance.js');const s=initialState();s.categories=Array.from({length:9},(_,i)=>({id:'cat-'+i,name:'Subcategoria '+i,color:'#818cf8',icon:'tag'}));s.transactions=s.categories.slice(0,7).map((c,i)=>entry('top-'+i,10000-i*1000,c.id));s.transactions.push({...entry('income',900000,'cat-8'),type:'income'},{...entry('old',900000,'cat-8'),date:'2026-10-01'});const original=structuredClone(s),overview=subcategorySpendingOverview(s,'2026-11');
 assert.equal(overview.all.length,7);assert.equal(overview.top.length,5);assert.deepEqual(overview.top.map(c=>c.spent),[10000,9000,8000,7000,6000]);assert.equal(overview.otherSpent,9000);assert.equal(overview.total,49000);assert.equal(overview.chartRows.length,6);assert.equal(overview.chartRows.at(-1).label,'Altele');assert.equal(overview.chartRows.reduce((sum,c)=>sum+c.spent,0),overview.total);assert.deepEqual(s,original);
 assert.deepEqual(subcategorySpendingOverview(s,'2026-12').chartRows,[]);s.transactions=s.transactions.slice(0,2);assert.equal(subcategorySpendingOverview(s,'2026-11').chartRows.length,2);assert.equal(subcategorySpendingOverview(s,'2026-11').otherSpent,0);
});
