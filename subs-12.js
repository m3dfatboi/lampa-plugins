/* subs-stable (all-in-one, OSv3)
   - Кнопка в панели плеера (рядом с дефолтной CC), иконка "глобус"
   - Автоопределение (IMDb из rating.js/контекста), фильмы и сериалы
   - Сериалы: выбор S/E селекторами, попытка парсинга из названия эпизода
   - Список RU субтитров + "Без субтитров"
   - Live-настройки: размер, отступ снизу, задержка; точный bottom через snapToLines=false
   - ESC закрывает окно
*/
(function () {
  const FLAG='__SUBS_STABLE_ALLINONE__';
  if (window[FLAG]) return; window[FLAG]=true;

  const OSV3_BASE='https://opensubtitles-v3.strem.io/';
  const LANG='ru';
  const LABEL='subs-stable';

  const STORE_KEY='subs_stable_cfg';
  const cfg = Object.assign({ fontSize:18, bottom:48, delay:0, selectedName:'' }, JSON.parse(localStorage.getItem(STORE_KEY)||'{}'));
  const saveCfg=()=>localStorage.setItem(STORE_KEY, JSON.stringify(cfg));

  const safe=v=>(v==null?'':String(v));
  let modalOpen=false, lastTrackUrl='', videoObs=null, escBound=false;

  // -------- HTTP / OSv3
  async function GET(path,q){
    const u=new URL(path.replace(/^\//,''), OSV3_BASE);
    if(q) Object.keys(q).forEach(k=>{const v=q[k]; if(v!==''&&v!=null) u.searchParams.set(k,String(v));});
    const r=await fetch(u); if(!r.ok) throw new Error('HTTP '+r.status);
    return r.json();
  }
  function pickRu(d){
    const a=Array.isArray(d)?d:(Array.isArray(d?.subtitles)?d.subtitles:[]);
    const out=[]; for(const s of a){
      const l=safe(s.lang||s.language||s.iso||s.id).toLowerCase();
      const name=safe(s.name||s.title||s.fileName||s.provider||'OpenSubtitles');
      const url=s.url||s.stream||s.href; if(!url) continue;
      if(l==='ru'||l==='rus'||l==='russian'||/(^|[^a-z])(ru|rus)([^a-z]|$)/i.test(name)) out.push({name,url});
    }
    const seen=new Set(); return out.filter(x=>!seen.has(x.url)&&(seen.add(x.url),true));
  }
  function srtToVtt(s){
    const t=safe(s).replace(/\r+/g,'').trim();
    return 'WEBVTT\n\n'+t.replace(/^\d+\n/gm,'').replace(/(\d{2}:\d{2}:\d{2}),(\d{3})\s-->\s(\d{2}:\d{2}:\d{2}),(\d{3})/g,'$1.$2 --> $3.$4').replace(/\n{3,}/g,'\n\n');
  }
  async function toVttUrl(url){
    if(/\.vtt(\?|$)/i.test(url)) return url;
    const r=await fetch(url); if(!r.ok) throw new Error('download');
    const b=await r.arrayBuffer();
    let t=''; try{ t=new TextDecoder('utf-8').decode(b);}catch{ t=new TextDecoder('windows-1251').decode(new Uint8Array(b)); }
    const vtt=t.trim().startsWith('WEBVTT')?t:srtToVtt(t);
    return URL.createObjectURL(new Blob([vtt],{type:'text/vtt'}));
  }

  // -------- META / rating.js bridge / parsing
  function normImdb(x){ const s=safe(x); return s? (s.startsWith('tt')?s:('tt'+s.replace(/^tt/,''))):''; }
  function imdbFromRating(){
    try{
      const act = (window.Lampa?.Activity?.active && Lampa.Activity.active()) || {};
      if (act?.movie?.imdb_id) return normImdb(act.movie.imdb_id);
      if (act?.card?.imdb_id)  return normImdb(act.card.imdb_id);
      const render = act?.activity?.render && act.activity.render();
      const n = render && (render.querySelector('[data-imdb], [data-imdb-id]'));
      const v = n?.getAttribute('data-imdb') || n?.getAttribute('data-imdb-id');
      if (v) return normImdb(v);
    }catch{}
    return '';
  }
  function parseSEFromTitle(titleRaw){
    const s = safe(titleRaw);
    let m = s.match(/S(\d{1,2})E(\d{1,2})/i); if (m) return {season:+m[1], episode:+m};
    m = s.match(/(\d{1,2})x(\d{1,2})/);        if (m) return {season:+m[1], episode:+m};
    m = s.match(/Season\s+(\d{1,2})\D+Episode\s+(\d{1,2})/i) || s.match(/Сезон\s+(\d{1,2})\D+Серия\s+(\d{1,2})/i);
    if (m) return {season:+m[1], episode:+m};
    return {season:0, episode:0};
  }
  function getContext(){
    const ctx1 = (window.Lampa?.Player?.video && Lampa.Player.video()) || {};
    const ctx2 = (window.Lampa?.Activity?.active && Lampa.Activity.active()) || {};
    const ctx = Object.keys(ctx1).length?ctx1:ctx2;

    const imdb = imdbFromRating() || normImdb(ctx.imdb_id || ctx.imdb);
    const seriesTitle = safe(ctx.title || ctx.name || '');
    const epTitle = safe(ctx.card?.episode_name || ctx.original_title || ctx.original_name || seriesTitle || document.title);

    let season = Number.isFinite(+ctx.season)?+ctx.season:0;
    let episode= Number.isFinite(+ctx.episode)?+ctx.episode:0;
    if (!season || !episode){
      const g = parseSEFromTitle(epTitle) || parseSEFromTitle(document.title);
      if (g.season && g.episode){ season=g.season; episode=g.episode; }
    }
    const year = ctx.year ? +ctx.year : (ctx.release_year ? +ctx.release_year : '');
    const type = season&&episode ? 'series' : 'movie';
    return { imdb, seriesTitle, epTitle, year, season, episode, type };
  }

  async function resolveSEByEpisodeName(imdb, seriesTitle, epTitle){
    const tries = [];
    if (imdb) tries.push({p:'subtitles.json', q:{type:'series', id:imdb}});
    if (seriesTitle) tries.push({p:'subtitles.json', q:{type:'series', query:seriesTitle}});
    const norm = (s)=>safe(s).toLowerCase().replace(/\s+/g,' ').trim();
    const target = norm(epTitle);
    for (const t of tries){
      try{
        const data = await GET(t.p,t.q);
        const arr = Array.isArray(data)?data:(Array.isArray(data.subtitles)?data.subtitles:[]);
        for (const it of arr){
          const name = norm(it.name || it.title || '');
          const sn = +it.season || 0, ep = +it.episode || 0;
          if (sn && ep && name && (name.includes(target) || target.includes(name))){
            return { season:sn, episode:ep };
          }
        }
      }catch{}
    }
    return { season:0, episode:0 };
  }

  async function fetchSubs(type, imdb, season, episode, title, year){
    const tries=[];
    if (imdb){
      tries.push({p:`subtitles/${type}/${encodeURIComponent(imdb)}.json`, q:{season:season||'', episode:episode||''}});
      if (type==='series' && season && episode)
        tries.push({p:`subtitles/${type}/${encodeURIComponent(`${imdb}:${season}:${episode}`)}.json`, q:{}});
      tries.push({p:'subtitles.json', q:{type, id:imdb, season:season||'', episode:episode||''}});
    }
    if (title){
      const q1 = year ? `${title} ${year}` : title;
      tries.push({p:'subtitles.json', q:{type, query:q1, season:season||'', episode:episode||''}});
    }
    let subs=[];
    for (const t of tries){
      try{ const data=await GET(t.p,t.q); const ru=pickRu(data); if(ru.length){ subs=ru; break; } }catch{}
    }
    return subs;
  }

  // -------- APPLY (track + styles)
  function ensureStyle(){
    let st=document.getElementById('subs-stable-style');
    if(!st){ st=document.createElement('style'); st.id='subs-stable-style'; document.head.appendChild(st); }
    st.textContent=`video::cue { font-size:${cfg.fontSize}px; }`;
  }
  function setCueBottomForTrack(tt, video){
    const vh = video.getBoundingClientRect().height || 720;
    const percent = Math.max(0, Math.min(100, 100 - (cfg.bottom / vh) * 100));
    const cues = tt.cues || [];
    for (let i=0;i<cues.length;i++){
      const c = cues[i];
      try{ c.snapToLines=false; c.line=percent; c.align='center'; c.position=50; c.size=100; }catch{}
    }
  }
  function applyBottom(video){
    if(!video?.textTracks) return;
    for(const tt of video.textTracks) setCueBottomForTrack(tt, video);
  }
  function applyDelay(video){
    if(!video?.textTracks) return;
    const delta = cfg.delay||0; if (!delta) return;
    for(const tt of video.textTracks){
      const cues=tt.cues||[];
      for(let i=0;i<cues.length;i++){
        const c=cues[i];
        try{ c.startTime=Math.max(0,c.startTime+delta); c.endTime=Math.max(c.startTime+0.2,c.endTime+delta); }
        catch{ try{ const nc=new VTTCue(Math.max(0,c.startTime+delta), Math.max(0.2,c.endTime+delta), c.text); nc.snapToLines=false; nc.line=c.line; nc.align=c.align; nc.position=c.position; nc.size=c.size; tt.removeCue(c); tt.addCue(nc);}catch{} }
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
    lastTrackUrl = vttUrl || '';
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
    if (videoObs) { videoObs.disconnect(); videoObs=null; }
    videoObs=new MutationObserver(()=>{ applyToVideo(lastTrackUrl); });
    videoObs.observe(v,{attributes:true,childList:true,subtree:true});
  }
  function liveReapply(){
    const v=document.querySelector('video'); if(!v) return;
    ensureStyle(); if(v.textTracks){ for(const tt of v.textTracks){ tt.mode=(tt.language===LANG||/ru|рус/i.test(tt.label))?'showing':'disabled'; } }
    applyBottom(v);
    if (lastTrackUrl && Math.abs(cfg.delay)>1e-6){ const keep=lastTrackUrl; lastTrackUrl=''; applyToVideo(keep); }
  }

  // -------- UI
  function openModal(html){
    if(modalOpen) closeModal();
    modalOpen=true;
    const w=document.createElement('div');
    w.id='subs-stable-modal';
    w.style.cssText='position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;font-family:sans-serif;';
    const b=document.createElement('div');
    b.style.cssText='width:min(880px,96vw);max-height:90vh;background:#1f1f1f;color:#fff;border-radius:12px;overflow:hidden;display:flex;flex-direction:column;';
    const h=document.createElement('div');
    h.style.cssText='padding:12px 16px;background:#2a2a2a;font-weight:600;display:flex;justify-content:space-between;align-items:center;';
    h.innerHTML=`<span>${LABEL}</span><button id="x" style="background:#444;color:#fff;border:0;border-radius:8px;padding:6px 10px;cursor:pointer;">Закрыть</button>`;
    const body=document.createElement('div'); body.style.cssText='padding:12px 16px;overflow:auto;'; body.innerHTML=html;
    b.appendChild(h); b.appendChild(body); w.appendChild(b); document.body.appendChild(w);
    h.querySelector('#x').onclick=closeModal; w.addEventListener('click',e=>{ if(e.target===w) closeModal(); });
    if(!escBound){ escBound=true; window.addEventListener('keydown',(e)=>{ if(e.key==='Escape'&&modalOpen){ e.preventDefault(); e.stopPropagation(); closeModal(); }},true); }
    return {body};
  }
  function closeModal(){ const w=document.getElementById('subs-stable-modal'); if(w) w.remove(); modalOpen=false; }
  function renderList(c,items,onPick){
    const ul=document.createElement('div');
    items.forEach(it=>{
      const btn=document.createElement('button');
      btn.textContent=it.label;
      btn.style.cssText='width:100%;text-align:left;background:transparent;color:#fff;border:0;border-bottom:1px solid #333;padding:10px 8px;cursor:pointer;';
      btn.onmouseenter=()=>btn.style.background='#333'; btn.onmouseleave=()=>btn.style.background='transparent';
      btn.onclick=()=>onPick(it); ul.appendChild(btn);
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

  // -------- Panels
  async function openMoviePanel(meta){
    const subs = await fetchSubs('movie', meta.imdb, 0, 0, meta.seriesTitle, meta.year);
    if (!subs.length){ openModal('<div>Субтитры не найдены</div>'); return; }
    const {body}=openModal(`
      <div style="display:grid;gap:12px;">
        <fieldset style="border:1px solid #333;border-radius:10px;padding:10px;">
          <legend style="padding:0 6px;color:#bbb;">Доступные субтитры</legend>
          <div id="subsList"></div>
        </fieldset>
        ${settingsBlock()}
      </div>
    `);
    const items = [{label:'Без субтитров', url:'', name:'(off)'}].concat(subs.map(s=>({label:s.name,url:s.url,name:s.name})));
    renderList(body.querySelector('#subsList'), items, async (it)=>{
      try{
        cfg.selectedName=it.name||''; saveCfg();
        if (it.url){ const vtt=await toVttUrl(it.url); applyToVideo(vtt); }
        else { lastTrackUrl=''; removeAllSubTracks(); }
      }catch{}
    });
    bindSliders(body);
  }

  async function openSeriesPanel(meta){
    // если нет S/E — пытаемся по названию эпизода определить
    let season=meta.season||0, episode=meta.episode||0;
    if (!season || !episode){
      const byName = await resolveSEByEpisodeName(meta.imdb, meta.seriesTitle, meta.epTitle);
      if (byName.season && byName.episode){ season=byName.season; episode=byName.episode; }
    }
    if (!season) season=1; if (!episode) episode=1;

    const {body}=openModal(`
      <div style="display:grid;gap:12px;">
        <fieldset style="border:1px solid #333;border-radius:10px;padding:10px;">
          <legend style="padding:0 6px;color:#bbb;">Серия (по названию: ${safe(meta.epTitle)||'—'})</legend>
          <div id="sePick" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:8px;">
            <label>Сезон:
              <select id="selSeason" style="margin-left:6px;padding:6px 10px;background:#111;color:#fff;border:1px solid #444;border-radius:8px;">
                ${Array.from({length:30},(_,i)=>i+1).map(v=>`<option value="${v}" ${v===season?'selected':''}>${v}</option>`).join('')}
              </select>
            </label>
            <label>Серия:
              <select id="selEpisode" style="margin-left:6px;padding:6px 10px;background:#111;color:#fff;border:1px solid #444;border-radius:8px;">
                ${Array.from({length:60},(_,i)=>i+1).map(v=>`<option value="${v}" ${v===episode?'selected':''}>${v}</option>`).join('')}
              </select>
            </label>
            <span id="seInfo" style="color:#bbb;">S${String(season).padStart(2,'0')}E${String(episode).padStart(2,'0')}</span>
          </div>
          <div id="subsList"></div>
        </fieldset>
        ${settingsBlock()}
      </div>
    `);

    async function loadSeriesSubs(){
      const s = +body.querySelector('#selSeason').value;
      const e = +body.querySelector('#selEpisode').value;
      body.querySelector('#seInfo').textContent = `S${String(s).padStart(2,'0')}E${String(e).padStart(2,'0')}`;
      const subs = await fetchSubs('series', meta.imdb, s, e, meta.seriesTitle, meta.year);
      const items = [{label:'Без субтитров', url:'', name:'(off)'}].concat(subs.map(x=>({label:x.name,url:x.url,name:x.name})));
      renderList(body.querySelector('#subsList'), items, async (it)=>{
        try{
          cfg.selectedName = it.name || ''; saveCfg();
          if (it.url){ const vtt=await toVttUrl(it.url); applyToVideo(vtt); }
          else { lastTrackUrl=''; removeAllSubTracks(); }
        }catch{}
      });
    }

    body.querySelector('#selSeason').addEventListener('change', loadSeriesSubs);
    body.querySelector('#selEpisode').addEventListener('change', loadSeriesSubs);
    bindSliders(body);
    await loadSeriesSubs();
  }

  // -------- Open Auto (exported)
  async function openAuto(){
    try{
      const meta = getContext();
      if (meta.type==='series' && meta.imdb) await openSeriesPanel(meta);
      else await openMoviePanel(meta);
    }catch{ openModal('<div>Ошибка поиска субтитров</div>'); }
  }
  window.subsStableOpenAuto = openAuto;

  // -------- Button in player (globe)
  function injectButtonIntoPlayer() {
    const candidates = [
      '.player-panel__right',
      '.player-panel-controls-right',
      '.player-panel__controls',
      '.player-controls__right',
      '.player-panel',
      '.video-player__controls'
    ];
    let host=null;
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el) { host=el; break; }
    }
    if (!host) {
      const defCC = document.querySelector('button[aria-label="Subtitles"], button[title="Subtitles"], .icon--subtitles, .player__subtitles');
      host = defCC ? defCC.parentElement : null;
    }
    if (!host) return false;
    if (host.querySelector('#subs-stable-btn-globe')) return true;

    const btn = document.createElement('button');
    btn.id = 'subs-stable-btn-globe';
    btn.type = 'button';
    btn.title = 'subs-stable';
    btn.style.cssText = [
      'display:inline-flex','align-items:center','justify-content:center',
      'width:40px','height:40px','margin-left:8px',
      'background:transparent','border:0','cursor:pointer','outline:none',
      'color:#fff','opacity:.9'
    ].join(';');
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
        <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm7.938 9h-3.09c-.128-2.167-.764-4.15-1.77-5.67A8.01 8.01 0 0 1 19.938 11zM12 4c.86 0 2.349 1.73 2.89 5H9.11C9.651 5.73 11.14 4 12 4zM8.922 5.33C7.917 6.85 7.28 8.833 7.152 11h-3.09a8.01 8.01 0 0 1 4.86-5.67zM4.062 13h3.09c.128 2.167.765 4.15 1.77 5.67A8.01 8.01 0 0 1 4.062 13zM12 20c-.86 0-2.349-1.73-2.89-5h5.78C14.349 18.27 12.86 20 12 20zm3.078-1.33c1.005-1.52 1.642-3.503 1.77-5.67h3.09a8.01 8.01 0 0 1-4.86 5.67z"/>
      </svg>
    `;
    btn.onmouseenter = ()=> btn.style.opacity='1';
    btn.onmouseleave = ()=> btn.style.opacity='.9';
    btn.onclick = ()=> { try { openAuto(); } catch {} };

    let inserted=false;
    const near = host.querySelector('button[aria-label="Subtitles"], button[title="Subtitles"], .icon--subtitles, .player__subtitles');
    if (near && near.parentElement === host) { near.insertAdjacentElement('afterend', btn); inserted=true; }
    if (!inserted) host.appendChild(btn);
    return true;
  }
  const obs = new MutationObserver(()=>{ injectButtonIntoPlayer(); });
  obs.observe(document.documentElement, { childList:true, subtree:true });
  document.addEventListener('DOMContentLoaded', injectButtonIntoPlayer, { once:true });
  setTimeout(injectButtonIntoPlayer, 500);
  setTimeout(injectButtonIntoPlayer, 1500);

  // -------- Init
  function init(){ ensureStyle(); }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true}); else init();
})();
