(function () {
  const FLAG='__SUBS_STABLE_SUBHERO_RU_FIX__';
  if (window[FLAG]) return; window[FLAG]=true;

  // ====== SubHero base (язык RU из твоей ссылки) ======
  const STREMIO_LINK = 'stremio://subhero.onrender.com/%7B%22language%22%3A%22ru%22%7D/manifest.json';

  function normalizeBase(input) {
    let s = String(input || '').trim()
      .replace(/^stremio:\/\//i, 'https://')
      .replace(/manifest\.json\s*$/i, '')
      .replace(/[?#].*$/, '');
    if (!s.endsWith('/')) s += '/';
    return s;
  }
  const SUBHERO_BASE_RU = normalizeBase(STREMIO_LINK);           // с сегментом {language:"ru"}
  const SUBHERO_BASE_RAW = 'https://subhero.onrender.com/';      // fallback без сегмента
  const LANG='ru';

  // ====== Settings ======
  const STORE='subs_stable_cfg';
  const defaultCfg = { fontSize:18, bottom:300, delay:0, debug:true }; // debug включён для диага
  const cfg = Object.assign({}, defaultCfg, safeParse(localStorage.getItem(STORE)));
  saveCfg();

  let videoObs=null;

  // ====== Utils ======
  function safeParse(json){ try{ return json?JSON.parse(json):{}; }catch{ return {}; } }
  function saveCfg(){ try{ localStorage.setItem(STORE, JSON.stringify(cfg)); }catch{} }
  const S=v=>(v==null?'':String(v));
  const normImdb = x => {
    const s=S(x).trim(); if(!s) return '';
    const m=s.match(/^tt\d+$/); return m?m[0]:'tt'+s.replace(/^tt?/,'').replace(/\D.*$/,'');
  };

  // ====== HTTP с warmup/таймаутами/ретраями ======
  async function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

  async function fetchJSON(url, opt={}){
    const ac = new AbortController();
    const t = setTimeout(()=>ac.abort(), opt.timeoutMs||8000);
    try{
      const r = await fetch(url, {
        mode: 'cors',
        referrerPolicy: 'no-referrer',
        headers: { 'Accept': 'application/json' },
        signal: ac.signal
      });
      if (!r.ok) throw new Error('HTTP '+r.status);
      try{ return await r.json(); }catch{ return {}; }
    } finally {
      clearTimeout(t);
    }
  }

  async function warmup(base){
    try{ await fetchJSON(new URL('manifest.json', base).toString(), { timeoutMs: 5000 }); }catch{}
  }

  async function httpGet(base, path, q){
    const b = normalizeBase(base);
    const u = new URL(path.replace(/^\//,''), b);
    if(q) Object.keys(q).forEach(k=>{ const v=q[k]; if(v!==''&&v!=null) u.searchParams.set(k, String(v)); });
    const href = u.toString();
    let lastErr=null;
    for (let attempt=0; attempt<2; attempt++){
      try{
        const json = await fetchJSON(href, { timeoutMs: 9000 + attempt*2000 });
        return { json, href };
      } catch(e){
        lastErr = e;
        if (attempt===0){ try{ await warmup(b); }catch{} }
        await sleep(300+attempt*500);
      }
    }
    throw lastErr||new Error('fetch failed');
  }

  // ====== SRT -> VTT ======
  function srtToVtt(s){
    const t=S(s).replace(/\r+/g,'').trim();
    return 'WEBVTT\n\n'+t
      .replace(/^\d+\n/gm,'')
      .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})\s-->\s(\d{2}:\d{2}:\d{2}),(\d{3})/g,'$1.$2 --> $3.$4')
      .replace(/\n{3,}/g,'\n\n');
  }
  async function toVttUrl(url){
    if(/\.vtt(\?|$)/i.test(url)) return url;
    const r=await fetch(url, { referrerPolicy:'no-referrer' });
    if(!r.ok) throw new Error('download ' + r.status);
    const b=await r.arrayBuffer();
    let t=''; try{ t=new TextDecoder('utf-8').decode(b);}catch{ t=new TextDecoder('windows-1251').decode(new Uint8Array(b)); }
    const vtt=t.trim().startsWith('WEBVTT')?t:srtToVtt(t);
    return URL.createObjectURL(new Blob([vtt],{type:'text/vtt'}));
  }

  // ====== Apply + Settings ======
  function ensureStyle(){
    let st=document.getElementById('subs-stable-style');
    if(!st){ st=document.createElement('style'); st.id='subs-stable-style'; document.head.appendChild(st); }
    st.textContent=`video::cue { font-size:${cfg.fontSize}px; }`;
  }
  function recalcBottomForTrack(tt, video){
    if(!tt||!video) return;
    const vh=video.getBoundingClientRect().height||720;
    const percent=Math.max(0, Math.min(100, 100 - (cfg.bottom / vh) * 100));
    const cues=tt.cues||[];
    for(let i=0;i<cues.length;i++){
      const c=cues[i]; try{ c.snapToLines=false; c.line=percent; c.align='center'; c.position=50; c.size=100; }catch{}
    }
  }
  function applyBottom(video){
    if(!video?.textTracks) return;
    for(const tt of video.textTracks) recalcBottomForTrack(tt, video);
  }
  function applyDelay(video){
    if(!video?.textTracks) return;
    const delta=Number(cfg.delay)||0; if(!delta) return;
    for(const tt of video.textTracks){
      const cues=tt.cues||[]; const toAdd=[];
      for(let i=0;i<cues.length;i++){
        const c=cues[i];
        try{
          const ns=Math.max(0,(c.startTime||0)+delta);
          const ne=Math.max(ns+0.2,(c.endTime||0)+delta);
          const nc=new VTTCue(ns,ne,c.text);
          nc.snapToLines=false; nc.line=c.line; nc.align='center'; nc.position=50; nc.size=100;
          toAdd.push({old:c, neu:nc});
        }catch{}
      }
      try{ for(const x of toAdd) tt.removeCue(x.old); for(const x of toAdd) tt.addCue(x.neu); }catch{}
    }
  }
  function removeAllSubTracks(){
    const v=document.querySelector('video'); if(!v) return;
    Array.from(v.querySelectorAll('track[kind="subtitles"]')).forEach(t=>t.remove());
  }
  async function applyToVideo(vttUrl){
    const v=document.querySelector('video'); if(!v) return;
    removeAllSubTracks();
    if(!vttUrl) return;
    const tr=document.createElement('track');
    tr.kind='subtitles'; tr.label='Русские'; tr.srclang=LANG; tr.src=vttUrl; tr.default=true;
    v.appendChild(tr);

    const reapply=()=>{ try{ ensureStyle(); if(v.textTracks) for(const tt of v.textTracks) tt.mode='showing'; applyBottom(v); if(Number(cfg.delay)) applyDelay(v);}catch{} };
    reapply();
    v.addEventListener('loadeddata', reapply, {once:true});
    v.addEventListener('loadedmetadata', reapply, {once:true});
    const hookTracks=()=>{ try{ if(!v.textTracks) return; for(const tt of v.textTracks){ tt.oncuechange=()=>{ reapply(); }; } }catch{} };
    hookTracks(); setTimeout(hookTracks,50);
    setTimeout(reapply,0); setTimeout(reapply,100); setTimeout(reapply,300); setTimeout(reapply,800);
    if (videoObs){ videoObs.disconnect(); videoObs=null; }
    videoObs=new MutationObserver(()=>{ reapply(); });
    videoObs.observe(v,{attributes:true,childList:true,subtree:true});
  }

  // ====== Diagnostics ======
  function diagBlock(){ return cfg.debug?`<div id="subsDiag" style="font-size:12px;color:#aaa;margin:6px 0;white-space:nowrap;overflow:auto;"></div>`:''; }
  function setDiag(txt){ if(!cfg.debug) return; const n=document.getElementById('subsDiag'); if(n) n.textContent=txt; }

  // ====== Нормализация ответов ======
  function normalizeSubsResponse(data){
    let arr = [];
    if (Array.isArray(data)) arr = data;
    else if (Array.isArray(data?.subtitles)) arr = data.subtitles;
    else if (Array.isArray(data?.streams)) arr = data.streams;

    const out=[]; const seen=new Set();
    for(const s of arr){
      const lang=S(s.lang||s.language||s.iso||s.id).toLowerCase();
      const name=S(s.name||s.title||s.fileName||s.provider||'SubHero');
      const url=s.url||s.stream||s.href;
      if(!url || seen.has(url)) continue;
      seen.add(url);
      out.push({lang, name, url});
    }
    return out;
  }
  function pickRu(list){
    return list.filter(x=>{
      if (x.lang==='ru'||x.lang==='rus'||x.lang==='russian') return true;
      return /(^(ru|rus)$|\b(ru|rus)\b)/i.test(x.name);
    }).map(x=>({name:x.name,url:x.url}));
  }

  // ====== Мульти-маршруты + fallback-базы ======
  async function tryAcrossBases(paths){
    // 1) база с конфиг-сегментом (ru), 2) fallback без сегмента
    const bases=[SUBHERO_BASE_RU, SUBHERO_BASE_RAW];
    for (const base of bases){
      for (const p of paths){
        try{
          const r = await httpGet(base, p.path, p.query||null);
          const items = normalizeSubsResponse(r.json);
          const ru = pickRu(items);
          setDiag(`OK ${r.href} | total:${items.length} ru:${ru.length}`);
          if (ru.length) return ru;
        }catch(e){
          setDiag(`ERR ${base}${p.path} | ${e.message||e}`);
        }
      }
    }
    return [];
  }

  async function querySeries(ttRaw, sRaw, eRaw){
    const tt = normImdb(ttRaw);
    const s = Number(sRaw)||0, e = Number(eRaw)||0;
    if(!tt||s<=0||e<=0){ setDiag(`INVALID tt/s/e ${ttRaw}/${sRaw}/${eRaw}`); return []; }
    // ВАЖНО: не энкодим двоеточия! Кодируем только tt.
    const safeTT = encodeURIComponent(tt);
    const rawId = `${tt}:${s}:${e}`;
    const safeIdPart = `${safeTT}:${s}:${e}`;
    const paths = [
      { path: `subtitles/series/${rawId}.json` },            // без энкода ':'
      { path: `subtitles/series/${safeIdPart}.json` },       // tt закодирован, ':' сырой
      { path: `subtitles/${rawId}.json`, query:{ type:'series' } },
      { path: `subtitles/series/${tt}.json`,  query:{ season:s, episode:e } }, // на всякий
      { path: `subtitles.json`, query:{ type:'series', id:rawId } },
      { path: `q`,              query:{ type:'series', id:rawId } },
    ];
    try{ return await tryAcrossBases(paths); }catch{ return []; }
  }

  async function queryMovie(ttRaw){
    const tt = normImdb(ttRaw);
    if(!tt){ setDiag(`INVALID tt ${ttRaw}`); return []; }
    const safeTT = encodeURIComponent(tt);
    const paths = [
      { path: `subtitles/movie/${tt}.json` },            // сырой tt
      { path: `subtitles/movie/${safeTT}.json` },        // закодированный tt
      { path: `subtitles/${tt}.json`,  query:{ type:'movie' } },
      { path: `subtitles/${safeTT}.json`,  query:{ type:'movie' } },
      { path: `subtitles.json`, query:{ type:'movie', id:tt } },
      { path: `q`,              query:{ type:'movie', id:tt } },
    ];
    try{ return await tryAcrossBases(paths); }catch{ return []; }
  }

  // ====== META ======
  function getMeta(){
    const a=(window.Lampa?.Activity?.active && Lampa.Activity.active())||{};
    const ctx1=(window.Lampa?.Player?.video && Lampa.Player.video())||{};
    const ctx2=a||{}; const ctx=Object.keys(ctx1).length?ctx1:ctx2;
    let imdb=a?.movie?.imdb_id || a?.card?.imdb_id || ctx.imdb_id || ctx.imdb || '';
    imdb=normImdb(imdb);
    const title=S(ctx.title||ctx.name||''); const year=ctx.year?+ctx.year:(ctx.release_year?+ctx.release_year:'');
    return {imdb,title,year};
  }

  // ====== UI (Tabs + Panels) ======
  function tabsBarHTML(active){
    const isSeries=active==='series';
    return `
      <div id="tabBar" style="display:flex;gap:6px;margin-bottom:10px;align-items:center;">
        <button id="tabSeries" style="flex:1;padding:10px;border-radius:10px;border:none;cursor:pointer;${isSeries?'background:#0a84ff;color:#fff;':'background:#222;color:#fff;'}">Сериал</button>
        <button id="tabMovie"  style="flex:1;padding:10px;border-radius:10px;border:none;cursor:pointer;${!isSeries?'background:#0a84ff;color:#fff;':'background:#222;color:#fff;'}">Фильм</button>
      </div>
    `;
  }
  function settingsHTML(){
    return `
      <fieldset style="border:1px solid #333;border-radius:10px;padding:10px;margin-top:10px;">
        <legend style="padding:0 6px;color:#bbb;">Настройки</legend>
        <div style="display:grid;gap:14px;grid-template-columns:1fr 1fr;">
          <div><label>Размер: <span id="valSize">${cfg.fontSize}px</span></label><input id="rSize" type="range" min="10" max="60" step="1" value="${cfg.fontSize}" style="width:100%;"></div>
          <div><label>Отступ снизу: <span id="valBottom">${cfg.bottom}px</span></label><input id="rBottom" type="range" min="0" max="400" step="2" value="${cfg.bottom}" style="width:100%;"></div>
          <div style="grid-column:1/-1;"><label>Задержка (сек): <span id="valDelay">${(cfg.delay||0).toFixed(1)}</span></label><input id="rDelay" type="range" min="-10" max="10" step="0.5" value="${cfg.delay||0}" style="width:100%;"></div>
        </div>
        ${diagBlock()}
      </fieldset>
    `;
  }
  function bindSettings(root){
    const rs=root.querySelector('#rSize'), rb=root.querySelector('#rBottom'), rd=root.querySelector('#rDelay');
    const vs=root.querySelector('#valSize'), vb=root.querySelector('#valBottom'), vd=root.querySelector('#valDelay');
    rs?.addEventListener('input', ()=>{ cfg.fontSize=+rs.value; vs.textContent=cfg.fontSize+'px'; saveCfg(); ensureStyle(); });
    rb?.addEventListener('input', ()=>{ cfg.bottom=+rb.value; vb.textContent=cfg.bottom+'px'; saveCfg(); const v=document.querySelector('video'); if(v) applyBottom(v); });
    rd?.addEventListener('input', ()=>{ cfg.delay=parseFloat(rd.value)||0; vd.textContent=cfg.delay.toFixed(1); saveCfg(); const v=document.querySelector('video'); if(v) applyDelay(v); });
  }

  function openModalWithTabs(defaultTab='series'){
    const meta=getMeta();
    const id='subs-stable-modal'; const prev=document.getElementById(id); if(prev) prev.remove();
    const wrap=document.createElement('div'); wrap.id=id;
    wrap.style.cssText='position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;font-family:sans-serif;';
    const box=document.createElement('div');
    box.style.cssText='width:min(920px,96vw);max-height:90vh;background:#1f1f1f;color:#fff;border-radius:12px;overflow:auto;padding:12px 16px;';
    wrap.appendChild(box); document.body.appendChild(wrap);
    const onKey=(e)=>{ if(e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); close(); } };
    window.addEventListener('keydown', onKey, true);
    wrap.addEventListener('click', e=>{ if(e.target===wrap) close(); });
    function close(){ window.removeEventListener('keydown', onKey, true); wrap.remove(); }

    box.innerHTML = `
      ${tabsBarHTML(defaultTab)}
      <div id="panel"></div>
      ${settingsHTML()}
    `;
    bindSettings(box);

    const panel=box.querySelector('#panel');
    function mountTabs(active){
      const bar=box.querySelector('#tabBar');
      bar.outerHTML=tabsBarHTML(active);
      box.querySelector('#tabSeries').onclick=()=>renderSeries();
      box.querySelector('#tabMovie').onclick =()=>renderMovie();
    }

    async function renderSeries(){
      mountTabs('series');
      panel.innerHTML=`
        <fieldset style="border:1px solid #333;border-radius:10px;padding:10px;">
          <legend style="padding:0 6px;color:#bbb;">Сезон и серия</legend>
          <div style="display:flex;gap:10px;flex-wrap:wrap;">
            <input id="season" type="number" min="1" value="1" style="width:120px;padding:8px;border:1px solid #444;background:#111;color:#fff;border-radius:8px;">
            <input id="episode" type="number" min="1" value="1" style="width:120px;padding:8px;border:1px solid #444;background:#111;color:#fff;border-radius:8px;">
            <button id="btnFind" style="background:#0a84ff;color:#fff;border:none;border-radius:8px;padding:8px 12px;cursor:pointer;">Найти</button>
          </div>
          <div style="color:#f78;${meta.imdb?'display:none;':''};margin-top:8px;">IMDb ID не найден — откройте экран рейтингов.</div>
        </fieldset>
        <fieldset style="border:1px solid #333;border-radius:10px;padding:10px;margin-top:8px;">
          <legend style="padding:0 6px;color:#bbb;">Субтитры</legend>
          <div id="subsList">Укажите S/E и нажмите “Найти”.</div>
        </fieldset>
      `;
      const list=panel.querySelector('#subsList');
      panel.querySelector('#btnFind').onclick=async ()=>{
        try{
          const s=Number(panel.querySelector('#season').value)||0;
          const e=Number(panel.querySelector('#episode').value)||0;
          const imdbNow=getMeta().imdb;
          list.textContent='Поиск...';
          if(!imdbNow||s<=0||e<=0){ list.textContent='Проверьте tt/S/E'; return; }
          const ru=await querySeries(imdbNow,s,e);
          if(!ru.length){ list.textContent='Субтитры не найдены'; return; }
          const items=[{label:'Без субтитров', off:true}].concat(ru.map(x=>({label:x.name,url:x.url})));
          renderList(list, items, async (it)=>{
            if(it.off){ removeAllSubTracks(); return; }
            try{ const vtt=await toVttUrl(it.url); await applyToVideo(vtt); }
            catch(err){ list.textContent='Ошибка загрузки'; setDiag('DL err: '+(err?.message||err)); }
          });
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
        const imdbNow=getMeta().imdb;
        if(!imdbNow){ list.textContent='Нет imdb_id'; return; }
        const ru=await queryMovie(imdbNow);
        if(!ru.length){ list.textContent='Субтитры не найдены'; return; }
        const items=[{label:'Без субтитров', off:true}].concat(ru.map(x=>({label:x.name,url:x.url})));
        renderList(list, items, async (it)=>{
          if(it.off){ removeAllSubTracks(); return; }
          try{ const vtt=await toVttUrl(it.url); await applyToVideo(vtt); }
          catch(err){ list.textContent='Ошибка загрузки'; setDiag('DL err: '+(err?.message||err)); }
        });
      }catch{ list.textContent='Ошибка запроса'; }
    }

    function renderList(root, items, onPick){
      root.innerHTML=''; const box=document.createElement('div'); root.appendChild(box);
      items.forEach(it=>{
        const btn=document.createElement('button');
        btn.textContent=it.label;
        btn.style.cssText='width:100%;text-align:left;background:transparent;color:#fff;border:none;border-bottom:1px solid #333;padding:10px 8px;cursor:pointer;';
        btn.onmouseenter=()=>btn.style.background='#333';
        btn.onmouseleave=()=>btn.style.background='transparent';
        btn.onclick=()=>onPick(it);
        box.appendChild(btn);
      });
    }

    if (defaultTab==='movie') renderMovie(); else renderSeries();
  }

  // ====== Кнопка в панели плеера ======
  (function(){
    const ID='subs-stable-btn';
    const BTN_CLASS='subs-stable-button';
    const BTN_GAP='.5em';
    const BTN_PADDING='0.4em';

    (function injectBtnStyle(){
      const sid='subs-stable-btn-style';
      if (document.getElementById(sid)) return;
      const st=document.createElement('style');
      st.id=sid;
      st.textContent = `
        .${BTN_CLASS}{
          height:100%;
          aspect-ratio:1 / 1;
          border-radius:50%;
          padding:${BTN_PADDING};
          background:transparent;
          color:#fff;
          display:flex;
          align-items:center;
          justify-content:center;
          flex:0 0 auto;
          user-select:none;
          box-sizing:border-box;
          border:none;
          outline:none;
          margin:0 ${BTN_GAP};
        }
        .${BTN_CLASS}:not(:where([style*="height"])) { min-height:2em; }
        .${BTN_CLASS}:hover,
        .${BTN_CLASS}:focus{ background:#fff; color:#000; }
        .${BTN_CLASS} svg{
          width:100%; height:100%;
          fill:none; stroke:currentColor;
          pointer-events:none;
        }
      `;
      document.head.appendChild(st);
    })();

    const GLOBE_SVG = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
          d="M12 21a9 9 0 1 0 0-18m-8.5 6h17m-17 6h17"/>
      </svg>
    `;

    function host(){
      return (
        document.querySelector('.player-panel__right')||
        document.querySelector('.player-controls__right')||
        document.querySelector('.player-panel-controls-right')||
        document.querySelector('.player-panel__controls')||
        document.querySelector('.video-player__controls')||
        document.querySelector('.player-panel')||null
      );
    }
    function triggerOpen(){ try{ openModalWithTabs('series'); }catch{} }

    function ensure(){
      const h=host(); if(!h) return false;
      if(document.getElementById(ID)) return true;
      const rect=h.getBoundingClientRect();
      const btn=document.createElement('button');
      btn.id=ID;
      btn.className=BTN_CLASS + ' player-panel__button button';
      btn.type='button';
      btn.setAttribute('title','Subtitles');
      btn.setAttribute('aria-label','Open subtitles');
      btn.setAttribute('role','button');
      btn.setAttribute('tabindex','0');
      if (rect.height>0) btn.style.height=Math.round(rect.height)+'px';
      const wrap=document.createElement('div');
      wrap.style.width='100%'; wrap.style.height='100%'; wrap.innerHTML=GLOBE_SVG;
      btn.appendChild(wrap);
      const onOver=()=>{ btn.style.background='#fff'; btn.style.color='#000'; };
      const onOut =()=>{ btn.style.background='transparent'; btn.style.color='#fff'; };
      btn.addEventListener('mouseenter', onOver);
      btn.addEventListener('mouseleave', onOut);
      btn.addEventListener('focus', onOver);
      btn.addEventListener('blur', onOut);
      btn.addEventListener('click', (e)=>{ e.preventDefault(); e.stopPropagation(); triggerOpen(); });
      btn.addEventListener('keydown', (e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); } });
      btn.addEventListener('keyup', (e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); triggerOpen(); } });
      const std=h.querySelector('button[aria-label="Subtitles"], button[title="Subtitles"]');
      if (std && std.parentElement===h) std.insertAdjacentElement('afterend', btn);
      else h.appendChild(btn);
      const ro=new ResizeObserver(()=>{ const r=h.getBoundingClientRect(); if (r.height>0) btn.style.height=Math.round(r.height)+'px'; });
      try{ ro.observe(h); }catch{}
      return true;
    }

    const mo=new MutationObserver(()=>{ try{ ensure(); }catch{} });
    mo.observe(document.documentElement,{childList:true,subtree:true});
    if(document.readyState==='loading'){
      document.addEventListener('DOMContentLoaded', ()=>{ try{ ensure(); }catch{} }, {once:true});
    } else { try{ ensure(); }catch{} }
    setTimeout(()=>{ try{ ensure(); }catch{} },400);
    setTimeout(()=>{ try{ ensure(); }catch{} },1200);
  })();

  // ====== Init ======
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded', ()=>ensureStyle(), {once:true});
  } else ensureStyle();

  // ====== Expose ======
  window.subsStableOpenAuto = openModalWithTabs;

})();
