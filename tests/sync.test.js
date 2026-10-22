import {test} from 'node:test';
import assert from 'node:assert/strict';
import {merge3,normalize} from '../sync.js';
const doc=()=>normalize({tasks:[{id:'a',name:'場地',done:false}],expenses:[],vendors:[],guests:[],notes:[],couple:'',venue:'',totalBudget:500000});
test('independent device changes merge at field and record level',()=>{
 const b=doc(),l=structuredClone(b),r=structuredClone(b);l.tasks[0].done=true;r.tasks[0].name='新場地';r.notes.push({id:'n',title:'日記',content:'hello'});
 const m=merge3(b,l,r);assert.equal(m.tasks[0].done,true);assert.equal(m.tasks[0].name,'新場地');assert.equal(m.notes.length,1);
});
test('same-field conflict preserves local document and refuses overwrite',()=>{
 const b=doc(),l=structuredClone(b),r=structuredClone(b);l.venue='A';r.venue='B';assert.throws(()=>merge3(b,l,r),/同時修改/);assert.equal(l.venue,'A');
});
test('delete/edit conflicts, ordinary deletions and concurrent additions',()=>{
 const b=doc(),l=structuredClone(b),r=structuredClone(b);l.tasks=[];r.tasks[0].name='修改';assert.throws(()=>merge3(b,l,r),/同時修改/);
 assert.deepEqual(merge3(b,l,b).tasks,[]);
 const x=doc(),y=doc();x.notes.push({id:'x',title:'x'});y.notes.push({id:'y',title:'y'});assert.equal(merge3(b,x,y).notes.length,2);
});
test('malicious and duplicate IDs rejected; numeric values normalized',()=>{
 const d=doc();d.tasks[0].id='" onclick="alert(1)';assert.throws(()=>normalize(d));
 const x=doc();x.tasks.push(x.tasks[0]);assert.throws(()=>normalize(x));
 const n=doc();n.totalBudget=-20;n.guests=[{id:'g',count:-4,name:'Guest'}];const result=normalize(n);assert.equal(result.totalBudget,500000);assert.equal(result.guests[0].count,1);
});
test('changes made while request is in flight survive response acknowledgement',()=>{
 const b=doc(),sent=structuredClone(b);sent.venue='A';const now=structuredClone(sent);now.couple='Two';assert.equal(merge3(sent,now,sent).couple,'Two');
});
