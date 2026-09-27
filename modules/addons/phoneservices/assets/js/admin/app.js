/**
 * Phone Services Admin Area JavaScript
 */

(function() {
    'use strict';

    window.PhoneServicesAdmin = window.PhoneServicesAdmin || {};

    PhoneServicesAdmin.init = function() {
        this.initTooltips();
        this.initConfirmActions();
    };

    PhoneServicesAdmin.initTooltips = function() {
        var links = document.querySelectorAll('a[title]');
        links.forEach(function(link) {
            link.addEventListener('mouseenter', function() {
                // Simple tooltip implementation
            });
        });
    };

    PhoneServicesAdmin.initConfirmActions = function() {
        var confirmLinks = document.querySelectorAll('[data-confirm]');
        confirmLinks.forEach(function(link) {
            link.addEventListener('click', function(e) {
                if (!confirm(link.getAttribute('data-confirm'))) {
                    e.preventDefault();
                }
            });
        });
    };

    document.addEventListener('DOMContentLoaded', function() {
        PhoneServicesAdmin.init();
    });
})();
