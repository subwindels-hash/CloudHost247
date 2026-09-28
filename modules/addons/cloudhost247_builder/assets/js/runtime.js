/*
 * CloudHost247 Website Builder - published page runtime.
 *
 * Progressive enhancement only. Every page is fully readable and usable with
 * this file blocked: tabs fall back to stacked sections with headings, the
 * carousel is a native scroll-snap strip, the mobile menu is a plain list and
 * counters show their final value. Nothing here fetches data, and no
 * administrator-supplied script is ever executed -- this is the only script
 * the builder puts on a public page.
 */
(function () {
    'use strict';

    function ready(fn) {
        if (document.readyState !== 'loading') { fn(); }
        else { document.addEventListener('DOMContentLoaded', fn); }
    }

    function enhanceTabs(root) {
        Array.prototype.forEach.call(root.querySelectorAll('[data-ch247-tabs]'), function (tabs) {
            var buttons = tabs.querySelectorAll('[data-ch247-tab-button]');
            var panels = tabs.querySelectorAll('[data-ch247-tab]');
            if (!buttons.length || !panels.length) { return; }
            tabs.classList.add('is-enhanced');

            function activate(index) {
                Array.prototype.forEach.call(buttons, function (button) {
                    var isActive = button.getAttribute('data-ch247-tab-button') === String(index);
                    button.setAttribute('aria-selected', isActive ? 'true' : 'false');
                });
                Array.prototype.forEach.call(panels, function (panel) {
                    panel.classList.toggle('is-active', panel.getAttribute('data-ch247-tab') === String(index));
                });
            }

            Array.prototype.forEach.call(buttons, function (button) {
                button.addEventListener('click', function () {
                    activate(button.getAttribute('data-ch247-tab-button'));
                });
                button.addEventListener('keydown', function (event) {
                    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') { return; }
                    var current = parseInt(button.getAttribute('data-ch247-tab-button'), 10);
                    var next = event.key === 'ArrowRight' ? current + 1 : current - 1;
                    if (next < 0) { next = buttons.length - 1; }
                    if (next >= buttons.length) { next = 0; }
                    activate(next);
                    buttons[next].focus();
                });
            });
            activate(0);
        });
    }

    function enhanceNav(root) {
        Array.prototype.forEach.call(root.querySelectorAll('.ch247-nav--collapse'), function (nav) {
            var toggle = nav.querySelector('.ch247-nav__toggle');
            if (!toggle) { return; }
            toggle.addEventListener('click', function () {
                var open = nav.classList.toggle('is-open');
                toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
            });
        });
    }

    function enhanceCarousels(root) {
        Array.prototype.forEach.call(root.querySelectorAll('[data-ch247-autoplay]'), function (carousel) {
            var seconds = parseInt(carousel.getAttribute('data-ch247-autoplay'), 10);
            if (!seconds || seconds < 2) { return; }
            var track = carousel.querySelector('.ch247-carousel__track');
            if (!track) { return; }
            if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) { return; }

            var paused = false;
            carousel.addEventListener('mouseenter', function () { paused = true; });
            carousel.addEventListener('mouseleave', function () { paused = false; });
            carousel.addEventListener('focusin', function () { paused = true; });

            window.setInterval(function () {
                if (paused || document.hidden) { return; }
                var width = track.clientWidth;
                var next = track.scrollLeft + width;
                if (next > track.scrollWidth - width / 2) { next = 0; }
                track.scrollTo({ left: next, behavior: 'smooth' });
            }, seconds * 1000);
        });
    }

    function enhanceCounters(root) {
        var counters = root.querySelectorAll('[data-ch247-counter]');
        if (!counters.length || typeof IntersectionObserver === 'undefined') { return; }
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) { return; }

        var observer = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (!entry.isIntersecting) { return; }
                var node = entry.target;
                observer.unobserve(node);
                var target = parseFloat(node.getAttribute('data-ch247-counter'));
                var output = node.querySelector('span');
                if (!output || isNaN(target)) { return; }
                var decimals = (String(target).split('.')[1] || '').length;
                var started = null;
                var duration = 900;
                function step(timestamp) {
                    if (started === null) { started = timestamp; }
                    var progress = Math.min(1, (timestamp - started) / duration);
                    output.textContent = (target * progress).toFixed(decimals);
                    if (progress < 1) { window.requestAnimationFrame(step); }
                    else { output.textContent = target.toFixed(decimals); }
                }
                output.textContent = '0';
                window.requestAnimationFrame(step);
            });
        }, { threshold: 0.4 });

        Array.prototype.forEach.call(counters, function (counter) { observer.observe(counter); });
    }

    function guardForms(root) {
        Array.prototype.forEach.call(root.querySelectorAll('.ch247-form'), function (form) {
            if (form.hasAttribute('data-ch247-inert')) {
                form.addEventListener('submit', function (event) { event.preventDefault(); });
                return;
            }
            form.addEventListener('submit', function () {
                var button = form.querySelector('button[type="submit"]');
                if (!button) { return; }
                button.disabled = true;
                button.textContent = 'Sending...';
                // Re-enable if the browser restores the page from cache.
                window.setTimeout(function () { button.disabled = false; }, 8000);
            });
        });
    }

    ready(function () {
        var root = document.querySelector('.ch247-root') || document;
        enhanceTabs(root);
        enhanceNav(root);
        enhanceCarousels(root);
        enhanceCounters(root);
        guardForms(root);
    });
}());
