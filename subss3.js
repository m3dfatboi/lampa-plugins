/* subs-stable (stable UI in player controls + our direct OpenSubtitles search)
   База: стабильная версия с кнопкой в контролах; источник сабов: прямой OpenSubtitles API (guest)
   - Фильмы: авто-поиск RU по imdb_id
   - Сериалы: ручной выбор Сезон/Серия → RU по imdb_id+season+episode
   - Настройки (live): размер, отступ снизу, задержка; пункт “Без субтитров”; ESC
*/
(function () {
  const FLAG='__SUBS_STABLE_BASE_UI_DIRECT_OS__';
  if (window[FLAG]) return; window[FLAG]=true;

  // ----- Константы / конфиг -----
  const OS_API='https://api.opensubtitles.com/api/v1';
  const APP_AGENT='subs-stable/1.0';
  const LANG='ru';
  const LABEL='subs-stable';

  const STORE='subs_stable_cfg';
  const cfg = Object.assign({ fontSize:18, bottom:48, delay:0 }, JSON.parse(localStorage.getItem(STORE)||'{}'));
  const save=()=>localStorage.setItem(STORE, JSON.stringify(cfg));

  const safe=v=>(v==null?'':String(v));
  const normImdb=x=>{ const s=safe(x).trim(); if(!s) return ''; const m=s.match(/^tt\d+$/); return m?m[0]:'tt'+s.replace(/^tt?/,'').replace(/\D.*$/,''); };

  let modalOpen=false, escBound=false, videoObs=null, token='', tokenTs=0;

  // ----- OpenSubtitles: auth + HTTP -----
  async function ensureToken(){
    const now=Date.now();
    if (token && now-tokenTs<50*60*1000) return token;
    const r=await fetch(`${OS_API}/auth/guest`, {
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'Accept':'application/json',
        'User-Agent':APP_AGENT
      },
      body: '{}'
    });
    if(!r.ok) throw new Error('auth '+r.status);
    const j=await r.json();
    token=j?.token||'';
    tokenTs=Date.now();
    return token;
  }
  async function OS_GET(path, params){
    const t=await ensureToken();
    const u=new URL(path.replace(/^\//,''), OS_API+'/');
    if(params) Object.keys(params).forEach(k=>{ const v=params[k]; if(v!==''&&v!=null) u.searchParams.set(k,String(v)); });
    const r=await fetch(u.toString(), { headers:{ 'Accept':'application/json','Authorization':`Bearer ${t}`,'User-Agent':APP_AGENT } });
    if(!r.ok) throw new Error('GET '+r.status);
    return r.json();
  }
  async function OS_POST(path, body){
    const t=await ensureToken();
    const r=await fetch(new URL(path.replace(/^\//,''), OS_API+'/').toString(), {
      method:'POST',
      headers:{ 'Content-Type':'application/json','Accept':'application/json','Authorization':`Bearer ${t}`,'User-Agent':APP_AGENT },
      body: JSON.stringify(body||{})
    });
    if(!r.ok) throw new Error('POST '+r.status);
    return r.json();
  }

  // ----- Поиск и скачивание -----
  function pickRUfromOS(resp){
    const data = Array.isArray(resp?.data)?resp.data:[];
    const out=[];
    for(const x of data){
      const lang=(x?.attributes?.language||'').toLowerCase();
      const files=Array.isArray(x?.attributes?.files)?x.attributes.files:[];
      const f=files[0];
      if(lang==='ru' && f?.file_id){
        out.push({
          id: x.id,
          name: x?.attributes?.release || x?.attributes?.feature_details || x?.attributes?.title || ('OpenSubtitles #'+x.id),
          file_id: f.file_id,
          file_name: f.file_name||'',
          ext: String(f.file_name||'').split('.').pop().toLowerCase()
        });
      }
    }
    return out;
  }
  async function searchMovie(imdb){
    const id = normImdb(imdb).replace(/^tt/,''); if(!id) return [];
    const resp = await OS_GET('/subtitles', { imdb_id:id, languages:'ru', order_by:'downloads', order_direction:'desc' });
    return pickRUfromOS(resp);
  }
  async function searchSeries(imdb, season, episode){
    const id = normImdb(imdb).replace(/^tt/,''); if(!id||!season||!episode) return [];
    const resp = await OS_GET('/subtitles', { imdb_id:id, season, episode, languages:'ru', order_by:'downloads', order_direction:'desc' });
    return pickRUfromOS(resp);
  }
  async function downloadDirectUrl(file_id){
    const resp=await OS_POST('/download', { file_id });
    const link = resp?.link || '';
    if(!link) throw new Error('no link');
    return link;
  }

  // ----- SRT->VTT и применение -----
  function srtToVtt(s){
    const t = safe(s).replace(/\r+/g,'').trim();
    return 'WEBVTT\n\n'+t
      .replace(/^\d+\n/gm,'')
      .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})\s-->\s(\d{2}:\d{2}:\d{2}),(\d{3})/g,'$1.$2 --> $3.$4')
      .replace(/\n{3,}/g,'\n\n');
  }
  async function toVttObjectUrl(url){
    if(/\.vtt(\?|$)/i.test(url)) return url;
    if(/\.zip(\?|$)/i.test(url)) throw new Error('zip not supported');
    const r=await fetch(url); if(!r.ok) throw new Error('download '+r.status);
    const b=await r.arrayBuffer();
    let t=''; try{ t=new TextDecoder('utf-8').decode(b);}catch{ t=new TextDecoder('windows-1251').decode(new Uint8Array(b)); }
    const vtt = t.trim().startsWith('WEBVTT') ? t : srtToVtt(t);
    return URL.createObjectURL(new Blob([vtt],{type:'text/vtt'}));
  }
  function ensureStyle(){
    let st=document.getElementById('subs-stable-style');
    if(!st){ st=document.createElement('style'); st.id='subs-stable-style'; document.head.appendChild(st); }
    st.textContent=`video::cue{font-size:${cfg.fontSize}px}`;
  }
  function setBottom(video){
    if(!video?.textTracks) return;
    const vh=video.getBoundingClientRect().height||720;
    const percent=Math.max(0,Math.min(100,100-(cfg.bottom/vh)*100));
    for(const tt of video.textTracks){
      const cues=tt.cues||[];
      for(let i=0;i<cues.length;i++){ const c=cues[i]; try{ c.snapToLines=false; c.line=percent; c.align='center'; c.position=50; c.size=100; }catch{} }
    }
  }
  function removeTracks(){
    const v=document.querySelector('video'); if(!v) return;
    Array.from(v.querySelectorAll('track[kind="subtitles"]')).forEach(t=>t.remove());
  }
  async function applyUrl(url){
    const v=document.querySelector('video'); if(!v) return;
    removeTracks();
    if(!url) return;
    const vtt=await toVttObjectUrl(url);
    const tr=document.createElement('track');
    tr.kind='subtitles'; tr.label='Русские'; tr.srclang=LANG; tr.src=vtt; tr.default=true;
    v.appendChild(tr);
    ensureStyle(); setBottom(v);
    v.addEventListener('loadeddata', ()=>setBottom(v), {once:true});

    if (videoObs){ videoObs.disconnect(); videoObs=null; }
    videoObs=new MutationObserver(()=>{ setBottom(v); });
    videoObs.observe(v,{attributes:true,childList:true,subtree:true});
  }

  // ----- UI helpers (как в стабильной версии) -----
  function openModal(html){
    if(modalOpen) closeModal();
    modalOpen=true;
    const w=document.createElement('div');
    w.id='subs-stable-modal';
    w.style.cssText='position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;font-family:sans-serif;';
    const b=document.createElement('div');
    b.style.cssText='width:min(900px,96vw);max-height:90vh;background:#1f1f1f;color:#fff;border-radius:12px;overflow:auto;padding:12px 16px;';
    b.innerHTML=html; w.appendChild(b); document.body.appendChild(w);
    w.addEventListener('click',e=>{ if(e.target===w) closeModal(); });
    if(!escBound){ escBound=true; window.addEventListener('keydown',(e)=>{ if(e.key==='Escape'&&modalOpen){ e.preventDefault(); e.stopPropagation(); closeModal(); }},true); }
  }
  function closeModal(){ const w=document.getElementById('subs-stable-modal'); if(w) w.remove(); modalOpen=false; }
  function listButtons(root, items, onPick){
    root.innerHTML=''; const box=document.createElement('div'); root.appendChild(box);
    items.forEach(it=>{
      const btn=document.createElement('button');
      btn.textContent=it.label;
      btn.style.cssText='width:100%;text-align:left;background:transparent;color:#fff;border:0;border-bottom:1px solid #333;padding:10px 8px;cursor:pointer;';
      btn.onmouseenter=()=>btn.style.background='#333';
      btn.onmouseleave=()=>btn.style.background='transparent';
      btn.onclick=()=>onPick(it);
      box.appendChild(btn);
    });
  }
  function settingsBlock(){
    return `
      <fieldset style="border:1px solid #333;border-radius:10px;padding:10px;margin-top:10px;">
        <legend style="padding:0 6px;color:#bbb;">Настройки (live)</legend>
        <div style="display:grid;gap:14px;grid-template-columns:1fr 1fr;">
          <div><label>Размер: <span id="valSize">${cfg.fontSize}px</span></label><input id="rSize" type="range" min="10" max="60" step="1" value="${cfg.fontSize}" style="width:100%;"></div>
          <div><label>Отступ снизу: <span id="valBottom">${cfg.bottom}px</span></label><input id="rBottom" type="range" min="0" max="300" step="2" value="${cfg.bottom}" style="width:100%;"></div>
          <div style="grid-column:1/-1;"><label>Задержка (сек): <span id="valDelay">${(cfg.delay||0).toFixed(1)}</span></label><input id="rDelay" type="range" min="-10" max="10" step="0.5" value="${cfg.delay||0}" style="width:100%;"></div>
        </div>
      </fieldset>
    `;
  }
  function bindSettings(root){
    const rs=root.querySelector('#rSize'), rb=root.querySelector('#rBottom'), rd=root.querySelector('#rDelay');
    const vs=root.querySelector('#valSize'), vb=root.querySelector('#valBottom'), vd=root.querySelector('#valDelay');
    rs?.addEventListener('input', ()=>{ cfg.fontSize=+rs.value; vs.textContent=cfg.fontSize+'px'; save(); ensureStyle(); });
    rb?.addEventListener('input', ()=>{ cfg.bottom=+rb.value; vb.textContent=cfg.bottom+'px'; save(); const v=document.querySelector('video'); if(v) setBottom(v); });
    rd?.addEventListener('input', ()=>{ cfg.delay=parseFloat(rd.value)||0; vd.textContent=cfg.delay.toFixed(1); save(); });
  }

  // ----- META (как в стабильной версии) -----
  function getMeta(){
    const a=(window.Lampa?.Activity?.active && Lampa.Activity.active())||{};
    const ctx1=(window.Lampa?.Player?.video && Lampa.Player.video())||{};
    const ctx2=a||{};
    const ctx=Object.keys(ctx1).length?ctx1:ctx2;
    let imdb = a?.movie?.imdb_id || a?.card?.imdb_id || ctx.imdb_id || ctx.imdb || '';
    imdb = normImdb(imdb);
    const title=safe(ctx.title||ctx.name||'');
    const year = ctx.year?+ctx.year:(ctx.release_year?+ctx.release_year:'');
    return { imdb, title, year };
  }

  // ----- Панели (поведение как у стабильной) -----
  async function openMovie(){
    const meta=getMeta();
    openModal(`
      <h3 style="margin:0 0 8px 0;">${LABEL} — фильм</h3>
      <fieldset style="border:1px solid #333;border-radius:10px;padding:10px;">
        <legend style="padding:0 6px;color:#bbb;">Доступные субтитры</legend>
        <div id="list">Поиск...</div>
      </fieldset>
      ${settingsBlock()}
    `);
    bindSettings(document.body);

    let subs=[];
    try{ subs = await searchMovie(meta.imdb); }catch{}
    const root=document.getElementById('list');
    if(!subs.length){ root.textContent='Субтитры не найдены'; return; }
    const items=[{label:'Без субтитров', off:true}].concat(subs.map(x=>({label:x.name, file_id:x.file_id})));
    listButtons(root, items, async (it)=>{
      if (it.off){ removeTracks(); return; }
      try{ const direct=await downloadDirectUrl(it.file_id); await applyUrl(direct); }catch{ root.textContent='Ошибка загрузки'; }
    });
  }

  async function openSeries(){
    const meta=getMeta();
    openModal(`
      <h3 style="margin:0 0 8px 0;">${LABEL} — сериал</h3>
      <fieldset style="border:1px solid #333;border-radius:10px;padding:10px;">
        <legend style="padding:0 6px;color:#bbb;">Сезон и серия</legend>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <input id="season" type="number" min="1" value="1" style="width:120px;padding:8px;border:1px solid #444;background:#111;color:#fff;border-radius:8px;">
          <input id="episode" type="number" min="1" value="1" style="width:120px;padding:8px;border:1px solid #444;background:#111;color:#fff;border-radius:8px;">
          <button id="find" style="background:#0a84ff;color:#fff;border:0;border-radius:8px;padding:8px 12px;cursor:pointer;">Найти</button>
        </div>
        <div style="color:#f78;${meta.imdb?'display:none;':''};margin-top:8px;">IMDb ID не найден — откройте экран рейтингов.</div>
      </fieldset>

      <fieldset style="border:1px solid #333;border-radius:10px;padding:10px;margin-top:8px;">
        <legend style="padding:0 6px;color:#bbb;">Доступные субтитры</legend>
        <div id="list">Укажите S/E и нажмите “Найти”.</div>
      </fieldset>

      ${settingsBlock()}
    `);
    bindSettings(document.body);

    document.getElementById('find').onclick=async ()=>{
      const root=document.getElementById('list');
      root.textContent='Поиск...';
      const s=+document.getElementById('season').value;
      const e=+document.getElementById('episode').value;
      let subs=[];
      try{ subs=await searchSeries(meta.imdb, s, e); }catch{}
      if(!subs.length){ root.textContent='Субтитры не найдены'; return; }
      const items=[{label:'Без субтитров', off:true}].concat(subs.map(x=>({label:x.name, file_id:x.file_id})));
      listButtons(root, items, async (it)=>{
        if (it.off){ removeTracks(); return; }
        try{ const direct=await downloadDirectUrl(it.file_id); await applyUrl(direct); }catch{ root.textContent='Ошибка загрузки'; }
      });
    };
  }

  // Корневое меню (как в стабильной)
  async function openRoot(){
    openModal(`
      <h3 style="margin:0 0 8px 0;">${LABEL}</h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
        <button id="btnSeries" style="background:#0a84ff;color:#fff;border:0;border-radius:8px;padding:8px 12px;cursor:pointer;">Сериал</button>
        <button id="btnMovie"  style="background:#222;color:#fff;border:1px solid #444;border-radius:8px;padding:8px 12px;cursor:pointer;">Фильм</button>
      </div>
      <div id="panel"></div>
    `);
    document.getElementById('btnSeries').onclick=()=>openSeries();
    document.getElementById('btnMovie').onclick =()=>openMovie();
  }
  window.subsStableOpenAuto=openRoot;

  // ----- Кнопка в контролах плеера (как в стабильной) -----
  (function(){
    const ID='subs-stable-btn';
    function host(){
      const cc=document.querySelector('button[aria-label="Subtitles"], button[title="Subtitles"], .icon--subtitles, .player__subtitles');
      return cc?cc.parentElement:(
        document.querySelector('.player-panel__right')||
        document.querySelector('.player-controls__right')||
        document.querySelector('.player-panel-controls-right')||
        document.querySelector('.player-panel__controls')||
        document.querySelector('.video-player__controls')||
        document.querySelector('.player-panel')||null
      );
    }
    function ensure(){
      const h=host(); if(!h) return false;
      if(document.getElementById(ID)) return true;
      const b=document.createElement('button');
      b.id=ID; b.type='button'; b.title=LABEL;
      b.style.cssText='display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;background:transparent;border:0;color:#fff;opacity:.9;cursor:pointer;';
      b.innerHTML='<span style="font:600 14px/1 sans-serif;">CC</span>';
      b.onmouseenter=()=>b.style.opacity='1';
      b.onmouseleave=()=>b.style.opacity='.9';
      b.onclick=(e)=>{ e.preventDefault(); e.stopPropagation(); openRoot(); };
      h.appendChild(b);
      return true;
    }
    const mo=new MutationObserver(()=>{ try{ ensure(); }catch{} });
    mo.observe(document.documentElement,{childList:true,subtree:true});
    if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded', ()=>{ try{ ensure(); }catch{} }, {once:true}); }
    else { try{ ensure(); }catch{} }
    setTimeout(()=>{ try{ ensure(); }catch{} },400);
    setTimeout(()=>{ try{ ensure(); }catch{} },1200);
  })();

  // ----- Init -----
  if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded', ()=>ensureStyle(), {once:true}); }
  else ensureStyle();
})();
