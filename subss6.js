/* subs-stable (OSv3-style, interactive tabs, ESC close, no header title)
   - Верхние вкладки: Сериал | Фильм (двухкнопочный "слайдер" с активным состоянием, двустороннее переключение)
   - Сериалы: ручной S/E -> три строгих OSv3 маршрута
   - Фильмы: OSv3 movie + fallback subtitles.json
   - Live-настройки, "Без субтитров", закрытие по Esc
*/
(function () {
  const FLAG='__SUBS_STABLE_OSV3_TABS_ESC__';
  if (window[FLAG]) return; window[FLAG]=true;

  const OSV3='https://opensubtitles-v3.strem.io/';
  const LANG='ru';

  const STORE='subs_stable_cfg';
  const cfg = Object.assign({ fontSize:18, bottom:48, delay:0, debug:false }, JSON.parse(localStorage.getItem(STORE)||'{}'));
  const save=()=>localStorage.setItem(STORE, JSON.stringify(cfg));

  const safe=v=>(v==null?'':String(v));
  const normImdb=x=>{ const s=safe(x).trim(); if(!s) return ''; const m=s.match(/^tt\d+$/); return m?m[0]:'tt'+s.replace(/^tt?/,'').replace(/\D.*$/,''); };

  // -------- HTTP --------
  async function httpGet(base, path, q){
    const u=new URL(path.replace(/^\//,''), base.endsWith('/')?base:base+'/');
    if(q) Object.keys(q).forEach(k=>{ const v=q[k]; if(v!==''&&v!=null) u.searchParams.set(k, String(v)); });
    const href=u.toString();
    const r=await fetch(href);
    if(!r.ok) throw new Error('HTTP '+r.status);
    return {json:await r.json(), href};
  }
  function pickRu(d){
    const arr=Array.isArray(d)?d:(Array.isArray(d?.subtitles)?d.subtitles:[]);
    const out=[];
    for(const s of arr){
      const lang=safe(s.lang||s.language||s.iso||s.id).toLowerCase();
      const name=safe(s.name||s.title||s.fileName||s.provider||'OpenSubtitles');
      const url=s.url||s.stream||s.href;
      if(!url) continue;
      if(lang==='ru'||lang==='rus'||lang==='russian'||/(^|[^a-z])(ru|rus)([^a-z]|$)/i.test(name)) out.push({name,url});
    }
    const seen=new Set(); return out.filter(x=>!seen.has(x.url)&&(seen.add(x.url),true));
  }

  // -------- VTT --------
  function srtToVtt(s){
    const t=safe(s).replace(/\r+/g,'').trim();
    return 'WEBVTT\n\n'+t
      .replace(/^\d+\n/gm,'')
      .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})\s-->\s(\d{2}:\d{2}:\d{2}),(\d{3})/g,'$1.$2 --> $3.$4')
      .replace(/\n{3,}/g,'\n\n');
  }
  async function toVttUrl(url){
    if(/\.vtt(\?|$)/i.test(url)) return url;
    const r=await fetch(url); if(!r.ok) throw new Error('download');
    const b=await r.arrayBuffer();
    let t=''; try{ t=new TextDecoder('utf-8').decode(b);}catch{ t=new TextDecoder('windows-1251').decode(new Uint8Array(b)); }
    const vtt=t.trim().startsWith('WEBVTT')?t:srtToVtt(t);
    return URL.createObjectURL(new Blob([vtt],{type:'text/vtt'}));
  }

  // -------- APPLY --------
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
      for(let i=0;i<cues.length;i++){
        try{
          const c=cues[i]; c.snapToLines=false; c.line=percent; c.align='center'; c.position=50; c.size=100;
        }catch{}
      }
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
    const vtt=await toVttUrl(url);
    const tr=document.createElement('track');
    tr.kind='subtitles'; tr.label='Русские'; tr.srclang='ru'; tr.src=vtt; tr.default=true;
    v.appendChild(tr);
    ensureStyle(); setBottom(v);
    v.addEventListener('loadeddata', ()=>setBottom(v), {once:true});
  }

  // -------- META --------
  function getMeta(){
    const a=(window.Lampa?.Activity?.active && Lampa.Activity.active())||{};
    const ctx1=(window.Lampa?.Player?.video && Lampa.Player.video())||{};
    const ctx2=a||{};
    const ctx=Object.keys(ctx1).length?ctx1:ctx2;
    let imdb=a?.movie?.imdb_id || a?.card?.imdb_id || ctx.imdb_id || ctx.imdb || '';
    imdb=normImdb(imdb);
    const title=safe(ctx.title||ctx.name||'');
    const year=ctx.year?+ctx.year:(ctx.release_year?+ctx.release_year:'');
    return {imdb,title,year};
  }

  // -------- Diagnostics --------
  function diagBlock(){ return cfg.debug ? `<div id="subsDiag" style="font-size:12px;color:#aaa;margin:6px 0;"></div>` : ''; }
  function setDiag(txt){ if(!cfg.debug) return; const n=document.getElementById('subsDiag'); if(n) n.textContent=txt; }

  // -------- OSv3 queries --------
  async function querySeriesOSV3(tt, s, e){
    // 1
    try{
      const r=await httpGet(OSV3, `subtitles/series/${encodeURIComponent(tt)}.json`, {season:s,episode:e});
      const ru=pickRu(r.json); if(cfg.debug) setDiag(`S1 ${r.href} (${ru.length})`);
      if(ru.length) return ru;
    }catch(err){ if(cfg.debug) setDiag(`S1 ERR ${err}`); }
    // 2
    try{
      const r=await httpGet(OSV3, 'subtitles.json', {type:'series', id:tt, season:s, episode:e});
      const ru=pickRu(r.json); if(cfg.debug) setDiag(`S2 ${r.href} (${ru.length})`);
      if(ru.length) return ru;
    }catch(err){ if(cfg.debug) setDiag(`S2 ERR ${err}`); }
    // 3 (key style)
    try{
      const key=`${tt}:${s}:${e}`;
      const r=await httpGet(OSV3, `subtitles/series/${encodeURIComponent(key)}.json`, {});
      const ru=pickRu(r.json); if(cfg.debug) setDiag(`S3 ${r.href} (${ru.length})`);
      if(ru.length) return ru;
    }catch(err){ if(cfg.debug) setDiag(`S3 ERR ${err}`); }
    return [];
  }
  async function queryMovieOSV3(tt){
    // 1
    try{
      const r=await httpGet(OSV3, `subtitles/movie/${encodeURIComponent(tt)}.json`, {});
      const ru=pickRu(r.json); if(cfg.debug) setDiag(`M1 ${r.href} (${ru.length})`);
      if(ru.length) return ru;
    }catch(err){ if(cfg.debug) setDiag(`M1 ERR ${err}`); }
    // 2
    try{
      const r=await httpGet(OSV3, 'subtitles.json', {type:'movie', id:tt});
      const ru=pickRu(r.json); if(cfg.debug) setDiag(`M2 ${r.href} (${ru.length})`);
      if(ru.length) return ru;
    }catch(err){ if(cfg.debug) setDiag(`M2 ERR ${err}`); }
    return [];
  }

  // -------- Slider tabs UI --------
  function tabsBarHTML(active){
    const isSeries = active==='series';
    return `
      <div id="tabBar" style="display:flex;gap:6px;margin-bottom:10px;">
        <button id="tabSeries" style="flex:1;padding:10px;border-radius:10px;border:1px solid #444;cursor:pointer;${isSeries?'background:#0a84ff;border-color:#0a84ff;color:#fff;':'background:#222;color:#fff;'}">Сериал</button>
        <button id="tabMovie"  style="flex:1;padding:10px;border-radius:10px;border:1px solid #444;cursor:pointer;${!isSeries?'background:#0a84ff;border-color:#0a84ff;color:#fff;':'background:#222;color:#fff;'}">Фильм</button>
      </div>
    `;
  }
  function settingsHTML(){
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

  function openModalWithTabs(defaultTab='series'){
    const meta=getMeta();
    const imdb=meta.imdb;

    // create modal
    const id='subs-stable-modal'; const prev=document.getElementById(id); if(prev) prev.remove();
    const wrap=document.createElement('div'); wrap.id=id;
    wrap.style.cssText='position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;font-family:sans-serif;';
    const box=document.createElement('div');
    box.style.cssText='width:min(920px,96vw);max-height:90vh;background:#1f1f1f;color:#fff;border-radius:12px;overflow:auto;padding:12px 16px;';
    wrap.appendChild(box); document.body.appendChild(wrap);

    // Esc close and overlay click
    const onKey=(e)=>{ if(e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); close(); } };
    window.addEventListener('keydown', onKey, true);
    wrap.addEventListener('click', e=>{ if(e.target===wrap) close(); });
    function close(){ window.removeEventListener('keydown', onKey, true); wrap.remove(); }

    // scaffold
    box.innerHTML = `
      ${tabsBarHTML(defaultTab)}
      ${diagBlock()}
      <div id="panel"></div>
      ${settingsHTML()}
    `;
    bindSettings(box);

    const panel=box.querySelector('#panel');
    function mountTabs(active){ box.querySelector('#tabBar').outerHTML = tabsBarHTML(active); bindTabHandlers(active); }
    function bindTabHandlers(active){
      const ts=box.querySelector('#tabSeries'), tm=box.querySelector('#tabMovie');
      ts.onclick=()=>{ renderSeries(); };
      tm.onclick=()=>{ renderMovie(); };
    }

    async function renderSeries(){
      mountTabs('series');
      panel.innerHTML=`
        <fieldset style="border:1px solid #333;border-radius:10px;padding:10px;">
          <legend style="padding:0 6px;color:#bbb;">Сезон и серия</legend>
          <div style="display:flex;gap:10px;flex-wrap:wrap;">
            <input id="season" type="number" min="1" value="1" style="width:120px;padding:8px;border:1px solid #444;background:#111;color:#fff;border-radius:8px;">
            <input id="episode" type="number" min="1" value="1" style="width:120px;padding:8px;border:1px solid #444;background:#111;color:#fff;border-radius:8px;">
            <button id="btnFind" style="background:#0a84ff;color:#fff;border:0;border-radius:8px;padding:8px 12px;cursor:pointer;">Найти</button>
          </div>
          <div style="color:#f78;${imdb?'display:none;':''};margin-top:8px;">IMDb ID не найден — откройте экран рейтингов.</div>
        </fieldset>
        <fieldset style="border:1px solid #333;border-radius:10px;padding:10px;margin-top:8px;">
          <legend style="padding:0 6px;color:#bbb;">Субтитры</legend>
          <div id="subsList">Укажите S/E и нажмите “Найти”.</div>
        </fieldset>
      `;
      const list=panel.querySelector('#subsList');
      panel.querySelector('#btnFind').onclick=async ()=>{
        try{
          const s=+panel.querySelector('#season').value|0;
          const e=+panel.querySelector('#episode').value|0;
          if(!imdb||!s||!e){ list.textContent='Проверьте tt/S/E'; return; }
          list.textContent='Поиск...';
          const ru=await querySeriesOSV3(normImdb(imdb), s, e);
          if(!ru.length){ list.textContent='Субтитры не найдены'; return; }
          const items=[{label:'Без субтитров', off:true}].concat(ru.map(x=>({label:x.name,url:x.url})));
          listButtons(list, items, async (it)=>{ if(it.off){ removeTracks(); return; } try{ await applyUrl(it.url); }catch{ list.textContent='Ошибка загрузки'; } });
        }catch{ list.textContent='Ошибка запроса'; }
      };
    }

    async function renderMovie(){
      mountTabs('movie');
      panel.innerHTML=`
        <fieldset style="border:1px solid #333;border-radius:10px;padding:10px;">
          <legend style="padding:0 6px;color:#bbb;">Субтитры</legend>
          <div id="subsList">Поиск...</div>
        </fieldset>
      `;
      const list=panel.querySelector('#subsList');
      try{
        if(!imdb){ list.textContent='Нет imdb_id'; return; }
        const ru=await queryMovieOSV3(normImdb(imdb));
        if(!ru.length){ list.textContent='Субтитры не найдены'; return; }
        const items=[{label:'Без субтитров', off:true}].concat(ru.map(x=>({label:x.name,url:x.url})));
        listButtons(list, items, async (it)=>{ if(it.off){ removeTracks(); return; } try{ await applyUrl(it.url); }catch{ list.textContent='Ошибка загрузки'; } });
      }catch{ list.textContent='Ошибка запроса'; }
    }

    // initial
    if (defaultTab==='movie') renderMovie(); else renderSeries();
  }

  // -------- Button in player controls --------
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
      b.id=ID; b.type='button'; b.title='subtitles';
      b.style.cssText='display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;background:transparent;border:0;color:#fff;opacity:.9;cursor:pointer;';
      b.innerHTML='<span style="font:600 14px/1 sans-serif;">CC</span>';
      b.onmouseenter=()=>b.style.opacity='1';
      b.onmouseleave=()=>b.style.opacity='.9';
      b.onclick=(e)=>{ e.preventDefault(); e.stopPropagation(); openModalWithTabs('series'); };
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

  // -------- Init --------
  if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded', ()=>ensureStyle(), {once:true}); }
  else ensureStyle();
})();
