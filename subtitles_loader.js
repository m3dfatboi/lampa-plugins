(function () {
    'use strict';

    var plugin = {
        name: 'External Subtitles Loader',
        version: '1.1',
        description: 'Загружает субтитры из OpenSubtitles во время просмотра торрентов',
        params: {
            api_key: { type: 'string', name: 'OpenSubtitles API Key', default: '' },
            language: { type: 'string', name: 'Язык субтитров (например, rus)', default: 'rus' }
        },
        init: function () {
            // Слушатель на запуск видео
            Lampa.Player.listen('start', this.loadSubtitles.bind(this));
            // Добавляем пункт в меню
            this.addSettingsToMenu();
        },
        addSettingsToMenu: function () {
            // Регистрируем пункт в основной шторке через Settings API
            Lampa.Settings.api.add({
                id: 'subtitles_settings',
                name: 'Настройки субтитров',
                icon: 'subtitles',
                onClick: function () {
                    // Открываем панель с параметрами
                    Lampa.Params.open({
                        title: 'Настройки OpenSubtitles',
                        params: plugin.params,
                        onChange: function (params) {
                            // Сохраняем в Storage
                            Lampa.Storage.set('subtitles_api_key', params.api_key);
                            Lampa.Storage.set('subtitles_language', params.language);
                            Lampa.Noty.show('Настройки сохранены! Перезапустите видео для теста.');
                        }
                    });
                }
            });
        },
        loadSubtitles: function (data) {
            // Загружаем настройки из Storage
            var apiKey = Lampa.Storage.get('subtitles_api_key') || '';
            var lang = Lampa.Storage.get('subtitles_language') || 'rus';

            if (!apiKey) {
                Lampa.Noty.show('Введите API-ключ в настройках шторки!');
                return;
            }

            if (data.source !== 'torrent') return; // Только для торрентов

            var movieName = data.title || ''; // Название фильма

            // Запрос на поиск субтитров
            Lampa.Network.request({
                url: 'https://api.opensubtitles.com/api/v1/subtitles',
                method: 'GET',
                headers: { 'Api-Key': apiKey },
                params: { query: movieName, languages: lang },
                success: function (response) {
                    if (response.data && response.data.length > 0) {
                        var fileId = response.data[0].attributes.files[0].file_id;
                        plugin.downloadSubtitle(fileId, apiKey);
                    } else {
                        Lampa.Noty.show('Субтитры не найдены для этого видео.');
                    }
                },
                error: function (err) {
                    Lampa.Noty.show('Ошибка: ' + (err.message || 'Проверьте ключ и связь.'));
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
                    if (response.link) {
                        Lampa.Player.subtitle.add({ url: response.link, lang: 'rus', label: 'OpenSubtitles' });
                        Lampa.Noty.show('Субтитры загружены успешно!');
                    }
                },
                error: function () {
                    Lampa.Noty.show('Ошибка скачивания субтитров.');
                }
            });
        }
    };

    Lampa.Plugin.add(plugin);
})();
