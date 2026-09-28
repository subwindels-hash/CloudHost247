/**
 * Phone Services - client area application.
 *
 * Talks exclusively to the module's REST API (same origin, session
 * authenticated) and drives the WebRTC softphone when the active voice
 * provider advertises browser calling.
 *
 * Bootstrapped from the client templates via:
 *   window.psConfig     = { apiBase, csrf, currency }
 *   window.psWebRtcConfig = { token, identity, provider, ttl }
 *
 * No build step, no framework - ES5-compatible so it runs in every browser
 * WHMCS supports.
 */
(function (window, document) {
    'use strict';

    var PhoneServices = window.PhoneServices || {};
    window.PhoneServices = PhoneServices;

    var config = window.psConfig || {};
    var API_BASE = config.apiBase || 'modules/addons/phoneservices/api/rest.php';

    // ------------------------------------------------------------------
    // Small helpers
    // ------------------------------------------------------------------

    function $(selector, scope) {
        return (scope || document).querySelector(selector);
    }

    function $$(selector, scope) {
        return Array.prototype.slice.call((scope || document).querySelectorAll(selector));
    }

    function escapeHtml(value) {
        return String(value === null || value === undefined ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    /**
     * Thin fetch wrapper that always resolves with the decoded envelope and
     * rejects with an Error carrying the API message.
     */
    function api(method, path, body) {
        var options = {
            method: method,
            credentials: 'same-origin',
            headers: {
                'Accept': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            }
        };

        if (config.csrf) {
            options.headers['X-CSRF-Token'] = config.csrf;
        }

        if (body !== undefined && body !== null) {
            options.headers['Content-Type'] = 'application/json';
            options.body = JSON.stringify(body);
        }

        return window.fetch(API_BASE + path, options).then(function (response) {
            return response.json().catch(function () {
                throw new Error('The server returned an unreadable response.');
            }).then(function (payload) {
                if (!response.ok || payload.success === false) {
                    throw new Error((payload && payload.error) || 'Request failed (' + response.status + ')');
                }

                return payload.data !== undefined ? payload.data : payload;
            });
        });
    }

    PhoneServices.api = api;

    function notify(element, type, message) {
        if (!element) {
            return;
        }

        element.className = 'alert alert-' + type;
        element.textContent = message;
        element.style.display = '';
    }

    function setBusy(button, busy, busyLabel) {
        if (!button) {
            return;
        }

        if (busy) {
            button.dataset.psLabel = button.innerHTML;
            button.disabled = true;
            button.innerHTML = escapeHtml(busyLabel || 'Working…');
        } else {
            button.disabled = false;

            if (button.dataset.psLabel) {
                button.innerHTML = button.dataset.psLabel;
                delete button.dataset.psLabel;
            }
        }
    }

    function formatDuration(seconds) {
        seconds = parseInt(seconds, 10) || 0;
        var minutes = Math.floor(seconds / 60);

        return (minutes < 10 ? '0' : '') + minutes + ':' + (seconds % 60 < 10 ? '0' : '') + (seconds % 60);
    }

    // ==================================================================
    // WebRTC softphone
    // ==================================================================

    var Dialer = {
        device: null,
        connection: null,
        callId: null,
        timer: null,
        elapsed: 0,

        elements: {},

        init: function () {
            var root = $('#ps-dialer');

            if (!root) {
                return;
            }

            this.elements = {
                root: root,
                status: $('#webrtc-status'),
                from: $('#from-number'),
                to: $('#to-number'),
                call: $('#btn-call'),
                hangup: $('#btn-hangup'),
                mute: $('#btn-mute'),
                timer: $('#ps-call-timer'),
                keypad: $('#ps-keypad'),
                log: $('#ps-call-log')
            };

            this.bindKeypad();
            this.loadNumbers();

            var self = this;

            if (this.elements.call) {
                this.elements.call.addEventListener('click', function () {
                    self.placeCall();
                });
            }

            if (this.elements.hangup) {
                this.elements.hangup.addEventListener('click', function () {
                    self.hangUp();
                });
            }

            if (this.elements.mute) {
                this.elements.mute.addEventListener('click', function () {
                    self.toggleMute();
                });
            }

            this.setupDevice();
        },

        bindKeypad: function () {
            var self = this;

            $$('button[data-digit]', this.elements.keypad || document).forEach(function (button) {
                button.addEventListener('click', function () {
                    var digit = button.getAttribute('data-digit');

                    if (self.connection && self.connection.sendDigits) {
                        self.connection.sendDigits(digit);
                        return;
                    }

                    if (self.elements.to) {
                        self.elements.to.value += digit;
                    }
                });
            });
        },

        loadNumbers: function () {
            var select = this.elements.from;

            if (!select) {
                return;
            }

            api('GET', '/api/numbers').then(function (data) {
                var numbers = data.numbers || data || [];

                select.innerHTML = '';

                if (!numbers.length) {
                    select.innerHTML = '<option value="">No numbers available</option>';
                    return;
                }

                numbers.forEach(function (number) {
                    if (number.status !== 'active') {
                        return;
                    }

                    var option = document.createElement('option');
                    option.value = number.number;
                    option.textContent = number.number + ' (' + number.country + ')';
                    select.appendChild(option);
                });
            }).catch(function () {
                select.innerHTML = '<option value="">Could not load numbers</option>';
            });
        },

        /**
         * Initialise the provider SDK. Currently Twilio Voice is the only
         * browser SDK we load; any other provider degrades gracefully to
         * server-initiated (click-to-call) dialling.
         */
        setupDevice: function () {
            var self = this;
            var webRtc = window.psWebRtcConfig || {};

            if (!webRtc.token) {
                notify(this.elements.status, 'warning', 'Browser calling is unavailable. Calls will be bridged through your phone instead.');
                this.enableCallButton();
                return;
            }

            if (webRtc.provider !== 'twilio' || typeof window.Twilio === 'undefined' || !window.Twilio.Device) {
                notify(this.elements.status, 'info', 'Click-to-call ready.');
                this.enableCallButton();
                return;
            }

            try {
                this.device = new window.Twilio.Device(webRtc.token, {
                    codecPreferences: ['opus', 'pcmu'],
                    enableRingingState: true
                });

                this.device.on('registered', function () {
                    notify(self.elements.status, 'success', 'Softphone ready.');
                    self.enableCallButton();
                });

                this.device.on('error', function (error) {
                    notify(self.elements.status, 'danger', 'Softphone error: ' + error.message);
                });

                this.device.on('incoming', function (connection) {
                    self.handleIncoming(connection);
                });

                if (this.device.register) {
                    this.device.register();
                } else {
                    this.enableCallButton();
                }

                // Refresh the token shortly before it expires.
                window.setInterval(function () {
                    self.refreshToken();
                }, Math.max(60, (webRtc.ttl || 3600) - 120) * 1000);
            } catch (error) {
                notify(this.elements.status, 'warning', 'Softphone could not start: ' + error.message);
                this.enableCallButton();
            }
        },

        refreshToken: function () {
            var self = this;

            api('GET', '/api/voip/token').then(function (data) {
                if (data.token && self.device && self.device.updateToken) {
                    self.device.updateToken(data.token);
                }
            }).catch(function () {
                /* a failed refresh is non-fatal; the next call will re-auth */
            });
        },

        enableCallButton: function () {
            if (this.elements.call) {
                this.elements.call.disabled = false;
            }
        },

        placeCall: function () {
            var self = this;
            var to = (this.elements.to && this.elements.to.value || '').trim();
            var from = this.elements.from ? this.elements.from.value : '';

            if (!/^\+?[1-9]\d{6,14}$/.test(to.replace(/[\s()-]/g, ''))) {
                notify(this.elements.status, 'danger', 'Enter a valid number in international format, e.g. +15551234567.');
                return;
            }

            setBusy(this.elements.call, true, 'Dialling…');

            api('POST', '/api/voip/call', { from: from, to: to }).then(function (data) {
                self.callId = data.call_id || null;
                self.onCallStarted();

                if (self.device && self.device.connect && data.use_browser !== false) {
                    Promise.resolve(self.device.connect({ params: { To: to, From: from } }))
                        .then(function (connection) {
                            self.attachConnection(connection);
                        })
                        .catch(function (error) {
                            notify(self.elements.status, 'danger', error.message);
                        });
                } else {
                    notify(self.elements.status, 'info', 'Connecting your phone to ' + to + '…');
                }
            }).catch(function (error) {
                setBusy(self.elements.call, false);
                notify(self.elements.status, 'danger', error.message);
            });
        },

        attachConnection: function (connection) {
            var self = this;
            this.connection = connection;

            connection.on('accept', function () {
                notify(self.elements.status, 'success', 'Connected.');
            });

            connection.on('disconnect', function () {
                self.onCallEnded();
            });

            connection.on('cancel', function () {
                self.onCallEnded();
            });

            connection.on('error', function (error) {
                notify(self.elements.status, 'danger', error.message);
                self.onCallEnded();
            });
        },

        handleIncoming: function (connection) {
            var self = this;
            var from = (connection.parameters && connection.parameters.From) || 'Unknown caller';

            notify(this.elements.status, 'info', 'Incoming call from ' + from);

            if (window.confirm('Incoming call from ' + from + '. Answer?')) {
                connection.accept();
                this.attachConnection(connection);
                this.onCallStarted();
            } else {
                connection.reject();
            }
        },

        toggleMute: function () {
            if (!this.connection || !this.connection.mute) {
                return;
            }

            var muted = this.connection.isMuted && this.connection.isMuted();
            this.connection.mute(!muted);
            this.elements.mute.classList.toggle('active', !muted);
        },

        hangUp: function () {
            var self = this;

            if (this.connection && this.connection.disconnect) {
                this.connection.disconnect();
            }

            if (this.callId) {
                api('POST', '/api/voip/call/' + encodeURIComponent(this.callId) + '/end').catch(function () {});
            }

            this.onCallEnded();
            notify(self.elements.status, 'info', 'Call ended.');
        },

        onCallStarted: function () {
            var self = this;
            this.elapsed = 0;

            setBusy(this.elements.call, false);

            if (this.elements.call) {
                this.elements.call.style.display = 'none';
            }
            if (this.elements.hangup) {
                this.elements.hangup.style.display = '';
            }

            this.timer = window.setInterval(function () {
                self.elapsed++;

                if (self.elements.timer) {
                    self.elements.timer.textContent = formatDuration(self.elapsed);
                }
            }, 1000);
        },

        onCallEnded: function () {
            window.clearInterval(this.timer);
            this.timer = null;
            this.connection = null;
            this.callId = null;

            if (this.elements.call) {
                this.elements.call.style.display = '';
                setBusy(this.elements.call, false);
            }
            if (this.elements.hangup) {
                this.elements.hangup.style.display = 'none';
            }
            if (this.elements.timer) {
                this.elements.timer.textContent = '00:00';
            }

            this.refreshCallLog();
        },

        refreshCallLog: function () {
            var tbody = this.elements.log;

            if (!tbody) {
                return;
            }

            api('GET', '/api/voip/calls?limit=25').then(function (data) {
                var calls = data.calls || data || [];

                tbody.innerHTML = calls.map(function (call) {
                    return '<tr>' +
                        '<td>' + escapeHtml(call.from_number) + '</td>' +
                        '<td>' + escapeHtml(call.to_number) + '</td>' +
                        '<td><span class="label label-default">' + escapeHtml(call.status) + '</span></td>' +
                        '<td>' + escapeHtml(formatDuration(call.duration)) + '</td>' +
                        '<td>' + escapeHtml(call.cost) + '</td>' +
                        '<td>' + escapeHtml(call.started_at) + '</td>' +
                        '</tr>';
                }).join('');
            }).catch(function () {});
        }
    };

    // ==================================================================
    // Numbers
    // ==================================================================

    var Numbers = {
        init: function () {
            var form = $('#ps-number-search');

            if (!form) {
                return;
            }

            var self = this;

            form.addEventListener('submit', function (event) {
                event.preventDefault();
                self.search(form);
            });

            $$('[data-number-action]').forEach(function (button) {
                button.addEventListener('click', function () {
                    self.lifecycle(button);
                });
            });
        },

        search: function (form) {
            var results = $('#ps-number-results');
            var status = $('#ps-number-status');
            var button = $('button[type="submit"]', form);
            var country = $('[name="country"]', form).value;
            var type = $('[name="type"]', form).value;

            setBusy(button, true, 'Searching…');
            results.innerHTML = '';

            api('GET', '/api/numbers/search?country=' + encodeURIComponent(country) + '&type=' + encodeURIComponent(type))
                .then(function (data) {
                    setBusy(button, false);
                    var numbers = data.numbers || data || [];

                    if (!numbers.length) {
                        notify(status, 'warning', 'No numbers available for that selection.');
                        return;
                    }

                    notify(status, 'success', numbers.length + ' number(s) available.');

                    results.innerHTML = numbers.map(function (number) {
                        return '<tr>' +
                            '<td>' + escapeHtml(number.number) + '</td>' +
                            '<td>' + escapeHtml(number.country) + '</td>' +
                            '<td>' + escapeHtml(number.type || '') + '</td>' +
                            '<td>' + escapeHtml(number.monthly_price || number.price || '') + '</td>' +
                            '<td class="text-right"><button class="btn btn-xs btn-primary" data-purchase="' +
                                escapeHtml(number.number) + '" data-country="' + escapeHtml(number.country) +
                                '" data-type="' + escapeHtml(number.type || type) + '">Buy</button></td>' +
                            '</tr>';
                    }).join('');

                    $$('[data-purchase]', results).forEach(function (button) {
                        button.addEventListener('click', function () {
                            Numbers.purchase(button, status);
                        });
                    });
                })
                .catch(function (error) {
                    setBusy(button, false);
                    notify(status, 'danger', error.message);
                });
        },

        purchase: function (button, status) {
            setBusy(button, true, 'Buying…');

            api('POST', '/api/numbers/purchase', {
                number: button.getAttribute('data-purchase'),
                country: button.getAttribute('data-country'),
                type: button.getAttribute('data-type')
            }).then(function () {
                notify(status, 'success', 'Number purchased. Reloading…');
                window.setTimeout(function () {
                    window.location.reload();
                }, 1200);
            }).catch(function (error) {
                setBusy(button, false);
                notify(status, 'danger', error.message);
            });
        },

        lifecycle: function (button) {
            var action = button.getAttribute('data-number-action');
            var id = button.getAttribute('data-number-id');
            var status = $('#ps-number-status');

            if (action === 'release' && !window.confirm('Releasing this number is permanent. Continue?')) {
                return;
            }

            setBusy(button, true);

            api('POST', '/api/numbers/' + encodeURIComponent(id) + '/' + action).then(function () {
                window.location.reload();
            }).catch(function (error) {
                setBusy(button, false);
                notify(status, 'danger', error.message);
            });
        }
    };

    // ==================================================================
    // Messaging
    // ==================================================================

    var Messaging = {
        init: function () {
            var form = $('#ps-sms-form');

            if (!form) {
                return;
            }

            var body = $('#ps-sms-body');
            var counter = $('#ps-sms-counter');

            if (body && counter) {
                var update = function () {
                    var length = body.value.length;
                    var segments = length === 0 ? 0 : Math.ceil(length / (/[^\u0000-\u007F]/.test(body.value) ? 70 : 160));
                    counter.textContent = length + ' characters · ' + segments + ' segment(s)';
                };

                body.addEventListener('input', update);
                update();
            }

            form.addEventListener('submit', function (event) {
                event.preventDefault();
                Messaging.send(form);
            });
        },

        send: function (form) {
            var status = $('#ps-sms-status');
            var button = $('button[type="submit"]', form);
            var channel = ($('[name="channel"]', form) || {}).value || 'sms';

            var payload = {
                from: ($('[name="from"]', form) || {}).value || '',
                to: ($('[name="to"]', form) || {}).value || '',
                message: ($('[name="message"]', form) || {}).value || ''
            };

            if (!payload.to || !payload.message) {
                notify(status, 'danger', 'A recipient and a message are required.');
                return;
            }

            setBusy(button, true, 'Sending…');

            api('POST', channel === 'whatsapp' ? '/api/sms/whatsapp' : '/api/sms/send', payload)
                .then(function () {
                    setBusy(button, false);
                    notify(status, 'success', 'Message queued for delivery.');
                    form.reset();
                })
                .catch(function (error) {
                    setBusy(button, false);
                    notify(status, 'danger', error.message);
                });
        }
    };

    // ==================================================================
    // eSIM
    // ==================================================================

    var Esim = {
        init: function () {
            if (!$('.phoneservices-client-esim')) {
                return;
            }

            $$('[data-esim-buy]').forEach(function (button) {
                button.addEventListener('click', function () {
                    Esim.purchase(button);
                });
            });

            $$('[data-esim-qr]').forEach(function (button) {
                button.addEventListener('click', function () {
                    Esim.showQr(button.getAttribute('data-esim-qr'));
                });
            });

            $$('[data-esim-usage]').forEach(function (button) {
                button.addEventListener('click', function () {
                    Esim.refreshUsage(button);
                });
            });
        },

        purchase: function (button) {
            var status = $('#ps-esim-status');

            setBusy(button, true, 'Purchasing…');

            api('POST', '/api/esim/purchase', { plan_id: button.getAttribute('data-esim-buy') })
                .then(function () {
                    notify(status, 'success', 'eSIM purchased. Reloading…');
                    window.setTimeout(function () {
                        window.location.reload();
                    }, 1200);
                })
                .catch(function (error) {
                    setBusy(button, false);
                    notify(status, 'danger', error.message);
                });
        },

        showQr: function (esimId) {
            var target = $('#ps-esim-qr');
            var status = $('#ps-esim-status');

            if (!target) {
                return;
            }

            api('GET', '/api/esim/' + encodeURIComponent(esimId) + '/qrcode').then(function (data) {
                var html = '';

                if (data.qr_base64) {
                    html += '<img src="' + escapeHtml(data.qr_base64) + '" alt="eSIM QR code" class="img-responsive ps-qr">';
                } else if (data.qr_code_url) {
                    html += '<img src="' + escapeHtml(data.qr_code_url) + '" alt="eSIM QR code" class="img-responsive ps-qr">';
                }

                if (data.manual_entry) {
                    html += '<dl class="dl-horizontal ps-manual-entry">' +
                        '<dt>SM-DP+ address</dt><dd><code>' + escapeHtml(data.manual_entry.smdp_address) + '</code></dd>' +
                        '<dt>Activation code</dt><dd><code>' + escapeHtml(data.manual_entry.activation_code) + '</code></dd>' +
                        '</dl>';
                }

                target.innerHTML = html || '<p class="text-muted">No provisioning data available yet.</p>';
            }).catch(function (error) {
                notify(status, 'danger', error.message);
            });
        },

        refreshUsage: function (button) {
            var esimId = button.getAttribute('data-esim-usage');
            var cell = $('#ps-esim-usage-' + esimId);

            setBusy(button, true, '…');

            api('GET', '/api/esim/' + encodeURIComponent(esimId) + '/usage').then(function (data) {
                setBusy(button, false);

                if (cell) {
                    cell.textContent = (data.used_mb || 0) + ' MB' + (data.total_mb ? ' / ' + data.total_mb + ' MB' : '');
                }
            }).catch(function () {
                setBusy(button, false);
            });
        }
    };

    // ==================================================================
    // Usage dashboard
    // ==================================================================

    var Usage = {
        init: function () {
            var canvas = $('#ps-usage-chart');
            var series = window.psUsageSeries || [];

            if (!canvas || typeof window.Chart === 'undefined' || !series.length) {
                return;
            }

            new window.Chart(canvas.getContext('2d'), {
                type: 'line',
                data: {
                    labels: series.map(function (row) { return row.date; }),
                    datasets: [
                        {
                            label: 'Call minutes',
                            data: series.map(function (row) { return row.call || 0; }),
                            borderColor: '#2f80ed',
                            backgroundColor: 'rgba(47,128,237,0.1)'
                        },
                        {
                            label: 'Messages',
                            data: series.map(function (row) { return row.sms || 0; }),
                            borderColor: '#27ae60',
                            backgroundColor: 'rgba(39,174,96,0.1)'
                        },
                        {
                            label: 'Data (MB)',
                            data: series.map(function (row) { return row.data || 0; }),
                            borderColor: '#f2994a',
                            backgroundColor: 'rgba(242,153,74,0.1)'
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: { y: { beginAtZero: true } }
                }
            });
        }
    };

    // ------------------------------------------------------------------
    // Boot
    // ------------------------------------------------------------------

    PhoneServices.init = function () {
        if (typeof window.fetch !== 'function') {
            return; // unsupported browser: server-rendered pages still work
        }

        Dialer.init();
        Numbers.init();
        Messaging.init();
        Esim.init();
        Usage.init();
    };

    PhoneServices.Dialer = Dialer;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            PhoneServices.init();
        });
    } else {
        PhoneServices.init();
    }
}(window, document));
