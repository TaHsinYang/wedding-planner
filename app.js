import {SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY} from './config.js';
import {LISTS,normalize,equal,merge3} from './sync.js';
import {defaults,uid,ui,fields} from './ui.js';
const client=window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY);
let state=defaults(), base=null, space=null, user=null, saving=false, pulling=false, blocked=false, epoch=0, timer, editing=null, recovery=false;
const {$,esc,render}=ui(()=>state);
const clone=x=>structuredClone(x);
const siteURL=new URL('./',location.href).href;
const OLD_KEY='our-wedding-planner-v1';
const pendingKey=()=>`wedding-draft-v2:${user.id}:${space.id}`;
function message(s){$('status').textContent=s;}
function errText(e){return e?.message||'連線失敗，請稍後再試';}
function updateControls(){
  $('plannerFields').disabled=blocked;
  $('weddingDate').disabled=blocked;
  $('syncRecovery').hidden=!space || (!blocked && equal(base,state));
}
function remember(){
  if(!space||!user)return;
  try{
    if(equal(base,state))localStorage.removeItem(pendingKey());
    else localStorage.setItem(pendingKey(),JSON.stringify({base,local:state,revision:space.revision,blocked}));
  }catch{message('本機儲存空間不足，請保持頁面開啟並匯出草稿。');}
}
function persist(){
  remember(); updateControls();
  message(navigator.onLine?'待同步…':'目前離線，本機草稿待同步');
  clearTimeout(timer);timer=setTimeout(flush,600);
}
function exportData(data){
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download=`備婚紀錄-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function rpc(name,args){const r=await client.rpc(name,args);if(r.error)throw r.error;return r.data;}
function showSpace(){
  $('onboarding').hidden=true;$('planner').hidden=false;document.body.classList.add('ready');
  $('partnerStatus').textContent=space.partner_id?'已連結伴侶，兩人都可以共同編輯。':'還沒連結伴侶。由建立者產生 Email 專用邀請。';
  $('inviteForm').hidden=space.owner_id!==user.id || !!space.partner_id;
  if(space.partner_id)$('inviteResult').hidden=true;
  render();updateControls();
}
function adopt(row){space=row;base=normalize(row.data);state=clone(base);blocked=false;remember();showSpace();message('已同步 ♡');}
async function fetchSpace(){
  const {data,error}=await client.from('wedding_spaces').select('*').limit(1).maybeSingle();
  if(error)throw error;return data;
}
function restoreDraft(draft){
  if(draft.blocked){state=normalize(draft.local);blocked=true;message('偵測到尚未解決的同步衝突。請先匯出本機草稿，再載入雲端版本核對。');remember();render();updateControls();return;}
  try{state=merge3(normalize(draft.base),normalize(draft.local),base);message('已恢復本機未同步草稿');}
  catch(e){state=normalize(draft.local);blocked=true;message(errText(e));}
  remember();render();updateControls();if(!blocked)void flush();
}
async function loadAccount(session){
  const next=session?.user||null;
  if(next?.id===user?.id && user)return;
  const gen=++epoch;user=next;space=null;base=null;blocked=false;state=defaults();editing=null;
  clearTimeout(timer);$('dialog').close();$('planner').hidden=true;$('onboarding').hidden=true;
  $('syncRecovery').hidden=true;$('inviteResult').hidden=true;$('inviteLink').value='';document.body.classList.remove('ready');
  $('authBox').hidden=!!user;$('signedIn').hidden=!user;$('accountEmail').textContent=user?.email||'';
  if(!user){message('請先登入或建立帳號');return;}
  message('正在載入夫妻共用空間…');
  try{
    const row=await fetchSpace();if(gen!==epoch)return;
    if(row){
      // Read before adopt, which clears acknowledged clean drafts.
      let draft;try{draft=JSON.parse(localStorage.getItem(`wedding-draft-v2:${user.id}:${row.id}`));}catch{}
      adopt(row);if(draft)restoreDraft(draft);
    }else{
      $('onboarding').hidden=false;$('migrate').hidden=!localStorage.getItem(OLD_KEY);
      $('inviteToken').value=sessionStorage.getItem('wedding-invite')||'';
      message($('inviteToken').value?'收到邀請了！請按「加入伴侶的空間」。':'請建立空間或加入伴侶邀請');
    }
  }catch(e){message(errText(e));$('signout').disabled=false;}
}
async function pull(){
  if(!user||!space||saving||pulling||blocked||document.hidden)return;
  pulling=true;const gen=epoch;
  try{
    const row=await fetchSpace();if(gen!==epoch||!row)return;
    if(row.revision!==space.revision){
      const remote=normalize(row.data);
      state=merge3(base,state,remote);base=remote;space=row;remember();showSpace();
    }else if(row.partner_id!==space.partner_id){space=row;showSpace();}
    if(!equal(base,state))void flush();else message('已同步 ♡');
  }catch(e){
    if(gen===epoch){if(/同時修改/.test(errText(e)))blocked=true;message(errText(e));updateControls();}
  }finally{pulling=false;}
}
async function flush(){
  if(!user||!space||saving||blocked||equal(base,state))return;
  saving=true;const gen=epoch;message('正在同步…');
  try{
    // Snapshot each request. Edits made during a save are merged with its response.
    for(let attempt=0;attempt<4 && gen===epoch && !equal(base,state);attempt++){
      const sent=clone(state),expected=space.revision;
      const {data,error}=await client.rpc('save_wedding',{space_id:space.id,expected_revision:expected,document:sent});
      if(gen!==epoch)return;
      if(error){
        if(error.code!=='40001')throw error;
        const row=await fetchSpace();if(gen!==epoch)return;if(!row)throw Error('無法讀取共用空間');
        const remote=normalize(row.data);state=merge3(base,state,remote);base=remote;space=row;remember();render();continue;
      }
      const remote=normalize(data.data);state=merge3(sent,state,remote);base=remote;space=data;remember();render();
    }
    message(equal(base,state)?'已同步 ♡':'仍有草稿待同步，將自動重試');
  }catch(e){
    if(gen===epoch){if(/同時修改/.test(errText(e)))blocked=true;message(`${errText(e)}${blocked?'':'；本機草稿待同步'}`);remember();}
  }finally{saving=false;updateControls();}
}
async function busy(button,fn){button.disabled=true;try{await fn();}catch(e){message(errText(e));}finally{button.disabled=false;}}
$('authForm').onsubmit=e=>{e.preventDefault();void busy(e.submitter,async()=>{
  const {data,error}=await client.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});
  if(error)throw error;$('password').value='';await loadAccount(data.session);
});};
$('signup').onclick=()=>void busy($('signup'),async()=>{
  if(!$('authForm').reportValidity())return;
  const {error}=await client.auth.signUp({email:$('email').value.trim(),password:$('password').value,options:{emailRedirectTo:siteURL}});
  if(error)throw error;$('password').value='';message('請到信箱完成驗證，再回來登入。若收不到信，請檢查垃圾郵件或聯絡網站建立者。');
});
$('forgot').onclick=()=>void busy($('forgot'),async()=>{
  if(!$('email').reportValidity())return;
  const {error}=await client.auth.resetPasswordForEmail($('email').value.trim(),{redirectTo:siteURL});
  if(error)throw error;message('若此 Email 可接收驗證信，密碼重設連結已寄出。');
});
$('resetForm').onsubmit=e=>{e.preventDefault();void busy(e.submitter,async()=>{
  const {error}=await client.auth.updateUser({password:$('newPassword').value});if(error)throw error;
  $('newPassword').value='';$('resetForm').hidden=true;recovery=false;message('密碼已更新');await loadAccount((await client.auth.getSession()).data.session);
});};
$('signout').onclick=()=>void busy($('signout'),async()=>{
  if(saving)throw Error('正在同步，請稍候再登出');
  if(space&&!equal(base,state)&&!confirm('仍有未同步草稿，請先匯出備份。確定登出？草稿會保留在本機，供同帳號下次登入恢復。'))return;
  const {error}=await client.auth.signOut();if(error)throw error;await loadAccount(null);
});
async function createSpace(migrate){
  if(!user||space)return;
  const initial=migrate?normalize(JSON.parse(localStorage.getItem(OLD_KEY))):defaults();
  if(!confirm(migrate?'將這台裝置的舊資料帶入新空間？原本資料會保留。':'確定建立新空間？若伴侶已建立，請改用伴侶邀請加入。'))return;
  adopt(await rpc('create_wedding',{initial_data:initial}));
}
$('createSpace').onclick=()=>void busy($('createSpace'),()=>createSpace(false));
$('migrate').onclick=()=>void busy($('migrate'),()=>createSpace(true));
$('joinForm').onsubmit=e=>{e.preventDefault();void busy(e.submitter,async()=>{
  let token=$('inviteToken').value.trim();
  if(token.includes('://')){try{token=new URLSearchParams(new URL(token).hash.slice(1)).get('invite')||'';}catch{throw Error('邀請網址不正確');}}
  if(!/^[a-f0-9]{64}$/.test(token))throw Error('邀請碼不正確');
  adopt(await rpc('join_wedding',{invite_token:token}));sessionStorage.removeItem('wedding-invite');$('inviteToken').value='';
});};
$('inviteForm').onsubmit=e=>{e.preventDefault();void busy(e.submitter,async()=>{
  const token=await rpc('invite_wedding_partner',{space_id:space.id,partner_email:$('partnerEmail').value.trim()});
  $('inviteLink').value=`${siteURL}#invite=${token}`;$('inviteResult').hidden=false;message('邀請已產生，請複製並自行傳給伴侶；新邀請會使舊邀請失效。');
});};
$('copyInvite').onclick=()=>void busy($('copyInvite'),async()=>{
  try{await navigator.clipboard.writeText($('inviteLink').value);message('已複製邀請網址');}
  catch{$('inviteLink').select();message('請手動複製已選取的網址');}
});
$('exportDraft').onclick=()=>exportData(state);
$('retrySync').onclick=()=>{if(blocked){message('同時修改的欄位需要人工核對。請先匯出本機草稿，再載入雲端版本。');return;}void flush();};
$('reloadCloud').onclick=()=>void busy($('reloadCloud'),async()=>{
  if(saving)throw Error('請等候同步完成');
  if(!confirm('請先匯出本機草稿。載入雲端版本會放棄本機尚未同步的變更，確定嗎？'))return;
  const row=await fetchSpace();if(!row)throw Error('無法讀取共用空間');adopt(row);$('dialog').close();
});
function editable(){if(!space||blocked)return false;return true;}
function edit(type,id){
  if(!editable())return;
  const old=id?state[type].find(x=>x.id===id):null;
  if(id&&!old){message('這筆資料已被刪除');return;}
  editing={type,id,original:clone(old)};
  $('dialogTitle').textContent=(id?'編輯':'新增')+({tasks:'任務',expenses:'支出',vendors:'廠商',guests:'賓客',notes:'筆記'}[type]);
  $('editForm').innerHTML=fields[type].map(([key,label,kind,opts])=>'<label>'+label+(kind==='textarea'?'<textarea name="'+key+'">'+esc(old?.[key]??'')+'</textarea>':kind==='select'?'<select name="'+key+'">'+opts.split('|').map(o=>'<option '+((old?.[key]??'')===o?'selected':'')+'>'+esc(o)+'</option>').join('')+'</select>':'<input name="'+key+'" type="'+kind+'" '+(kind==='number'?'min="0" inputmode="numeric"':'')+' value="'+esc(old?.[key]??(key==='count'?1:''))+'">')+'</label>').join('')+(id?'<button class="btn danger" type="button" id="deleteRecord">刪除此筆紀錄</button>':'');
  $('dialog').showModal();
  if(id)$('deleteRecord').onclick=()=>{
    if(!editable())return;
    const current=state[type].find(x=>x.id===id);
    if(!equal(current,editing.original)){alert('這筆資料已被另一台裝置修改，請關閉後重新開啟確認。');return;}
    if(confirm('確定刪除這筆共用紀錄？')){state[type]=state[type].filter(x=>x.id!==id);persist();render();$('dialog').close();}
  };
}
LISTS.forEach((t,i)=>$(['addTask','addExpense','addVendor','addGuest','addNote'][i]).onclick=()=>edit(t));
$('save').onclick=()=>{
  if(!editable()||!editing)return;
  try{
    const {type,id,original}=editing;
    const data=Object.fromEntries(new FormData($('editForm')).entries());
    if(!String(data.name??data.title??'').trim())throw Error('請填寫名稱或標題');
    if(!$('editForm').reportValidity())return;
    if(type==='expenses')data.amount=Number(data.amount||0);
    if(type==='guests')data.count=Math.max(1,Math.floor(Number(data.count||1)));
    if(id){
      const current=state[type].find(x=>x.id===id);
      const merged=merge3(original,{...original,...data},current,'正在編輯的紀錄');
      state[type]=state[type].map(x=>x.id===id?merged:x);
    }else state[type].push({id:uid(),...(type==='tasks'?{done:false}:{}),...data});
    state=normalize(state);persist();render();$('dialog').close();
  }catch(e){alert(errText(e));}
};
$('editForm').onsubmit=e=>{e.preventDefault();$('save').click();};
$('cancel').onclick=()=>$('dialog').close();
document.addEventListener('click',e=>{const el=e.target.closest('[data-edit]');if(el){const[t,id]=el.dataset.edit.split(':');edit(t,id);}});
document.addEventListener('change',e=>{
  if(!editable())return;
  if(e.target.dataset.check){const t=state.tasks.find(x=>x.id===e.target.dataset.check);if(t)t.done=e.target.checked;persist();render();}
});
['weddingDate','couple','venue','totalBudget'].forEach(k=>$(k).addEventListener('input',e=>{
  if(!editable())return;state[k]=k==='totalBudget'?Math.max(0,Number(e.target.value||0)):e.target.value;persist();render();
}));
$('taskFilter').onchange=render;
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('.tab,.panel').forEach(el=>el.classList.remove('active'));b.classList.add('active');$(b.dataset.tab).classList.add('active');
});
$('export').onclick=()=>exportData(state);
$('importBtn').onclick=()=>$('importFile').click();
$('importFile').onchange=async e=>{
  const file=e.target.files[0];if(!file||!editable())return;
  try{
    if(file.size>1000000)throw Error('備份檔超過 1 MB');
    const d=normalize(JSON.parse(await file.text()));
    if(confirm('匯入會取代夫妻共用資料，請先匯出目前備份。確定繼續？')){state=d;persist();render();}
  }catch(e){alert(errText(e));}finally{$('importFile').value='';}
};
window.addEventListener('beforeunload',e=>{if(space&&!equal(base,state)){e.preventDefault();e.returnValue='';}});
window.addEventListener('online',()=>{void flush();void pull();});
window.addEventListener('offline',()=>message('目前離線；未同步的變更會保留在本機草稿'));
window.addEventListener('focus',()=>void pull());
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void pull();});
setInterval(()=>{if(!document.hidden){void flush();void pull();}},5000);
const fragment=new URLSearchParams(location.hash.slice(1));
if(fragment.has('invite')){
  const token=fragment.get('invite');if(/^[a-f0-9]{64}$/.test(token))sessionStorage.setItem('wedding-invite',token);
  history.replaceState(null,'',location.pathname+location.search);
}
client.auth.onAuthStateChange((event,session)=>{
  if(event==='PASSWORD_RECOVERY'){recovery=true;$('resetForm').hidden=false;message('請設定新密碼');}
  // Avoid deadlocking auth's internal lock by doing async work after the callback.
  setTimeout(()=>{if(!recovery)void loadAccount(session);},0);
});
const {data:{session},error}=await client.auth.getSession();
if(error)message(errText(error));else if(!recovery)await loadAccount(session);
