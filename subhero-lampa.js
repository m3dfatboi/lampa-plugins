(function () {
    'use strict';

    // === Настройки ===
    const LANGUAGES = ['ru', 'en']; // фильтр по языкам
    const OPENSUBTITLES_API_KEY = 'ВАШ_API_KEY'; // получи на opensubtitles.org
    const SUBDL_API = 'https://api.subdl.com/subtitle/search';
    const SUBF2M_API = 'https://subf2m.co/api/search';

    Lampa.Plugin.create('SubHero', {
        title: 'SubHero for Lampa',
        icon: 'subtitle',
        description: 'Мультиисточниковый поиск субтитров с фильтрацией',
        version: '1.0',
    }, () => {
        
        /**
         * Универсальная функция загрузки субтитров из всех источников
         */
        async function fetchSubtitles(query) {
            const results = [];

            // OpenSubtitles
            try {
                let res = await fetch(`https://api.opensubtitles.com/api/v1/subtitles?query=${encodeURIComponent(query)}`, {
                    headers: { 'Api-Key': OPENSUBTITLES_API_KEY }
                });
                let data = await res.json();
                data.data
                    .filter(sub => LANGUAGES.includes(sub.attributes.language))
                    .forEach(sub => results.push({
                        source: 'OpenSubtitles',
                        lang: sub.attributes.language,
                        url: sub.attributes.url
                    }));
            } catch (e) {
                console.error('OS error', e);
            }

            // SubDL
            try {
                let res = await fetch(`${SUBDL_API}?q=${encodeURIComponent(query)}`);
                let data = await res.json();
                data.subtitles
                    .filter(sub => LANGUAGES.includes(sub.lang))
                    .forEach(sub => results.push({
                        source: 'SubDL',
                        lang: sub.lang,
                        url: sub.url
                    }));
            } catch (e) {
                console.error('SubDL error', e);
            }

            // Subf2m
            try {
                let res = await fetch(`${SUBF2M_API}?q=${encodeURIComponent(query)}`);
                let data = await res.json();
                data.subtitles
                    .filter(sub => LANGUAGES.includes(sub.lang))
                    .forEach(sub => results.push({
                        source: 'Subf2m',
                        lang: sub.lang,
                        url: sub.url
                    }));
            } catch (e) {
                console.error('Subf2m error', e);
            }

            return results;
        }

        // Добавляем кнопку "Субтитры"
        Lampa.Controller.add('subhero', {
            toggle: () => {
                Lampa.Controller.collectionSet([], 'subhero');
            },
            render: (query) => {
                fetchSubtitles(query).then(subs => {
                    let items = subs.map(s => ({
                        title: `${s.source} [${s.lang}]`,
                        subtitle: s.url,
                        onclick: () => Lampa.Player.subtitles(s.url)
                    }));
                    Lampa.Controller.collectionSet(items, 'subhero');
                });
            },
            back: () => Lampa.Controller.toggle('content')
        });
    });
})();
