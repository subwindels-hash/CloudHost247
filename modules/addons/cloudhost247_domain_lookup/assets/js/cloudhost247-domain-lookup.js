/**
 * CloudHost247 Domain Lookup - Client JavaScript
 * Handles all AJAX requests and UI interactions
 * Compatible with CloudHost247 v2.2.6 theme
 */

(function($) {
    'use strict';

    // ===== Configuration =====
    var config = {
        ajaxUrl: 'index.php?m=cloudhost247_domain_lookup&ajax=1',
        csrfToken: null,
        defaultTimeout: 30000, // 30 seconds max wait
    };

    // ===== Initialization =====
    $(document).ready(function() {
        // Get CSRF token
        config.csrfToken = $('#cloudhost247-csrf-token').val() || '';

        // Initialize tools based on current page
        initDomainWhois();
        initIpWhois();
        initDnsLookup();
        initAvailability();

        // TLD checkbox limit
        initTldLimit();
    });

    // ===== Domain WHOIS Tool =====
    function initDomainWhois() {
        var $btn = $('#btn-whois-lookup');
        if (!$btn.length) return;

        // Button click
        $btn.on('click', function() {
            performDomainWhois();
        });

        // Enter key in input
        $('#whois-domain').on('keypress', function(e) {
            if (e.which === 13) {
                performDomainWhois();
            }
        });

        // Toggle raw WHOIS
        $('#btn-toggle-raw').on('click', function() {
            $('#whois-result-raw').toggleClass('hidden');
        });
    }

    function performDomainWhois() {
        var domain = $.trim($('#whois-domain').val());

        if (!domain) {
            showError('whois-error', 'Please enter a domain name.');
            return;
        }

        // Reset UI
        hideResult('whois-results');
        hideError('whois-error');
        showLoading('whois-loading');

        // Make AJAX request
        $.ajax({
            url: config.ajaxUrl,
            type: 'POST',
            dataType: 'json',
            timeout: config.defaultTimeout,
            data: {
                action: 'domain_whois',
                domain: domain,
                csrf_token: config.csrfToken
            },
            success: function(response) {
                hideLoading('whois-loading');

                if (response.success) {
                    displayWhoisResults(response.data);
                } else {
                    showError('whois-error', response.error || 'WHOIS lookup failed.');
                }
            },
            error: function(xhr, status, error) {
                hideLoading('whois-loading');

                var message = 'Request failed. Please try again.';
                if (status === 'timeout') {
                    message = 'Request timed out. The server may be busy.';
                } else if (xhr.status === 0) {
                    message = 'Network error. Please check your connection.';
                }

                showError('whois-error', message);
            }
        });
    }

    function displayWhoisResults(data) {
        // Source badge
        var sourceText = data.source || 'Unknown';
        if (data.fallback) {
            sourceText += ' (Fallback)';
        }
        $('#whois-source').text(sourceText);

        // Cache badge
        if (data.cached) {
            $('#whois-cached').removeClass('hidden');
        } else {
            $('#whois-cached').addClass('hidden');
        }

        // Domain
        $('#whois-result-domain').text(data.domain || '-');

        // Registrar
        $('#whois-result-registrar').text(data.registrar || 'Not available');

        // Creation date
        $('#whois-result-creation').text(formatDate(data.creation_date) || 'Not available');

        // Expiry date
        $('#whois-result-expiry').text(formatDate(data.expiry_date) || 'Not available');

        // Name servers
        var nsHtml = '';
        if (data.name_servers && data.name_servers.length > 0) {
            $.each(data.name_servers, function(i, ns) {
                nsHtml += '<span class="cloudhost247-badge">' + escapeHtml(ns) + '</span>';
            });
        } else {
            nsHtml = '<span class="text-muted">Not available</span>';
        }
        $('#whois-result-nameservers').html(nsHtml);

        // Status
        var statusHtml = '';
        if (data.domain_status && data.domain_status.length > 0) {
            $.each(data.domain_status, function(i, status) {
                statusHtml += '<span class="cloudhost247-badge">' + escapeHtml(status) + '</span>';
            });
        } else if (data.status && data.status.length > 0) {
            if (typeof data.status === 'string') {
                statusHtml = '<span class="cloudhost247-badge">' + escapeHtml(data.status) + '</span>';
            } else {
                $.each(data.status, function(i, status) {
                    statusHtml += '<span class="cloudhost247-badge">' + escapeHtml(status) + '</span>';
                });
            }
        } else {
            statusHtml = '<span class="text-muted">Not available</span>';
        }
        $('#whois-result-status').html(statusHtml);

        // Raw WHOIS
        $('#whois-result-raw').text(data.raw_whois || 'Not available');

        showResult('whois-results');
    }

    // ===== IP WHOIS Tool =====
    function initIpWhois() {
        var $btn = $('#btn-ip-lookup');
        if (!$btn.length) return;

        $btn.on('click', function() {
            performIpWhois();
        });

        $('#ip-address').on('keypress', function(e) {
            if (e.which === 13) {
                performIpWhois();
            }
        });
    }

    function performIpWhois() {
        var ip = $.trim($('#ip-address').val());

        if (!ip) {
            showError('ip-error', 'Please enter an IP address.');
            return;
        }

        hideResult('ip-results');
        hideError('ip-error');
        showLoading('ip-loading');

        $.ajax({
            url: config.ajaxUrl,
            type: 'POST',
            dataType: 'json',
            timeout: config.defaultTimeout,
            data: {
                action: 'ip_whois',
                ip: ip,
                csrf_token: config.csrfToken
            },
            success: function(response) {
                hideLoading('ip-loading');

                if (response.success) {
                    displayIpResults(response.data);
                } else {
                    showError('ip-error', response.error || 'IP lookup failed.');
                }
            },
            error: function(xhr, status, error) {
                hideLoading('ip-loading');

                var message = 'Request failed. Please try again.';
                if (status === 'timeout') {
                    message = 'Request timed out. The server may be busy.';
                } else if (xhr.status === 0) {
                    message = 'Network error. Please check your connection.';
                }

                showError('ip-error', message);
            }
        });
    }

    function displayIpResults(data) {
        // Source badge
        var sourceText = data.source || 'Unknown';
        if (data.fallback) {
            sourceText += ' (Fallback)';
        }
        $('#ip-source').text(sourceText);

        // Cache badge
        if (data.cached) {
            $('#ip-cached').removeClass('hidden');
        } else {
            $('#ip-cached').addClass('hidden');
        }

        // IP Address
        $('#ip-result-address').text(data.ip || '-');

        // ISP / Organization
        $('#ip-result-isp').text(data.isp || data.organization || 'Not available');

        // Country
        var countryText = data.country_name || data.country || 'Not available';
        if (data.country && data.country_name && data.country !== data.country_name) {
            countryText += ' (' + data.country + ')';
        }
        $('#ip-result-country').text(countryText);

        // City / Region
        var cityText = '';
        if (data.city) cityText += data.city;
        if (data.region) {
            if (cityText) cityText += ', ';
            cityText += data.region;
        }
        $('#ip-result-city').text(cityText || 'Not available');

        // ASN
        var asnText = data.asn || 'Not available';
        if (data.asn_name) {
            asnText += ' - ' + data.asn_name;
        }
        if (data.asn_domain) {
            asnText += ' (' + data.asn_domain + ')';
        }
        $('#ip-result-asn').text(asnText);

        // Timezone
        $('#ip-result-timezone').text(data.timezone || 'Not available');

        // Latitude
        $('#ip-result-lat').text(data.latitude || 'Not available');

        // Longitude
        $('#ip-result-lon').text(data.longitude || 'Not available');

        // Postal
        $('#ip-result-postal').text(data.postal || 'Not available');

        showResult('ip-results');
    }

    // ===== DNS Lookup Tool =====
    function initDnsLookup() {
        var $btn = $('#btn-dns-lookup');
        if (!$btn.length) return;

        $btn.on('click', function() {
            performDnsLookup();
        });

        $('#dns-domain').on('keypress', function(e) {
            if (e.which === 13) {
                performDnsLookup();
            }
        });
    }

    function performDnsLookup() {
        var domain = $.trim($('#dns-domain').val());
        var type = $('#dns-type').val();

        if (!domain) {
            showError('dns-error', 'Please enter a domain name.');
            return;
        }

        hideResult('dns-results');
        hideError('dns-error');
        showLoading('dns-loading');

        $.ajax({
            url: config.ajaxUrl,
            type: 'POST',
            dataType: 'json',
            timeout: config.defaultTimeout,
            data: {
                action: 'dns_lookup',
                domain: domain,
                type: type,
                csrf_token: config.csrfToken
            },
            success: function(response) {
                hideLoading('dns-loading');

                if (response.success) {
                    displayDnsResults(response.data);
                } else {
                    showError('dns-error', response.error || 'DNS lookup failed.');
                }
            },
            error: function(xhr, status, error) {
                hideLoading('dns-loading');

                var message = 'Request failed. Please try again.';
                if (status === 'timeout') {
                    message = 'Request timed out. The server may be busy.';
                } else if (xhr.status === 0) {
                    message = 'Network error. Please check your connection.';
                }

                showError('dns-error', message);
            }
        });
    }

    function displayDnsResults(data) {
        // Cache badge
        if (data.cached) {
            $('#dns-cached').removeClass('hidden');
        } else {
            $('#dns-cached').addClass('hidden');
        }

        // Count badge
        $('#dns-count').text(data.count + ' records');

        // Build records table
        var $tbody = $('#dns-records-body');
        $tbody.empty();

        if (data.records && data.records.length > 0) {
            $.each(data.records, function(i, record) {
                var row = buildDnsRow(record);
                $tbody.append(row);
            });
            $('#dns-records-table').removeClass('hidden');
            $('#dns-no-records').addClass('hidden');
        } else {
            $('#dns-records-table').addClass('hidden');
            $('#dns-no-records').removeClass('hidden');
        }

        showResult('dns-results');
    }

    function buildDnsRow(record) {
        var typeClass = 'cloudhost247-dns-type-' + (record.type || 'unknown').toLowerCase();
        var value = getDnsRecordValue(record);
        var extra = getDnsRecordExtra(record);

        return '<tr>' +
            '<td><span class="cloudhost247-dns-type-badge ' + typeClass + '">' + escapeHtml(record.type) + '</span></td>' +
            '<td>' + escapeHtml(record.host || '-') + '</td>' +
            '<td>' + escapeHtml(value) + '</td>' +
            '<td>' + (record.ttl ? numberFormat(record.ttl) : '-') + '</td>' +
            '<td>' + escapeHtml(extra) + '</td>' +
            '</tr>';
    }

    function getDnsRecordValue(record) {
        switch (record.type) {
            case 'A': return record.ip || '-';
            case 'AAAA': return record.ipv6 || '-';
            case 'MX': return record.target || '-';
            case 'NS': return record.target || '-';
            case 'TXT': return record.txt ? truncateText(record.txt, 80) : '-';
            case 'CNAME': return record.target || '-';
            case 'SOA': return record.mname || '-';
            case 'PTR': return record.target || '-';
            case 'SRV': return record.target || '-';
            case 'CAA': return record.value || '-';
            default: return '-';
        }
    }

    function getDnsRecordExtra(record) {
        switch (record.type) {
            case 'MX': return 'Priority: ' + (record.pri || 0);
            case 'SOA':
                var parts = [];
                if (record.serial) parts.push('Serial: ' + record.serial);
                if (record.refresh) parts.push('Refresh: ' + record.refresh);
                return parts.join(', ');
            case 'SRV':
                var srvParts = [];
                if (record.pri) srvParts.push('Priority: ' + record.pri);
                if (record.weight) srvParts.push('Weight: ' + record.weight);
                if (record.port) srvParts.push('Port: ' + record.port);
                return srvParts.join(', ');
            case 'CAA':
                return 'Tag: ' + (record.tag || '-') + ', Flags: ' + (record.flags || 0);
            default: return '-';
        }
    }

    // ===== Domain Availability Tool =====
    function initAvailability() {
        var $btn = $('#btn-avail-check');
        if (!$btn.length) return;

        $btn.on('click', function() {
            performAvailabilityCheck();
        });

        $('#avail-domain').on('keypress', function(e) {
            if (e.which === 13) {
                performAvailabilityCheck();
            }
        });
    }

    function initTldLimit() {
        var maxTlds = 10;

        $(document).on('change', '#tld-grid input[type="checkbox"]', function() {
            var checked = $('#tld-grid input[type="checkbox"]:checked');

            if (checked.length >= maxTlds) {
                $('#tld-grid input[type="checkbox"]:not(:checked)').prop('disabled', true);
            } else {
                $('#tld-grid input[type="checkbox"]:disabled').prop('disabled', false);
            }
        });
    }

    function performAvailabilityCheck() {
        var domain = $.trim($('#avail-domain').val());
        var tlds = [];

        $('#tld-grid input[type="checkbox"]:checked').each(function() {
            tlds.push($(this).val());
        });

        if (!domain) {
            showError('avail-error', 'Please enter a domain name.');
            return;
        }

        if (tlds.length === 0) {
            showError('avail-error', 'Please select at least one TLD.');
            return;
        }

        hideResult('avail-results');
        hideError('avail-error');
        showLoading('avail-loading');
        $('#avail-progress').text('');

        $.ajax({
            url: config.ajaxUrl,
            type: 'POST',
            dataType: 'json',
            timeout: 60000, // Longer timeout for multiple checks
            data: {
                action: 'domain_availability',
                domain: domain,
                tlds: tlds,
                csrf_token: config.csrfToken
            },
            success: function(response) {
                hideLoading('avail-loading');

                if (response.success) {
                    displayAvailabilityResults(response.data);
                } else {
                    showError('avail-error', response.error || 'Availability check failed.');
                }
            },
            error: function(xhr, status, error) {
                hideLoading('avail-loading');

                var message = 'Request failed. Please try again.';
                if (status === 'timeout') {
                    message = 'Request timed out. Checking multiple domains can take time.';
                } else if (xhr.status === 0) {
                    message = 'Network error. Please check your connection.';
                }

                showError('avail-error', message);
            }
        });
    }

    function displayAvailabilityResults(data) {
        var $grid = $('#avail-grid');
        $grid.empty();

        if (data.results && data.results.length > 0) {
            $.each(data.results, function(i, result) {
                var itemClass = 'error';
                var statusText = 'Unknown';

                if (result.success) {
                    if (result.available === true) {
                        itemClass = 'available';
                        statusText = 'Available';
                    } else if (result.available === false) {
                        itemClass = 'taken';
                        statusText = 'Taken';
                    } else {
                        itemClass = 'error';
                        statusText = 'Unknown';
                    }
                }

                var html = '<div class="cloudhost247-avail-item ' + itemClass + '">' +
                    '<div class="domain-name">' + escapeHtml(result.domain || '-') + '</div>' +
                    '<div class="domain-status">' + statusText + '</div>';

                if (result.registrar) {
                    html += '<small class="text-muted">' + escapeHtml(result.registrar) + '</small>';
                }

                html += '</div>';
                $grid.append(html);
            });
        }

        // Source badge
        var sourceText = data.source || 'Mixed';
        $('#avail-source').text(sourceText);

        showResult('avail-results');
    }

    // ===== Utility Functions =====

    function showLoading(id) {
        $('#' + id).removeClass('hidden');
    }

    function hideLoading(id) {
        $('#' + id).addClass('hidden');
    }

    function showResult(id) {
        $('#' + id).hide().removeClass('hidden').fadeIn(300);
    }

    function hideResult(id) {
        $('#' + id).addClass('hidden');
    }

    function showError(id, message) {
        $('#' + id).removeClass('hidden').html('<i class="fa fa-exclamation-circle"></i> ' + escapeHtml(message));
    }

    function hideError(id) {
        $('#' + id).addClass('hidden');
    }

    function escapeHtml(text) {
        if (!text) return '';
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(text));
        return div.innerHTML;
    }

    function formatDate(dateStr) {
        if (!dateStr) return null;

        var date = new Date(dateStr);
        if (isNaN(date.getTime())) return dateStr;

        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    function truncateText(text, maxLength) {
        if (!text) return '';
        if (text.length <= maxLength) return text;
        return text.substring(0, maxLength) + '...';
    }

    function numberFormat(num) {
        return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

})(jQuery);
