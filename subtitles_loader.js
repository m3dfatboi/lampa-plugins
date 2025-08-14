(function () {
    'use strict';

    var plugin = {
        name: 'External Subtitles Loader',
        version: '1.0',
        description: 'Загружает субтитры из OpenSubtitles во время просмотра торрентов',
        params: {
            api_key: { type: 'string', name: 'OpenSubtitles API Key' },
            language: { type: 'string', name: 'Язык субтитров (например, rus)', default: 'rus' }
        },
        init: function () {
            // Инициализация: добавляем кнопку в плеер или хук на запуск видео
            Lampa.Player.listen('start', this.loadSubtitles.bind(this));
        },
        loadSubtitles: function (data) {
            // data — объект с информацией о видео (имя, IMDB ID и т.д.)
            var movieName = data.title; // Или используй IMDB ID, если доступен
            var apiKey = this.params.api_key;
            var lang = this.params.language;

            // Запрос к OpenSubtitles API для поиска субтитров
            Lampa.Network.request({
                url: 'https://api.opensubtitles.com/api/v1/subtitles',
                method: 'GET',
                headers: { 'Api-Key': apiKey },
                params: { query: movieName, languages: lang },
                success: function (response) {
                    if (response.data && response.data.length > 0) {
                        var subtitleUrl = response.data[0].attributes.files[0].file_id; // Получи ID файла
                        // Скачай субтитры
                        plugin.downloadSubtitle(subtitleUrl, apiKey);
                    }
                },
                error: function () {
                    Lampa.Noty.show('Ошибка поиска субтитров');
                }
            });
        },
        downloadSubtitle: function (fileId, apiKey) {
            Lampa.Network.request({
                url: 'https://api.opensubtitles.com/api/v1/download',
                method: 'POST',
                headers: { 'Api-Key': apiKey },
                data: { file_id: fileId },
                success: function (response) {
                    var subUrl = response.link; // URL для скачивания
                    // Интегрируй в плеер Lampa
                    Lampa.Player.subtitle.add({ url: subUrl, lang: 'rus', label: 'OpenSubtitles' });
                    Lampa.Noty.show('Субтитры загружены!');
                }
            });
        }
    };

    Lampa.Plugin.add(plugin);
})();
