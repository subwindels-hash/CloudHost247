/**
 * CloudHost247 Passkey — browser helper.
 *
 * Vanilla ES5-compatible JavaScript, no framework and no bundler, matching
 * the rest of the CloudHost247 client-area assets. Everything is optional
 * progressive enhancement: if WebAuthn is unavailable the passkey controls
 * simply never appear and the normal password form keeps working.
 */
(function (window, document) {
    'use strict';

    var config = window.CloudHost247PasskeyConfig || {};
    var endpoint = config.endpoint || 'modules/addons/cloudhost247_passkey/api.php';

    /** Feature detection — the single source of truth for showing any UI. */
    function supported() {
        return !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create);
    }

    function conditionalUiSupported() {
        return supported() && typeof window.PublicKeyCredential.isConditionalMediationAvailable === 'function';
    }

    // ---------------------------------------------------------------- encoding
    function b64urlToBuffer(value) {
        var padded = String(value).replace(/-/g, '+').replace(/_/g, '/');
        while (padded.length % 4) { padded += '='; }
        var binary = window.atob(padded);
        var bytes = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; i++) { bytes[i] = binary.charCodeAt(i); }
        return bytes.buffer;
    }

    function bufferToB64url(buffer) {
        var bytes = new Uint8Array(buffer);
        var binary = '';
        for (var i = 0; i < bytes.length; i++) { binary += String.fromCharCode(bytes[i]); }
        return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    // ------------------------------------------------------------------- api
    function call(action, payload) {
        var body = payload || {};
        body.action = action;
        body.csrf = config.token || '';
        return window.fetch(endpoint, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify(body)
        }).then(function (response) {
            return response.json().catch(function () {
                throw new Error('The server returned an unreadable response.');
            }).then(function (data) {
                if (!data || data.success !== true) {
                    var error = new Error((data && data.message) || 'The request could not be completed.');
                    error.reason = (data && data.reason) || 'server_error';
                    throw error;
                }
                return data;
            });
        });
    }

    // ------------------------------------------------------------ ceremonies
    function toCreationOptions(options) {
        var publicKey = {
            rp: options.rp,
            user: {
                id: b64urlToBuffer(options.user.id),
                name: options.user.name,
                displayName: options.user.displayName
            },
            challenge: b64urlToBuffer(options.challenge),
            pubKeyCredParams: options.pubKeyCredParams,
            timeout: options.timeout,
            attestation: options.attestation,
            authenticatorSelection: options.authenticatorSelection,
            excludeCredentials: (options.excludeCredentials || []).map(function (item) {
                return { type: item.type, id: b64urlToBuffer(item.id), transports: item.transports };
            })
        };
        if (options.extensions) { publicKey.extensions = options.extensions; }
        return publicKey;
    }

    function toRequestOptions(options) {
        return {
            challenge: b64urlToBuffer(options.challenge),
            timeout: options.timeout,
            rpId: options.rpId,
            userVerification: options.userVerification,
            allowCredentials: (options.allowCredentials || []).map(function (item) {
                return { type: item.type, id: b64urlToBuffer(item.id), transports: item.transports };
            })
        };
    }

    function serialiseAttestation(credential) {
        var transports = [];
        if (credential.response.getTransports) {
            try { transports = credential.response.getTransports() || []; } catch (e) { transports = []; }
        }
        return {
            id: credential.id,
            rawId: bufferToB64url(credential.rawId),
            type: credential.type,
            transports: transports,
            response: {
                clientDataJSON: bufferToB64url(credential.response.clientDataJSON),
                attestationObject: bufferToB64url(credential.response.attestationObject)
            }
        };
    }

    function serialiseAssertion(credential) {
        return {
            id: credential.id,
            rawId: bufferToB64url(credential.rawId),
            type: credential.type,
            response: {
                clientDataJSON: bufferToB64url(credential.response.clientDataJSON),
                authenticatorData: bufferToB64url(credential.response.authenticatorData),
                signature: bufferToB64url(credential.response.signature),
                userHandle: credential.response.userHandle ? bufferToB64url(credential.response.userHandle) : ''
            }
        };
    }

    /** Turns a WebAuthn DOMException into wording a customer can act on. */
    function describe(error) {
        if (!error) { return 'Something went wrong. Please try again.'; }
        if (error.name === 'NotAllowedError') {
            return 'The request was cancelled or timed out. Please try again.';
        }
        if (error.name === 'InvalidStateError') {
            return 'This device already has a passkey for your account.';
        }
        if (error.name === 'SecurityError') {
            return 'Passkeys require a secure (HTTPS) connection on this site.';
        }
        if (error.name === 'AbortError') {
            return 'The passkey prompt was dismissed.';
        }
        return error.message || 'Something went wrong. Please try again.';
    }

    // ------------------------------------------------------------ public api
    var api = {
        supported: supported,
        conditionalUiSupported: conditionalUiSupported,
        describe: describe,

        register: function (deviceName) {
            if (!supported()) { return Promise.reject(new Error('This browser does not support passkeys.')); }
            return call('register_options', {}).then(function (data) {
                return navigator.credentials.create({ publicKey: toCreationOptions(data.options) });
            }).then(function (credential) {
                if (!credential) { throw new Error('No passkey was created.'); }
                return call('register_verify', {
                    credential: serialiseAttestation(credential),
                    device_name: deviceName || ''
                });
            });
        },

        authenticate: function (identifier, mediation) {
            if (!supported()) { return Promise.reject(new Error('This browser does not support passkeys.')); }
            return call('auth_options', { identifier: identifier || '' }).then(function (data) {
                var request = { publicKey: toRequestOptions(data.options) };
                if (mediation) { request.mediation = mediation; }
                return navigator.credentials.get(request);
            }).then(function (credential) {
                if (!credential) { throw new Error('No passkey was selected.'); }
                return call('auth_verify', { credential: serialiseAssertion(credential) });
            });
        },

        /** Confirms a sensitive action; resolves with a single-use token. */
        confirm: function (sensitiveAction) {
            if (!supported()) { return Promise.reject(new Error('This browser does not support passkeys.')); }
            return call('action_options', { sensitive_action: sensitiveAction }).then(function (data) {
                return navigator.credentials.get({ publicKey: toRequestOptions(data.options) });
            }).then(function (credential) {
                if (!credential) { throw new Error('The action was not confirmed.'); }
                return call('action_verify', {
                    sensitive_action: sensitiveAction,
                    credential: serialiseAssertion(credential)
                });
            }).then(function (data) {
                return data.confirmation.token;
            });
        },

        resetPassword: function (identifier) {
            return call('reset_options', { identifier: identifier }).then(function (data) {
                return navigator.credentials.get({ publicKey: toRequestOptions(data.options) });
            }).then(function (credential) {
                if (!credential) { throw new Error('No passkey was selected.'); }
                return call('reset_verify', { credential: serialiseAssertion(credential) });
            });
        },

        completeReset: function (token, password) {
            return call('reset_complete', { token: token, password: password });
        },

        list: function () { return call('list_credentials', {}); },
        rename: function (id, name) { return call('rename_credential', { credential_id: id, device_name: name }); },
        revoke: function (id, confirmation) {
            return call('revoke_credential', { credential_id: id, confirmation: confirmation || '' });
        },
        status: function () { return call('status', {}); }
    };

    window.CloudHost247Passkey = api;

    // ------------------------------------------------------- declarative wiring
    // Elements opt in with data attributes so templates stay markup-only.
    document.addEventListener('DOMContentLoaded', function () {
        if (!supported()) {
            Array.prototype.forEach.call(document.querySelectorAll('[data-passkey-only]'), function (node) {
                node.style.display = 'none';
            });
            Array.prototype.forEach.call(document.querySelectorAll('[data-passkey-unsupported]'), function (node) {
                node.style.display = '';
            });
            return;
        }

        Array.prototype.forEach.call(document.querySelectorAll('[data-passkey-action]'), function (button) {
            button.addEventListener('click', function (event) {
                event.preventDefault();
                var action = button.getAttribute('data-passkey-action');
                var feedback = document.querySelector(button.getAttribute('data-passkey-feedback') || '#passkey-feedback');
                var setMessage = function (message, isError) {
                    if (!feedback) { return; }
                    feedback.textContent = message;
                    feedback.className = isError ? 'passkey-feedback passkey-feedback--error' : 'passkey-feedback passkey-feedback--ok';
                };

                button.disabled = true;
                setMessage('Waiting for your device…', false);

                var done = function () { button.disabled = false; };
                var failed = function (error) { setMessage(describe(error), true); done(); };

                if (action === 'register') {
                    var nameField = document.querySelector(button.getAttribute('data-passkey-name') || '#passkey-device-name');
                    api.register(nameField ? nameField.value : '').then(function () {
                        setMessage('Passkey added.', false);
                        window.location.reload();
                    }).catch(failed);
                } else if (action === 'authenticate') {
                    var idField = document.querySelector(button.getAttribute('data-passkey-identifier') || '#passkey-identifier');
                    api.authenticate(idField ? idField.value : '').then(function (data) {
                        setMessage('Signed in. Redirecting…', false);
                        window.location.href = data.redirect || 'clientarea.php';
                    }).catch(failed);
                } else if (action === 'revoke') {
                    var id = parseInt(button.getAttribute('data-passkey-id'), 10);
                    if (!window.confirm('Remove this passkey? You will no longer be able to sign in with it.')) {
                        done();
                        return;
                    }
                    api.revoke(id).catch(function (error) {
                        // A confirmation-required response means we should
                        // prove possession with another passkey first.
                        if (error.reason !== 'confirmation_required') { throw error; }
                        return api.confirm('passkey_remove').then(function (token) {
                            return api.revoke(id, token);
                        });
                    }).then(function () {
                        window.location.reload();
                    }).catch(failed);
                } else {
                    done();
                }
            });
        });
    });
}(window, document));
