(function () {
    'use strict';

    var plugin_name = 'auto_subtitles_ru';
    var plugin_version = '1.0.0';

    // Настройка языка субтитров (русский)
    var subtitle_language = 'ru';
    var subtitle_language_name = 'Russian';

    // API Wyzie (используется SubHero)
    var WYZIE_API_URL = 'https://api.wyzie.ru/subs/search';

    var Plugin = {
        component: 'auto_subtitles',
        name: 'Русские субтитры',
        description: 'Автоматическая загрузка русских субтитров для торрентов',
        version: plugin_version,

        init: function () {
            Lampa.Listener.follow('video', this.onVideoStart.bind(this));
            console.log('[AUTO_SUBTITLES_RU] Плагин инициализирован');
        },

        onVideoStart: function (event) {
            var player = event.player;
            var video_data = event.video_data || {};

            if (video_data.source === 'torrent' || video_data.torrent) {
                this.loadSubtitles(video_data, player);
            }
        },

        loadSubtitles: function (video_data, player) {
            console.log('[AUTO_SUBTITLES_RU] Загрузка субтитров...');
            
            var tmdb_id = video_data.id || video_data.tmdb_id;
            var season = video_data.season;
            var episode = video_data.episode;

            if (!tmdb_id) {
                console.warn('[AUTO_SUBTITLES_RU] TMDB ID не найден');
                return;
            }

            this.searchSubtitles(tmdb_id, season, episode, function(subtitles) {
                if (subtitles && subtitles.length > 0) {
                    console.log('[AUTO_SUBTITLES_RU] Найдено субтитров:', subtitles.length);
                    Plugin.addSubtitlesToPlayer(subtitles, player);
                } else {
                    console.log('[AUTO_SUBTITLES_RU] Субтитры не найдены');
                }
            });
        },

        searchSubtitles: function (tmdb_id, season, episode, callback) {
            var search_params = {
                tmdb_id: tmdb_id,
                language: subtitle_language,
                type: season && episode ? 'episode' : 'movie'
            };

            if (season && episode) {
                search_params.season_number = season;
                search_params.episode_number = episode;
            }

            // Создаем URL для запроса
            var params_string = Object.keys(search_params)
                .map(key => key + '=' + encodeURIComponent(search_params[key]))
                .join('&');
            
            var request_url = WYZIE_API_URL + '?' + params_string;

            this.makeRequest(request_url, function(response) {
                try {
                    var data = typeof response === 'string' ? JSON.parse(response) : response;
                    var subtitles = [];

                    if (data && data.subtitles && Array.isArray(data.subtitles)) {
                        subtitles = data.subtitles
                            .filter(sub => sub.language === subtitle_language)
                            .map(sub => ({
                                label: subtitle_language_name + (sub.release ? ' (' + sub.release + ')' : ''),
                                src: sub.url,
                                language: subtitle_language,
                                default: true
                            }));
                    }

                    callback(subtitles);
                } catch (e) {
                    console.error('[AUTO_SUBTITLES_RU] Ошибка парсинга:', e);
                    callback([]);
                }
            }, function(error) {
                console.error('[AUTO_SUBTITLES_RU] Ошибка запроса:', error);
                callback([]);
            });
        },

        makeRequest: function (url, success, error) {
            try {
                var xhr = new XMLHttpRequest();
                xhr.open('GET', url, true);
                xhr.timeout = 10000;
                
                xhr.onreadystatechange = function () {
                    if (xhr.readyState === 4) {
                        if (xhr.status === 200) {
                            success(xhr.responseText);
                        } else {
                            error('HTTP ' + xhr.status);
                        }
                    }
                };

                xhr.ontimeout = function () {
                    error('Timeout');
                };

                xhr.onerror = function () {
                    error('Network error');
                };

                xhr.send();
            } catch (e) {
                error(e.message);
            }
        },

        addSubtitlesToPlayer: function (subtitles, player) {
            if (!player || !subtitles || subtitles.length === 0) return;

            try {
                // Для разных типов плееров в Lampa
                if (player.video && player.video.textTracks !== undefined) {
                    // HTML5 плеер
                    this.addToHTML5Player(subtitles, player);
                } else if (typeof player.addSubtitle === 'function') {
                    // Кастомный плеер Lampa
                    subtitles.forEach(function(subtitle) {
                        player.addSubtitle(subtitle);
                    });
                }

                console.log('[AUTO_SUBTITLES_RU] Субтитры добавлены в плеер');
            } catch (e) {
                console.error('[AUTO_SUBTITLES_RU] Ошибка добавления субтитров:', e);
            }
        },

        addToHTML5Player: function (subtitles, player) {
            var video = player.video;
            if (!video) return;

            subtitles.forEach(function(subtitle, index) {
                var track = document.createElement('track');
                track.kind = 'subtitles';
                track.src = subtitle.src;
                track.srclang = subtitle.language;
                track.label = subtitle.label;
                track.default = index === 0; // Первые субтитры по умолчанию

                video.appendChild(track);
            });

            // Активируем первые субтитры
            if (video.textTracks && video.textTracks.length > 0) {
                video.textTracks[0].mode = 'showing';
            }
        },

        destroy: function () {
            Lampa.Listener.remove('video', this.onVideoStart);
            console.log('[AUTO_SUBTITLES_RU] Плагин деактивирован');
        }
    };

    // Регистрация плагина
    if (typeof Lampa !== 'undefined') {
        Lampa.Plugin.add(Plugin);
        console.log('[AUTO_SUBTITLES_RU] Плагин зарегистрирован');
    }

})();
