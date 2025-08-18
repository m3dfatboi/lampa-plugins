(function () {
  const FLAG='__SUBS_RU_OSV3__';
  if (window[FLAG]) return; window[FLAG]=true;

  // ВСТАВЬ URL БАЗЫ АДДОНА OpenSubtitles v3 (Stremio):
  // пример: 'https://opensubtitles-v3.onrender.com/'
  const OSV3_BASE='https://opensubtitles-v3.strem.io/';

  const LANG='ru';
  const LABEL='Субтитры (OpenSubtitles v3 · RU)';

  const safe=v=>(v==null?'':String(v));

  async function GET(path, q){
    const base=OSV3_BASE.endsWith('/')?OSV3_BASE:OSV3_BASE+'/';
    const url=new URL(path.replace(/^\//,''), base);
    if (q) for (const k in q) { const v=q[k]; if (v!=='' && v!=null) url.searchParams.set(k, String(v)); }
    const r=await fetch(url.toString());
    if (!r.ok) throw new Error('HTTP '+r.status);
    return r.json();
  }

  // Общий парсер subtitiles ответа Stremio-аддонов
  function pickRu(list){
    const arr=Array.isArray(list)?list:(Array.isArray(list?.subtitles)?list.subtitles:[]);
    const out=[];
    for (const s of arr){
      const l=safe(s.lang||s.language||s.iso||s.id).toLowerCase();
      const name=safe(s.name||s.title||s.fileName||s.provider||'OpenSubtitles');
      const url=s.url||s.stream||s.href;
      if (!url) continue;
      const isRu = l==='ru'||l==='rus'||l==='russian'||/(^|[^a-z])(ru|rus)([^a-z]|$)/i.test(name);
      if (isRu) out.push({ name, url });
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

  // Мини-UI
  function modal(html,onClose){
    const wrap=document.createElement('div');
    wrap.style.cssText='position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;font-family:sans-serif;';
    const box=document.createElement('div');
    box.style.cssText='width:min(720px,94vw);max-height:86vh;background:#1f1f1f;color:#fff;border-radius:12px;overflow:hidden;display:flex;flex-direction:column;';
    const head=document.createElement('div');
    head.style.cssText='padding:12px 16px;background:#2a2a2a;font-weight:600;display:flex;justify-content:space-between;align-items:center;';
    head.innerHTML=`<span>${LABEL}</span><button id="x" style="background:#444;color:#fff;border:0;border-radius:8px;padding:6px 10px;cursor:pointer;">Закрыть</button>`;
    const body=document.createElement('div'); body.style.cssText='padding:12px 16px;overflow:auto;';
    body.innerHTML=html;
    box.appendChild(head); box.appendChild(body); wrap.appendChild(box); document.body.appendChild(wrap);
    function close(){ wrap.remove(); onClose&&onClose(); }
    head.querySelector('#x').onclick=close; wrap.addEventListener('click',e=>{ if(e.target===wrap) close(); });
    return {wrap,body,close};
  }
  function list(container, items, onPick){
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
  }

  // Шаг 1: ручной ввод
  function stepInput(defaults, onNext){
    const html=`<div style="display:grid;gap:10px;grid-template-columns:1fr 1fr;">
      <label style="grid-column:1/-1;">Название или IMDb ID (tt1234567)
        <input id="q" type="text" placeholder="например: The Boys 2019 или tt1190634" style="width:100%;margin-top:6px;padding:8px;border-radius:8px;border:1px solid #444;background:#111;color:#fff;">
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
    </div>`;
    const m=modal(html);
    m.body.querySelector('#q').value=defaults.query||'';
    m.body.querySelector('#type').value=defaults.type||'movie';
    m.body.querySelector('#year').value=defaults.year||'';
    m.body.querySelector('#season').value=defaults.season||'';
    m.body.querySelector('#episode').value=defaults.episode||'';
    m.body.querySelector('#next').onclick=()=>{
      const data={
        query: safe(m.body.querySelector('#q').value).trim(),
        type: m.body.querySelector('#type').value,
        year: m.body.querySelector('#year').value,
        season: Number(m.body.querySelector('#season').value)||'',
        episode: Number(m.body.querySelector('#episode').value)||'',
      };
      m.close(); onNext(data);
    };
  }

  // Шаг 2: выбор тайтла (используем каталог аддона, если доступен)
  async function stepPickTitle(data, onNext){
    const tt = /^tt\d+$/i.test(data.query) ? data.query : '';
    let items=[];
    if (tt){
      items=[{label:`IMDb ${tt}${data.type==='series'&&data.season&&data.episode?` S${data.season}E${data.episode}`:''}`, id:tt, type:data.type, season:data.season||'', episode:data.episode||''}];
    } else {
      try{
        const cat=await GET('catalog.json',{ type:data.type, search:data.query|| (data.year?`${data.query} ${data.year}`:'') });
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
    const m=modal('<div id="list"></div>');
    list(m.body.querySelector('#list'), items, (pick)=>{ m.close(); onNext(pick); });
  }

  // Шаг 3: запрос субтитров у OSv3 и выбор RU
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
    if (!subs.length){ modal('<div>Субтитры не найдены</div>'); return; }

    const m=modal('<div id="list"></div>');
    list(m.body.querySelector('#list'), subs.map(s=>({label:s.name, url:s.url})), (s)=>{ m.close(); onApply(s.url); });
  }

  async function applyTrack(url){
    let track=url;
    if (!/\.vtt(\?|$)/i.test(url)){
      const r=await fetch(url); if (!r.ok) throw new Error('download');
      const buf=await r.arrayBuffer();
      let txt=''; try{ txt=new TextDecoder('utf-8').decode(buf);}catch{ txt=new TextDecoder('windows-1251').decode(new Uint8Array(buf));}
      const vtt = txt.trim().startsWith('WEBVTT')?txt:srtToVtt(txt);
      track = URL.createObjectURL(new Blob([vtt],{type:'text/vtt'}));
    }
    const player = window.Lampa?.Player || window.Lampa?.PlayerVideo || window.Lampa?.PlayerLite || {};
    if (player.subtitles?.add){
      player.subtitles.clear&&player.subtitles.clear();
      player.subtitles.add({label:'Русские', language:LANG, url:track});
      player.subtitles.enable&&player.subtitles.enable(LANG);
    } else if (window.Lampa?.Player?.listener?.send){
      window.Lampa.Player.listener.send('subtitle', {label:'Русские', language:LANG, url:track});
    } else if (window.Lampa?.Event?.emit){
      window.Lampa.Event.emit('player_subtitle', {url:track, label:'Русские', lang:LANG});
    }
    window.Lampa?.Noty?.show && Lampa.Noty.show('Субтитры подключены: RU');
  }

  // Входной сценарий
  function openWizard(){
    stepInput({type:'movie'}, (input)=> stepPickTitle(input, (pick)=> stepPickSubs(pick, applyTrack)));
  }

  // Инициализация кнопки
  function init(){
    if (window.Lampa?.Player?.addInteractive){
      try{ Lampa.Player.removeInteractive && Lampa.Player.removeInteractive('subs-ru-osv3'); }catch{}
      Lampa.Player.addInteractive({ id:'subs-ru-osv3', title:LABEL, subtitle:'ru', icon:'cc', onClick: openWizard });
    } else {
      if (!document.getElementById('subsru-btn')){
        const b=document.createElement('button');
        b.id='subsru-btn'; b.textContent='CC'; b.title=LABEL;
        b.style.cssText='position:fixed;right:16px;bottom:88px;z-index:2147483647;background:#111;color:#fff;border:1px solid #444;border-radius:50%;width:44px;height:44px;font-weight:700;cursor:pointer;opacity:.9;';
        b.onmouseenter=()=>b.style.opacity='1'; b.onmouseleave=()=>b.style.opacity='.9';
        b.onclick=openWizard; document.body.appendChild(b);
      }
      window.addEventListener('keydown', e=>{ if (e.key.toLowerCase()==='s' && !e.repeat) openWizard(); });
    }
  }

  if (window.Lampa) init(); else document.addEventListener('lampa-ready', init, {once:true});
})();
