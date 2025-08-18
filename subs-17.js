/* subs-stable (stable rollback + auto-hide button)
   - Базовая стабильная версия, где меню открывалось
   - Добавлен авто-скрытие кнопки через 5s без движения мыши
*/
(function () {
  const FLAG='__SUBS_STABLE_ROLLBACK_AUTOHIDE__';
  if (window[FLAG]) return; window[FLAG]=true;

  const OSV3_BASE='https://opensubtitles-v3.strem.io/';
  const LANG='ru';
  const LABEL='subs-stable';

  const STORE_KEY='subs_stable_cfg';
  const cfg = Object.assign({ fontSize:18, bottom:48, delay:0, selectedName:'' }, JSON.parse(localStorage.getItem(STORE_KEY)||'{}'));
  const saveCfg=()=>localStorage.setItem(STORE_KEY, JSON.stringify(cfg));

  const safe=v=>(v==null?'':String(v));
  let modalOpen=false, lastTrackUrl='', videoObs=null, escBound=false;

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
    let m = s.match(/S(\d{1,2})E(\d{1,2})/i); if (m) return {season:+m[1], episode:+m[2]};
    m = s.match(/(\d{1,2})x(\d{1,2})/);        if (m) return {season:+m[1], episode:+m[2]};
    m = s.match(/Season\s+(\d{1,2})\D+Episode\s+(\d{1,2})/i) || s.match(/Сезон\s+(\d{1,2})\D+Серия\s+(\d{1,2})/i);
    if (m) return {season:+m[1], episode:+m[2]};
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
        catch{ try{ const nc=new VTTCue(Math.max(0,c.startTime+delta), Math.max(0.2,c.endTime+delta), c.text);
          nc.snapToLines=false; nc.line=c.line; nc.align=c.align; nc.position=c.position; nc.size=c.size; tt.removeCue(c); tt.addCue(nc);}catch{} }
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
    let season=meta.season||1, episode=meta.episode||1;
    const {body}=openModal(`
      <div style="display:grid;gap:12px;">
        <fieldset style="border:1px solid #333;border-radius:10px;padding:10px;">
          <legend style="padding:0 6px;color:#bbb;">Серия</legend>
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

  async function openAuto(){
    try{
      const meta = getContext();
      if (meta.type==='series' && meta.imdb) await openSeriesPanel(meta);
      else await openMoviePanel(meta);
    }catch{ openModal('<div>Ошибка поиска субтитров</div>'); }
  }
  window.subsStableOpenAuto = openAuto;

  // Floating CC button (player-only + auto-hide 5s)
  (function(){
    const BTN_ID='subs-stable-btn';
    let btn=null, hideTimer=null, listeners=false;

    function createBtn(){
      if (btn) return btn;
      btn=document.createElement('button');
      btn.id=BTN_ID; btn.textContent='CC'; btn.title=LABEL;
      btn.style.cssText='position:fixed;right:16px;bottom:88px;z-index:2147483647;background:#111;color:#fff;border:1px solid #444;border-radius:50%;width:44px;height:44px;font-weight:700;cursor:pointer;opacity:0;pointer-events:none;transition:opacity .25s ease;box-shadow:0 2px 8px rgba(0,0,0,.35);';
      btn.onmouseenter=()=>{ btn.style.opacity='1'; };
      btn.onclick=(e)=>{ e.preventDefault(); e.stopPropagation(); try{ window.subsStableOpenAuto&&window.subsStableOpenAuto(); }catch{} };
      document.body.appendChild(btn);
      return btn;
    }
    function isPlayerActive(){
      const v=document.querySelector('video'); if(!v) return false;
      const r=v.getBoundingClientRect(), cs=getComputedStyle(v);
      return r.width>0 && r.height>0 && cs.display!=='none' && cs.visibility!=='hidden';
    }
    function showBtn(){ if(!btn) createBtn(); btn.style.opacity='1'; btn.style.pointerEvents='auto'; resetTimer(); }
    function hideBtn(){ if(!btn) return; btn.style.opacity='0'; btn.style.pointerEvents='none'; }
    function resetTimer(){ clearTimeout(hideTimer); hideTimer=setTimeout(()=>hideBtn(), 5000); }
    function onActivity(){ if(isPlayerActive()) showBtn(); else hideBtn(); }
    function attach(){
      if (listeners) return; listeners=true;
      ['mousemove','pointermove','touchstart','click'].forEach(ev=>document.addEventListener(ev,onActivity,true));
      ['fullscreenchange','webkitfullscreenchange','mozfullscreenchange','MSFullscreenChange','visibilitychange'].forEach(ev=>document.addEventListener(ev,onActivity,true));
      const mo=new MutationObserver(onActivity); mo.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['style','class']});
    }
    function initBtn(){ createBtn(); attach(); if(isPlayerActive()) showBtn(); else hideBtn(); }
    if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',initBtn,{once:true}); else initBtn();
  })();

  function init(){ ensureStyle(); }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true}); else init();
})();
