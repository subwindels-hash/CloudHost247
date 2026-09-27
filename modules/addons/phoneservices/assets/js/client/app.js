/**
 * Phone Services Client Area JavaScript
 */

(function() {
    'use strict';

    window.PhoneServices = window.PhoneServices || {};

    PhoneServices.init = function() {
        this.initDialer();
        this.initSmsCounter();
    };

    PhoneServices.initDialer = function() {
        var statusEl = document.getElementById('webrtc-status');
        var callBtn = document.getElementById('btn-call');
        var hangupBtn = document.getElementById('btn-hangup');
        var fromSelect = document.getElementById('from-number');
        var toInput = document.getElementById('to-number');

        if (!callBtn) return;

        if (typeof window.psWebRtcConfig !== 'undefined' && window.psWebRtcConfig.token) {
            statusEl.className = 'alert alert-success';
            statusEl.textContent = 'Ready to call';
            callBtn.disabled = false;
        } else {
            statusEl.className = 'alert alert-warning';
            statusEl.textContent = 'WebRTC not configured. Please contact support.';
        }

        callBtn.addEventListener('click', function() {
            if (!toInput.value) {
                alert('Please enter a number to call');
                return;
            }
            statusEl.className = 'alert alert-info';
            statusEl.textContent = 'Calling...';
            callBtn.style.display = 'none';
            hangupBtn.style.display = 'block';
        });

        hangupBtn.addEventListener('click', function() {
            statusEl.className = 'alert alert-success';
            statusEl.textContent = 'Call ended';
            callBtn.style.display = 'block';
            hangupBtn.style.display = 'none';
        });
    };

    PhoneServices.initSmsCounter = function() {
        var textarea = document.querySelector('textarea[name="message"]');
        if (textarea) {
            var counter = document.createElement('small');
            counter.className = 'text-muted pull-right';
            textarea.parentNode.appendChild(counter);

            textarea.addEventListener('input', function() {
                var len = textarea.value.length;
                var segments = Math.ceil(len / 160);
                counter.textContent = len + '/1600 chars (' + segments + ' SMS)';
            });
        }
    };

    document.addEventListener('DOMContentLoaded', function() {
        PhoneServices.init();
    });
})();
