(function () {
    'use strict';

    var plugin = {
        name: 'Subtitles from Stremio',
        version: '1.0',
        description: 'Подгружает субтитры из Stremio аддонов для торрентов',
        init: function () {
            Lampa.Player.listen('start', this.loadSubtitles.bind(this));
        },
        loadSubtitles: function (data) {
            if (data.source !== 'torrent') return; // Только для торрентов

            var movieName = data.title || ''; // Название для поиска
            var lang = 'rus'; // Дефолтный язык (измени, если нужно)

            // Запрос к Stremio аддону (пример: Community Subtitles)
            var stremioUrl = 'https://community-subtitles.stremio-community-subtitles.top/subtitles/' + encodeURIComponent(movieName) + '/' + lang + '.json';

            Lampa.Network.request({
                url: stremioUrl,
                method: 'GET',
                success: function (response) {
                    if (response.subtitles && response.subtitles.length > 0) {
                        var subUrl = response.subtitles[0].url; // Берём первый подходящий
                        Lampa.Player.subtitle.add({ url: subUrl, lang: lang, label: 'From Stremio' });
                    }
                },
                error: function () {} // Пропускаем ошибки молча
            });
        }
    };

    Lampa.Plugin.add(plugin);
})();
