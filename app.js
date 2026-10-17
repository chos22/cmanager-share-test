'use strict';
const $=id=>document.getElementById(id);
const CONFIG_KEY='cmanager_share_test_config_v1';
const TOKEN_KEY='cmanager_share_test_session_v1';
let config=null,session=null,householdId=null;
function note(message,error=false){$('status').textContent=message;$('status').className=error?'error':'ok'}
function loadJSON(key){try{return JSON.parse(localStorage.getItem(key)||'null')}catch{return null}}
function validConfig(value){try{const u=new URL(value.url);return u.protocol==='https:'&&u.hostname.endsWith('.supabase.co')&&/^sb_publishable_/.test(value.key)}catch{return false}}
function setIdentity(){ $('identity').textContent=session&&householdId?`로그인됨: ${session.user?.email||'사용자'}\n공동 관리 공간 ID: ${householdId}`:'로그인 전'; $('write').disabled=!householdId; $('read').disabled=!householdId;}
function endpoint(path){return config.url.replace(/\/$/,'')+path}
async function request(path,options={},authenticated=false,retry=true){
 if(!config)throw Error('Supabase 연결 정보를 먼저 저장하세요.');
 if(authenticated&&(!session||!session.access_token))throw Error('먼저 로그인하세요.');
 const headers={'apikey':config.key,'Content-Type':'application/json',...(options.headers||{})};
 if(authenticated)headers.Authorization='Bearer '+session.access_token;
 const response=await fetch(endpoint(path),{...options,headers});
 if(response.status===401&&authenticated&&retry&&session?.refresh_token){await refreshSession();return request(path,options,true,false)}
 const raw=await response.text();let data;try{data=raw?JSON.parse(raw):null}catch{data=raw}
 if(!response.ok)throw Error(`${response.status}: ${typeof data==='object'?(data?.message||data?.error_description||data?.error||JSON.stringify(data)):data}`);
 return data;
}
async function refreshSession(){
 const r=await request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:JSON.stringify({refresh_token:session.refresh_token})});
 if(!r?.access_token)throw Error('로그인이 만료되었습니다. 다시 로그인하세요.');
 session=r;localStorage.setItem(TOKEN_KEY,JSON.stringify(session));
}
async function ensureSession(){if(!session)return false;if(session.expires_at&&Date.now()/1000>session.expires_at-120){await refreshSession()}return true}
async function connectHousehold(){
 await ensureSession();
 const userid=encodeURIComponent(session.user.id);
 const memberships=await request(`/rest/v1/household_members?select=household_id&user_id=eq.${userid}&limit=5`,{},true);
 if(!Array.isArray(memberships)||memberships.length!==1)throw Error('연결된 가족 관리 공간이 정확히 하나인지 확인해야 합니다. 공동 공간을 찾지 못했거나 여러 개 연결되어 있습니다.');
 householdId=memberships[0].household_id;setIdentity();note('가족 공동 관리 공간에 안전하게 연결했어요.');
}
$('save-config').onclick=()=>{
 const data={url:$('url').value.trim().replace(/\/$/,''),key:$('key').value.trim()};
 if(!validConfig(data)){note('Project URL 또는 Publishable key 형식을 확인하세요. sb_secret_ 키는 사용할 수 없습니다.',true);return}
 config=data;localStorage.setItem(CONFIG_KEY,JSON.stringify(config));note('연결 정보를 이 기기에 저장했어요.');
};
$('login').onclick=async()=>{
 try{
  if(!config)throw Error('먼저 연결 정보를 저장하세요.');
  const email=$('email').value.trim(),password=$('password').value;
  if(!email||!password)throw Error('이메일과 비밀번호를 입력해 주세요.');
  note('로그인 및 가족 공간 확인 중...');
  const result=await request('/auth/v1/token?grant_type=password',{method:'POST',body:JSON.stringify({email,password})});
  if(!result?.access_token||!result?.user?.id)throw Error('로그인 토큰을 받지 못했습니다.');
  session={...result,expires_at:Math.floor(Date.now()/1000)+(result.expires_in||3600)};
  localStorage.setItem(TOKEN_KEY,JSON.stringify(session));
  $('password').value='';householdId=null;
  await connectHousehold();
 }catch(e){householdId=null;setIdentity();note('연결 실패: '+e.message,true)}
};
$('logout').onclick=async()=>{session=null;householdId=null;localStorage.removeItem(TOKEN_KEY);setIdentity();$('remote-msg').textContent='없음';note('이 기기에서 로그아웃했어요.')};
$('write').onclick=async()=>{
 try{
  if(!householdId)throw Error('로그인 필요');
  const msg=$('message').value.trim();if(!msg)throw Error('테스트 메시지를 입력하세요.');
  note('공동 저장소에 저장 중...');
  await ensureSession();
  await request('/rest/v1/shared_card_data?on_conflict=household_id%2Citem_type%2Citem_id',{
   method:'POST',headers:{'Prefer':'resolution=merge-duplicates,return=minimal'},
   body:JSON.stringify({household_id:householdId,item_type:'connection_test',item_id:'family_message',data:{message:msg},updated_by:session.user.id,updated_at:new Date().toISOString()})
  },true);
  note('공동 저장 완료! 다른 아이폰에서 읽기 버튼을 눌러 확인하세요.');
 }catch(e){note('저장 실패: '+e.message,true)}
};
$('read').onclick=async()=>{
 try{
  if(!householdId)throw Error('로그인 필요');
  note('공동 저장소 조회 중...');
  await ensureSession();
  const rows=await request(`/rest/v1/shared_card_data?select=data,updated_at&household_id=eq.${encodeURIComponent(householdId)}&item_type=eq.connection_test&item_id=eq.family_message`,{},true);
  $('remote-msg').textContent=rows?.[0]?.data?.message??'아직 저장된 메시지가 없어요.';
  note('공동 저장소에서 데이터를 읽었어요.');
 }catch(e){note('조회 실패: '+e.message,true)}
};
(async()=>{
 config=loadJSON(CONFIG_KEY);session=loadJSON(TOKEN_KEY);
 if(config&&validConfig(config)){$('url').value=config.url;$('key').value=config.key}
 if(session){try{await connectHousehold()}catch(e){session=null;householdId=null;localStorage.removeItem(TOKEN_KEY);setIdentity();note('다시 로그인해 주세요: '+e.message,true)}}
 setIdentity();
})();
