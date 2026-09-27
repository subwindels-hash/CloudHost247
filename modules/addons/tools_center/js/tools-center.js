/**
 * Tools Center - Client Area JavaScript
 * Handles tool forms, API calls, and result display
 */

(function() {
    'use strict';

    // API endpoint - will be set from template
    var apiUrl = window.toolsCenterConfig && window.toolsCenterConfig.apiUrl 
        ? window.toolsCenterConfig.apiUrl 
        : 'index.php?m=tools_center';

    /**
     * Open tool modal
     */
    window.openTool = function(category, action) {
        var def = window.toolDefinitions && window.toolDefinitions[action];
        if (!def) {
            // Redirect to tool page
            window.location.href = 'index.php?m=tools_center&cat=' + category + '&tool=' + action;
            return;
        }

        document.getElementById('modalTitle').textContent = def.title;
        var modalBody = document.getElementById('modalBody');
        modalBody.innerHTML = '';

        // Build form
        var form = document.createElement('form');
        form.className = 'tc-tool-dynamic-form';
        form.onsubmit = function(e) {
            e.preventDefault();
            submitToolForm(category, action, form);
        };

        // Form fields
        if (def.fields && def.fields.length > 0) {
            def.fields.forEach(function(field) {
                var group = document.createElement('div');
                group.className = 'tc-form-group';

                var label = document.createElement('label');
                label.textContent = field.label;
                if (field.required) {
                    label.className = 'tc-required';
                }
                group.appendChild(label);

                var input;
                if (field.type === 'textarea') {
                    input = document.createElement('textarea');
                    input.rows = field.rows || 4;
                } else if (field.type === 'select') {
                    input = document.createElement('select');
                    if (field.options) {
                        field.options.forEach(function(opt) {
                            var option = document.createElement('option');
                            option.value = opt;
                            option.textContent = opt;
                            input.appendChild(option);
                        });
                    }
                } else {
                    input = document.createElement('input');
                    input.type = field.type || 'text';
                    if (field.min) input.min = field.min;
                    if (field.max) input.max = field.max;
                    if (field.step) input.step = field.step;
                }

                input.name = field.name;
                input.className = 'form-control';
                if (field.placeholder) input.placeholder = field.placeholder;
                if (field.value) input.value = field.value;
                if (field.required) input.required = true;

                group.appendChild(input);
                form.appendChild(group);
            });
        } else if (def.note) {
            var note = document.createElement('div');
            note.className = 'tc-alert tc-alert-info';
            note.textContent = def.note;
            form.appendChild(note);
        }

        // Actions
        var actions = document.createElement('div');
        actions.className = 'tc-form-actions';

        var submitBtn = document.createElement('button');
        submitBtn.type = 'submit';
        submitBtn.className = 'btn btn-primary';
        submitBtn.innerHTML = '<i class="fa fa-play"></i> Run Tool';
        actions.appendChild(submitBtn);

        var resetBtn = document.createElement('button');
        resetBtn.type = 'button';
        resetBtn.className = 'btn btn-default';
        resetBtn.textContent = 'Reset';
        resetBtn.onclick = function() {
            form.reset();
        };
        actions.appendChild(resetBtn);

        form.appendChild(actions);
        modalBody.appendChild(form);

        // Results container
        var resultsDiv = document.createElement('div');
        resultsDiv.id = 'modalResults';
        resultsDiv.style.display = 'none';
        modalBody.appendChild(resultsDiv);

        // Show modal
        document.getElementById('toolModal').classList.add('tc-active');

        // Auto-submit for tools with no fields
        if (!def.fields || def.fields.length === 0) {
            submitToolForm(category, action, form);
        }
    };

    /**
     * Close tool modal
     */
    window.closeToolModal = function() {
        document.getElementById('toolModal').classList.remove('tc-active');
    };

    /**
     * Submit tool form via AJAX
     */
    function submitToolForm(category, action, form) {
        var resultsDiv = document.getElementById('modalResults');
        var submitBtn = form.querySelector('button[type="submit"]');

        // Collect form data
        var params = {};
        var inputs = form.querySelectorAll('input, select, textarea');
        inputs.forEach(function(input) {
            if (input.name) {
                params[input.name] = input.value;
            }
        });

        // Show loading
        if (resultsDiv) {
            resultsDiv.style.display = 'block';
            resultsDiv.innerHTML = '<div class="tc-loading"><div class="tc-spinner"></div> Processing...</div>';
        }

        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Processing...';
        }

        // Make AJAX request
        var xhr = new XMLHttpRequest();
        xhr.open('POST', apiUrl, true);
        xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
        xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');

        xhr.onreadystatechange = function() {
            if (xhr.readyState !== 4) return;

            // Re-enable button
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<i class="fa fa-play"></i> Run Tool';
            }

            if (xhr.status === 200) {
                try {
                    var response = JSON.parse(xhr.responseText);
                    displayResults(resultsDiv, response);
                } catch (e) {
                    displayError(resultsDiv, 'Invalid response from server');
                }
            } else {
                displayError(resultsDiv, 'Request failed (HTTP ' + xhr.status + ')');
            }
        };

        // Build POST data
        var postData = 'category=' + encodeURIComponent(category) + 
                       '&action=' + encodeURIComponent(action);
        
        for (var key in params) {
            postData += '&params[' + encodeURIComponent(key) + ']=' + encodeURIComponent(params[key]);
        }

        xhr.send(postData);
    }

    /**
     * Display results
     */
    function displayResults(container, data) {
        if (!container) return;

        if (!data.success) {
            container.innerHTML = '<div class="tc-alert tc-alert-danger"><i class="fa fa-exclamation-circle"></i> ' + 
                (data.error || 'An error occurred') + '</div>';
            return;
        }

        var html = '<div class="tc-results-content">';
        html += '<div class="tc-result-section">';
        html += '<h4><i class="fa fa-check-circle"></i> Result</h4>';

        // Render data based on type
        if (typeof data.data === 'object' && data.data !== null) {
            html += renderObject(data.data);
        } else {
            html += '<div class="tc-result-data"><pre>' + escapeHtml(String(data.data)) + '</pre></div>';
        }

        if (data.response_time_ms) {
            html += '<div style="margin-top:10px;color:#999;font-size:0.85em;">';
            html += '<i class="fa fa-clock"></i> Completed in ' + data.response_time_ms + 'ms';
            if (data.cached) html += ' (cached)';
            html += '</div>';
        }

        html += '</div></div>';
        container.innerHTML = html;
    }

    /**
     * Render object as HTML
     */
    function renderObject(obj, level) {
        level = level || 0;
        var html = '';

        if (Array.isArray(obj)) {
            if (obj.length === 0) {
                html += '<div class="tc-result-data">(empty)</div>';
            } else if (typeof obj[0] === 'object' && obj[0] !== null) {
                // Array of objects - render as table
                html += '<div class="table-responsive"><table class="tc-result-table table">';
                // Header
                var keys = Object.keys(obj[0]).filter(function(k) {
                    return typeof obj[0][k] !== 'object' || obj[0][k] === null;
                });
                html += '<thead><tr>';
                keys.forEach(function(k) {
                    html += '<th>' + escapeHtml(k) + '</th>';
                });
                html += '</tr></thead><tbody>';
                obj.forEach(function(item) {
                    html += '<tr>';
                    keys.forEach(function(k) {
                        var val = item[k];
                        if (typeof val === 'boolean') {
                            html += '<td><span class="tc-badge-status ' + 
                                (val ? 'tc-badge-success' : 'tc-badge-danger') + '">' + 
                                (val ? 'Yes' : 'No') + '</span></td>';
                        } else {
                            html += '<td>' + escapeHtml(String(val !== null ? val : '-')) + '</td>';
                        }
                    });
                    html += '</tr>';
                });
                html += '</tbody></table></div>';
            } else {
                // Simple array
                html += '<div class="tc-result-data"><ul>';
                obj.forEach(function(item) {
                    html += '<li>' + escapeHtml(String(item)) + '</li>';
                });
                html += '</ul></div>';
            }
        } else {
            // Object
            html += '<div class="tc-result-data">';
            for (var key in obj) {
                if (!obj.hasOwnProperty(key)) continue;
                var val = obj[key];
                var label = key.replace(/_/g, ' ').replace(/([A-Z])/g, ' $1').trim();
                label = label.charAt(0).toUpperCase() + label.slice(1);

                if (typeof val === 'object' && val !== null && level < 2) {
                    html += '<div style="margin-bottom:10px;">';
                    html += '<strong>' + escapeHtml(label) + ':</strong>';
                    html += renderObject(val, level + 1);
                    html += '</div>';
                } else if (typeof val === 'boolean') {
                    html += '<div><strong>' + escapeHtml(label) + ':</strong> ';
                    html += '<span class="tc-badge-status ' + (val ? 'tc-badge-success' : 'tc-badge-danger') + '">';
                    html += (val ? 'Yes' : 'No') + '</span></div>';
                } else if (key === 'security_score' || key === 'overall_score' || key === 'health_score' || key === 'score') {
                    var score = parseInt(val) || 0;
                    var scoreClass = score >= 80 ? 'tc-score-excellent' : (score >= 60 ? 'tc-score-good' : (score >= 40 ? 'tc-score-fair' : 'tc-score-poor'));
                    html += '<div style="display:flex;align-items:center;gap:15px;margin:10px 0;">';
                    html += '<div class="tc-score ' + scoreClass + '">' + score + '</div>';
                    html += '<div><strong>' + escapeHtml(label) + '</strong></div></div>';
                } else if (key === 'raw' || key === 'raw_output') {
                    html += '<div><strong>' + escapeHtml(label) + ':</strong></div>';
                    html += '<pre>' + escapeHtml(String(val)) + '</pre>';
                } else {
                    html += '<div><strong>' + escapeHtml(label) + ':</strong> ' + escapeHtml(String(val !== null ? val : '-')) + '</div>';
                }
            }
            html += '</div>';
        }

        return html;
    }

    /**
     * Display error
     */
    function displayError(container, message) {
        if (!container) return;
        container.innerHTML = '<div class="tc-alert tc-alert-danger"><i class="fa fa-exclamation-circle"></i> ' + 
            escapeHtml(message) + '</div>';
    }

    /**
     * Clear results
     */
    window.clearResults = function() {
        var results = document.getElementById('toolResults');
        if (results) {
            results.style.display = 'none';
            document.getElementById('resultsContent').innerHTML = '';
        }
    };

    /**
     * Escape HTML
     */
    function escapeHtml(text) {
        var div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Render tool form on page
     */
    window.renderToolForm = function(category, action) {
        var def = window.toolDefinitions && window.toolDefinitions[action];
        if (!def) {
            document.getElementById('toolForm').innerHTML = '<div class="tc-alert tc-alert-danger">Tool not found</div>';
            return;
        }

        document.getElementById('currentToolName').textContent = def.title;

        var formDiv = document.getElementById('toolForm');
        var form = document.createElement('form');
        form.onsubmit = function(e) {
            e.preventDefault();
            runPageTool(category, action, form);
        };

        var title = document.createElement('h3');
        title.innerHTML = '<i class="fa fa-cog"></i> ' + def.title;
        form.appendChild(title);

        // Form fields
        if (def.fields && def.fields.length > 0) {
            def.fields.forEach(function(field) {
                var group = document.createElement('div');
                group.className = 'tc-form-group';

                var label = document.createElement('label');
                label.textContent = field.label;
                if (field.required) label.className = 'tc-required';
                group.appendChild(label);

                var input;
                if (field.type === 'textarea') {
                    input = document.createElement('textarea');
                    input.rows = field.rows || 4;
                } else if (field.type === 'select') {
                    input = document.createElement('select');
                    if (field.options) {
                        field.options.forEach(function(opt) {
                            var option = document.createElement('option');
                            option.value = opt;
                            option.textContent = opt;
                            input.appendChild(option);
                        });
                    }
                } else {
                    input = document.createElement('input');
                    input.type = field.type || 'text';
                    if (field.min) input.min = field.min;
                    if (field.max) input.max = field.max;
                    if (field.step) input.step = field.step;
                }

                input.name = field.name;
                input.className = 'form-control';
                if (field.placeholder) input.placeholder = field.placeholder;
                if (field.value) input.value = field.value;
                if (field.required) input.required = true;

                group.appendChild(input);
                form.appendChild(group);
            });
        }

        var actions = document.createElement('div');
        actions.className = 'tc-form-actions';

        var submitBtn = document.createElement('button');
        submitBtn.type = 'submit';
        submitBtn.className = 'btn btn-primary';
        submitBtn.innerHTML = '<i class="fa fa-play"></i> Run Tool';
        actions.appendChild(submitBtn);

        var clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'btn btn-default';
        clearBtn.textContent = 'Clear';
        clearBtn.onclick = function() { form.reset(); };
        actions.appendChild(clearBtn);

        form.appendChild(actions);
        formDiv.innerHTML = '';
        formDiv.appendChild(form);

        // Auto-run for no-field tools
        if (!def.fields || def.fields.length === 0) {
            runPageTool(category, action, form);
        }
    };

    /**
     * Run tool on page
     */
    function runPageTool(category, action, form) {
        var resultsDiv = document.getElementById('toolResults');
        var resultsContent = document.getElementById('resultsContent');
        var submitBtn = form.querySelector('button[type="submit"]');

        var params = {};
        var inputs = form.querySelectorAll('input, select, textarea');
        inputs.forEach(function(input) {
            if (input.name) {
                params[input.name] = input.value;
            }
        });

        resultsDiv.style.display = 'block';
        resultsContent.innerHTML = '<div class="tc-loading"><div class="tc-spinner"></div> Processing...</div>';

        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Processing...';
        }

        var xhr = new XMLHttpRequest();
        xhr.open('POST', apiUrl, true);
        xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
        xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');

        xhr.onreadystatechange = function() {
            if (xhr.readyState !== 4) return;

            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<i class="fa fa-play"></i> Run Tool';
            }

            if (xhr.status === 200) {
                try {
                    var response = JSON.parse(xhr.responseText);
                    displayResults({innerHTML: '', style: {}}, response);
                    // Render into resultsContent
                    var tempDiv = document.createElement('div');
                    displayResults(tempDiv, response);
                    resultsContent.innerHTML = tempDiv.innerHTML;
                } catch (e) {
                    resultsContent.innerHTML = '<div class="tc-alert tc-alert-danger">Invalid response</div>';
                }
            } else {
                resultsContent.innerHTML = '<div class="tc-alert tc-alert-danger">Request failed</div>';
            }
        };

        var postData = 'category=' + encodeURIComponent(category) + '&action=' + encodeURIComponent(action);
        for (var key in params) {
            postData += '&params[' + encodeURIComponent(key) + ']=' + encodeURIComponent(params[key]);
        }

        xhr.send(postData);
    }

    // Close modal on escape key
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            var modal = document.getElementById('toolModal');
            if (modal && modal.classList.contains('tc-active')) {
                closeToolModal();
            }
        }
    });

    // Close modal on background click
    document.addEventListener('click', function(e) {
        var modal = document.getElementById('toolModal');
        if (e.target === modal) {
            closeToolModal();
        }
    });

})();