/**
 * CloudHost247 Isc LTE Proxy Module - Admin JavaScript
 * Version: 1.0.0
 */

(function() {
    'use strict';

    const CH247Admin = {
        /**
         * Initialize admin functionality
         */
        init() {
            this.bindEvents();
            console.log('[CH247] Admin initialized');
        },

        /**
         * Bind event listeners
         */
        bindEvents() {
            // Confirm destructive actions
            document.querySelectorAll('[data-confirm]').forEach(el => {
                el.addEventListener('click', (e) => {
                    const message = el.dataset.confirm;
                    if (!confirm(message)) {
                        e.preventDefault();
                    }
                });
            });

            // Refresh stats
            const refreshBtn = document.getElementById('refresh-stats');
            if (refreshBtn) {
                refreshBtn.addEventListener('click', () => this.refreshStats());
            }
        },

        /**
         * Refresh statistics
         */
        async refreshStats() {
            const btn = document.getElementById('refresh-stats');
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Refreshing...';
            }

            try {
                await fetch(location.href, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
                location.reload();
            } catch (e) {
                location.reload();
            }
        },

        /**
         * Clear cache
         */
        async clearCache() {
            if (!confirm('Are you sure you want to clear the cache?')) return;

            try {
                const response = await fetch('?module=cloudhost247_lteproxy&action=clear_cache', {
                    headers: { 'X-Requested-With': 'XMLHttpRequest' },
                });
                const data = await response.json();

                if (data.success) {
                    alert('Cache cleared successfully');
                    location.reload();
                } else {
                    alert('Failed to clear cache');
                }
            } catch (e) {
                alert('Error clearing cache');
            }
        },
    };

    window.CH247Admin = CH247Admin;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => CH247Admin.init());
    } else {
        CH247Admin.init();
    }
})();
