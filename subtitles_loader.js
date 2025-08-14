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
            // Инициализация: добавляем слушатель на запуск видео
            Lampa.Player.listen('start', this.loadSubtitles.bind(this));
            // Добавляем пункт в меню
            this.addToMenu();
        },
        addToMenu: function () {
            // Добавляем раздел в правую шторку (основное меню)
            Lampa.Menu.addItem({
                title: 'Настройки субтитров (OpenSubtitles)',
                icon: 'subtitles', // Иконка, если поддерживается (можно заменить на другую)
                onClick: function () {
                    // Открываем панель настроек
                    Lampa.Params.open({
                        title: 'Настройки плагина',
                        params: plugin.params,
                        onChange: function (params) {
                            // Сохраняем изменения
                            Lampa.Storage.set('subtitles_api_key', params.api_key);
                            Lampa.Storage.set('subtitles_language', params.language);
                            Lampa.Noty.show('Настройки сохранены!');
                        }
                    });
                }
            }, 'sidebar'); // 'sidebar' указывает на правую шторку
        },
        loadSubtitles: function (data) {
            // Загружаем сохранённые настройки
            var apiKey = Lampa.Storage.get('subtitles_api_key') || this.params.api_key;
            var lang = Lampa.Storage.get('subtitles_language') || this.params.language;

            if (!apiKey) {
                Lampa.Noty.show('Введите API-ключ в настройках!');
                return;
            }

            var movieName = data.title; // Или используй IMDB ID, если доступен

            // Запрос к OpenSubtitles API для поиска субтитров
            Lampa.Network.request({
                url: 'https://api.opensubtitles.com/api/v1/subtitles',
                method: 'GET',
                headers: { 'Api-Key': apiKey },
                params: { query: movieName, languages: lang },
                success: function (response) {
                    if (response.data && response.data.length > 0) {
                        var subtitleUrl = response.data[0].attributes.files[0].file_id;
                        plugin.downloadSubtitle(subtitleUrl, apiKey);
                    } else {
                        Lampa.Noty.show('Субтитры не найдены');
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
                    var subUrl = response.link;
                    Lampa.Player.subtitle.add({ url: subUrl, lang: 'rus', label: 'OpenSubtitles' });
                    Lampa.Noty.show('Субтитры загружены!');
                }
            });
        }
    };

    Lampa.Plugin.add(plugin);
})();
