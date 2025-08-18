/* subs-stable (OSv3: строгий формат Stremio + ручной/массовый поиск серий)
   Назначение:
   - Кнопка рядом с дефолтной CC в панели плеера.
   - Фильмы: авто-поиск RU субтитров (OSv3 movie).
   - Сериалы: два режима:
       1) Быстрый — ручной выбор Сезон/Серия → строгий запрос как в Stremio.
       2) Массовый — сканирование диапазона серий, выводит список эпизодов, где RU найдены.
   - "Без субтитров", ESC, live-настройки (размер/отступ/задержка; отступ через snapToLines=false).
   Заметки:
   - Если imdb_id пустой — покажем предупреждение (зайдите на экран рейтингов, чтобы подхватился ID).
   - Диагностика (cfg.debug=true) — показывает последний URL и статус ответа.
*/
(function () {
  const FLAG='__SUBS_STABLE_OSV3_FINAL__';
  if (window[FLAG]) return; window[FLAG]=true;

  // ---------------- Consts / Config ----------------
  const OSV3_BASE='https://opensubtitles-v3.strem.io/';
  const LANG='ru';
  const LABEL='subs-stable';

  // Диапазон для массового сканирования (адаптируйте по вкусу)
  const MAX_S=15;      // сезоны 1..15
  const MAX_E=30;      // эпизоды 1..30
  const CONCURRENCY=6; // параллельных запросов

  const STORE_KEY='subs_stable_cfg';
  const cfg = Object.assign(
    { fontSize:18, bottom:48, delay:0, selectedName:'', debug:false },
    JSON.parse(localStorage.getItem(STORE_KEY)||'{}')
  );
  const saveCfg=()=>localStorage.setItem(STORE_KEY, JSON.stringify(cfg));

  const safe=v=>(v==null?'':String(v));
  const normImdb=x=>{
    const s=safe(x).trim();
    if(!s) return '';
    const m=s.match(/^tt\d+$/);
    if (m) return m[0];
    return 'tt'+s.replace(/^tt?/,'').replace(/\D.*$/,'');
  };

  let modalOpen=false, escBound=false, lastTrackUrl='', videoObs=null;

  // ---------------- HTTP ----------------
  async function httpGet(path, q){
    const base = OSV3_BASE.endsWith('/')?OSV3_BASE:OSV3_BASE+'/';
    const url = new URL(path.replace(/^\//,''), base);
    if(q) for(const k of Object.keys(q)){ const v=q[k]; if(v!==''&&v!=null) url.searchParams.set(k, String(v)); }
    const href=url.toString();
    const r=await fetch(href);
    if(!r.ok) throw new Error('HTTP '+r.status);
    return { json:await r.json(), href };
  }
  function pickRu(d){
    const a=Array.isArray(d)?d:(Array.isArray(d?.subtitles)?d.subtitles:[]);
    const out=[];
    for(const s of a){
      const lang=safe(s.lang||s.language||s.iso||s.id).toLowerCase();
      const name=safe(s.name||s.title||s.fileName||s.provider||'OpenSubtitles');
      const url=s.url||s.stream||s.href; if(!url) continue;
      if(lang==='ru'||lang==='rus'||lang==='russian'||/(^|[^a-z])(ru|rus)([^a-z]|$)/i.test(name)) out.push({name,url});
    }
    const seen=new Set(); return out.filter(x=>!seen.has(x.url)&&(seen.add(x.url),true));
  }

  // ---------------- SRT -> VTT ----------------
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

  // ---------------- META ----------------
  function imdbFromRating(){
    try{
      const act=(window.Lampa?.Activity?.active && Lampa.Activity.active())||{};
      if (act?.movie?.imdb_id) return act.movie.imdb_id;
      if (act?.card?.imdb_id)  return act.card.imdb_id;
      const render = act?.activity?.render && act.activity.render();
      const n = render && (render.querySelector('[data-imdb], [data-imdb-id]'));
      const v = n?.getAttribute('data-imdb') || n?.getAttribute('data-imdb-id');
      if (v) return v;
    }catch{}
    return '';
  }
  function getContext(){
    const ctx1=(window.Lampa?.Player?.video && Lampa.Player.video())||{};
    const ctx2=(window.Lampa?.Activity?.active && Lampa.Activity.active())||{};
    const ctx=Object.keys(ctx1).length?ctx1:ctx2;
    const imdb = normImdb(imdbFromRating() || ctx.imdb_id || ctx.imdb);
    const title=safe(ctx.title || ctx.name || '');
    const year = ctx.year ? +ctx.year : (ctx.release_year ? +ctx.release_year : '');
    return { imdb, title, year };
  }

  // ---------------- APPLY (tracks + styles) ----------------
  function ensureStyle(){
    let st=document.getElementById('subs-stable-style');
    if(!st){ st=document.createElement('style'); st.id='subs-stable-style'; document.head.appendChild(st); }
    st.textContent=`video::cue { font-size:${cfg.fontSize}px; }`;
  }
  function setCueBottomForTrack(tt, video){
    const vh=video.getBoundingClientRect().height||720;
    const percent=Math.max(0, Math.min(100, 100 - (cfg.bottom / vh) * 100));
    const cues=tt.cues||[];
    for(let i=0;i<cues.length;i++){
      const c=cues[i];
      try{ c.snapToLines=false; c.line=percent; c.align='center'; c.position=50; c.size=100; }catch{}
    }
  }
  function applyBottom(video){
    if(!video?.textTracks) return;
    for(const tt of video.textTracks) setCueBottomForTrack(tt, video);
  }
  function applyDelay(video){
    if(!video?.textTracks) return;
    const delta=cfg.delay||0; if (!delta) return;
    for(const tt of video.textTracks){
      const cues=tt.cues||[];
      for(let i=0;i<cues.length;i++){
        const c=cues[i];
        try{ c.startTime=Math.max(0,c.startTime+delta); c.endTime=Math.max(c.startTime+0.2,c.endTime+delta); }
        catch{
          try{
            const nc=new VTTCue(Math.max(0,c.startTime+delta), Math.max(0.2,c.endTime+delta), c.text);
            nc.snapToLines=false; nc.line=c.line; nc.align=c.align; nc.position=c.position; nc.size=c.size;
            tt.removeCue(c); tt.addCue(nc);
          }catch{}
        }
      }
    }
  }
  function removeAllSubTracks(){
    const v=document.querySelector('video'); if(!v) return;
    Array.from(v.querySelectorAll('track[kind="subtitles"]')).forEach(t=>t.remove());
  }
  function applyToVideo(vttUrl){
    const v=document.querySelector('video'); if(!v) return;

    removeAllSubTracks();
    lastTrackUrl=vttUrl||'';
    if (!vttUrl) return;

    const tr=document.createElement('track');
    tr.kind='subtitles'; tr.label='Русские'; tr.srclang=LANG; tr.src=vttUrl; tr.default=true;
    v.appendChild(tr);

    const show=()=>{
      try{
        if(v.textTracks){
          for(const tt of v.textTracks){ tt.mode=(tt.language===LANG||/ru|рус/i.test(tt.label))?'showing':'disabled'; }
          applyBottom(v); applyDelay(v);
        }
      }catch{}
    };
    ensureStyle(); show();
    v.addEventListener('loadeddata',show,{once:true});
    v.addEventListener('play',show,{once:true});

    if (videoObs){ videoObs.disconnect(); videoObs=null; }
    videoObs=new MutationObserver(()=>{ applyToVideo(lastTrackUrl); });
    videoObs.observe(v,{attributes:true,childList:true,subtree:true});
  }
  function liveReapply(){
    const v=document.querySelector('video'); if(!v) return;
    ensureStyle();
    if(v.textTracks){ for(const tt of v.textTracks){ tt.mode=(tt.language===LANG||/ru|рус/i.test(tt.label))?'showing':'disabled'; } }
    applyBottom(v);
    if (lastTrackUrl && Math.abs(cfg.delay)>1e-6){ const keep=lastTrackUrl; lastTrackUrl=''; applyToVideo(keep); }
  }

  // ---------------- UI helpers ----------------
  function openModal(html){
    if(modalOpen) closeModal();
    modalOpen=true;
    const w=document.createElement('div');
    w.id='subs-stable-modal';
    w.style.cssText='position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;font-family:sans-serif;';
    const b=document.createElement('div');
    b.style.cssText='width:min(980px,96vw);max-height:90vh;background:#1f1f1f;color:#fff;border-radius:12px;overflow:hidden;display:flex;flex-direction:column;';
    const h=document.createElement('div');
    h.style.cssText='padding:12px 16px;background:#2a2a2a;font-weight:600;display:flex;justify-content:space-between;align-items:center;';
    h.innerHTML=`<span>${LABEL}</span><button id="subsStableClose" style="background:#444;color:#fff;border:0;border-radius:8px;padding:6px 10px;cursor:pointer;">Закрыть</button>`;
    const body=document.createElement('div'); body.style.cssText='padding:12px 16px;overflow:auto;'; body.innerHTML=html;
    b.appendChild(h); b.appendChild(body); w.appendChild(b); document.body.appendChild(w);
    h.querySelector('#subsStableClose').onclick=closeModal;
    w.addEventListener('click',e=>{ if(e.target===w) closeModal(); });

    if(!escBound){ escBound=true; window.addEventListener('keydown', (e)=>{ if(e.key==='Escape'&&modalOpen){ e.preventDefault(); e.stopPropagation(); closeModal(); }}, true); }
    return {body};
  }
  function closeModal(){ const w=document.getElementById('subs-stable-modal'); if(w) w.remove(); modalOpen=false; }
  function renderList(c,items,onPick){
    const ul=document.createElement('div');
    items.forEach(it=>{
      const btn=document.createElement('button');
      btn.textContent=it.label;
      btn.style.cssText='width:100%;text-align:left;background:transparent;color:#fff;border:0;border-bottom:1px solid #333;padding:10px 8px;cursor:pointer;';
      btn.onmouseenter=()=>btn.style.background='#333';
      btn.onmouseleave=()=>btn.style.background='transparent';
      btn.onclick=()=>onPick(it);
      ul.appendChild(btn);
    });
    c.innerHTML=''; c.appendChild(ul);
  }
  function settingsBlock(){
    return `
      <fieldset style="border:1px solid #333;border-radius:10px;padding:10px;">
        <legend style="padding:0 6px;color:#bbb;">Настройки (live)</legend>
        <div style="display:grid;gap:14px;grid-template-columns:1fr 1fr;">
          <div><label>Размер: <span id="valSize">${cfg.fontSize}px</span></label><input id="rangeSize" type="range" min="10" max="60" step="1" value="${cfg.fontSize}" style="width:100%;"></div>
          <div><label>Отступ снизу: <span id="valBottom">${cfg.bottom}px</span></label><input id="rangeBottom" type="range" min="0" max="300" step="2" value="${cfg.bottom}" style="width:100%;"></div>
          <div style="grid-column:1/-1;"><label>Задержка (сек): <span id="valDelay">${cfg.delay.toFixed(1)}</span></label><input id="rangeDelay" type="range" min="-10" max="10" step="0.5" value="${cfg.delay}" style="width:100%;"></div>
        </div>
      </fieldset>
    `;
  }
  function bindSliders(root){
    const sizeEl=root.querySelector('#rangeSize'), bottomEl=root.querySelector('#rangeBottom'), delayEl=root.querySelector('#rangeDelay');
    const valSize=root.querySelector('#valSize'), valBottom=root.querySelector('#valBottom'), valDelay=root.querySelector('#valDelay');
    sizeEl.addEventListener('input', ()=>{ cfg.fontSize=+sizeEl.value; valSize.textContent=cfg.fontSize+'px'; saveCfg(); ensureStyle(); liveReapply(); });
    bottomEl.addEventListener('input', ()=>{ cfg.bottom=+bottomEl.value; valBottom.textContent=cfg.bottom+'px'; saveCfg(); liveReapply(); });
    delayEl.addEventListener('input', ()=>{ cfg.delay=parseFloat(delayEl.value)||0; valDelay.textContent=cfg.delay.toFixed(1); saveCfg(); liveReapply(); });
  }
  function diagBlock(){ return `<div id="subsDiag" style="font-size:12px;color:#aaa;margin-bottom:8px;"></div>`; }
  function setDiag(txt){ const n=document.getElementById('subsDiag'); if(n) n.textContent=txt; }

  // ---------------- FETCH flows ----------------
  async function fetchMovieAuto(imdb, title, year){
    const out=[]; const tt=normImdb(imdb);
    if (tt){
      try{ const {json}=await httpGet(`subtitles/movie/${encodeURIComponent(tt)}.json`,{}); out.push(...pickRu(json)); }catch{}
      if(!out.length){ try{ const {json}=await httpGet('subtitles.json',{type:'movie', id:tt}); out.push(...pickRu(json)); }catch{} }
    } else if (title){
      try{ const {json}=await httpGet('subtitles.json',{type:'movie', query:year?`${title} ${year}`:title}); out.push(...pickRu(json)); }catch{}
    }
    return out;
  }

  async function fetchSeriesStrictOne(tt, season, episode){
    // строгий маршрут
    try{
      const {json, href}=await httpGet(`subtitles/series/${encodeURIComponent(tt)}.json`, {season, episode});
      return { items:pickRu(json), href, status:'OK' };
    }catch(e){
      return { items:[], href:'', status:'ERR' };
    }
  }
  async function fetchSeriesFallbackOne(tt, season, episode){
    try{
      const {json, href}=await httpGet('subtitles.json', {type:'series', id:tt, season, episode});
      return { items:pickRu(json), href, status:'OK' };
    }catch(e){
      return { items:[], href:'', status:'ERR' };
    }
  }
  async function fetchSeriesAnyOne(tt, season, episode){
    const a=await fetchSeriesStrictOne(tt, season, episode);
    if (a.items.length) return a;
    const b=await fetchSeriesFallbackOne(tt, season, episode);
    return b.items.length ? b : a;
  }

  // ---------------- BULK scan ----------------
  async function bulkFetchSeries(tt){
    const map=new Map(); // "SxE" -> items[]
    const jobs=[];
    for(let s=1;s<=MAX_S;s++){
      for(let e=1;e<=MAX_E;e++){
        jobs.push({s,e});
      }
    }
    async function worker(queue){
      while(queue.length){
        const {s,e}=queue.shift();
        try{
          const r=await fetchSeriesStrictOne(tt, s, e);
          if (r.items.length) map.set(`${s}x${e}`, r.items);
        }catch{}
      }
    }
    const q=jobs.slice();
    const ws=[];
    for(let i=0;i<CONCURRENCY;i++) ws.push(worker(q));
    await Promise.all(ws);

    // fallback маленькой сеткой, если ничего не нашли
    if (!map.size){
      const alt=[];
      for(let s=1;s<=Math.min(5,MAX_S);s++){
        for(let e=1;e<=Math.min(5,MAX_E);e++){
          alt.push({s,e});
        }
      }
      async function worker2(queue){
        while(queue.length){
          const {s,e}=queue.shift();
          try{
            const r=await fetchSeriesFallbackOne(tt, s, e);
            if (r.items.length) map.set(`${s}x${e}`, r.items);
          }catch{}
        }
      }
      const q2=alt.slice();
      const ws2=[];
      for(let i=0;i<CONCURRENCY;i++) ws2.push(worker2(q2));
      await Promise.all(ws2);
    }

    return map;
  }

  // ---------------- Panels ----------------
  async function openMoviePanel(meta){
    const subs = await fetchMovieAuto(meta.imdb, meta.title, meta.year);
    const {body}=openModal(`
      <div style="display:grid;gap:12px;">
        <fieldset style="border:1px solid #333;border-radius:10px;padding:10px;">
          <legend style="padding:0 6px;color:#bbb;">Доступные субтитры</legend>
          <div id="subsList">${subs.length?'':'Субтитры не найдены'}</div>
        </fieldset>
        ${settingsBlock()}
      </div>
    `);
    bindSliders(body);
    if (!subs.length) return;

    const items=[{label:'Без субтитров', url:'', name:'(off)'}].concat(subs.map(s=>({label:s.name,url:s.url,name:s.name})));
    renderList(body.querySelector('#subsList'), items, async (it)=>{
      try{
        cfg.selectedName=it.name||''; saveCfg();
        if (it.url){ const vtt=await toVttUrl(it.url); applyToVideo(vtt); } else { lastTrackUrl=''; removeAllSubTracks(); }
      }catch{}
    });
  }

  async function openSeriesManualPanel(meta){
    const {body}=openModal(`
      <div style="display:grid;gap:12px;">
        <fieldset style="border:1px solid #333;border-radius:10px;padding:10px;">
          <legend style="padding:0 6px;color:#bbb;">Сериал: ручной поиск</legend>
          ${cfg.debug? `<div id="subsDiag" style="font-size:12px;color:#aaa;margin-bottom:8px;"></div>` : ``}
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
            <label>Сезон:
              <select id="selSeason" style="margin-left:6px;padding:6px 10px;background:#111;color:#fff;border:1px solid #444;border-radius:8px;">
                ${Array.from({length:30},(_,i)=>i+1).map(v=>`<option value="${v}">${v}</option>`).join('')}
              </select>
            </label>
            <label>Серия:
              <select id="selEpisode" style="margin-left:6px;padding:6px 10px;background:#111;color:#fff;border:1px solid #444;border-radius:8px;">
                ${Array.from({length:60},(_,i)=>i+1).map(v=>`<option value="${v}">${v}</option>`).join('')}
              </select>
            </label>
            <button id="btnFind" style="margin-left:auto;background:#0a84ff;color:#fff;border:0;border-radius:8px;padding:8px 12px;cursor:pointer;">Найти</button>
          </div>
          <div style="color:#f78;${meta.imdb?'display:none;':''};margin-top:8px;">IMDb ID не найден. Откройте экран рейтингов, чтобы подтянуть imdb_id.</div>
        </fieldset>

        <fieldset style="border:1px solid #333;border-radius:10px;padding:10px;">
          <legend style="padding:0 6px;color:#bbb;">Результаты</legend>
          <div id="subsList">Выберите S/E и нажмите “Найти”.</div>
        </fieldset>

        ${settingsBlock()}
      </div>
    `);
    bindSliders(body);

    body.querySelector('#btnFind').onclick=async ()=>{
      const season=+body.querySelector('#selSeason').value;
      const episode=+body.querySelector('#selEpisode').value;
      const listNode=body.querySelector('#subsList');
      listNode.textContent='Поиск...';
      const tt=normImdb(meta.imdb);
      if (!tt){ listNode.innerHTML='Нет imdb_id'; return; }

      let lastHref='', status='EMPTY';
      let res=await fetchSeriesStrictOne(tt, season, episode);
      lastHref=res.href; let subs=res.items; status=res.items.length?'OK':'EMPTY';
      if (!subs.length){
        res=await fetchSeriesFallbackOne(tt, season, episode);
        lastHref=res.href; subs=res.items; status=res.items.length?'OK':'EMPTY';
      }
      if (cfg.debug) setDiag(`season=${season} episode=${episode} • ${status} • ${lastHref}`);

      if (!subs.length){ listNode.innerHTML='Субтитры не найдены'; return; }
      const items=[{label:'Без субтитров', url:'', name:'(off)'}].concat(subs.map(x=>({label:x.name,url:x.url,name:x.name})));
      renderList(listNode, items, async (it)=>{
        try{
          cfg.selectedName = it.name || ''; saveCfg();
          if (it.url){ const vtt=await toVttUrl(it.url); applyToVideo(vtt); } else { lastTrackUrl=''; removeAllSubTracks(); }
        }catch{}
      });
    };
  }

  async function openSeriesBulkPanel(meta){
    const {body}=openModal(`
      <div style="display:grid;gap:12px;">
        <fieldset style="border:1px solid #333;border-radius:10px;padding:10px;">
          <legend style="padding:0 6px;color:#bbb;">Сканирование эпизодов</legend>
          ${cfg.debug? `<div id="subsDiag" style="font-size:12px;color:#aaa;margin-bottom:8px;"></div>` : ``}
          <div id="scanStatus" style="color:#bbb;">Подготовка...</div>
        </fieldset>

        <fieldset style="border:1px solid #333;border-radius:10px;padding:10px;">
          <legend style="padding:0 6px;color:#bbb;">Найденные серии</legend>
          <div id="episodesList">Еще ничего нет. Подождите завершения сканирования...</div>
        </fieldset>

        <fieldset style="border:1px solid #333;border-radius:10px;padding:10px;">
          <legend style="padding:0 6px;color:#bbb;">Файлы субтитров (выбранная серия)</legend>
          <div id="subsList">Выберите серию слева.</div>
        </fieldset>

        ${settingsBlock()}
      </div>
    `);
    bindSliders(body);

    const tt=normImdb(meta.imdb);
    if (!tt){
      body.querySelector('#scanStatus').innerHTML='<span style="color:#f78;">IMDb ID не найден. Откройте экран рейтингов, чтобы подтянуть imdb_id.</span>';
      return;
    }

    body.querySelector('#scanStatus').textContent='Сканирование OSv3…';
    const map=await bulkFetchSeries(tt);

    if (!map.size){
      body.querySelector('#scanStatus').innerHTML='Сканирование завершено: подходящих RU субтитров не найдено.';
      return;
    }
    body.querySelector('#scanStatus').textContent=`Готово: найдено серий с субтитрами — ${map.size}`;

    // сгруппируем по сезонам
    const bySeason=new Map();
    for(const key of map.keys()){
      const [s,e]=key.split('x').map(n=>+n);
      if(!bySeason.has(s)) bySeason.set(s,[]);
      bySeason.get(s).push(e);
    }
    for(const s of bySeason.keys()){ bySeason.get(s).sort((a,b)=>a-b); }

    const epRoot=body.querySelector('#episodesList');
    epRoot.innerHTML='';
    for(const s of Array.from(bySeason.keys()).sort((a,b)=>a-b)){
      const head=document.createElement('div');
      head.textContent='Сезон '+s;
      head.style.cssText='margin:6px 0 4px;color:#bbb;font-weight:600;';
      epRoot.appendChild(head);
      const wrap=document.createElement('div');
      wrap.style.cssText='display:flex;flex-wrap:wrap;gap:6px;';
      bySeason.get(s).forEach(e=>{
        const b=document.createElement('button');
        b.textContent=`S${String(s).padStart(2,'0')}E${String(e).padStart(2,'0')}`;
        b.style.cssText='padding:6px 10px;background:#222;color:#fff;border:1px solid #444;border-radius:8px;cursor:pointer;';
        b.onmouseenter=()=>b.style.background='#333';
        b.onmouseleave=()=>b.style.background='#222';
        b.onclick=()=>{
          const list=body.querySelector('#subsList');
          const arr=map.get(`${s}x${e}`)||[];
          if (!arr.length){ list.textContent='Для выбранной серии нет субтитров'; return; }
          const items=[{label:'Без субтитров', url:'', name:'(off)'}].concat(arr.map(x=>({label:x.name,url:x.url,name:x.name})));
          const ul=document.createElement('div'); list.innerHTML=''; list.appendChild(ul);
          items.forEach(it=>{
            const btn=document.createElement('button');
            btn.textContent=it.label;
            btn.style.cssText='width:100%;text-align:left;background:transparent;color:#fff;border:0;border-bottom:1px solid #333;padding:10px 8px;cursor:pointer;';
            btn.onmouseenter=()=>btn.style.background='#333';
            btn.onmouseleave=()=>btn.style.background='transparent';
            btn.onclick=async ()=>{
              try{
                cfg.selectedName=it.name||''; saveCfg();
                if (it.url){ const vtt=await toVttUrl(it.url); applyToVideo(vtt); } else { lastTrackUrl=''; removeAllSubTracks(); }
              }catch{}
            };
            ul.appendChild(btn);
          });
        };
        wrap.appendChild(b);
      });
      epRoot.appendChild(wrap);
    }
  }

  async function openAuto(){
    try{
      const meta=getContext();
      // По умолчанию — панель сериалов (bulk) + отдельно доступна ручная панель из кнопки ниже
      const {body}=openModal(`
        <div style="display:grid;gap:12px;">
          <div id="panelHost"></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button id="btnBulk" style="background:#0a84ff;color:#fff;border:0;border-radius:8px;padding:8px 12px;cursor:pointer;">Сканировать сериал (bulk)</button>
            <button id="btnManual" style="background:#222;color:#fff;border:1px solid #444;border-radius:8px;padding:8px 12px;cursor:pointer;">Ручной поиск серии</button>
            <button id="btnMovie" style="background:#222;color:#fff;border:1px solid #444;border-radius:8px;padding:8px 12px;cursor:pointer;">Фильм (авто)</button>
          </div>
        </div>
      `);

      // Внутри panelHost будем открывать соответствующую панель:
      body.querySelector('#btnBulk').onclick = ()=> openSeriesBulkPanel(meta);
      body.querySelector('#btnManual').onclick= ()=> openSeriesManualPanel(meta);
      body.querySelector('#btnMovie').onclick = ()=> openMoviePanel(meta);
      // По умолчанию — bulk:
      await openSeriesBulkPanel(meta);
    }catch{
      openModal('<div>Ошибка открытия меню</div>');
    }
  }
  window.subsStableOpenAuto = openAuto;

  // ---------------- Button inside player controls ----------------
  (function(){
    const BTN_ID='subs-stable-btn-globe';
    function findControlsRight(){
      const cc=document.querySelector('button[aria-label="Subtitles"], button[title="Subtitles"], .icon--subtitles, .player__subtitles');
      const host = cc ? cc.parentElement : (
        document.querySelector('.player-panel__right') ||
        document.querySelector('.player-controls__right') ||
        document.querySelector('.player-panel-controls-right') ||
        document.querySelector('.player-panel__controls') ||
        document.querySelector('.video-player__controls') ||
        document.querySelector('.player-panel') || null
      );
      return {host, cc};
    }
    function ensureButton(){
      const {host, cc}=findControlsRight(); if(!host) return false;
      let btn=document.getElementById(BTN_ID);
      if(!btn){
        btn = cc && cc.tagName==='BUTTON' ? cc.cloneNode(true) : document.createElement('button');
        btn.id=BTN_ID; btn.type='button'; btn.setAttribute('aria-label','subs-stable'); btn.setAttribute('title','subs-stable');
        if (cc && cc.className) btn.className = cc.className + ' subs-stable-btn';
        // иконка
        if (document.querySelector('.material-icons, .material-symbols-outlined') || document.querySelector('link[href*="fonts.googleapis.com/icon"]')){
          const i=document.createElement('span'); i.className='material-icons'; i.style.fontSize='20px'; i.textContent='public'; btn.innerHTML=''; btn.appendChild(i);
        } else if (document.querySelector('.mdi') || document.querySelector('link[href*="materialdesignicons"]')){
          const i=document.createElement('i'); i.className='mdi mdi-earth'; i.style.fontSize='20px'; btn.innerHTML=''; btn.appendChild(i);
        } else if (document.querySelector('.uil') || document.querySelector('link[href*="unicons"]')){
          const i=document.createElement('i'); i.className='uil uil-globe'; i.style.fontSize='20px'; btn.innerHTML=''; btn.appendChild(i);
        } else { btn.textContent='CC'; }
        btn.addEventListener('click',(e)=>{ e.preventDefault(); e.stopPropagation(); try{ window.subsStableOpenAuto && window.subsStableOpenAuto(); }catch{} });
        if (cc && cc.parentElement===host) cc.insertAdjacentElement('afterend', btn); else host.appendChild(btn);
      }
      return true;
    }
    const obs=new MutationObserver(()=>{ ensureButton(); });
    obs.observe(document.documentElement,{childList:true,subtree:true});
    if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', ()=>ensureButton(), {once:true}); else ensureButton();
    setTimeout(()=>ensureButton(), 400); setTimeout(()=>ensureButton(), 1200);
  })();

  // ---------------- Init ----------------
  function init(){ ensureStyle(); }
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', init, {once:true}); else init();
})();
