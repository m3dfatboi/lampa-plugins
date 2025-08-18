(function () {
  const FLAG = '__SUBS_RU_SUBHERO__';
  if (window[FLAG]) return; window[FLAG] = true;

  // ВСТАВЬ БАЗОВЫЙ URL ТВОЕГО SUBHERO-АДДОНА (без хвоста /manifest.json — просто база)
  // Примеры: 'https://subhero.yourhost.com' или 'https://yourname.github.io/subhero'
  const SUBHERO_BASE = 'https://subhero.onrender.com/%7B%22language%22%3A%22ru%22%7D/';

  const LANG = 'ru';
  const LABEL = 'Субтитры (SubHero · RU)';

  const safe = v => (v == null ? '' : String(v));
  const delay = ms => new Promise(r => setTimeout(r, ms));

  // Мини-клиент Stremio-аддона (GET JSON)
  async function addonGet(path, params) {
    if (!SUBHERO_BASE || !/^https?:\/\//i.test(SUBHERO_BASE)) {
      throw new Error('SUBHERO_BASE not set');
    }
    const base = SUBHERO_BASE.endsWith('/') ? SUBHERO_BASE : SUBHERO_BASE + '/';
    const url = new URL(path.replace(/^\//,''), base);
    if (params && typeof params === 'object') {
      for (const k of Object.keys(params)) {
        const v = params[k];
        if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
      }
    }
    const r = await fetch(url.toString(), { method:'GET' });
    if (!r.ok) throw new Error('HTTP '+r.status);
    return r.json();
  }

  // Запрос субтитров у SubHero по спецификации Stremio
  async function fetchSubtitles(meta) {
    const type = meta.season && meta.episode ? 'series' : 'movie';
    const id = meta.imdb_id || '';
    const tries = [];

    if (id) {
      // style 1: /subtitles/{type}/{id}.json
      tries.push({ p: `subtitles/${type}/${encodeURIComponent(id)}.json`, q: { season: meta.season || '', episode: meta.episode || '' } });
      // style 2: /subtitles.json?type=&id=&season=&episode=
      tries.push({ p: 'subtitles.json', q: { type, id, season: meta.season || '', episode: meta.episode || '' } });
    }
    if (!id && meta.title) {
      // fallback по названию/году, если аддон поддерживает query
      tries.push({ p: 'subtitles.json', q: { type, query: `${meta.title} ${meta.year||''}`.trim(), season: meta.season||'', episode: meta.episode||'' } });
    }

    for (const t of tries) {
      try {
        const data = await addonGet(t.p, t.q);
        const list = normalizeSubs(data, LANG);
        if (list.length) return list;
      } catch (_) {}
      await delay(120);
    }
    return [];
  }

  // Приводим ответ SubHero/Stremio к [{name, lang, url}]
  function normalizeSubs(data, lang) {
    const arr = Array.isArray(data) ? data : Array.isArray(data.subtitles) ? data.subtitles : [];
    const out = [];
    for (const s of arr) {
      const lraw = safe(s.lang || s.language || s.iso || s.id).toLowerCase();
      const lbl = safe(s.name || s.title || s.fileName || s.provider || 'SubHero');
      const url = s.url || s.stream || s.href;
      if (!url) continue;
      const isRu = lraw === 'ru' || lraw === 'rus' || lraw === 'russian' || /(^|[^a-z])(ru|rus)([^a-z]|$)/i.test(lbl);
      if (!isRu) continue;
      out.push({ name: lbl, lang: 'ru', url });
    }
    // уникализация по url
    const seen = new Set();
    return out.filter(x => (seen.has(x.url) ? false : (seen.add(x.url), true)));
  }

  // Конвертация SRT -> VTT
  function srtToVtt(srt) {
    const t = safe(srt).replace(/\r+/g,'').trim();
    return 'WEBVTT\n\n' + t
      .replace(/^\d+\n/gm,'')
      .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})\s-->\s(\d{2}:\d{2}:\d{2}),(\d{3})/g,'$1.$2 --> $3.$4')
      .replace(/\n{3,}/g,'\n\n');
  }

  // Свой модал поверх плеера (без внутренних UI Lampa)
  function showModal(items, onPick) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;font-family:sans-serif;';
    const box = document.createElement('div');
    box.style.cssText = 'width:min(640px,92vw);max-height:80vh;background:#1f1f1f;color:#fff;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.5);display:flex;flex-direction:column;overflow:hidden;';
    const head = document.createElement('div');
    head.style.cssText = 'padding:14px 16px;background:#2a2a2a;font-size:16px;font-weight:600;display:flex;justify-content:space-between;align-items:center;';
    head.innerHTML = `<span>${LABEL}</span><button id="subsru-close" style="background:#444;color:#fff;border:0;border-radius:8px;padding:6px 10px;cursor:pointer;">Закрыть</button>`;
    const body = document.createElement('div');
    body.style.cssText = 'padding:8px 0;overflow:auto;';
    const list = document.createElement('div');
    items.forEach(x=>{
      const row = document.createElement('button');
      row.textContent = `${safe(x.name)} · ru`;
      row.style.cssText = 'width:100%;text-align:left;background:transparent;color:#fff;border:0;border-bottom:1px solid #333;padding:12px 16px;cursor:pointer;';
      row.onmouseenter = ()=> row.style.background = '#333';
      row.onmouseleave = ()=> row.style.background = 'transparent';
      row.onclick = ()=> { cleanup(); onPick(x); };
      list.appendChild(row);
    });
    body.appendChild(list);
    box.appendChild(head); box.appendChild(body);
    wrap.appendChild(box);
    document.body.appendChild(wrap);
    function cleanup(){ wrap.remove(); }
    wrap.addEventListener('click', (e)=>{ if(e.target===wrap) cleanup(); });
    head.querySelector('#subsru-close').onclick = cleanup;
  }

  // Кнопка “CC” поверх плеера (если нет нативной кнопки)
  function ensureFloatingButton() {
    if (document.getElementById('subsru-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'subsru-btn';
    btn.textContent = 'CC';
    btn.title = LABEL;
    btn.style.cssText = 'position:fixed;right:16px;bottom:88px;z-index:2147483647;background:#111;color:#fff;border:1px solid #444;border-radius:50%;width:44px;height:44px;font-weight:700;cursor:pointer;opacity:.9;';
    btn.onmouseenter = ()=> btn.style.opacity = '1';
    btn.onmouseleave = ()=> btn.style.opacity = '.9';
    btn.onclick = openPicker;
    document.body.appendChild(btn);
  }

  function getMeta(ctx) {
    const d = ctx||{};
    const imdbRaw = safe(d.imdb_id||d.imdb);
    const imdb = imdbRaw.startsWith('tt')?imdbRaw:(imdbRaw?('tt'+imdbRaw):'');
    return {
      title: safe(d.title||d.name),
      year: d.year ? +d.year : (d.release_year ? +d.release_year : ''),
      season: Number.isFinite(+d.season)?+d.season:0,
      episode: Number.isFinite(+d.episode)?+d.episode:0,
      imdb_id: imdb
    };
  }

  async function openPicker() {
    try {
      if (!SUBHERO_BASE || !/^https?:\/\//i.test(SUBHERO_BASE)) {
        window.Lampa?.Noty?.show && Lampa.Noty.show('Укажи URL SubHero в начале файла');
        return;
      }
      const ctx = (window.Lampa && Lampa.Player && Lampa.Player.video && Lampa.Player.video()) ||
                  (window.Lampa && Lampa.Activity && Lampa.Activity.active && Lampa.Activity.active()) || {};
      const meta = getMeta(ctx);
      if (!meta.imdb_id && !meta.title) {
        window.Lampa?.Noty?.show && Lampa.Noty.show('Нет метаданных для запроса');
        return;
      }
      window.Lampa?.Noty?.show && Lampa.Noty.show('SubHero: запрос…');

      const items = await fetchSubtitles(meta);
      if (!items.length) { window.Lampa?.Noty?.show && Lampa.Noty.show('Субтитры не найдены'); return; }

      showModal(items, async (picked)=>{
        try {
          let url = picked.url;
          // Если не VTT — пытаемся скачать и конвертировать
          if (!/\.vtt(\?|$)/i.test(url)) {
            const r = await fetch(url);
            if (!r.ok) throw new Error('download');
            const buf = await r.arrayBuffer();
            let text = '';
            try { text = new TextDecoder('utf-8').decode(buf); }
            catch { text = new TextDecoder('windows-1251').decode(new Uint8Array(buf)); }
            const vtt = text.trim().startsWith('WEBVTT') ? text : srtToVtt(text);
            url = URL.createObjectURL(new Blob([vtt], { type:'text/vtt' }));
          }

          const player = window.Lampa?.Player || window.Lampa?.PlayerVideo || window.Lampa?.PlayerLite || {};
          if (player.subtitles?.add) {
            player.subtitles.clear && player.subtitles.clear();
            player.subtitles.add({ label:'Русские', language:LANG, url });
            player.subtitles.enable && player.subtitles.enable(LANG);
          } else if (window.Lampa?.Player?.listener?.send) {
            window.Lampa.Player.listener.send('subtitle', { label:'Русские', language:LANG, url });
          } else if (window.Lampa?.Event?.emit) {
            window.Lampa.Event.emit('player_subtitle', { url, label:'Русские', lang:LANG });
          }
          window.Lampa?.Noty?.show && Lampa.Noty.show('Субтитры подключены: RU');
        } catch {
          window.Lampa?.Noty?.show && Lampa.Noty.show('Ошибка загрузки субтитров');
        }
      });
    } catch {
      window.Lampa?.Noty?.show && Lampa.Noty.show('Ошибка плагина');
    }
  }

  function init() {
    if (window.Lampa?.Player?.addInteractive) {
      try { Lampa.Player.removeInteractive && Lampa.Player.removeInteractive('subs-ru-subhero'); } catch {}
      Lampa.Player.addInteractive({
        id: 'subs-ru-subhero',
        title: LABEL,
        subtitle: 'ru',
        icon: 'cc',
        onClick: openPicker
      });
    } else {
      ensureFloatingButton();
      window.addEventListener('keydown', (e)=>{ if (e.key.toLowerCase()==='s' && !e.repeat) openPicker(); });
    }
  }

  if (window.Lampa) init();
  else document.addEventListener('lampa-ready', init, { once:true });
})();
