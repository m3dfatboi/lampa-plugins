(function () {
  const PLUGIN_ID = 'subs-ru-opensubs';
  const LABEL = 'Субтитры (RU)';
  const LANG = 'ru';

  // ---------- Utils ----------
  const delay = (ms) => new Promise(r => setTimeout(r, ms));
  const safe = (v) => (v == null ? '' : String(v));

  function srtToVtt(srtText) {
    const txt = safe(srtText).replace(/\r+/g, '').trim();
    // Удаляем нумерацию блоков и приводим запятые к точкам
    const vtt = 'WEBVTT\n\n' + txt
      .replace(/^\d+\n/gm, '')
      .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})\s-->\s(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2 --> $3.$4')
      .replace(/\n{3,}/g, '\n\n');
    return vtt;
  }

  async function safeFetch(url, options = {}, timeoutMs = 15000) {
    const u = safe(url);
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(u, {
        method: 'GET',
        credentials: 'omit',
        mode: 'cors',
        headers: {
          'Accept': 'text/html,application/json,*/*',
          // UA маскируем под браузер
          'User-Agent': 'Mozilla/5.0 LampaPlugin/1.0',
        },
        signal: controller.signal,
        ...options
      });
      return resp;
    } finally {
      clearTimeout(id);
    }
  }

  // ---------- Parsing ----------
  function parseOpenSubtitlesHtml(html) {
    const doc = document.implementation.createHTMLDocument('');
    doc.documentElement.innerHTML = safe(html);

    const items = [];
    // Захватываем максимально широкий список ссылок на карточки субтитров
    const anchors = doc.querySelectorAll('a[href*="/subtitles/"] , a[href*="/ru/subtitles/"], a[href*="/en/subtitles/"]');
    anchors.forEach(a => {
      const href = a.getAttribute('href') || '';
      if (!href.includes('/subtitles/')) return;

      const container = a.closest('article,li,div,section,tbody,tr') || a.parentElement;
      const text = safe(a.textContent).trim();
      const ctx = safe(container ? container.textContent : '').toLowerCase();

      const isRu = ctx.includes('russian') || ctx.includes('рус') || /\bru\b/.test(ctx) || /\brus\b/.test(ctx);
      if (!isRu) return;

      items.push({
        name: text || 'Russian subtitles',
        pageUrl: new URL(href, 'https://www.opensubtitles.org/').toString(),
        source: 'OpenSubtitles',
        lang: LANG
      });
    });

    // Уникализируем по pageUrl
    const seen = new Set();
    const result = [];
    for (const it of items) {
      if (seen.has(it.pageUrl)) continue;
      seen.add(it.pageUrl);
      result.push(it);
    }
    return result;
  }

  async function resolveSubtitleDownload(pageUrl) {
    const res = await safeFetch(pageUrl);
    if (!res.ok) throw new Error('OS page fetch failed');
    const html = await res.text();

    const doc = document.implementation.createHTMLDocument('');
    doc.documentElement.innerHTML = html;

    // Ищем кнопку/ссылку скачивания
    let link = doc.querySelector('a[href*="/download/"], a[href$=".srt"], a[href$=".vtt"], a[href$=".ass"]');
    if (!link) {
      link = Array.from(doc.querySelectorAll('a,button')).find(el => {
        const h = safe(el.getAttribute('href') || el.getAttribute('data-url'));
        return /download|\.srt|\.vtt|\.ass|скачать/i.test(h);
      });
    }
    if (!link) throw new Error('OS: no download link');

    const raw = link.getAttribute('href') || link.getAttribute('data-url') || '';
    return new URL(raw, pageUrl).toString();
  }

  async function fetchAndPrepareSubtitle(downloadUrl) {
    const resp = await safeFetch(downloadUrl);
    if (!resp.ok) throw new Error('Subtitle download failed');
    const ctype = safe(resp.headers.get('content-type')).toLowerCase();

    // В идеале обрабатывать zip. Здесь базовая поддержка текстовых форматов.
    const buf = await resp.arrayBuffer();
    let text = '';
    try {
      text = new TextDecoder('utf-8').decode(buf);
    } catch (_) {
      try {
        text = new TextDecoder('windows-1251').decode(new Uint8Array(buf));
      } catch (e) {
        throw new Error('Decode failed');
      }
    }

    let vtt;
    if (ctype.includes('text/vtt') || text.trim().startsWith('WEBVTT') || /\.vtt(\?|$)/i.test(downloadUrl)) {
      vtt = text;
    } else {
      // для .srt/.ass делаем конвертацию в vtt (ASS — упрощённо)
      vtt = srtToVtt(text);
    }

    const blob = new Blob([vtt], { type: 'text/vtt' });
    return URL.createObjectURL(blob);
  }

  // ---------- Search ----------
  function buildQueries(meta) {
    const queries = [];
    const imdb = safe(meta.imdb_id);
    const title = safe(meta.title).trim();
    const year = meta.year ? String(meta.year) : '';
    const s = Number.isFinite(+meta.season) ? +meta.season : 0;
    const e = Number.isFinite(+meta.episode) ? +meta.episode : 0;

    if (imdb) {
      // imdbid формат на OS: imdbid-tt1234567
      queries.push(`https://www.opensubtitles.org/en/search2/imdbid-${encodeURIComponent(imdb)}/sublanguageid-rus`);
    }
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
    console.log('[SubsRU] queries', queries);
    const results = [];

    for (const url of queries) {
      try {
        await delay(350);
        const r = await safeFetch(url);
        if (!r.ok) continue;
        const html = await r.text();
        const items = parseOpenSubtitlesHtml(html);
        for (const it of items) results.push(it);
      } catch (e) {
        console.warn('[SubsRU] query failed', url, e);
      }
    }

    // Уникализация
    const seen = new Set();
    const uniq = [];
    for (const r of results) {
      if (seen.has(r.pageUrl)) continue;
      seen.add(r.pageUrl);
      uniq.push(r);
    }
    return uniq;
  }

  // ---------- UI ----------
  function renderList(items, onPick) {
    const list = items.map(it => ({
      title: `${safe(it.name) || 'RU subtitles'} · ${safe(it.source) || 'OpenSubtitles'}`,
      subtitle: LANG,
      callback: () => onPick(it)
    }));

    console.log('[SubsRU] items', list);
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
      } else if (Lampa.Player && Lampa.Player.listener && Lampa.Player.listener.send) {
        Lampa.Player.listener.send('subtitle', {
          label: 'Русские',
          language: LANG,
          url: vttUrl
        });
      } else if (Lampa.Event && Lampa.Event.emit) {
        Lampa.Event.emit('player_subtitle', { url: vttUrl, label: 'Русские', lang: LANG });
      } else {
        console.warn('[SubsRU] no player subtitle API');
      }
      Lampa.Noty && Lampa.Noty.show && Lampa.Noty.show('Субтитры подключены: RU');
    } catch (e) {
      console.error('[SubsRU] apply error', e);
      Lampa.Noty && Lampa.Noty.show && Lampa.Noty.show('Ошибка применения субтитров');
    }
  }

  function resolveMetaFromContext(data) {
    const d = data || {};
    const imdbRaw = safe(d.imdb_id || d.imdb);
    const imdb = imdbRaw.startsWith('tt') ? imdbRaw : (imdbRaw ? 'tt' + imdbRaw : '');
    const meta = {
      title: safe(d.title || d.name),
      year: d.year ? +d.year : (d.release_year ? +d.release_year : ''),
      imdb_id: imdb,
      season: Number.isFinite(+d.season) ? +d.season : 0,
      episode: Number.isFinite(+d.episode) ? +d.episode : 0,
      type: safe(d.type)
    };
    console.log('[SubsRU] meta', meta);
    return meta;
  }

  async function openPicker(context) {
    const meta = resolveMetaFromContext(context);
    if (!meta.title && !meta.imdb_id) {
      Lampa.Noty && Lampa.Noty.show && Lampa.Noty.show('Нет метаданных для поиска');
      return;
    }
    try {
      Lampa.Noty && Lampa.Noty.show && Lampa.Noty.show('Поиск русских субтитров…');
      const list = await searchOpenSubtitles(meta);
      if (!list.length) {
        Lampa.Noty && Lampa.Noty.show && Lampa.Noty.show('Субтитры не найдены');
        return;
      }
      renderList(list, async (picked) => {
        try {
          const dl = await resolveSubtitleDownload(picked.pageUrl);
          const vtt = await fetchAndPrepareSubtitle(dl);
          applySubtitleToPlayer(vtt);
        } catch (e) {
          console.error('[SubsRU] download/prepare error', e);
          Lampa.Noty && Lampa.Noty.show && Lampa.Noty.show('Ошибка загрузки субтитров');
        }
      });
    } catch (e) {
      console.error('[SubsRU] search error', e);
      Lampa.Noty && Lampa.Noty.show && Lampa.Noty.show('Ошибка поиска субтитров');
    }
  }

  function initUI() {
    // Кнопка в плеере
    if (Lampa.Player && typeof Lampa.Player.addInteractive === 'function') {
      Lampa.Player.addInteractive({
        title: safe(LABEL),
        subtitle: LANG,
        icon: 'cc',
        onClick: () => {
          const ctx = (Lampa.Player && Lampa.Player.video && Lampa.Player.video()) ||
                      (Lampa.Activity && Lampa.Activity.active && Lampa.Activity.active()) || {};
          openPicker(ctx);
        }
      });
    }

    // Пункт в меню карточки
    if (Lampa.Listener && typeof Lampa.Listener.follow === 'function') {
      Lampa.Listener.follow('full', function (e) {
        try {
          if (e && e.type === 'button' && e.name === 'more' && Array.isArray(e.items)) {
            const card = e.data || {};
            e.items.push({
              title: safe(LABEL),
              subtitle: 'поиск ru на OpenSubtitles',
              icon: 'cc',
              onClick: () => openPicker(card)
            });
          }
        } catch (err) {
          console.warn('[SubsRU] follow full err', err);
        }
      });
    }
  }

  function start() {
    try {
      initUI();
      console.log(`[${PLUGIN_ID}] initialized`);
    } catch (e) {
      console.error(`[${PLUGIN_ID}] init error`, e);
    }
  }

  if (window.Lampa) {
    if (Lampa.Plugins && typeof Lampa.Plugins.add === 'function') {
      Lampa.Plugins.add({
        id: PLUGIN_ID,
        title: LABEL,
        description: 'Русские субтитры с OpenSubtitles (без API), ручной выбор',
        version: '0.2.0',
        author: 'you',
        onLoad: start
      });
    } else {
      start();
    }
  } else {
    document.addEventListener('lampa-ready', start, { once: true });
  }
})();
