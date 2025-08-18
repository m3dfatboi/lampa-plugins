(function () {
  const PLUGIN_ID = 'subs-ru-opensubs';
  const LABEL = 'Субтитры (RU)';
  const LANG = 'ru';

  // Антидубликат: если плагин уже инициализирован — выходим
  if (window.__SUBS_RU_OPEN_SUBS_INIT__) return;
  window.__SUBS_RU_OPEN_SUBS_INIT__ = true;

  // Снимем предыдущие слушатели (если от старой версии остались)
  try {
    if (window.Lampa && Lampa.Listener && Lampa.Listener.remove) {
      Lampa.Listener.remove('full', 'subs-ru-hook');
    }
  } catch (_) {}

  // Утилиты
  const delay = (ms) => new Promise(r => setTimeout(r, ms));
  const safe = (v) => (v == null ? '' : String(v));

  // Мини-конвертация SRT -> VTT
  function srtToVtt(srtText) {
    const txt = safe(srtText).replace(/\r+/g, '').trim();
    return 'WEBVTT\n\n' + txt
      .replace(/^\d+\n/gm, '')
      .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})\s-->\s(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2 --> $3.$4')
      .replace(/\n{3,}/g, '\n\n');
  }

  // Безопасный fetch
  async function safeFetch(url, options = {}, timeoutMs = 15000) {
    const u = safe(url);
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(u, {
        method: 'GET',
        credentials: 'omit',
        mode: 'cors',
        headers: { 'Accept': 'text/html,application/json,*/*' },
        signal: controller.signal,
        ...options
      });
      return resp;
    } finally { clearTimeout(id); }
  }

  // Парсинг листинга на OpenSubtitles
  function parseOpenSubtitlesHtml(html) {
    const doc = document.implementation.createHTMLDocument('');
    doc.documentElement.innerHTML = safe(html);

    const items = [];
    const anchors = doc.querySelectorAll('a[href*="/subtitles/"]');
    anchors.forEach(a => {
      const href = a.getAttribute('href') || '';
      if (!href.includes('/subtitles/')) return;
      const container = a.closest('article,li,div,section,tr,tbody') || a.parentElement;
      const ctx = safe(container?.textContent).toLowerCase();

      // Только ru
      const isRu = ctx.includes('russian') || ctx.includes('рус') || /\bru\b/.test(ctx) || /\brus\b/.test(ctx);
      if (!isRu) return;

      const name = safe(a.textContent).trim() || 'Russian subtitles';
      items.push({
        name,
        pageUrl: new URL(href, 'https://www.opensubtitles.org/').toString(),
        source: 'OpenSubtitles',
        lang: LANG
      });
    });

    // Уникализация
    const seen = new Set();
    return items.filter(it => (seen.has(it.pageUrl) ? false : (seen.add(it.pageUrl), true)));
  }

  async function resolveSubtitleDownload(pageUrl) {
    const res = await safeFetch(pageUrl);
    if (!res.ok) throw new Error('OS page fetch failed');
    const html = await res.text();

    const doc = document.implementation.createHTMLDocument('');
    doc.documentElement.innerHTML = html;

    let link = doc.querySelector('a[href*="/download/"], a[href$=".srt"], a[href$=".vtt"], a[href$=".ass"]');
    if (!link) {
      link = Array.from(doc.querySelectorAll('a,button')).find(el => {
        const h = safe(el.getAttribute('href') || el.getAttribute('data-url'));
        return /download|\.srt|\.vtt|\.ass|скачать/i.test(h);
      });
    }
    if (!link) throw new Error('no download link');

    const raw = link.getAttribute('href') || link.getAttribute('data-url') || '';
    return new URL(raw, pageUrl).toString();
  }

  async function fetchAndPrepareSubtitle(downloadUrl) {
    const resp = await safeFetch(downloadUrl);
    if (!resp.ok) throw new Error('Subtitle download failed');
    const ctype = safe(resp.headers.get('content-type')).toLowerCase();

    const buf = await resp.arrayBuffer();
    let text = '';
    try { text = new TextDecoder('utf-8').decode(buf); }
    catch { text = new TextDecoder('windows-1251').decode(new Uint8Array(buf)); }

    let vtt;
    if (ctype.includes('text/vtt') || text.trim().startsWith('WEBVTT') || /\.vtt(\?|$)/i.test(downloadUrl)) {
      vtt = text;
    } else {
      vtt = srtToVtt(text);
    }
    return URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
  }

  function buildQueries(meta) {
    const queries = [];
    const imdb = safe(meta.imdb_id);
    const title = safe(meta.title).trim();
    const year = meta.year ? String(meta.year) : '';
    const s = Number.isFinite(+meta.season) ? +meta.season : 0;
    const e = Number.isFinite(+meta.episode) ? +meta.episode : 0;

    if (imdb) queries.push(`https://www.opensubtitles.org/en/search2/imdbid-${encodeURIComponent(imdb)}/sublanguageid-rus`);
    if (title && s && e) {
      const q = encodeURIComponent(`${title} S${String(s).padStart(2,'0')}E${String(e).padStart(2,'0')}`);
      queries.push(`https://www.opensubtitles.org/en/search2/sublanguageid-rus/moviename-${q}`);
    }
    if (title && year) {
      const q = encodeURIComponent(`${title} ${year}`);
      queries.push(`https://www.opensubtitles.org/en/search2/sublanguageid-rus/moviename-${q}`);
    }
    if (title) {
      const q = encodeURIComponent(title);
      queries.push(`https://www.opensubtitles.org/en/search2/sublanguageid-rus/moviename-${q}`);
    }
    return queries;
  }

  async function searchOpenSubtitles(meta) {
    const queries = buildQueries(meta);
    const results = [];
    for (const url of queries) {
      try {
        await delay(300);
        const r = await safeFetch(url);
        if (!r.ok) continue;
        const html = await r.text();
        results.push(...parseOpenSubtitlesHtml(html));
      } catch (_) {}
    }
    // Уникализация
    const seen = new Set();
    return results.filter(it => (seen.has(it.pageUrl) ? false : (seen.add(it.pageUrl), true)));
  }

  // ВАЖНО: элементы Select не должны иметь полей, которые Lampa трактует как “link” или “url” в контексте источников.
  function renderList(items, onPick) {
    const list = items.map(it => ({
      title: `${safe(it.name)} · ${safe(it.source)}`,
      // НИКАКИХ link/url/id/quality/magnet/stream и прочего
      // Только безопасные поля, которые UI Select понимает как пункты меню
      // и callback для клика
      subtitle: LANG,
      // добавляем явный тип item: 'button' чтобы Lampa не пыталась его парсить как источник
      item: 'button',
      // не даём никакие data поля
      callback: () => onPick({ pageUrl: it.pageUrl })
    }));

    Lampa.Select.show({
      title: LABEL,
      items: list,
      onBack: function () {}
    });
  }

  function applySubtitleToPlayer(vttUrl) {
    const player = Lampa.Player || Lampa.PlayerVideo || Lampa.PlayerLite || {};
    const subs = player.subtitles;
    try {
      if (subs && typeof subs.add === 'function') {
        subs.clear && subs.clear();
        subs.add({ label: 'Русские', language: LANG, url: vttUrl });
        subs.enable && subs.enable(LANG);
      } else if (Lampa.Player?.listener?.send) {
        Lampa.Player.listener.send('subtitle', { label: 'Русские', language: LANG, url: vttUrl });
      } else if (Lampa.Event?.emit) {
        Lampa.Event.emit('player_subtitle', { url: vttUrl, label: 'Русские', lang: LANG });
      }
      Lampa.Noty?.show && Lampa.Noty.show('Субтитры подключены: RU');
    } catch (e) {
      Lampa.Noty?.show && Lampa.Noty.show('Ошибка применения субтитров');
    }
  }

  function resolveMeta(context) {
    const d = context || {};
    const imdbRaw = safe(d.imdb_id || d.imdb);
    const imdb = imdbRaw.startsWith('tt') ? imdbRaw : (imdbRaw ? 'tt' + imdbRaw : '');
    return {
      title: safe(d.title || d.name),
      year: d.year ? +d.year : (d.release_year ? +d.release_year : ''),
      imdb_id: imdb,
      season: Number.isFinite(+d.season) ? +d.season : 0,
      episode: Number.isFinite(+d.episode) ? +d.episode : 0,
      type: safe(d.type)
    };
  }

  async function openPicker(context) {
    const meta = resolveMeta(context);
    if (!meta.title && !meta.imdb_id) {
      Lampa.Noty?.show && Lampa.Noty.show('Нет метаданных для поиска');
      return;
    }
    Lampa.Noty?.show && Lampa.Noty.show('Поиск русских субтитров…');
    const list = await searchOpenSubtitles(meta);
    if (!list.length) {
      Lampa.Noty?.show && Lampa.Noty.show('Субтитры не найдены');
      return;
    }
    renderList(list, async (picked) => {
      try {
        const dl = await resolveSubtitleDownload(picked.pageUrl);
        const vtt = await fetchAndPrepareSubtitle(dl);
        applySubtitleToPlayer(vtt);
      } catch (e) {
        Lampa.Noty?.show && Lampa.Noty.show('Ошибка загрузки субтитров');
      }
    });
  }

  function initUI() {
    // 1) Без регистрации “источника” — только кнопка в плеере
    if (Lampa.Player && typeof Lampa.Player.addInteractive === 'function') {
      // снять предыдущую кнопку, если была
      try { Lampa.Player.removeInteractive && Lampa.Player.removeInteractive(PLUGIN_ID); } catch (_) {}
      Lampa.Player.addInteractive({
        id: PLUGIN_ID,
        title: safe(LABEL),
        subtitle: LANG,
        icon: 'cc',
        onClick: () => {
          const ctx = (Lampa.Player?.video && Lampa.Player.video()) || (Lampa.Activity?.active && Lampa.Activity.active()) || {};
          openPicker(ctx);
        }
      });
    }

    // 2) Пункт в “Ещё” карточки как обычная кнопка (не источник)
    if (Lampa.Listener && typeof Lampa.Listener.follow === 'function') {
      Lampa.Listener.follow('full', function subsRuHook(e) {
        // помечаем как именованный слушатель для возможного удаления
        subsRuHook.id = 'subs-ru-hook';
        if (e?.type === 'button' && e.name === 'more' && Array.isArray(e.items)) {
          const card = e.data || {};
          e.items.push({
            title: safe(LABEL),
            subtitle: 'поиск ru на OpenSubtitles',
            icon: 'cc',
            item: 'button',
            callback: () => openPicker(card)
          });
        }
      });
    }
  }

  function start() {
    // Укажем нормальные метаданные плагина, чтобы не было “Без названия/undefined”
    if (Lampa.Plugins?.add) {
      Lampa.Plugins.add({
        id: PLUGIN_ID,
        title: safe(LABEL),
        description: 'РУ-субтитры с OpenSubtitles (без API), ручной выбор',
        version: '0.3.0',
        author: 'you',
        onLoad: initUI
      });
    } else {
      initUI();
    }
  }

  if (window.Lampa) {
    start();
  } else {
    document.addEventListener('lampa-ready', start, { once: true });
  }
})();
