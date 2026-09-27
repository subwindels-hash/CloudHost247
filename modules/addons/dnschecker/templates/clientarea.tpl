{* DNS Checker - Client Area Template *}
{* Compatible with WHMCS 8.x default themes (Bootstrap 4/5) *}

<style type="text/css">
.dnschecker-spinner {
    display: inline-block;
    width: 2rem;
    height: 2rem;
    border: 0.25em solid #337ab7;
    border-right-color: transparent;
    border-radius: 50%;
    animation: dnschecker-spin 0.75s linear infinite;
    vertical-align: middle;
    margin-right: 0.5em;
}
@keyframes dnschecker-spin {
    to { transform: rotate(360deg); }
}
.dnschecker-result-table th,
.dnschecker-result-table td {
    vertical-align: middle !important;
}
.dnschecker-badge {
    display: inline-block;
    padding: 0.25em 0.4em;
    font-size: 75%;
    font-weight: 700;
    line-height: 1;
    text-align: center;
    white-space: nowrap;
    vertical-align: baseline;
    border-radius: 0.25rem;
}
.dnschecker-badge-success {
    color: #fff;
    background-color: #28a745;
}
.dnschecker-badge-warning {
    color: #212529;
    background-color: #ffc107;
}
.dnschecker-record-list {
    margin: 5px 0 0 0;
    padding: 0;
    list-style: none;
}
.dnschecker-record-list li {
    font-size: 12px;
    word-break: break-all;
    padding: 2px 0;
    border-bottom: 1px dotted #eee;
}
.dnschecker-record-list li:last-child {
    border-bottom: none;
}
.dnschecker-server-name {
    font-weight: 600;
    color: #333;
}
</style>

<div class="card">
    <div class="card-header">
        <h3 class="m-0"><i class="fas fa-globe"></i> DNS Propagation Checker</h3>
    </div>
    <div class="card-body">
        <p>Enter a domain name below to check DNS propagation across multiple global DNS servers in real-time.</p>

        <form id="dnschecker-form" method="post" action="{$modulelink nofilter}" data-action="{$modulelink nofilter}&amp;action=check">
            <div class="form-group">
                <label for="dnschecker-domain"><strong>Domain Name</strong></label>
                <div class="input-group">
                    <input type="text" name="domain" id="dnschecker-domain" class="form-control" placeholder="example.com" required autocomplete="off" autocorrect="off" autocapitalize="none">
                    <span class="input-group-btn">
                        <button type="submit" class="btn btn-primary" id="dnschecker-btn">
                            <span class="btn-text">Check DNS</span>
                            <span class="btn-loading" style="display:none;">Checking...</span>
                        </button>
                    </span>
                </div>
                <small class="form-text text-muted">Enter domain without http:// or www (e.g., example.com)</small>
            </div>
        </form>

        <div id="dnschecker-loading" style="display:none; text-align:center; margin:30px 0;">
            <div class="dnschecker-spinner"></div>
            <p class="text-muted mt-2">Querying DNS servers worldwide... This may take a few seconds.</p>
        </div>

        <div id="dnschecker-error" class="alert alert-danger" style="display:none; margin-top:15px;"></div>

        <div id="dnschecker-results" style="display:none; margin-top:20px;">
            <h4 class="mb-3">Results for <code id="result-domain"></code></h4>
            <div class="table-responsive">
                <table class="table table-striped table-bordered dnschecker-result-table">
                    <thead class="thead-dark">
                        <tr>
                            <th style="width:18%;">DNS Server</th>
                            <th style="width:14%;">Server IP</th>
                            {foreach from=$recordtypes item=rtype}
                            <th>{$rtype} Records</th>
                            {/foreach}
                        </tr>
                    </thead>
                    <tbody id="results-tbody">
                    </tbody>
                </table>
            </div>
        </div>
    </div>
</div>

