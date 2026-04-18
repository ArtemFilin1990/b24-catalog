const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET,POST,DELETE,OPTIONS","Access-Control-Allow-Headers":"Content-Type","Cache-Control":"no-store"};
const JSON_H={...CORS,"Content-Type":"application/json; charset=utf-8"};
const SYSTEM=`Ты — опытный специалист по подшипникам компании ТД «Эверест» (Вологда). Помогаешь клиентам: подобрать подшипник, найти аналог, расшифровать обозначение. Отвечай кратко и по делу на русском языке. Используй данные из базы если переданы. Правила: аналоги только при полном совпадении d/D/B и типа. Если аналога нет — "NO DIRECT EQUIV". 2RS=резина, ZZ=щит, C3=увеличенный зазор, C0=нормальный.`;
function ok(d){return new Response(JSON.stringify({ok:true,...d}),{status:200,headers:JSON_H});}
function err(m,s=400){return new Response(JSON.stringify({ok:false,error:m}),{status:s,headers:JSON_H});}
async function searchDB(q,env){
  const clean=q.replace(/['"`;\\]/g," ").trim().slice(0,100);
  const results=[];
  try{const r=await env.DB.prepare("SELECT brand,base_number,gost_equiv,d_inner,d_outer,width_mm FROM catalog WHERE base_number LIKE ? OR gost_equiv LIKE ? LIMIT 10").bind(`%${clean}%`,`%${clean}%`).all();if(r.results?.length)results.push(...r.results);}catch{}
  try{const r=await env.DB.prepare("SELECT data FROM imported_rows WHERE deleted=0 AND base_number LIKE ? LIMIT 4").bind(`%${clean}%`).all();for(const row of r.results||[]){try{const d=JSON.parse(row.data);if(!results.find(x=>x.base_number===d.designation))results.push({brand:d.brand,base_number:d.designation,d_inner:d.d,d_outer:d.D,width_mm:d.B});}catch{}}}catch{}
  return results.slice(0,10);
}
function buildCtx(rows){
  if(!rows.length)return"";
  return`\nИз базы (${rows.length} позиций):\n${rows.map(r=>`• ${r.base_number} (${r.brand||"?"})${r.gost_equiv?` → ГОСТ: ${r.gost_equiv}`:""}${r.d_inner?` | d=${r.d_inner} D=${r.d_outer} B=${r.width_mm}`:""}`).join("\n")}\n`;
}
async function loadHistory(sid,env,limit=16){
  try{const r=await env.DB.prepare("SELECT role,content FROM chat_memory WHERE session_id=? ORDER BY created_at DESC LIMIT ?").bind(sid,limit).all();return(r.results||[]).reverse();}catch{return[];}
}
async function saveMemory(sid,userMsg,aiMsg,sources,env){
  try{await env.DB.batch([env.DB.prepare("INSERT INTO chat_memory(session_id,role,content,sources)VALUES(?,?,?,?)").bind(sid,"user",userMsg,0),env.DB.prepare("INSERT INTO chat_memory(session_id,role,content,sources)VALUES(?,?,?,?)").bind(sid,"assistant",aiMsg,sources)]);}catch{}
}
async function ask(question,sid,env){
  if(!question?.trim())return err("question required");
  const rows=await searchDB(question,env);
  const ctx=buildCtx(rows);
  const history=sid?await loadHistory(sid,env):[]; 
  const messages=[{role:"system",content:SYSTEM}];
  for(const h of history)messages.push({role:h.role==="user"?"user":"assistant",content:h.content});
  messages.push({role:"user",content:ctx?`${ctx}\nВопрос: ${question}`:question});
  try{
    const resp=await env.AI.run("@cf/meta/llama-3.1-8b-instruct",{messages,max_tokens:600,temperature:0.25},{gateway:{id:"catalog",skipCache:false,cacheTtl:3600}});
    const answer=resp?.response||resp?.result?.response||"Нет ответа от модели";
    if(sid)await saveMemory(sid,question,answer,rows.length,env);
    return ok({answer,sources:rows.length,session_id:sid,model:"llama-3.1-8b-instruct"});
  }catch(e){return err("AI error: "+e.message,500);}
}
export default{
  async fetch(req,env){
    const url=new URL(req.url),path=url.pathname,method=req.method;
    if(method==="OPTIONS")return new Response(null,{status:204,headers:CORS});
    if(path==="/api/ping")return ok({app:"ai-kb",catalog_rows:58742,memory:"d1",time:new Date().toISOString()});
    if(path==="/api/ask"&&method==="POST"){
      let b;try{b=await req.json();}catch{return err("Invalid JSON");}
      return ask((b.question||b.message||"").trim(),(b.session_id||"").trim()||null,env);
    }
    if(path==="/api/ask"&&method==="GET")
      return ask((url.searchParams.get("q")||"").trim(),url.searchParams.get("session_id")||null,env);
    if(path.startsWith("/api/history/")&&method==="GET"){
      const sid=path.slice(13);if(!sid)return err("session_id required");
      try{const r=await env.DB.prepare("SELECT role,content,sources,created_at FROM chat_memory WHERE session_id=? ORDER BY created_at ASC LIMIT 200").bind(sid).all();return ok({messages:r.results||[],session_id:sid});}catch(e){return err(e.message,500);}
    }
    if(path.startsWith("/api/history/")&&method==="DELETE"){
      const sid=path.slice(13);
      try{await env.DB.prepare("DELETE FROM chat_memory WHERE session_id=?").bind(sid).run();return ok({cleared:true,session_id:sid});}catch(e){return err(e.message,500);}
    }
    const ar=await env.ASSETS.fetch(req);
    const h=new Headers(ar.headers);
    ["X-Frame-Options","Content-Security-Policy"].forEach(k=>h.delete(k));
    h.set("Access-Control-Allow-Origin","*");
    return new Response(ar.body,{status:ar.status,headers:h});
  }
};
