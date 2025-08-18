(function () {
  const FLAG = '__SUBS_RU_SUBHERO_V2__';
  if (window[FLAG]) return; window[FLAG] = true;

  // SubHero (RU) из твоей ссылки:
  const SUBHERO_BASE = 'https://subhero.onrender.com/%7B%22language%22%3A%22ru%22%7D/';
  const LANG = 'ru';
  const LABEL = 'Субтитры (SubHero · RU)';

  const safe = v => (v == null ? '' : String(v));
  const delay = ms => new Promise(r => setTimeout(r, ms));

  async function GET(path, q) {
    const base = SUBHERO_BASE.endsWith('/') ? SUBHERO_BASE : SUBHERO_BASE + '/';
    const url = new URL(path.replace(/^\//,''), base);
    if (q) for (const k in q) if (q[k] !== '' && q[k] != null) url.searchParams.set(k, String(q[k]));
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  function normalizeSubs(data) {
    const arr = Array.isArray(data) ? data : Array.isArray(data.subtitles) ? data.subtitles : [];
    const out = [];
    for (const s of arr) {
      const l = safe(s.lang || s.language || s.iso || s.id).toLowerCase();
      const name = safe(s.name || s.title || s.fileName || s.provider || 'SubHero');
      const url = s.url || s.stream || s.href;
      if (!url) continue;
      const isRu = l==='ru' || l==='rus' || l==='russian' || /(^|[^a-z])(ru|rus)([^a-z]|$)/i.test(name);
      if (isRu) out.push({ name, url });
    }
    const seen = new Set();
    return out.filter(x => (seen.has(x.url) ? false : (seen.add(x.url), true)));
  }

  function srtToVtt(srt) {
    const t = safe(srt).replace(/\r+/g,'').trim();
    return 'WEBVTT\n\n' + t
      .replace(/^\d+\n/gm,'')
      .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})\s-->\s(\d{2}:\d{2}:\d{2}),(\d{3})/g,'$1.$2 --> $3.$4')
      .replace(/\n{3,}/g,'\n\n');
  }

  function getMeta(ctx) {
    const d = ctx || {};
    let imdb = safe(d.imdb_id || d.imdb);
    imdb = imdb ? (imdb.startsWith('tt') ? imdb : ('tt' + imdb.replace(/^tt/,''))) : '';
    return {
      title: safe(d.title || d.name),
      year: d.year ? +d.year : (d.release_year ? +d.release_year : ''),
      season: Number.isFinite(+d.season) ? +d.season : 0,
      episode: Number.isFinite(+d.episode) ? +d.episode : 0,
      imdb_id: imdb
    };
  }

  async function fetchSubtitles(meta) {
    const type = meta.season && meta.episode ? 'series' : 'movie';
    const id = meta.imdb_id;
    const tries = [];

    if (id) {
      tries.push({ p:`subtitles/${type}/${encodeURIComponent(id)}.json`, q:{ season: meta.season||'', episode: meta.episode||'' } });
      tries.push({ p:'subtitles.json', q:{ type, id, season: meta.season||'', episode: meta.episode||'' } });
      if (type==='series') tries.push({ p:`subtitles/${type}/${encodeURIComponent(`${id}:${meta.season}:${meta.episode}`)}.json`, q:{} });
    } else if (meta.title) {
      tries.push({ p:'subtitles.json', q:{ type, query:`${meta.title} ${meta.year||''}`.trim(), season: meta.season||'', episode: meta.episode||'' } });
    }

    for (const t of tries) {
      try {
        const data = await GET(t.p, t.q);
        const list = normalizeSubs(data);
        if (list.length) return list;
      } catch (_) {}
      await delay(120);
    }
    return [];
  }

  function modal(items, onPick) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;font-family:sans-serif;';
    const box = document.createElement('div');
    box.style.cssText = 'width:min(640px,92vw);max-height:80vh;background:#1f1f1f;color:#fff;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.5);display:flex;flex-direction:column;overflow:hidden;';
    const head = document.createElement('div');
    head.style.cssText = 'padding:14px 16px;background:#2a2a2a;font-size:16px;font-weight:600;display:flex;justify-content:space-between;align-items:center;';
    head.innerHTML = `<span>${LABEL}</span><button id="x" style="background:#444;color:#fff;border:0;border-radius:8px;padding:6px 10px;cursor:pointer;">Закрыть</button>`;
    const body = document.createElement('div'); body.style.cssText='padding:8px 0;overflow:auto;';
    const list = document.createElement('div');
    items.forEach(x=>{
      const b=document.createElement('button');
      b.textContent = `${x.name} · ru`;
      b.style.cssText='width:100%;text-align:left;background:transparent;color:#fff;border:0;border-bottom:1px solid #333;padding:12px 16px;cursor:pointer;';
      b.onmouseenter=()=>b.style.background='#333'; b.onmouseleave=()=>b.style.background='transparent';
      b.onclick=()=>{ wrap.remove(); onPick(x); };
      list.appendChild(b);
    });
    body.appendChild(list); box.appendChild(head); box.appendChild(body); wrap.appendChild(box); document.body.appendChild(wrap);
    head.querySelector('#x').onclick = ()=>wrap.remove();
    wrap.addEventListener('click',e=>{ if(e.target===wrap) wrap.remove(); });
  }

  async function applySub(url) {
    let trackUrl = url;
    if (!/\.vtt(\?|$)/i.test(url)) {
      const r = await fetch(url); if (!r.ok) throw new Error('download');
      const buf = await r.arrayBuffer();
      let txt=''; try { txt = new TextDecoder('utf-8').decode(buf); } catch { txt = new TextDecoder('windows-1251').decode(new Uint8Array(buf)); }
      const vtt = txt.trim().startsWith('WEBVTT') ? txt : srtToVtt(txt);
      trackUrl = URL.createObjectURL(new Blob([vtt], { type:'text/vtt' }));
    }
    const player = window.Lampa?.Player || window.Lampa?.PlayerVideo || window.Lampa?.PlayerLite || {};
    if (player.subtitles?.add) {
      player.subtitles.clear && player.subtitles.clear();
      player.subtitles.add({ label:'Русские', language:LANG, url:trackUrl });
      player.subtitles.enable && player.subtitles.enable(LANG);
    } else if (window.Lampa?.Player?.listener?.send) {
      window.Lampa.Player.listener.send('subtitle', { label:'Русские', language:LANG, url:trackUrl });
    } else if (window.Lampa?.Event?.emit) {
      window.Lampa.Event.emit('player_subtitle', { url:trackUrl, label:'Русские', lang:LANG });
    }
    window.Lampa?.Noty?.show && Lampa.Noty.show('Субтитры подключены: RU');
  }

  async function openPicker() {
    try {
      const ctx = (window.Lampa?.Player?.video && Lampa.Player.video()) || (window.Lampa?.Activity?.active && Lampa.Activity.active()) || {};
      const meta = getMeta(ctx);
      if (!meta.imdb_id && !meta.title) { window.Lampa?.Noty?.show && Lampa.Noty.show('Нет метаданных'); return; }
      window.Lampa?.Noty?.show && Lampa.Noty.show('SubHero: запрос…');
      const items = await fetchSubtitles(meta);
      if (!items.length) { window.Lampa?.Noty?.show && Lampa.Noty.show('Субтитры не найдены'); return; }
      modal(items, (picked)=> applySub(picked.url));
    } catch { window.Lampa?.Noty?.show && Lampa.Noty.show('Ошибка плагина'); }
  }

  function init() {
    if (window.Lampa?.Player?.addInteractive) {
      try { Lampa.Player.removeInteractive && Lampa.Player.removeInteractive('subs-ru-subhero'); } catch {}
      Lampa.Player.addInteractive({ id:'subs-ru-subhero', title:LABEL, subtitle:'ru', icon:'cc', onClick: openPicker });
    } else {
      if (!document.getElementById('subsru-btn')) {
        const b=document.createElement('button');
        b.id='subsru-btn'; b.textContent='CC'; b.title=LABEL;
        b.style.cssText='position:fixed;right:16px;bottom:88px;z-index:2147483647;background:#111;color:#fff;border:1px solid #444;border-radius:50%;width:44px;height:44px;font-weight:700;cursor:pointer;opacity:.9;';
        b.onmouseenter=()=>b.style.opacity='1'; b.onmouseleave=()=>b.style.opacity='.9';
        b.onclick=openPicker; document.body.appendChild(b);
      }
      window.addEventListener('keydown', e=>{ if (e.key.toLowerCase()==='s' && !e.repeat) openPicker(); });
    }
  }

  if (window.Lampa) init(); else document.addEventListener('lampa-ready', init, { once:true });
})();
