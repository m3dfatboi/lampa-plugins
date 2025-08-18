/* subs-stable (OSv3-style, interactive tabs, ESC close, persistent settings, globe button)
   - Вкладки: Сериал | Фильм (переключаются в одном окне, без перезагрузки)
   - Сериалы: строгие маршруты OSv3 (S1/S2/S3)
   - Фильмы: OSv3 movie (+fallback subtitles.json)
   - Настройки (live) сохраняются и немедленно применяются:
       • Размер шрифта (video::cue)
       • Отступ снизу (snapToLines=false; line обновляется сразу, по oncuechange и таймерами)
       • Задержка (пересоздание cues)
   - Закрытие по Esc, пункт “Без субтитров”
   - Кнопка в контролах плеера: круглая 2em×2em, SVG‑глобус, ховер: белый фон/чёрная иконка
*/
(function () {
  const FLAG='__SUBS_STABLE_OSV3_FULL_GLOBE__';
  if (window[FLAG]) return; window[FLAG]=true;

  const OSV3='https://opensubtitles-v3.strem.io/';
  const LANG='ru';

  // ------------- Settings -------------
  const STORE='subs_stable_cfg';
  const defaultCfg = { fontSize:18, bottom:300, delay:0, debug:false };
  const cfg = Object.assign({}, defaultCfg, safeParse(localStorage.getItem(STORE)));
  saveCfg();

  // ------------- State -------------
  let videoObs=null;

  // ------------- Utils -------------
  function safeParse(json){ try{ return json?JSON.parse(json):{}; }catch{ return {}; } }
  function saveCfg(){ try{ localStorage.setItem(STORE, JSON.stringify(cfg)); }catch{} }
  const S=v=>(v==null?'':String(v));
  const normImdb=x=>{
    const s=S(x).trim();
    if(!s) return '';
    const m=s.match(/^tt\d+$/);
    return m?m[0]:'tt'+s.replace(/^tt?/,'').replace(/\D.*$/,'');
  };

  // ------------- HTTP -------------
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
      const lang=S(s.lang||s.language||s.iso||s.id).toLowerCase();
      const name=S(s.name||s.title||s.fileName||s.provider||'OpenSubtitles');
      const url=s.url||s.stream||s.href;
      if(!url) continue;
      if(lang==='ru'||lang==='rus'||lang==='russian'||/(^|[^a-z])(ru|rus)([^a-z]|$)/i.test(name)) out.push({name,url});
    }
    const seen=new Set(); return out.filter(x=>!seen.has(x.url)&&(seen.add(x.url),true));
  }

  // ------------- SRT -> VTT -------------
  function srtToVtt(s){
    const t=S(s).replace(/\r+/g,'').trim();
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

  // ------------- Apply subtitles + Settings -------------
  function ensureStyle(){
    let st=document.getElementById('subs-stable-style');
    if(!st){ st=document.createElement('style'); st.id='subs-stable-style'; document.head.appendChild(st); }
    st.textContent=`video::cue { font-size:${cfg.fontSize}px; }`;
  }

  function recalcBottomForTrack(tt, video){
    if(!tt||!video) return;
    const vh = video.getBoundingClientRect().height || 720;
    const percent = Math.max(0, Math.min(100, 100 - (cfg.bottom / vh) * 100));
    const cues = tt.cues || [];
    for (let i=0;i<cues.length;i++){
      const c = cues[i];
      try{
        c.snapToLines = false;
        c.line = percent;
        c.align = 'center';
        c.position = 50;
        c.size = 100;
      }catch{}
    }
  }

  function applyBottom(video){
    if(!video?.textTracks) return;
    for(const tt of video.textTracks) recalcBottomForTrack(tt, video);
  }

  function applyDelay(video){
    if(!video?.textTracks) return;
    const delta = Number(cfg.delay)||0;
    if (!delta) return;
    for(const tt of video.textTracks){
      const cues = tt.cues || [];
      const toAdd=[];
      for(let i=0;i<cues.length;i++){
        const c=cues[i];
        try{
          const ns = Math.max(0, (c.startTime||0)+delta);
          const ne = Math.max(ns+0.2, (c.endTime||0)+delta);
          const nc = new VTTCue(ns, ne, c.text);
          nc.snapToLines=false;
          nc.line=c.line;
          nc.align='center';
          nc.position=50;
          nc.size=100;
          toAdd.push({old:c, neu:nc});
        }catch{}
      }
      try{
        for(const x of toAdd) tt.removeCue(x.old);
        for(const x of toAdd) tt.addCue(x.neu);
      }catch{}
    }
  }

  function removeAllSubTracks(){
    const v=document.querySelector('video'); if(!v) return;
    Array.from(v.querySelectorAll('track[kind="subtitles"]')).forEach(t=>t.remove());
  }

  async function applyToVideo(vttUrl){
    const v=document.querySelector('video'); if(!v) return;

    // remove previous
    removeAllSubTracks();
    if (!vttUrl) return;

    // add new track
    const tr=document.createElement('track');
    tr.kind='subtitles'; tr.label='Русские'; tr.srclang=LANG; tr.src=vttUrl; tr.default=true;
    v.appendChild(tr);

    const reapply = ()=>{
      try{
        ensureStyle();
        if (v.textTracks) for (const tt of v.textTracks) tt.mode='showing';
        applyBottom(v);
        if (Number(cfg.delay)) applyDelay(v);
      }catch{}
    };

    // immediate
    reapply();
    // when data/metadata loaded
    v.addEventListener('loadeddata', reapply, {once:true});
    v.addEventListener('loadedmetadata', reapply, {once:true});

    // oncuechange hook for all tracks (cues appear async)
    const hookTracks = ()=>{
      try{
        if(!v.textTracks) return;
        for(const tt of v.textTracks){
          tt.oncuechange = ()=>{ reapply(); };
        }
      }catch{}
    };
    hookTracks();
    setTimeout(hookTracks, 50);

    // timed retries
    setTimeout(reapply, 0);
    setTimeout(reapply, 100);
    setTimeout(reapply, 300);
    setTimeout(reapply, 800);

    // observe DOM for track changes
    if (videoObs){ videoObs.disconnect(); videoObs=null; }
    videoObs=new MutationObserver(()=>{ reapply(); });
    videoObs.observe(v,{attributes:true,childList:true,subtree:true});
  }

  // ------------- Diagnostics -------------
  function diagBlock(){ return cfg.debug ? `<div id="subsDiag" style="font-size:12px;color:#aaa;margin:6px 0;white-space:nowrap;overflow:auto;"></div>` : ''; }
  function setDiag(txt){ if(!cfg.debug) return; const n=document.getElementById('subsDiag'); if(n) n.textContent=txt; }

  // ------------- OSv3 Queries -------------
  async function querySeriesOSV3(ttRaw, sRaw, eRaw){
    const tt = (String(ttRaw||'').match(/^tt\d+$/)?.[0]) || ('tt'+String(ttRaw||'').replace(/^tt?/,'').replace(/\D.*$/,''));
    const s = Number(sRaw)||0, e = Number(eRaw)||0;
    if (!tt || s<=0 || e<=0){ setDiag(`INVALID tt/s/e -> tt=${ttRaw} s=${sRaw} e=${eRaw}`); return []; }

    // 1
    try{
      const r=await httpGet(OSV3, `subtitles/series/${encodeURIComponent(tt)}.json`, {season:s,episode:e});
      const ru=pickRu(r.json); setDiag(`S1 ${r.href} (${ru.length})`);
      if(ru.length) return ru;
    }catch(err){ setDiag(`S1 ERR ${err}`); }
    // 2
    try{
      const r=await httpGet(OSV3, 'subtitles.json', {type:'series', id:tt, season:s, episode:e});
      const ru=pickRu(r.json); setDiag(`S2 ${r.href} (${ru.length})`);
      if(ru.length) return ru;
    }catch(err){ setDiag(`S2 ERR ${err}`); }
    // 3 key style
    try{
      const key=`${tt}:${s}:${e}`;
      const r=await httpGet(OSV3, `subtitles/series/${encodeURIComponent(key)}.json`, {});
      const ru=pickRu(r.json); setDiag(`S3 ${r.href} (${ru.length})`);
      if(ru.length) return ru;
    }catch(err){ setDiag(`S3 ERR ${err}`); }

    return [];
  }

  async function queryMovieOSV3(ttRaw){
    const tt = (String(ttRaw||'').match(/^tt\d+$/)?.[0]) || ('tt'+String(ttRaw||'').replace(/^tt?/,'').replace(/\D.*$/,''));
    if (!tt){ setDiag(`INVALID tt -> ${ttRaw}`); return []; }
    // 1
    try{
      const r=await httpGet(OSV3, `subtitles/movie/${encodeURIComponent(tt)}.json`, {});
      const ru=pickRu(r.json); setDiag(`M1 ${r.href} (${ru.length})`);
      if(ru.length) return ru;
    }catch(err){ setDiag(`M1 ERR ${err}`); }
    // 2
    try{
      const r=await httpGet(OSV3, 'subtitles.json', {type:'movie', id:tt});
      const ru=pickRu(r.json); setDiag(`M2 ${r.href} (${ru.length})`);
      if(ru.length) return ru;
    }catch(err){ setDiag(`M2 ERR ${err}`); }
    return [];
  }

  // ------------- META -------------
  function getMeta(){
    const a=(window.Lampa?.Activity?.active && Lampa.Activity.active())||{};
    const ctx1=(window.Lampa?.Player?.video && Lampa.Player.video())||{};
    const ctx2=a||{};
    const ctx=Object.keys(ctx1).length?ctx1:ctx2;
    let imdb=a?.movie?.imdb_id || a?.card?.imdb_id || ctx.imdb_id || ctx.imdb || '';
    imdb=normImdb(imdb);
    const title=S(ctx.title||ctx.name||'');
    const year=ctx.year?+ctx.year:(ctx.release_year?+ctx.release_year:'');
    return {imdb,title,year};
  }

  // ------------- UI: Tabs + Panels -------------
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
          <div><label>Отступ снизу: <span id="valBottom">${cfg.bottom}px</span></label><input id="rBottom" type="range" min="0" max="400" step="2" value="${cfg.bottom}" style="width:100%;"></div>
          <div style="grid-column:1/-1;"><label>Задержка (сек): <span id="valDelay">${(cfg.delay||0).toFixed(1)}</span></label><input id="rDelay" type="range" min="-10" max="10" step="0.5" value="${cfg.delay||0}" style="width:100%;"></div>
        </div>
      </fieldset>
    `;
  }
  function bindSettings(root){
    const rs=root.querySelector('#rSize'), rb=root.querySelector('#rBottom'), rd=root.querySelector('#rDelay');
    const vs=root.querySelector('#valSize'), vb=root.querySelector('#valBottom'), vd=root.querySelector('#valDelay');

    rs?.addEventListener('input', ()=>{
      cfg.fontSize=+rs.value; vs.textContent=cfg.fontSize+'px'; saveCfg();
      ensureStyle();
    });
    rb?.addEventListener('input', ()=>{
      cfg.bottom=+rb.value; vb.textContent=cfg.bottom+'px'; saveCfg();
      const v=document.querySelector('video'); if(v){ applyBottom(v); }
    });
    rd?.addEventListener('input', ()=>{
      cfg.delay=parseFloat(rd.value)||0; vd.textContent=cfg.delay.toFixed(1); saveCfg();
      const v=document.querySelector('video'); if(v){ applyDelay(v); }
    });
  }

  function openModalWithTabs(defaultTab='series'){
    const meta=getMeta();

    // Modal + Esc
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
      ${diagBlock()}
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
            <button id="btnFind" style="background:#0a84ff;color:#fff;border:0;border-radius:8px;padding:8px 12px;cursor:pointer;">Найти</button>
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
          if(!imdbNow || s<=0 || e<=0){ list.textContent='Проверьте tt/S/E'; return; }
          const ru=await querySeriesOSV3(imdbNow, s, e);
          if(!ru.length){ list.textContent='Субтитры не найдены'; return; }
          const items=[{label:'Без субтитров', off:true}].concat(ru.map(x=>({label:x.name,url:x.url})));
          renderList(list, items, async (it)=>{
            if(it.off){ removeAllSubTracks(); return; }
            try{ const vtt=await toVttUrl(it.url); await applyToVideo(vtt); }catch{ list.textContent='Ошибка загрузки'; }
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
        const ru=await queryMovieOSV3(imdbNow);
        if(!ru.length){ list.textContent='Субтитры не найдены'; return; }
        const items=[{label:'Без субтитров', off:true}].concat(ru.map(x=>({label:x.name,url:x.url})));
        renderList(list, items, async (it)=>{
          if(it.off){ removeAllSubTracks(); return; }
          try{ const vtt=await toVttUrl(it.url); await applyToVideo(vtt); }catch{ list.textContent='Ошибка загрузки'; }
        });
      }catch{ list.textContent='Ошибка запроса'; }
    }

    function renderList(root, items, onPick){
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

    // initial
    if (defaultTab==='movie') renderMovie(); else renderSeries();
  }

  // ------------- Player controls globe button -------------
  (function(){
    const ID='subs-stable-btn';
    const GLOBE_SVG = `
      <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" focusable="false">
        <path d="M12 2a10 10 0 100 20 10 10 0 000-20Zm7.1 9h-3.05a13.7 13.7 0 00-1.66-5.2A8 8 0 0119.1 11ZM9.6 5.8A12 12 0 008.07 11H4.9A8 8 0 019.6 5.8ZM4.9 13h3.17a12 12 0 001.53 5.2A8 8 0 014.9 13Zm5.48 0h3.24a10.8 10.8 0 01-1.62 4.52c-.55.95-1.1 1.48-1.62-2.2A12.3 12.3 0 0110.38 13Zm3.24-2h-3.24a12.3 12.3 0 011.62-4.32c.55-.95 1.1-1.48 1.62 2.2.28.82.48 1.73.62 2.12ZM12 4a8 8 0 013.61 1.87A13.7 13.7 0 0117.95 11h-3.05A12 12 0 0012 4Zm0 16a8 8 0 01-3.61-1.87A13.7 13.7 0 016.05 13h3.05A12 12 0 0012 20Z"></path>
      </svg>
    `;

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

      const btn=document.createElement('button');
      btn.id=ID; btn.type='button'; btn.title='subtitles';
      btn.style.cssText=[
        'display:inline-flex','align-items:center','justify-content:center',
        'width:2em','height:2em','border-radius:50%','border:1px solid rgba(255,255,255,.6)',
        'background:transparent','color:#fff','cursor:pointer','transition:all .15s ease',
        'outline:none','padding:0','margin:0 .25em'
      ].join(';');

      btn.innerHTML = GLOBE_SVG;
      const svg = btn.querySelector('svg');
      if (svg){
        svg.style.fill='currentColor';
        svg.style.color='#fff';
        svg.style.width='1.1em';
        svg.style.height='1.1em';
      }

      btn.onmouseenter=()=>{
        btn.style.background='#fff';
        btn.style.color='#000';
        btn.style.borderColor='#fff';
      };
      btn.onmouseleave=()=>{
        btn.style.background='transparent';
        btn.style.color='#fff';
        btn.style.borderColor='rgba(255,255,255,.6)';
      };
      btn.onmousedown = ()=>{ btn.style.transform='scale(0.96)'; };
      btn.onmouseup   = ()=>{ btn.style.transform='scale(1)'; };

      btn.onclick=(e)=>{
        e.preventDefault(); e.stopPropagation();
        try{ openModalWithTabs && openModalWithTabs('series'); }catch{}
      };

      h.appendChild(btn);
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

  // ------------- Init -------------
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded', ()=>ensureStyle(), {once:true});
  } else ensureStyle();
})();
