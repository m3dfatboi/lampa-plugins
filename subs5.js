(function () {
  const FLAG = '__SUBS_RU_OS_STANDALONE__';
  if (window[FLAG]) return; window[FLAG] = true;

  const LANG = 'ru';
  const LABEL = 'Субтитры (RU)';

  // ---------- tiny utils ----------
  const safe = v => (v == null ? '' : String(v));
  const delay = ms => new Promise(r => setTimeout(r, ms));

  function srtToVtt(srt) {
    const t = safe(srt).replace(/\r+/g,'').trim();
    return 'WEBVTT\n\n' + t
      .replace(/^\d+\n/gm,'')
      .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})\s-->\s(\d{2}:\d{2}:\d{2}),(\d{3})/g,'$1.$2 --> $3.$4')
      .replace(/\n{3,}/g,'\n\n');
  }

  async function http(url, timeout=15000) {
    const ctrl = new AbortController();
    const id = setTimeout(()=>ctrl.abort(), timeout);
    try {
      const r = await fetch(safe(url), { method:'GET', credentials:'omit', mode:'cors', signal: ctrl.signal, headers:{'Accept':'text/html,application/json,*/*'}});
      return r;
    } finally { clearTimeout(id); }
  }

  // ---------- OpenSubtitles scraping ----------
  function parseList(html) {
    const doc = document.implementation.createHTMLDocument('');
    doc.documentElement.innerHTML = safe(html);
    const out = [];
    doc.querySelectorAll('a[href*="/subtitles/"]').forEach(a=>{
      const href = a.getAttribute('href')||'';
      if (!href.includes('/subtitles/')) return;
      const ctx = safe((a.closest('article,li,div,section,tr,tbody')||a.parentElement)?.textContent).toLowerCase();
      const isRu = ctx.includes('russian') || ctx.includes('рус') || /\bru\b/.test(ctx) || /\brus\b/.test(ctx);
      if (!isRu) return;
      out.push({
        name: safe(a.textContent).trim() || 'Russian subtitles',
        pageUrl: new URL(href, 'https://www.opensubtitles.org/').toString()
      });
    });
    const seen = new Set();
    return out.filter(x=> (seen.has(x.pageUrl)?false:(seen.add(x.pageUrl),true)));
  }

  async function resolveDownload(pageUrl) {
    const r = await http(pageUrl);
    if (!r.ok) throw new Error('page');
    const html = await r.text();
    const doc = document.implementation.createHTMLDocument('');
    doc.documentElement.innerHTML = html;
    let el = doc.querySelector('a[href*="/download/"],a[href$=".srt"],a[href$=".vtt"],a[href$=".ass"]');
    if (!el) {
      el = Array.from(doc.querySelectorAll('a,button')).find(x=>{
        const h = safe(x.getAttribute('href')||x.getAttribute('data-url'));
        return /download|\.srt|\.vtt|\.ass|скачать/i.test(h);
      });
    }
    if (!el) throw new Error('no link');
    const raw = el.getAttribute('href')||el.getAttribute('data-url')||'';
    return new URL(raw, pageUrl).toString();
  }

  async function fetchVtt(dl) {
    const r = await http(dl);
    if (!r.ok) throw new Error('download');
    const type = safe(r.headers.get('content-type')).toLowerCase();
    const buf = await r.arrayBuffer();
    let text = '';
    try { text = new TextDecoder('utf-8').decode(buf); }
    catch { text = new TextDecoder('windows-1251').decode(new Uint8Array(buf)); }
    const vtt = (type.includes('text/vtt') || text.trim().startsWith('WEBVTT') || /\.vtt(\?|$)/i.test(dl)) ? text : srtToVtt(text);
    return URL.createObjectURL(new Blob([vtt], { type:'text/vtt' }));
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

  function buildQueries(m) {
    const qs = [];
    if (m.imdb_id) qs.push(`https://www.opensubtitles.org/en/search2/imdbid-${encodeURIComponent(m.imdb_id)}/sublanguageid-rus`);
    if (m.title && m.season && m.episode) {
      const q = encodeURIComponent(`${m.title} S${String(m.season).padStart(2,'0')}E${String(m.episode).padStart(2,'0')}`);
      qs.push(`https://www.opensubtitles.org/en/search2/sublanguageid-rus/moviename-${q}`);
    }
    if (m.title && m.year) {
      const q = encodeURIComponent(`${m.title} ${m.year}`);
      qs.push(`https://www.opensubtitles.org/en/search2/sublanguageid-rus/moviename-${q}`);
    }
    if (m.title) {
      const q = encodeURIComponent(m.title);
      qs.push(`https://www.opensubtitles.org/en/search2/sublanguageid-rus/moviename-${q}`);
    }
    return qs;
  }

  async function searchOS(meta) {
    const qs = buildQueries(meta);
    const out = [];
    for (const u of qs) {
      try {
        await delay(300);
        const r = await http(u);
        if (!r.ok) continue;
        out.push(...parseList(await r.text()));
      } catch {}
    }
    const seen = new Set();
    return out.filter(x=> (seen.has(x.pageUrl)?false:(seen.add(x.pageUrl),true)));
  }

  // ---------- standalone modal ----------
  function makeModal(items, onPick, onClose) {
    // контейнер
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;font-family:sans-serif;';
    // окно
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
      row.textContent = `${safe(x.name)} · OpenSubtitles`;
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

    function cleanup(){
      wrap.remove();
      onClose && onClose();
    }
    wrap.addEventListener('click', (e)=>{ if(e.target===wrap) cleanup(); });
    head.querySelector('#subsru-close').onclick = cleanup;
    return cleanup;
  }

  async function openPickerStandalone() {
    try {
      const ctx = (window.Lampa && Lampa.Player && Lampa.Player.video && Lampa.Player.video()) ||
                  (window.Lampa && Lampa.Activity && Lampa.Activity.active && Lampa.Activity.active()) || {};
      const meta = getMeta(ctx);
      if (!meta.title && !meta.imdb_id) {
        window.Lampa?.Noty?.show && Lampa.Noty.show('Нет метаданных для поиска');
        return;
      }
      window.Lampa?.Noty?.show && Lampa.Noty.show('Поиск русских субтитров…');

      const list = await searchOS(meta);
      if (!list.length) { window.Lampa?.Noty?.show && Lampa.Noty.show('Субтитры не найдены'); return; }

      makeModal(list, async (picked)=>{
        try {
          const dl = await resolveDownload(picked.pageUrl);
          const vtt = await fetchVtt(dl);
          const player = window.Lampa?.Player || window.Lampa?.PlayerVideo || window.Lampa?.PlayerLite || {};
          if (player.subtitles?.add) {
            player.subtitles.clear && player.subtitles.clear();
            player.subtitles.add({label:'Русские', language:LANG, url:vtt});
            player.subtitles.enable && player.subtitles.enable(LANG);
          } else if (window.Lampa?.Player?.listener?.send) {
            window.Lampa.Player.listener.send('subtitle', { label:'Русские', language:LANG, url:vtt });
          } else if (window.Lampa?.Event?.emit) {
            window.Lampa.Event.emit('player_subtitle', { url:vtt, label:'Русские', lang:LANG });
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

  // ---------- minimal hook: only a player button ----------
  function init() {
    // не регистрируемся в менеджере плагинов, не подписываемся на экраны
    if (window.Lampa?.Player?.addInteractive) {
      try { window.Lampa.Player.removeInteractive && Lampa.Player.removeInteractive('subs-ru-standalone'); } catch {}
      window.Lampa.Player.addInteractive({
        id: 'subs-ru-standalone',
        title: LABEL,
        subtitle: LANG,
        icon: 'cc',
        onClick: openPickerStandalone
      });
    } else {
      // если нет API кнопки — добавим глобальную клавишу (к примеру, клавиша S)
      window.addEventListener('keydown', (e)=>{
        if (e.key.toLowerCase()==='s' && !e.repeat) openPickerStandalone();
      });
    }
  }

  if (window.Lampa) init();
  else document.addEventListener('lampa-ready', init, { once:true });
})();
