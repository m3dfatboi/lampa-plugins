(function () {
  const PLUGIN_ID = 'subs-ru-opensubtitles';
  const LABEL = 'Субтитры (RU)';
  const LANG_CODE = 'ru';

  // Утилита: задержка
  const delay = (ms) => new Promise(r => setTimeout(r, ms));

  // Утилита: простая конвертация SRT -> WebVTT
  function srtToVtt(srtText) {
    const vtt = 'WEBVTT\n\n' + srtText
      .replace(/\r+/g, '')
      .replace(/^\s+|\s+$/g, '')
      .replace(/(\d+)\n(\d{2}:\d{2}:\d{2}),(\d{3}) --> (\d{2}:\d{2}:\d{2}),(\d{3})/g,
               ' $1\n$2.$3 --> $4.$5')
      .replace(/^\d+\n/gm, '')
      .replace(/\n{2,}/g, '\n\n');
    return vtt;
  }

  // Хелпер: безопасный fetch с таймаутом и заголовками
  async function safeFetch(url, options = {}, timeoutMs = 15000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(url, {
        method: 'GET',
        credentials: 'omit',
        mode: 'cors',
        headers: {
          'Accept': 'text/html,application/json,*/*',
          'User-Agent': 'Mozilla/5.0 (compatible; Lampa-Plugin/1.0)',
        },
        signal: controller.signal,
        ...options
      });
      return resp;
    } finally {
      clearTimeout(id);
    }
  }

  // Парсинг результатов OpenSubtitles из HTML
  // ПРИМЕЧАНИЕ: структура страниц может меняться; при изменениях обновить селекторы.
  function parseOpenSubtitlesHtml(html) {
    const dom = document.implementation.createHTMLDocument('');
    dom.documentElement.innerHTML = html;

    // Ищем карточки субтитров
    const items = [];
    const rows = dom.querySelectorAll('section a[href*="/en/subtitles/"], section a[href*="/ru/subtitles/"], a[href*="/subtitles/"]');

    rows.forEach(a => {
      const href = a.getAttribute('href') || '';
      if (!href.includes('/subtitles/')) return;

      // Ищем язык и название
      const parent = a.closest('article, div, li') || a.parentElement;
      const text = (a.textContent || '').trim();
      const langHint = (parent?.textContent || '').toLowerCase();

      // Фильтрация по русскому языку
      const isRu = langHint.includes('russian') || langHint.includes('рус') || langHint.includes('(ru)') || /(?:^|\W)ru(?:\W|$)/.test(langHint);
      if (!isRu) return;

      // Оценка "качества" по названию
      const quality = /hi|forced|full/i.test(text) ? 'hi' : 'normal';

      items.push({
        title: text || 'Russian subtitles',
        pageUrl: new URL(href, 'https://www.opensubtitles.org/').toString(),
        lang: 'ru',
        quality
      });
    });

    // Удаляем дубликаты по pageUrl
    const uniq = [];
    const seen = new Set();
    for (const it of items) {
      if (seen.has(it.pageUrl)) continue;
      seen.add(it.pageUrl);
      uniq.push(it);
    }
    return uniq;
  }

  // Получение прямой ссылки на файл субтитров со страницы субтитров
  async function resolveSubtitleDownload(pageUrl) {
    // Ищем на странице ссылку на загрузку .srt/.ass/.vtt
    const res = await safeFetch(pageUrl);
    if (!res.ok) throw new Error('OpenSubtitles page fetch failed');
    const html = await res.text();

    const dom = document.implementation.createHTMLDocument('');
    dom.documentElement.innerHTML = html;

    // Популярные варианты ссылок на загрузку
    let downloadA = dom.querySelector('a[href*="/download/"], a[href*="fileadownload"], a[href*=".srt"], a[href*=".vtt"], a[href*=".ass"]');
    if (!downloadA) {
      // иногда ссылка может быть с data-атрибутов/кнопок
      downloadA = Array.from(dom.querySelectorAll('a, button'))
        .find(el => /download|скачать|\.srt|\.vtt|\.ass/i.test(el.getAttribute('href') || el.getAttribute('data-url') || ''));
    }

    if (!downloadA) throw new Error('No download link found');
    const raw = downloadA.getAttribute('href') || downloadA.getAttribute('data-url');
    const url = new URL(raw, pageUrl).toString();
    return url;
  }

  // Поиск субтитров на OpenSubtitles без API
  async function searchOpenSubtitles(meta) {
    // Попробуем несколько стратегий: imdb, сериал (s/e), просто title+year
    const queries = [];
    if (meta.imdb_id) {
      // У OpenSubtitles встречается фильтр imdbid: https://www.opensubtitles.org/en/search2/imdbid-tt1234567/sublanguageid-rus
      queries.push(`https://www.opensubtitles.org/en/search2/imdbid-${meta.imdb_id}/sublanguageid-rus`);
    }
    // Сериал
    if (meta.title && meta.season && meta.episode) {
      const q = encodeURIComponent(`${meta.title} S${String(meta.season).padStart(2,'0')}E${String(meta.episode).padStart(2,'0')}`);
      queries.push(`https://www.opensubtitles.org/en/search2/sublanguageid-rus/moviename-${q}`);
    }
    // Фильм
    if (meta.title && meta.year) {
      const q = encodeURIComponent(`${meta.title} ${meta.year}`);
      queries.push(`https://www.opensubtitles.org/en/search2/sublanguageid-rus/moviename-${q}`);
    }
    // Запасной — только title
    if (meta.title) {
      const q = encodeURIComponent(meta.title);
      queries.push(`https://www.opensubtitles.org/en/search2/sublanguageid-rus/moviename-${q}`);
    }

    const results = [];
    for (const url of queries) {
      try {
        await delay(400); // не спамим
        const resp = await safeFetch(url);
        if (!resp.ok) continue;
        const html = await resp.text();
        const items = parseOpenSubtitlesHtml(html);
        // Нормализация
        for (const it of items) {
          results.push({
            name: it.title,
            lang: 'ru',
            source: 'OpenSubtitles',
            pageUrl: it.pageUrl
          });
        }
      } catch (e) {
        // игнорируем конкретный запрос, идем дальше
      }
    }

    // Уникализируем по pageUrl
    const uniq = [];
    const seen = new Set();
    for (const r of results) {
      if (seen.has(r.pageUrl)) continue;
      seen.add(r.pageUrl);
      uniq.push(r);
    }
    return uniq;
  }

  // Загрузка файла субтитров и подготовка blob URL
  async function fetchAndPrepareSubtitle(downloadUrl) {
    const resp = await safeFetch(downloadUrl);
    if (!resp.ok) throw new Error('Subtitle download failed');

    // В некоторых случаях OpenSubtitles отдает zip. Здесь базовая обработка только “text/*”.
    const contentType = resp.headers.get('content-type') || '';
    const buf = await resp.arrayBuffer();
    let text = '';

    if (/text\/plain|application\/octet-stream|text\/srt|text\/vtt|application\/x-subrip/i.test(contentType) || buf) {
      // Пробуем как текст (SRT/VTT/ASS)
      try {
        text = new TextDecoder('utf-8').decode(buf);
      } catch (_) {
        text = new TextDecoder('windows-1251', { fatal: false }).decode(new Uint8Array(buf));
      }
    } else {
      throw new Error('Unsupported subtitle content-type');
    }

    let vttText;
    if (/\.vtt(\?|$)/i.test(downloadUrl) || /^WEBVTT/.test(text.trim())) {
      vttText = text;
    } else {
      // SRT/ASS -> VTT. Для .ass конвертация упрощённая: зачастую плееру нужен VTT.
      // Если потребуется корректная обработка ASS, стоит подключить ass-to-vtt конвертер.
      vttText = srtToVtt(text);
    }

    const blob = new Blob([vttText], { type: 'text/vtt' });
    const blobUrl = URL.createObjectURL(blob);
    return blobUrl;
  }

  // Рендер UI в плеере Lampa
  function renderList(items, onPick) {
    const list = items.map(it => ({
      title: `${it.name} · ${it.source}`,
      subtitle: 'ru',
      callback: () => onPick(it)
    }));

    // Используем встроенный интерфейс выбора в Lampa
    Lampa.Select.show({
      title: LABEL,
      items: list,
      onBack: function () {}
    });
  }

  // Применение субтитров к текущему плееру
  function applySubtitleToPlayer(vttUrl) {
    const player = Lampa.Player || Lampa.PlayerVideo || Lampa.PlayerLite;
    // Универсальный способ: событийная шина Lampa плеера
    if (player && player.subtitles) {
      // Новый способ (если доступен)
      if (typeof player.subtitles.add === 'function') {
        player.subtitles.clear && player.subtitles.clear();
        player.subtitles.add({ label: 'Русские', language: 'ru', url: vttUrl });
        player.subtitles.enable && player.subtitles.enable('ru');
      } else {
        // Старый способ — установить напрямую трек
        Lampa.Player.listener && Lampa.Player.listener.send('subtitle', {
          label: 'Русские',
          language: 'ru',
          url: vttUrl
        });
      }
    } else {
      // fallback: событие для плеера
      Lampa.Event && Lampa.Event.emit('player_subtitle', { url: vttUrl, label: 'Русские', lang: 'ru' });
    }
    Lampa.Noty.show('Субтитры подключены: RU');
  }

  // Извлечение метаданных из контекста плеера Lampa
  function resolveMetaFromLampa(data) {
    const meta = {
      title: data?.title || data?.name || '',
      year: data?.year || data?.release_year || '',
      imdb_id: (data?.imdb_id || data?.imdb || '').replace(/^tt/, 'tt') || '',
      season: data?.season || data?.episode ? parseInt(data?.season || 0) : 0,
      episode: data?.episode ? parseInt(data?.episode) : 0,
      type: data?.type || ''
    };
    return meta;
  }

  async function openSubtitlePicker(context) {
    const meta = resolveMetaFromLampa(context);
    try {
      Lampa.Noty.show('Поиск русских субтитров…');
      const list = await searchOpenSubtitles(meta);
      if (!list.length) {
        Lampa.Noty.show('Субтитры не найдены');
        return;
      }
      renderList(list, async (picked) => {
        try {
          const dlUrl = await resolveSubtitleDownload(picked.pageUrl);
          const vttUrl = await fetchAndPrepareSubtitle(dlUrl);
          applySubtitleToPlayer(vttUrl);
        } catch (e) {
          Lampa.Noty.show('Ошибка загрузки субтитров');
          console.error('[SubsRU] download error', e);
        }
      });
    } catch (e) {
      Lampa.Noty.show('Ошибка поиска субтитров');
      console.error('[SubsRU] search error', e);
    }
  }

  // Инициализация: добавляем кнопку в плеер и пункт в "доп. меню" карточки
  function initUIHooks() {
    // Кнопка в плеере
    if (Lampa.Player && typeof Lampa.Player.addInteractive === 'function') {
      Lampa.Player.addInteractive({
        title: LABEL,
        subtitle: 'ru',
        icon: 'cc',
        onClick: () => {
          const ctx = Lampa.Player && Lampa.Player.video ? Lampa.Player.video() : Lampa.Activity && Lampa.Activity.active() || {};
          openSubtitlePicker(ctx);
        }
      });
    }

    // Кнопка в карточке фильма/серии (доп. действия)
    Lampa.Listener.follow('full', function (e) {
      if (e.type === 'button' && e.name === 'more') {
        const card = e.data || {};
        e.items.push({
          title: LABEL,
          subtitle: 'поиск ru на OpenSubtitles',
          icon: 'cc',
          onClick: () => openSubtitlePicker(card)
        });
      }
    });
  }

  function start() {
    try {
      initUIHooks();
      console.log(`[${PLUGIN_ID}] initialized`);
    } catch (e) {
      console.error(`[${PLUGIN_ID}] init error`, e);
    }
  }

  // Регистрация плагина в Lampa
  if (window.Lampa) {
    if (Lampa.Plugins && typeof Lampa.Plugins.add === 'function') {
      Lampa.Plugins.add({
        id: PLUGIN_ID,
        title: LABEL,
        description: 'Русские субтитры с OpenSubtitles без API',
        version: '0.1.0',
        author: 'you',
        onLoad: start
      });
    } else {
      // fallback, если нет менеджера плагинов
      start();
    }
  } else {
    document.addEventListener('lampa-ready', start, { once: true });
  }
})();
