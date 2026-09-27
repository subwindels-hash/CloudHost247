/**
 * CloudHost247 Isc LTE Proxy Module - Client JavaScript
 * Version: 1.0.0
 */

(function() {
    'use strict';

    const CH247 = {
        config: window.CH247Config || {},
        proxies: [],
        currentTab: 'proxies',
        isLoading: false,

        /**
         * Initialize the dashboard
         */
        init() {
            this.bindEvents();

            if (this.config.orderId) {
                this.loadProxies();
                this.loadOrderDetails();
                this.populateProxySelects();
            }

            console.log('[CH247] LTE Proxy Dashboard initialized');
        },

        /**
         * Bind all event listeners
         */
        bindEvents() {
            // Tab switching
            document.querySelectorAll('.ch247-tab').forEach(tab => {
                tab.addEventListener('click', (e) => this.switchTab(e.currentTarget));
            });

            // Refresh proxies
            const refreshBtn = document.getElementById('refresh-proxies');
            if (refreshBtn) {
                refreshBtn.addEventListener('click', () => this.loadProxies());
            }

            // Batch test
            const batchTestBtn = document.getElementById('batch-test-btn');
            if (batchTestBtn) {
                batchTestBtn.addEventListener('click', () => this.runBatchTest());
            }

            // Run speed test
            const speedTestBtn = document.getElementById('run-speed-test');
            if (speedTestBtn) {
                speedTestBtn.addEventListener('click', () => this.runSpeedTest());
            }

            // Management actions
            this.bindManagementActions();

            // Modal
            const modalClose = document.getElementById('modal-close');
            const modalOverlay = document.getElementById('modal-overlay');
            if (modalClose) modalClose.addEventListener('click', () => this.closeModal());
            if (modalOverlay) modalOverlay.addEventListener('click', (e) => {
                if (e.target === modalOverlay) this.closeModal();
            });

            // Auth type change
            const authTypeSelect = document.getElementById('auth-type-select');
            if (authTypeSelect) {
                authTypeSelect.addEventListener('change', (e) => this.toggleAuthFields(e.target.value));
            }
        },

        /**
         * Bind management action buttons
         */
        bindManagementActions() {
            // Region update
            const regionBtn = document.getElementById('update-region-btn');
            if (regionBtn) {
                regionBtn.addEventListener('click', () => this.updateRegion());
            }

            // Carrier update
            const carrierBtn = document.getElementById('update-carrier-btn');
            if (carrierBtn) {
                carrierBtn.addEventListener('click', () => this.updateCarrier());
            }

            // Proxy type update
            const typeBtn = document.getElementById('update-type-btn');
            if (typeBtn) {
                typeBtn.addEventListener('click', () => this.updateProxyType());
            }

            // Auth update
            const authBtn = document.getElementById('update-auth-btn');
            if (authBtn) {
                authBtn.addEventListener('click', () => this.updateAuth());
            }
        },

        /**
         * Switch tabs
         */
        switchTab(tabElement) {
            const tabId = tabElement.dataset.tab;
            if (!tabId) return;

            this.currentTab = tabId;

            // Update tab buttons
            document.querySelectorAll('.ch247-tab').forEach(t => t.classList.remove('active'));
            tabElement.classList.add('active');

            // Update tab content
            document.querySelectorAll('.ch247-tab-content').forEach(c => c.classList.remove('active'));
            const content = document.getElementById('tab-' + tabId);
            if (content) content.classList.add('active');

            // Load tab-specific data
            if (tabId === 'rotation') this.loadRotationStatus();
            if (tabId === 'history') this.loadOrderHistory();
        },

        /**
         * Make authenticated AJAX request
         */
        async request(endpoint, options = {}) {
            const url = this.config.ajaxUrl + endpoint;
            const csrfToken = this.config.csrfToken;

            const defaults = {
                headers: {
                    'X-CSRF-Token': csrfToken,
                    'X-Requested-With': 'XMLHttpRequest',
                },
                credentials: 'same-origin',
            };

            if (options.body && !(options.body instanceof FormData)) {
                defaults.headers['Content-Type'] = 'application/x-www-form-urlencoded';
            }

            const settings = { ...defaults, ...options };
            settings.headers = { ...defaults.headers, ...(options.headers || {}) };

            // Add service ID to URL params
            const separator = url.includes('?') ? '&' : '?';
            const urlWithParams = url + separator + 'service_id=' + encodeURIComponent(this.config.serviceId) +
                '&csrf_token=' + encodeURIComponent(csrfToken);

            try {
                const response = await fetch(urlWithParams, settings);
                const data = await response.json();

                if (!data.success) {
                    throw new Error(data.error || 'Request failed');
                }

                return data;
            } catch (error) {
                console.error('[CH247] Request failed:', error);
                this.showToast(error.message || 'Network error', 'error');
                throw error;
            }
        },

        /**
         * Load proxy list
         */
        async loadProxies() {
            const tbody = document.getElementById('proxy-table-body');
            if (!tbody) return;

            tbody.innerHTML = '<tr><td colspan="7" class="ch247-loading"><i class="fas fa-spinner fa-spin"></i> Loading proxies...</td></tr>';

            try {
                const data = await this.request('proxy-operations.php', {
                    method: 'POST',
                    body: 'action=get_proxies',
                });

                this.proxies = data.proxies || [];
                this.renderProxies(data.proxies || []);
                this.updateStats(data.proxies || []);
                this.populateProxySelects();
            } catch (error) {
                tbody.innerHTML = '<tr><td colspan="7" class="ch247-empty-state"><i class="fas fa-exclamation-circle"></i><p>Failed to load proxies</p></td></tr>';
            }
        },

        /**
         * Render proxy table
         */
        renderProxies(proxies) {
            const tbody = document.getElementById('proxy-table-body');
            if (!tbody) return;

            if (!proxies.length) {
                tbody.innerHTML = '<tr><td colspan="7" class="ch247-empty-state"><i class="fas fa-wifi"></i><p>No proxies found</p></td></tr>';
                return;
            }

            tbody.innerHTML = proxies.map(proxy => `
                <tr data-proxy-id="${proxy.id}">
                    <td>
                        <div class="ch247-proxy-info">
                            <span class="ch247-proxy-ip">${proxy.ip}:${proxy.port}</span>
                            <span class="ch247-proxy-meta">${proxy.formatted_proxy}</span>
                        </div>
                    </td>
                    <td><span class="ch247-badge ch247-badge-info">${proxy.type}</span></td>
                    <td>${proxy.region.toUpperCase()}</td>
                    <td>${proxy.carrier}</td>
                    <td>
                        <span class="ch247-status ch247-status-${proxy.status === 'active' ? 'online' : 'offline'}">
                            ${proxy.status}
                        </span>
                    </td>
                    <td>${proxy.time_remaining}</td>
                    <td>
                        <div class="ch247-table-actions">
                            <button class="ch247-action-btn" title="Copy proxy" onclick="CH247.copyProxy('${proxy.formatted_proxy}')">
                                <i class="fas fa-copy"></i>
                            </button>
                            <button class="ch247-action-btn" title="Copy format" onclick="CH247.copyProxy('${proxy.copy_format}')">
                                <i class="fas fa-clipboard"></i>
                            </button>
                            <button class="ch247-action-btn" title="Rotate IP" onclick="CH247.rotateIp('${proxy.id}')">
                                <i class="fas fa-sync-alt"></i>
                            </button>
                            ${proxy.is_1by1 ? `
                            <button class="ch247-action-btn" title="Reveal IP" onclick="CH247.revealIp('${proxy.id}')">
                                <i class="fas fa-eye"></i>
                            </button>` : ''}
                            <button class="ch247-action-btn" title="Test proxy" onclick="CH247.testProxy('${proxy.id}')">
                                <i class="fas fa-tachometer-alt"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `).join('');
        },

        /**
         * Update statistics display
         */
        updateStats(proxies) {
            const countEl = document.getElementById('proxy-count');
            if (countEl) countEl.textContent = proxies.length;
        },

        /**
         * Populate proxy select dropdowns
         */
        populateProxySelects() {
            const selects = [
                'manage-proxy-select',
                'carrier-proxy-select',
                'type-proxy-select',
                'auth-proxy-select',
            ];

            const options = this.proxies.map(p =>
                `<option value="${p.id}">${p.ip}:${p.port}</option>`
            ).join('');

            selects.forEach(id => {
                const select = document.getElementById(id);
                if (select) {
                    select.innerHTML = '<option value="">Select a proxy...</option>' + options;
                }
            });
        },

        /**
         * Load order details
         */
        async loadOrderDetails() {
            try {
                const data = await this.request('proxy-operations.php', {
                    method: 'POST',
                    body: 'action=get_order_details',
                });

                if (data.order) {
                    const timeEl = document.getElementById('time-remaining');
                    const statusEl = document.getElementById('order-status');

                    if (timeEl) timeEl.textContent = data.order.time_remaining;
                    if (statusEl) statusEl.textContent = data.order.status.charAt(0).toUpperCase() + data.order.status.slice(1);
                }
            } catch (error) {
                console.error('Failed to load order details:', error);
            }
        },

        /**
         * Copy proxy to clipboard
         */
        async copyProxy(text) {
            try {
                await navigator.clipboard.writeText(text);
                this.showToast('Proxy copied to clipboard!', 'success');
            } catch (err) {
                // Fallback
                const textarea = document.createElement('textarea');
                textarea.value = text;
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
                this.showToast('Proxy copied to clipboard!', 'success');
            }
        },

        /**
         * Rotate IP for a proxy
         */
        async rotateIp(proxyId) {
            const btn = document.querySelector(`tr[data-proxy-id="${proxyId}"] .fa-sync-alt`);
            if (btn) btn.classList.add('fa-spin');

            try {
                const data = await this.request('proxy-operations.php', {
                    method: 'POST',
                    body: `action=rotate_ip&proxy_id=${encodeURIComponent(proxyId)}`,
                });

                this.showToast('IP rotated successfully! New IP: ' + (data.new_ip || 'N/A'), 'success');
                this.loadProxies();
            } catch (error) {
                // Error handled by request()
            } finally {
                if (btn) btn.classList.remove('fa-spin');
            }
        },

        /**
         * Reveal IP for 1:1 proxy
         */
        async revealIp(proxyId) {
            try {
                const data = await this.request('proxy-operations.php', {
                    method: 'POST',
                    body: `action=reveal_ip&proxy_id=${encodeURIComponent(proxyId)}`,
                });

                this.showToast('IP Revealed: ' + (data.ip || 'N/A'), 'success');
                this.loadProxies();
            } catch (error) {
                // Error handled
            }
        },

        /**
         * Test a single proxy
         */
        async testProxy(proxyId) {
            this.showModal('Testing Proxy', '<div class="ch247-loading"><i class="fas fa-spinner fa-spin"></i> Running tests...</div>');

            try {
                const aliveData = await this.request('proxy-test.php', {
                    method: 'POST',
                    body: `action=test_alive&proxy_id=${encodeURIComponent(proxyId)}`,
                });

                let speedData = null;
                try {
                    speedData = await this.request('proxy-test.php', {
                        method: 'POST',
                        body: `action=test_speed&proxy_id=${encodeURIComponent(proxyId)}`,
                    });
                } catch (e) {
                    // Speed test may fail
                }

                const content = this.buildTestResultsHtml(aliveData, speedData);
                this.showModal('Proxy Test Results', content);
            } catch (error) {
                this.closeModal();
            }
        },

        /**
         * Run batch test on all proxies
         */
        async runBatchTest() {
            const btn = document.getElementById('batch-test-btn');
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Testing...';
            }

            try {
                const data = await this.request('proxy-test.php', {
                    method: 'POST',
                    body: 'action=batch_test',
                });

                const summary = data.summary || {};
                const results = data.results || [];

                const content = `
                    <div class="ch247-speed-metrics" style="margin-bottom:20px">
                        <div class="ch247-speed-metric">
                            <div class="ch247-speed-metric-value">${summary.total || 0}</div>
                            <div class="ch247-speed-metric-label">Total</div>
                        </div>
                        <div class="ch247-speed-metric">
                            <div class="ch247-speed-metric-value ch247-quality-excellent">${summary.alive || 0}</div>
                            <div class="ch247-speed-metric-label">Alive</div>
                        </div>
                        <div class="ch247-speed-metric">
                            <div class="ch247-speed-metric-value ch247-quality-poor">${summary.dead || 0}</div>
                            <div class="ch247-speed-metric-label">Dead</div>
                        </div>
                        <div class="ch247-speed-metric">
                            <div class="ch247-speed-metric-value">${summary.success_rate || 0}%</div>
                            <div class="ch247-speed-metric-label">Success Rate</div>
                        </div>
                    </div>
                    <div style="max-height:300px;overflow-y:auto">
                        <table class="ch247-proxy-table">
                            <thead><tr><th>Proxy</th><th>Status</th><th>Speed</th><th>Latency</th></tr></thead>
                            <tbody>
                                ${results.map(r => `
                                    <tr>
                                        <td>${r.ip || r.proxy_id}</td>
                                        <td><span class="ch247-status ch247-status-${r.alive ? 'online' : 'offline'}">${r.alive ? 'Alive' : 'Dead'}</span></td>
                                        <td>${r.speed || 'N/A'}</td>
                                        <td>${r.latency || 'N/A'}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                `;

                this.showModal('Batch Test Results', content);
            } catch (error) {
                // Error handled
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fas fa-vial"></i> Test All';
                }
            }
        },

        /**
         * Run speed test
         */
        async runSpeedTest() {
            const btn = document.getElementById('run-speed-test');
            const results = document.getElementById('speed-test-results');

            if (!this.proxies.length) {
                this.showToast('No proxies to test', 'warning');
                return;
            }

            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Testing...';
            }

            results.innerHTML = '<div class="ch247-loading"><i class="fas fa-spinner fa-spin"></i> Running speed tests on all proxies...</div>';

            const testResults = [];

            for (const proxy of this.proxies) {
                try {
                    const aliveData = await this.request('proxy-test.php', {
                        method: 'POST',
                        body: `action=test_alive&proxy_id=${encodeURIComponent(proxy.id)}`,
                    });

                    let speedData = null;
                    if (aliveData.alive) {
                        try {
                            speedData = await this.request('proxy-test.php', {
                                method: 'POST',
                                body: `action=test_speed&proxy_id=${encodeURIComponent(proxy.id)}`,
                            });
                        } catch (e) {}
                    }

                    testResults.push({ proxy, aliveData, speedData });
                } catch (e) {
                    testResults.push({ proxy, aliveData: null, speedData: null, error: true });
                }
            }

            this.renderSpeedTestResults(testResults);

            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-play"></i> Run Speed Test';
            }
        },

        /**
         * Render speed test results
         */
        renderSpeedTestResults(results) {
            const container = document.getElementById('speed-test-results');
            if (!container) return;

            container.innerHTML = results.map(({ proxy, aliveData, speedData, error }) => {
                if (error || !aliveData) {
                    return `
                        <div class="ch247-speed-card">
                            <div class="ch247-speed-header">
                                <span class="ch247-proxy-ip">${proxy.ip}:${proxy.port}</span>
                                <span class="ch247-badge ch247-badge-danger">Failed</span>
                            </div>
                            <p>Test failed - could not reach proxy</p>
                        </div>
                    `;
                }

                const quality = speedData ? (speedData.quality_rating || 'N/A') : 'N/A';
                const qualityClass = this.getQualityClass(quality);

                return `
                    <div class="ch247-speed-card">
                        <div class="ch247-speed-header">
                            <div>
                                <span class="ch247-proxy-ip">${proxy.ip}:${proxy.port}</span>
                                <span class="ch247-status ch247-status-${aliveData.alive ? 'online' : 'offline'}" style="margin-left:10px">${aliveData.alive ? 'Online' : 'Offline'}</span>
                            </div>
                            ${speedData ? `<span class="ch247-quality-${qualityClass}">${quality}</span>` : ''}
                        </div>
                        ${speedData ? `
                        <div class="ch247-speed-metrics">
                            <div class="ch247-speed-metric">
                                <div class="ch247-speed-metric-value">${speedData.download_speed ? speedData.download_speed.formatted : 'N/A'}</div>
                                <div class="ch247-speed-metric-label">Download</div>
                            </div>
                            <div class="ch247-speed-metric">
                                <div class="ch247-speed-metric-value">${speedData.upload_speed ? speedData.upload_speed.formatted : 'N/A'}</div>
                                <div class="ch247-speed-metric-label">Upload</div>
                            </div>
                            <div class="ch247-speed-metric">
                                <div class="ch247-speed-metric-value">${speedData.latency_ms}ms</div>
                                <div class="ch247-speed-metric-label">Latency</div>
                            </div>
                            <div class="ch247-speed-metric">
                                <div class="ch247-speed-metric-value">${speedData.packet_loss_percent}%</div>
                                <div class="ch247-speed-metric-label">Packet Loss</div>
                            </div>
                        </div>
                        ` : '<p>No speed data available</p>'}
                    </div>
                `;
            }).join('');
        },

        /**
         * Get quality class
         */
        getQualityClass(rating) {
            const map = {
                'Excellent': 'excellent',
                'Good': 'good',
                'Fair': 'fair',
                'Poor': 'poor',
                'Very Poor': 'poor',
            };
            return map[rating] || 'fair';
        },

        /**
         * Build test results HTML
         */
        buildTestResultsHtml(aliveData, speedData) {
            let html = `
                <div class="ch247-speed-metrics" style="margin-bottom:16px">
                    <div class="ch247-speed-metric">
                        <div class="ch247-speed-metric-value">
                            <span class="ch247-status ch247-status-${aliveData.alive ? 'online' : 'offline'}">${aliveData.alive ? 'Online' : 'Offline'}</span>
                        </div>
                        <div class="ch247-speed-metric-label">Status</div>
                    </div>
                    <div class="ch247-speed-metric">
                        <div class="ch247-speed-metric-value">${aliveData.response_time_ms}ms</div>
                        <div class="ch247-speed-metric-label">Response Time</div>
                    </div>
                </div>
            `;

            if (aliveData.ip) {
                html += `<p><strong>IP:</strong> ${aliveData.ip}</p>`;
            }
            if (aliveData.location) {
                html += `<p><strong>Location:</strong> ${aliveData.location}</p>`;
            }
            if (aliveData.isp) {
                html += `<p><strong>ISP:</strong> ${aliveData.isp}</p>`;
            }

            if (speedData) {
                html += `
                    <hr style="margin:16px 0;border:none;border-top:1px solid var(--ch247-border)">
                    <h4>Speed Test Results</h4>
                    <div class="ch247-speed-metrics">
                        <div class="ch247-speed-metric">
                            <div class="ch247-speed-metric-value">${speedData.download_speed ? speedData.download_speed.formatted : 'N/A'}</div>
                            <div class="ch247-speed-metric-label">Download</div>
                        </div>
                        <div class="ch247-speed-metric">
                            <div class="ch247-speed-metric-value">${speedData.latency_ms}ms</div>
                            <div class="ch247-speed-metric-label">Latency</div>
                        </div>
                        <div class="ch247-speed-metric">
                            <div class="ch247-speed-metric-value">${speedData.packet_loss_percent}%</div>
                            <div class="ch247-speed-metric-label">Loss</div>
                        </div>
                    </div>
                `;
            }

            return html;
        },

        /**
         * Update region
         */
        async updateRegion() {
            const proxyId = document.getElementById('manage-proxy-select')?.value;
            const region = document.getElementById('region-select')?.value;

            if (!proxyId || !region) {
                this.showToast('Please select a proxy and region', 'warning');
                return;
            }

            try {
                await this.request('proxy-operations.php', {
                    method: 'POST',
                    body: `action=update_region&proxy_id=${encodeURIComponent(proxyId)}&region=${encodeURIComponent(region)}`,
                });

                this.showToast('Region updated successfully!', 'success');
                this.loadProxies();
            } catch (error) {}
        },

        /**
         * Update carrier
         */
        async updateCarrier() {
            const proxyId = document.getElementById('carrier-proxy-select')?.value;
            const carrier = document.getElementById('carrier-select')?.value;

            if (!proxyId || !carrier) {
                this.showToast('Please select a proxy and carrier', 'warning');
                return;
            }

            try {
                await this.request('proxy-operations.php', {
                    method: 'POST',
                    body: `action=update_carrier&proxy_id=${encodeURIComponent(proxyId)}&carrier=${encodeURIComponent(carrier)}`,
                });

                this.showToast('Carrier updated successfully!', 'success');
                this.loadProxies();
            } catch (error) {}
        },

        /**
         * Update proxy type
         */
        async updateProxyType() {
            const proxyId = document.getElementById('type-proxy-select')?.value;
            const proxyType = document.getElementById('proxy-type-select')?.value;

            if (!proxyId || !proxyType) {
                this.showToast('Please select a proxy and type', 'warning');
                return;
            }

            try {
                await this.request('proxy-operations.php', {
                    method: 'POST',
                    body: `action=update_proxy_type&proxy_id=${encodeURIComponent(proxyId)}&proxy_type=${encodeURIComponent(proxyType)}`,
                });

                this.showToast('Proxy type updated successfully!', 'success');
                this.loadProxies();
            } catch (error) {}
        },

        /**
         * Update authentication
         */
        async updateAuth() {
            const proxyId = document.getElementById('auth-proxy-select')?.value;
            const authType = document.getElementById('auth-type-select')?.value;

            if (!proxyId || !authType) {
                this.showToast('Please select a proxy and auth method', 'warning');
                return;
            }

            let body = `action=update_auth&proxy_id=${encodeURIComponent(proxyId)}&auth_type=${encodeURIComponent(authType)}`;

            if (['username_password', 'both'].includes(authType)) {
                const password = document.getElementById('auth-password')?.value;
                if (password) body += '&password=' + encodeURIComponent(password);
            }

            if (['ip_whitelist', 'both'].includes(authType)) {
                const clientIp = document.getElementById('auth-client-ip')?.value;
                if (clientIp) body += '&client_ip=' + encodeURIComponent(clientIp);
            }

            try {
                await this.request('proxy-operations.php', {
                    method: 'POST',
                    body: body,
                });

                this.showToast('Authentication updated!', 'success');
                this.loadProxies();
            } catch (error) {}
        },

        /**
         * Toggle auth fields based on selection
         */
        toggleAuthFields(authType) {
            const ipGroup = document.getElementById('auth-ip-group');
            const passwordGroup = document.getElementById('auth-password-group');

            if (ipGroup) {
                ipGroup.style.display = ['ip_whitelist', 'both'].includes(authType) ? 'block' : 'none';
            }
            if (passwordGroup) {
                passwordGroup.style.display = ['username_password', 'both'].includes(authType) ? 'block' : 'none';
            }
        },

        /**
         * Load rotation status
         */
        async loadRotationStatus() {
            const container = document.getElementById('rotation-list');
            if (!container) return;

            container.innerHTML = '<div class="ch247-loading"><i class="fas fa-spinner fa-spin"></i> Loading rotation status...</div>';

            try {
                const data = await this.request('stats.php', {
                    method: 'GET',
                }, 'get_rotation_status');

                const rotations = data.rotations || [];

                if (!rotations.length) {
                    container.innerHTML = '<div class="ch247-empty-state"><i class="fas fa-sync-alt"></i><p>No rotation data available</p></div>';
                    return;
                }

                container.innerHTML = rotations.map(r => `
                    <div class="ch247-rotation-card">
                        <div class="ch247-rotation-card-header">
                            <span class="ch247-proxy-ip">${r.ip || r.proxy_id}</span>
                            <span class="ch247-badge ch247-badge-info">${r.rotation_type}</span>
                        </div>
                        <div class="ch247-stat-info" style="margin-bottom:8px">
                            <span class="ch247-stat-label">Rotation Interval</span>
                            <span class="ch247-stat-value" style="font-size:16px">${r.rotation_interval} min</span>
                        </div>
                        ${r.next_rotation ? `
                        <div class="ch247-stat-info">
                            <span class="ch247-stat-label">Next Rotation In</span>
                            <span class="ch247-rotation-timer" data-minutes="${r.time_until_next}">${r.time_until_next} min</span>
                        </div>
                        ` : ''}
                        ${r.last_rotated ? `<p style="font-size:11px;color:var(--ch247-text-muted);margin-top:8px">Last rotated: ${r.last_rotated}</p>` : ''}
                    </div>
                `).join('');

                this.startRotationTimers();
            } catch (error) {
                container.innerHTML = '<div class="ch247-empty-state"><i class="fas fa-exclamation-circle"></i><p>Failed to load rotation data</p></div>';
            }
        },

        /**
         * Start rotation countdown timers
         */
        startRotationTimers() {
            document.querySelectorAll('.ch247-rotation-timer').forEach(el => {
                let minutes = parseInt(el.dataset.minutes) || 0;

                const interval = setInterval(() => {
                    minutes--;
                    if (minutes <= 0) {
                        el.textContent = 'Due';
                        el.style.color = 'var(--ch247-warning)';
                        clearInterval(interval);
                    } else {
                        el.textContent = minutes + ' min';
                    }
                }, 60000);
            });
        },

        /**
         * Load order history
         */
        async loadOrderHistory() {
            const container = document.getElementById('order-history');
            if (!container) return;

            container.innerHTML = '<div class="ch247-loading"><i class="fas fa-spinner fa-spin"></i> Loading history...</div>';

            try {
                const data = await this.request('stats.php', {
                    method: 'GET',
                }, 'get_order_history');

                const history = data.history || [];

                if (!history.length) {
                    container.innerHTML = '<div class="ch247-empty-state"><i class="fas fa-history"></i><p>No order history found</p></div>';
                    return;
                }

                container.innerHTML = history.map(h => `
                    <div class="ch247-history-item">
                        <div>
                            <strong>Order #${h.id}</strong>
                            <span class="ch247-badge ch247-badge-${h.type === 'active' ? 'success' : 'danger'}" style="margin-left:8px">${h.type}</span>
                            <p style="margin:4px 0 0;font-size:12px;color:var(--ch247-text-muted)">
                                ${h.quantity} proxies - ${h.region} - ${h.carrier}
                            </p>
                        </div>
                        <div style="text-align:right">
                            <p style="margin:0;font-size:12px">${h.created_at}</p>
                            ${h.expires_at ? `<p style="margin:4px 0 0;font-size:11px;color:var(--ch247-text-muted)">Expires: ${h.expires_at}</p>` : ''}
                        </div>
                    </div>
                `).join('');
            } catch (error) {
                container.innerHTML = '<div class="ch247-empty-state"><i class="fas fa-exclamation-circle"></i><p>Failed to load history</p></div>';
            }
        },

        /**
         * Show toast notification
         */
        showToast(message, type = 'info', duration = 4000) {
            const container = document.getElementById('toast-container');
            if (!container) return;

            const toast = document.createElement('div');
            toast.className = `ch247-toast ch247-toast-${type}`;
            toast.innerHTML = `
                <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : type === 'warning' ? 'exclamation-triangle' : 'info-circle'}"></i>
                <span>${this.escapeHtml(message)}</span>
            `;

            container.appendChild(toast);

            setTimeout(() => {
                toast.classList.add('ch247-toast-leave');
                setTimeout(() => toast.remove(), 300);
            }, duration);
        },

        /**
         * Show modal
         */
        showModal(title, content, footer = '') {
            const overlay = document.getElementById('modal-overlay');
            const titleEl = document.getElementById('modal-title');
            const bodyEl = document.getElementById('modal-body');
            const footerEl = document.getElementById('modal-footer');

            if (titleEl) titleEl.textContent = title;
            if (bodyEl) bodyEl.innerHTML = content;
            if (footerEl) footerEl.innerHTML = footer;

            if (overlay) overlay.classList.add('active');
        },

        /**
         * Close modal
         */
        closeModal() {
            const overlay = document.getElementById('modal-overlay');
            if (overlay) overlay.classList.remove('active');
        },

        /**
         * Escape HTML
         */
        escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        },
    };

    // Expose to global scope
    window.CH247 = CH247;

    // Initialize on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => CH247.init());
    } else {
        CH247.init();
    }
})();
