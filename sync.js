export const LISTS = ['tasks', 'expenses', 'vendors', 'guests', 'notes'];
const TEXT = {tasks:['name','category','due'],expenses:['name','category','date'],vendors:['name','category','contact','status','memo'],guests:['name','side','status','memo'],notes:['title','content']};
const str = v => typeof v === 'string' ? v : '';
const num = (v, fallback=0) => Number.isFinite(Number(v)) && Number(v)>=0 ? Number(v) : fallback;
export function normalize(x) {
  if (!x || typeof x !== 'object' || LISTS.some(k=>!Array.isArray(x[k]))) throw Error('備份格式不正確');
  const d={weddingDate:str(x.weddingDate),couple:str(x.couple),venue:str(x.venue),totalBudget:num(x.totalBudget,500000)};
  for (const k of LISTS) {
    const ids = new Set();
    d[k]=x[k].map(a=>{
      if (!a || typeof a.id!=='string' || !/^[A-Za-z0-9_-]{1,100}$/.test(a.id) || ids.has(a.id)) throw Error('紀錄 ID 不正確或重複');
      ids.add(a.id);
      const b={id:a.id};
      for(const f of TEXT[k]) b[f]=str(a[f]);
      if(k==='tasks') b.done=a.done===true;
      if(k==='expenses') b.amount=num(a.amount);
      if(k==='guests') b.count=Math.max(1,Math.floor(num(a.count,1)));
      return b;
    });
    if(d[k].length>10000) throw Error('單類紀錄超過 10,000 筆');
  }
  if(JSON.stringify(d).length>900000) throw Error('資料太大，請先精簡筆記');
  return d;
}
export const equal = (a,b) => JSON.stringify(a)===JSON.stringify(b);
const clone = x => x===undefined ? undefined : structuredClone(x);
// Three-way field merge. Same-field changes and delete/edit races fail closed.
export function merge3(base, local, remote, path='資料') {
  if(equal(local,remote)) return clone(local);
  if(equal(base,local)) return clone(remote);
  if(equal(base,remote)) return clone(local);
  if(Array.isArray(base) && Array.isArray(local) && Array.isArray(remote)) {
    const maps=[base,local,remote].map(a=>new Map(a.map(x=>[x.id,x])));
    const order=[...new Set([...remote,...local].map(x=>x.id))];
    return order.map(id=>merge3(maps[0].get(id),maps[1].get(id),maps[2].get(id),`${path}/${id}`)).filter(x=>x!==undefined);
  }
  if([base,local,remote].every(x=>x && typeof x==='object' && !Array.isArray(x))) {
    const result={};
    for(const k of new Set([...Object.keys(base),...Object.keys(local),...Object.keys(remote)])) {
      const v=merge3(base[k],local[k],remote[k],`${path}/${k}`);
      if(v!==undefined) result[k]=v;
    }
    return result;
  }
  throw Error(`你們同時修改了「${path}」。本機草稿已保留，請先匯出，再載入雲端版本核對。`);
}
