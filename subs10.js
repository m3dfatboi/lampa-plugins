(function () {
  const FLAG='__SUBS_RU_OSV3_FIX__';
  if (window[FLAG]) return; window[FLAG]=true;

  const OSV3_BASE='https://opensubtitles-v3.strem.io/';
  const LANG='ru';
  const LABEL='Субтитры (OpenSubtitles v3 · RU)';

  const safe=v=>(v==null?'':String(v));

  // ---- state ----
  let modalOpen=false;
  let lastTrackUrl='';

  // ---- net helpers ----
  async function GET(path, q){
    const base=OSV3_BASE.endsWith('/')?OSV3_BASE:OSV3_BASE+'/';
    const url=new URL(path.replace(/^\//,''), base);
    if (q) for (const k in q){ const v=q[k]; if(v!==''&&v!=null) url.searchParams.set(k,String(v)); }
    const r=await fetch(url.toString());
    if(!r.ok) throw new Error('HTTP '+r.status);
    return r.json();
  }

  // ---- subtitles utils ----
  function pickRu(list){
    const arr=Array.isArray(list)?list:(Array.isArray(list?.subtitles)?list.subtitles:[]);
    const out=[];
    for(const s of arr){
      const l=safe(s.lang||s.language||s.iso||s.id).toLowerCase();
      const name=safe(s.name||s.title||s.fileName||s.provider||'OpenSubtitles');
      const url=s.url||s.stream||s.href;
      if(!url) continue;
      const isRu=l==='ru'||l==='rus'||l==='russian'||/(^|[^a-z])(ru|rus)([^a-z]|$)/i.test(name);
      if(isRu) out.push({ name, url });
    }
    const seen=new Set();
    return out.filter(x=> (seen.has(x.url)?false:(seen.add(x.url),true)));
  }

  function srtToVtt(srt){
    const t=safe(srt).replace(/\r+/g,'').trim();
    return 'WEBVTT\n\n'+t
      .replace(/^\d+\n/gm,'')
      .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})\s-->\s(\d{2}:\d{2}:\d{2}),(\d{3})/g,'$1.$2 --> $3.$4')
      .replace(/\n{3,}/g,'\n\n');
  }

  async function toVttUrl(url){
    if (/\.vtt(\?|$)/i.test(url)) return url;
    const r=await fetch(url);
    if(!r.ok) throw new Error('download');
    const buf=await r.arrayBuffer();
    let txt='';
    try{ txt=new TextDecoder('utf-8').decode(buf);}catch{ txt=new TextDecoder('windows-1251').decode(new Uint8Array(buf));}
    const vtt = txt.trim().startsWith('WEBVTT')?txt:srtToVtt(txt);
    return URL.createObjectURL(new Blob([vtt],{type:'text/vtt'}));
  }

  // ---- robust apply to Lampa player ----
  function applyToLampa(vttUrl){
    lastTrackUrl=vttUrl;

    const player = window.Lampa?.Player || window.Lampa?.PlayerVideo || window.Lampa?.PlayerLite || {};
    const subs   = player.subtitles;

    // 1) Новый API
    if (subs && typeof subs.add==='function'){
      try{
        subs.clear && subs.clear();
        subs.add({ label:'Русские', language:LANG, url:vttUrl });
        subs.enable && subs.enable(LANG);
        window.Lampa?.Noty?.show && Lampa.Noty.show('Субтитры подключены: RU');
        return;
      }catch(e){}
    }

    // 2) Событийный API
    if (window.Lampa?.Player?.listener?.send){
      try{
        Lampa.Player.listener.send('subtitle', { label:'Русские', language:LANG, url:vttUrl });
        window.Lampa?.Noty?.show && Lampa.Noty.show('Субтитры подключены: RU');
        return;
      }catch(e){}
    }

    // 3) Глобальное событие
    if (window.Lampa?.Event?.emit){
      try{
        Lampa.Event.emit('player_subtitle', { url:vttUrl, label:'Русские', lang:LANG });
        window.Lampa?.Noty?.show && Lampa.Noty.show('Субтитры подключены: RU');
      }catch(e){}
    }

    // 4) HTML5 fallback (на случай встроенного video)
    try{
      const video = document.querySelector('video');
      if (video){
        // убрать старые
        Array.from(video.querySelectorAll('track[kind="subtitles"]')).forEach(t=>t.remove());
        const track=document.createElement('track');
        track.kind='subtitles'; track.label='Русские'; track.srclang='ru'; track.src=vttUrl; track.default=true;
        video.appendChild(track);
        video.textTracks && Array.from(video.textTracks).forEach(tt=>{ tt.mode = tt.language==='ru' ? 'showing' : 'hidden'; });
        toast('Субтитры подключены: RU (HTML5)');
      }
    }catch(e){}
  }

  function toast(msg){ window.Lampa?.Noty?.show && Lampa.Noty.show(msg); }

  // При смене потока повторно включаем субтитры
  function hookReapply(){
    if (!window.Lampa?.Listener?.follow) return;
    window.Lampa.Listener.follow('player', function(e){
      if (e?.type==='ready' && lastTrackUrl){
        setTimeout(()=>applyToLampa(lastTrackUrl), 500);
      }
    });
  }

  // ---- UI (single modal) ----
  function stopKeysInside(el){
    // Блокируем всплытие клавиш, чтобы печаталось в input
    el.addEventListener('keydown', e=>{
      e.stopPropagation();
    });
    el.addEventListener('keyup', e=>e.stopPropagation());
    el.addEventListener('keypress', e=>e.stopPropagation());
  }

  function openModal(html){
    if (modalOpen){ closeModal(); }
    modalOpen=true;

    const wrap=document.createElement('div');
    wrap.id='subsru-modal';
    wrap.style.cssText='position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;font-family:sans-serif;';
    const box=document.createElement('div');
    box.style.cssText='width:min(720px,94vw);max-height:86vh;background:#1f1f1f;color:#fff;border-radius:12px;overflow:hidden;display:flex;flex-direction:column;';
    const head=document.createElement('div');
    head.style.cssText='padding:12px 16px;background:#2a2a2a;font-weight:600;display:flex;justify-content:space-between;align-items:center;';
    head.innerHTML=`<span>${LABEL}</span>
      <div style="display:flex;gap:8px;">
        <button id="subsru-close" style="background:#444;color:#fff;border:0;border-radius:8px;padding:6px 10px;cursor:pointer;">Закрыть</button>
      </div>`;
    const body=document.createElement('div'); body.style.cssText='padding:12px 16px;overflow:auto;';

    body.innerHTML=html;
    stopKeysInside(body);

    box.appendChild(head); box.appendChild(body); wrap.appendChild(box); document.body.appendChild(wrap);

    head.querySelector('#subsru-close').onclick = closeModal;
    wrap.addEventListener('click', e=>{ if (e.target===wrap) closeModal(); });

    return { wrap, body };
  }

  function closeModal(){
    const w=document.getElementById('subsru-modal');
    if (w) w.remove();
    modalOpen=false;
  }

  function ensureButton(){
    if (document.getElementById('subsru-btn')) return;
    const b=document.createElement('button');
    b.id='subsru-btn'; b.textContent='CC'; b.title=LABEL;
    b.style.cssText='position:fixed;right:16px;bottom:88px;z-index:2147483647;background:#111;color:#fff;border:1px solid #444;border-radius:50%;width:44px;height:44px;font-weight:700;cursor:pointer;opacity:.9;';
    b.onmouseenter=()=>b.style.opacity='1'; b.onmouseleave=()=>b.style.opacity='.9';
    b.onclick=toggleWizard;
    document.body.appendChild(b);
  }

  // ---- wizard ----
  function stepInput(defaults, onNext){
    const { body } = openModal(`
      <div style="display:grid;gap:10px;grid-template-columns:1fr 1fr;">
        <label style="grid-column:1/-1;">Название или IMDb ID (tt1234567)
          <input id="q" type="text" placeholder="например: Dune 2024 или tt1160419" style="width:100%;margin-top:6px;padding:8px;border-radius:8px;border:1px solid #444;background:#111;color:#fff;">
        </label>
        <label>Тип
          <select id="type" style="width:100%;margin-top:6px;padding:8px;border-radius:8px;border:1px solid #444;background:#111;color:#fff;">
            <option value="movie">Фильм</option>
            <option value="series">Сериал</option>
          </select>
        </label>
        <label>Год
          <input id="year" type="number" min="1900" max="2100" style="width:100%;margin-top:6px;padding:8px;border-radius:8px;border:1px solid #444;background:#111;color:#fff;">
        </label>
        <label>Сезон (для сериала)
          <input id="season" type="number" min="1" style="width:100%;margin-top:6px;padding:8px;border-radius:8px;border:1px solid #444;background:#111;color:#fff;">
        </label>
        <label>Эпизод (для сериала)
          <input id="episode" type="number" min="1" style="width:100%;margin-top:6px;padding:8px;border-radius:8px;border:1px solid #444;background:#111;color:#fff;">
        </label>
        <div style="grid-column:1/-1;display:flex;gap:8px;justify-content:flex-end;margin-top:6px;">
          <button id="next" style="background:#0a84ff;border:0;color:#fff;border-radius:8px;padding:10px 14px;cursor:pointer;">Далее</button>
        </div>
      </div>
    `);
    body.querySelector('#q').value=defaults.query||'';
    body.querySelector('#type').value=defaults.type||'movie';
    body.querySelector('#year').value=defaults.year||'';
    body.querySelector('#season').value=defaults.season||'';
    body.querySelector('#episode').value=defaults.episode||'';

    body.querySelector('#next').onclick=()=>{
      const data={
        query: safe(body.querySelector('#q').value).trim(),
        type: body.querySelector('#type').value,
        year: body.querySelector('#year').value,
        season: Number(body.querySelector('#season').value)||'',
        episode: Number(body.querySelector('#episode').value)||'',
      };
      closeModal();
      stepPickTitle(data, pick=> stepPickSubs(pick, applyTrack));
    };
  }

  async function stepPickTitle(data, onNext){
    const tt = /^tt\d+$/i.test(data.query) ? data.query : '';
    let items=[];
    if (tt){
      items=[{label:`IMDb ${tt}${data.type==='series'&&data.season&&data.episode?` S${data.season}E${data.episode}`:''}`, id:tt, type:data.type, season:data.season||'', episode:data.episode||''}];
    } else {
      try{
        const cat=await GET('catalog.json',{ type:data.type, search:data.query || (data.year?`${data.query} ${data.year}`:'') });
        const arr=Array.isArray(cat)?cat:Array.isArray(cat.metas)?cat.metas:[];
        items = arr.slice(0,50).map(x=>{
          const name=[x.name||x.title, x.year||''].filter(Boolean).join(' ');
          const id=x.id||x.imdb_id||x.imdb||'';
          return { label:`${name} ${id?`(${id})`:''}`, id, type:data.type, season:data.season||'', episode:data.episode||'' };
        }).filter(x=>x.id);
      }catch(_){}
      if (!items.length){
        items=[{label:`${data.query} ${data.year||''}`.trim(), id:'', q:data.query, type:data.type, season:data.season||'', episode:data.episode||''}];
      }
    }

    const { body } = openModal('<div id="list"></div>');
    renderList(body.querySelector('#list'), items, pick=>{ closeModal(); onNext(pick); });
  }

  function renderList(container, items, onPick){
    const ul=document.createElement('div');
    items.forEach(it=>{
      const b=document.createElement('button');
      b.textContent=it.label;
      b.style.cssText='width:100%;text-align:left;background:transparent;color:#fff;border:0;border-bottom:1px solid #333;padding:10px 8px;cursor:pointer;';
      b.onmouseenter=()=>b.style.background='#333'; b.onmouseleave=()=>b.style.background='transparent';
      b.onclick=()=>onPick(it);
      ul.appendChild(b);
    });
    container.innerHTML=''; container.appendChild(ul);
    stopKeysInside(container);
  }

  async function stepPickSubs(pick, onApply){
    const tries=[];
    if (pick.id){
      tries.push({p:`subtitles/${pick.type}/${encodeURIComponent(pick.id)}.json`, q:{season:pick.season||'',episode:pick.episode||''}});
      if (pick.type==='series' && pick.season && pick.episode)
        tries.push({p:`subtitles/${pick.type}/${encodeURIComponent(`${pick.id}:${pick.season}:${pick.episode}`)}.json`, q:{}});
      tries.push({p:'subtitles.json', q:{type:pick.type, id:pick.id, season:pick.season||'', episode:pick.episode||''}});
    } else if (pick.q){
      tries.push({p:'subtitles.json', q:{type:pick.type, query:pick.q, season:pick.season||'', episode:pick.episode||''}});
    }

    let subs=[];
    for (const t of tries){
      try{
        const data=await GET(t.p,t.q);
        const ru=pickRu(data);
        if (ru.length){ subs=ru; break; }
      }catch(_){}
    }

    if (!subs.length){ openModal('<div>Субтитры не найдены</div>'); return; }

    const { body } = openModal('<div id="list"></div>');
    renderList(body.querySelector('#list'), subs.map(s=>({label:s.name, url:s.url})), s=>{ closeModal(); onApply(s.url); });
  }

  async function applyTrack(url){
    try{
      const vtt = await toVttUrl(url);
      applyToLampa(vtt);
    }catch{
      toast('Ошибка загрузки субтитров');
    }
  }

  function toggleWizard(){
    if (modalOpen){ closeModal(); return; }
    stepInput({type:'movie'}, ()=>{});
  }

  function init(){
    // Кнопка в плеере если доступна
    if (window.Lampa?.Player?.addInteractive){
      try{ Lampa.Player.removeInteractive && Lampa.Player.removeInteractive('subs-ru-osv3-fix'); }catch{}
      Lampa.Player.addInteractive({ id:'subs-ru-osv3-fix', title:LABEL, subtitle:'ru', icon:'cc', onClick: toggleWizard });
    } else {
      ensureButton();
    }
    // Горячая клавиша S: переключает окно, а не открывает новые
    window.addEventListener('keydown', e=>{
      if (e.key && e.key.toLowerCase()==='s' && !e.repeat){
        e.preventDefault(); e.stopPropagation();
        toggleWizard();
      }
    }, true);

    hookReapply();
  }

  if (window.Lampa) init(); else document.addEventListener('lampa-ready', init, {once:true});
})();
