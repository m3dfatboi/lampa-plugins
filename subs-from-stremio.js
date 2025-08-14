(function () {
    'use strict';

    var plugin_name = 'auto_subtitles_ru';
    var plugin_version = '1.0.2';

    var Plugin = {
        component: 'auto_subtitles',
        name: 'Русские субтитры',
        description: 'Автоматическая загрузка русских субтитров',
        version: plugin_version,

        init: function () {
            try {
                // Более безопасная инициализация
                if (typeof Lampa !== 'undefined' && Lampa.Activity) {
                    this.startPlugin();
                } else {
                    console.warn('[AUTO_SUBTITLES_RU] Lampa не готов, повторная попытка...');
                    setTimeout(this.init.bind(this), 1000);
                }
            } catch (error) {
                console.error('[AUTO_SUBTITLES_RU] Ошибка инициализации:', error);
            }
        },

        startPlugin: function () {
            var self = this;
            
            // Перехватываем создание плеера
            var originalPlayer = Lampa.Player;
            if (originalPlayer && originalPlayer.play) {
                var originalPlay = originalPlayer.play;
                
                originalPlayer.play = function (params) {
                    console.log('[AUTO_SUBTITLES_RU] Перехвачен запуск плеера:', params);
                    
                    // Запускаем оригинальный плеер
                    var result = originalPlay.call(this, params);
                    
                    // Загружаем субтитры с задержкой
                    setTimeout(function () {
                        self.loadSubtitlesForVideo(params);
                    }, 2000);
                    
                    return result;
                };
            }

            // Альтернативный способ через события активности
            if (Lampa.Activity && Lampa.Activity.active) {
                Lampa.Activity.listener.follow('activity', function (e) {
                    if (e.type === 'start' && e.component === 'player') {
                        setTimeout(function () {
                            self.checkActivePlayer();
                        }, 3000);
                    }
                });
            }

            console.log('[AUTO_SUBTITLES_RU] Плагин запущен');
        },

        checkActivePlayer: function () {
            try {
                // Ищем активный плеер в DOM
                var videoElements = document.querySelectorAll('video');
                if (videoElements.length > 0) {
                    var video = videoElements[videoElements.length - 1]; // Последний добавленный
                    if (video && !video.hasAttribute('data-subtitles-loaded')) {
                        this.addSubtitlesToVideoElement(video);
                        video.setAttribute('data-subtitles-loaded', 'true');
                    }
                }
            } catch (error) {
                console.error('[AUTO_SUBTITLES_RU] Ошибка проверки плеера:', error);
            }
        },

        loadSubtitlesForVideo: function (params) {
            try {
                var card = params && params.card;
                if (!card) {
                    console.warn('[AUTO_SUBTITLES_RU] Нет данных карточки');
                    return;
                }

                var searchQuery = this.buildSearchQuery(card);
                if (searchQuery) {
                    this.searchSubtitles(searchQuery);
                }
            } catch (error) {
                console.error('[AUTO_SUBTITLES_RU] Ошибка загрузки субтитров:', error);
            }
        },

        buildSearchQuery: function (card) {
            var title = card.original_title || card.title || card.name;
            if (!title) return null;

            var query = title;
            
            // Добавляем год если есть
            if (card.release_date) {
                var year = new Date(card.release_date).getFullYear();
                query += ' ' + year;
            }

            // Для сериалов добавляем сезон и эпизод
            if (card.seasons || card.number_of_seasons) {
                // Пытаемся определить текущий сезон/эпизод
                var season = 1; // По умолчанию
                var episode = 1; // По умолчанию
                
                query += ' S' + String(season).padStart(2, '0') + 'E' + String(episode).padStart(2, '0');
            }

            return query;
        },

        searchSubtitles: function (query) {
            // Используем более простой и надёжный источник
            var urls = [
                'https://www.opensubtitles.org/api/v1/subtitles?query=' + encodeURIComponent(query) + '&languages=ru',
                'https://api.opensubtitles.com/api/v1/subtitles?query=' + encodeURIComponent(query) + '&languages=ru'
            ];

            this.trySubtitleSources(urls, 0);
        },

        trySubtitleSources: function (urls, index) {
            if (index >= urls.length) {
                console.log('[AUTO_SUBTITLES_RU] Субтитры не найдены во всех источниках');
                return;
            }

            var self = this;
            var url = urls[index];

            this