<script type="text/javascript">
(function() {
    var form = document.getElementById('dnschecker-form');
    var actionUrl = form.getAttribute('data-action').replace(/&amp;/g, '&');

    form.addEventListener('submit', function(e) {
        e.preventDefault();

        var domainInput = document.getElementById('dnschecker-domain');
        var domain = domainInput.value.trim();

        if (!domain) {
            alert('Please enter a domain name.');
            return;
        }

        var btn = document.getElementById('dnschecker-btn');
        var loading = document.getElementById('dnschecker-loading');
        var resultsDiv = document.getElementById('dnschecker-results');
        var errorDiv = document.getElementById('dnschecker-error');

        btn.disabled = true;
        btn.querySelector('.btn-text').style.display = 'none';
        btn.querySelector('.btn-loading').style.display = 'inline';
        loading.style.display = 'block';
        resultsDiv.style.display = 'none';
        errorDiv.style.display = 'none';
        errorDiv.innerHTML = '';

        var formData = new FormData();
        formData.append('domain', domain);

        var tokenInput = document.querySelector('input[name="token"]');
        if (tokenInput) {
            formData.append('token', tokenInput.value);
        }

        var request = new XMLHttpRequest();
        request.open('POST', actionUrl, true);
        request.setRequestHeader('X-Requested-With', 'XMLHttpRequest');

        request.onreadystatechange = function() {
            if (request.readyState !== 4) {
                return;
            }

            loading.style.display = 'none';
            btn.disabled = false;
            btn.querySelector('.btn-text').style.display = 'inline';
            btn.querySelector('.btn-loading').style.display = 'none';

            if (request.status !== 200) {
                errorDiv.textContent = 'An error occurred (HTTP ' + request.status + '). Please try again.';
                errorDiv.style.display = 'block';
                return;
            }

            var data;
            try {
                data = JSON.parse(request.responseText);
            } catch (err) {
                errorDiv.textContent = 'Invalid response from server. Please try again.';
                errorDiv.style.display = 'block';
                return;
            }

            if (data.error) {
                errorDiv.textContent = data.error;
                errorDiv.style.display = 'block';
                return;
            }

            renderResults(data);
        };

        request.onerror = function() {
            loading.style.display = 'none';
            btn.disabled = false;
            btn.querySelector('.btn-text').style.display = 'inline';
            btn.querySelector('.btn-loading').style.display = 'none';
            errorDiv.textContent = 'Network error. Please check your connection and try again.';
            errorDiv.style.display = 'block';
        };

        request.send(formData);
    });

    function renderResults(data) {
        document.getElementById('result-domain').textContent = data.domain;

        var tbody = document.getElementById('results-tbody');
        tbody.innerHTML = '';

        for (var i = 0; i < data.results.length; i++) {
            var server = data.results[i];
            var row = document.createElement('tr');

            var nameCell = document.createElement('td');
            nameCell.innerHTML = '<span class="dnschecker-server-name">' + escapeHtml(server.name) + '</span>';
            row.appendChild(nameCell);

            var ipCell = document.createElement('td');
            ipCell.innerHTML = '<small class="text-muted">' + escapeHtml(server.ip) + '</small>';
            row.appendChild(ipCell);

            for (var type in server.records) {
                if (!server.records.hasOwnProperty(type)) {
                    continue;
                }
                var records = server.records[type];
                var cell = document.createElement('td');

                if (records.length > 0) {
                    var badge = document.createElement('span');
                    badge.className = 'dnschecker-badge dnschecker-badge-success';
                    badge.textContent = 'Propagated';
                    cell.appendChild(badge);

                    var list = document.createElement('ul');
                    list.className = 'dnschecker-record-list';
                    for (var r = 0; r < records.length; r++) {
                        var li = document.createElement('li');
                        li.textContent = records[r];
                        list.appendChild(li);
                    }
                    cell.appendChild(list);
                } else {
                    var badge = document.createElement('span');
                    badge.className = 'dnschecker-badge dnschecker-badge-warning';
                    badge.textContent = 'Not Found';
                    cell.appendChild(badge);
                }

                row.appendChild(cell);
            }

            tbody.appendChild(row);
        }

        document.getElementById('dnschecker-results').style.display = 'block';
    }

    function escapeHtml(text) {
        var div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
})();
</script>
