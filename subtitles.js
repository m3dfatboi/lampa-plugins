(function () {
    'use strict';

    var plugin_name = 'auto_subtitles_ru';
    var plugin_version = '1.0.1';

    // Настройка языка субтитров (русский)
    var subtitle_language = 'ru';
    var subtitle_language_name = 'Russian';

    // OpenSubtitles API (бесплатный)
    var OPENSUBTITLES_API = 'https://rest.opensubtitles.org/search';

    var Plugin = {
        component: 'auto_subtitles',
        name: 'Русские субтитры',
        description: 'Автоматическая загрузка русских субтитров для фильмов и сериалов',
        version: plugin_version,

        init: function () {
            Lampa.Listener.follow('video', this.onVideoStart.bind(this));
            Lampa.Listener.follow('torrent', this.onTorrentStart.bind(this));
            console.log('[AUTO_SUBTITLES_RU] Плагин инициализирован');
        },

        onVideoStart: function (event) {
            console.log('[AUTO_SUBTITLES_RU] Video event:', event);
            var player = event.player;
            var video_data = event.video_data || event.data || {};
            
            this.loadSubtitles(video_data, player);
        },

        onTorrentStart: function (event) {
            console.log('[AUTO_SUBTITLES_RU] Torrent event:', event);
            var player = event.player;
            var video_data = event.video_data || event.data || {};
            
            this.loadSubtitles(video_data, player);
        },

        loadSubtitles: function (video_data, player) {
            console.log('[AUTO_SUBTITLES_RU] Данные видео:', video_data);
            
            if (!video_data) {
                console.warn('[AUTO_SUBTITLES_RU] Нет данных о видео');
                return;
            }

            // Определяем тип контента и параметры поиска
            var search_params = this.extractSearchParams(video_data);
            
            if (!search_params.title) {
                console.warn('[AUTO_SUBTITLES_RU] Не найдено название для поиска');
                return;
            }

            console.log('[AUTO_SUBTITLES_RU] Параметры поиска:', search_params);
            
            this.searchSubtitles(search_params, function(subtitles) {
                if (subtitles && subtitles.length > 0) {
                    console.log('[AUTO_SUBTITLES_RU] Найдено субтитров:', subtitles.length);
                    Plugin.addSubtitlesToPlayer(subtitles, player);
                } else {
                    console.log('[AUTO_SUBTITLES_RU] Субтитры не найдены для:', search_params);
                }
            });
        },

        extractSearchParams: function (video_data) {
            var params = {};
            
            // Название (приоритет: original_title, title, name)
            params.title = video_data.original_title || 
                          video_data.title || 
                          video_data.name || 
                          video_data.original_name;

            // Год
            params.year = null;
            if (video_data.release_date) {
                params.year = new Date(video_data.release_date).getFullYear();
            } else if (video_data.first_air_date) {
                params.year = new Date(video_data.first_air_date).getFullYear();
            }

            // Сериал или фильм
            params.is_series = false;
            params.season = null;
            params.episode = null;

            // Проверяем признаки сериала
            if (video_data.number_of_seasons || 
                video_data.episode_run_time || 
                video_data.first_air_date ||
                video_data.seasons ||
                (video_data.media_type && video_data.media_type === 'tv')) {
                
                params.is_series = true;
                
                // Извлекаем сезон и эпизод из разных источников
                params.season = video_data.season_number || 
                               video_data.season || 
                               (video_data.seasons && video_data.seasons.length > 0 ? 1 : null);
                
                params.episode = video_data.episode_number || 
                                video_data.episode || 
                                1; // По умолчанию первый эпизод
            }

            // IMDB ID если есть
            params.imdb_id = video_data.imdb_id || video_data.external_ids?.imdb_id;

            return params;
        },

        searchSubtitles: function (params, callback) {
            // Формируем запрос для OpenSubtitles
            var query_parts = [];
            
            // Добавляем название
            if (params.title) {
                query_parts.push(encodeURIComponent(params.title));
            }
            
            // Для сериалов добавляем сезон и эпизод
            if (params.is_series && params.season && params.episode) {
                query_parts.push('S' + String(params.season).padStart(2, '0'));
                query_parts.push('E' + String(params.episode).padStart(2, '0'));
            }
            
            // Добавляем год если есть
            if (params.year) {
                query_parts.push(params.year);
            }

            var search_query = query_parts.join(' ');
            var request_url = OPENSUBTITLES_API + '/sublanguageid-' + subtitle_language + 
                             '/query-' + encodeURIComponent(search_query);

            console.log('[AUTO_SUBTITLES_RU] Запрос:', request_url);

            this.makeRequest(request_url, function(response) {
                try {
                    var data = typeof response === 'string' ? JSON.parse(response) : response;
                    var subtitles = [];

                    if (data && Array.isArray(data)) {
                        // Фильтруем и сортируем субтитры
                        var filtered = data
                            .filter(function(sub) {
                                return sub.SubLanguageID === subtitle_language && 
                                       sub.SubDownloadLink;
                            })
                            .sort(function(a, b) {
                                // Сортируем по рейтингу и количеству скачиваний
                                var scoreA = parseFloat(a.SubRating || 0) + (parseInt(a.SubDownloadsCnt || 0) / 1000);
                                var scoreB = parseFloat(b.SubRating || 0) + (parseInt(b.SubDownloadsCnt || 0) / 1000);
                                return scoreB - scoreA;
                            });

                        // Берем топ-3 субтитра
                        subtitles = filtered.slice(0, 3).map(function(sub, index) {
                            return {
                                label: subtitle_language_name + ' #' + (index + 1) + 
                                       (sub.SubRating ? ' (' + sub.SubRating + '★)' : ''),
                                src: sub.SubDownloadLink,
                                language: subtitle_language,
                                default: index === 0
                            };
                        });
                    }

                    callback(subtitles);
                } catch (e) {
                    console.error('[AUTO_SUBTITLES_RU] Ошибка парсинга:', e);
                    // Фолбэк на прямой поиск по названию
                    Plugin.fallbackSearch(params, callback);
                }
            }, function(error) {
                console.error('[AUTO_SUBTITLES_RU] Ошибка запроса:', error);
                Plugin.fallbackSearch(params, callback);
            });
        },

        fallbackSearch: function (params, callback) {
            // Альтернативный поиск через другие API
            var alternative_urls = [
                'https://api.opensubtitles.com/api/v1/subtitles?query=' + 
                encodeURIComponent(params.title) + '&languages=' + subtitle_language,
                
                'https://www.opensubtitles.org/api/v1/subtitles?query=' + 
                encodeURIComponent(params.title + (params.is_series ? ' S' + 
                String(params.season || 1).padStart(2, '0') + 'E' + 
                String(params.episode || 1).padStart(2, '0') : ''))
            ];

            this.tryAlternativeAPIs(alternative_urls, 0, callback);
        },

        tryAlternativeAPIs: function (urls, index, callback) {
            if (index >= urls.length) {
                console.log('[AUTO_SUBTITLES_RU] Все альтернативные источники недоступны');
                callback([]);
                return;
            }

            var url = urls[index];
            this.makeRequest(url, function(response) {
                try {
                    var data = typeof response === 'string' ? JSON.parse(response) : response;
                    if (data && (data.data || data.length > 0)) {
                        var subtitles = [{
                            label: subtitle_language_name,
                            src: url,
                            language: subtitle_language,
                            default: true
                        }];
                        callback(subtitles);
                    } else {
                        Plugin.tryAlternativeAPIs(urls, index + 1, callback);
                    }
                } catch (e) {
                    Plugin.tryAlternativeAPIs(urls, index + 1, callback);
                }
            }, function(error) {
                Plugin.tryAlternativeAPIs(urls, index + 1, callback);
            });
        },

        makeRequest: function (url, success, error) {
            try {
                var xhr = new XMLHttpRequest();
                xhr.open('GET', url, true);
                xhr.timeout = 15000;
                
                // Добавляем заголовки для обхода CORS
                xhr.setRequestHeader('User-Agent', 'Lampa v' + (Lampa.Platform?.version || '1.0'));
                
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
                var self = this;
                
                // Задержка для полной загрузки плеера
                setTimeout(function() {
                    if (player.video && player.video.textTracks !== undefined) {
                        self.addToHTML5Player(subtitles, player);
                    } else if (typeof player.addSubtitle === 'function') {
                        subtitles.forEach(function(subtitle) {
                            player.addSubtitle(subtitle);
                        });
                    } else if (player.setSubtitles) {
                        player.setSubtitles(subtitles);
                    }
                    
                    console.log('[AUTO_SUBTITLES_RU] Субтитры добавлены в плеер');
                }, 1000);

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
                track.default = index === 0;

                video.appendChild(track);
            });

            // Активируем первые субтитры с задержкой
            setTimeout(function() {
                if (video.textTracks && video.textTracks.length > 0) {
                    for (var i = 0; i < video.textTracks.length; i++) {
                        video.textTracks[i].mode = i === 0 ? 'showing' : 'hidden';
                    }
                }
            }, 500);
        },

        destroy: function () {
            Lampa.Listener.remove('video', this.onVideoStart);
            Lampa.Listener.remove('torrent', this.onTorrentStart);
            console.log('[AUTO_SUBTITLES_RU] Плагин деактивирован');
        }
    };

    // Регистрация плагина
    if (typeof Lampa !== 'undefined') {
        Lampa.Plugin.add(Plugin);
        console.log('[AUTO_SUBTITLES_RU] Плагин зарегистрирован');
    }

})();
