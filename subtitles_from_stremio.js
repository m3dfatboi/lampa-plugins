(function () {
    'use strict';

    var plugin = {
        name: 'SubHero Subtitles for Lampa',
        version: '1.0',
        description: 'Загружает русские субтитры из Stremio SubHero для торрентов',
        init: function () {
            Lampa.Player.listen('start', this.loadSubtitles.bind(this));
        },
        loadSubtitles: function (data) {
            if (data.source !== 'torrent') return; // Только для торрентов

            var movieName = data.title || ''; // Название для поиска
            var lang = 'ru'; // Русский язык (измени на 'eng' или другой, если нужно)

            // Запрос к эндпоинту SubHero (адаптировано под Stremio-формат)
            var subheroUrl = 'https://subhero.onrender.com/subtitles/movie/' + encodeURIComponent(movieName) + '.json?lang=' + lang;

            Lampa.Network.request({
                url: subheroUrl,
                method: 'GET',
                success: function (response) {
                    if (response.subtitles && response.subtitles.length > 0) {
                        var subUrl = response.subtitles[0].url; // Берём первый подходящий SRT
                        Lampa.Player.subtitle.add({ url: subUrl, lang: lang, label: 'SubHero (RU)' });
                    }
                },
                error: function () {} // Пропускаем ошибки молча
            });
        }
    };

    Lampa.Plugin.add(plugin);
})();
