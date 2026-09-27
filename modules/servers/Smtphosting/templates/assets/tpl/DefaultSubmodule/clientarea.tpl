
<!-- SMTP Reseller Module -->
<!-- Author: SmtpHosting.com -->
<!-- Release: 1st August, 2024 -->
<!-- Last Update: 5th November, 2025 -->
<!-- Support @ https://my.smtphosting.com/contact.php -->

<link rel="stylesheet" href="/modules/servers/Smtphosting/templates/assets/css/sh.css">
<link rel="stylesheet" href="/modules/servers/Smtphosting/branding-sh.css">

<!-- Hide unwanted sections -->

<script>
{literal}
document.addEventListener("DOMContentLoaded", function(){});
document.write('<style>.col-md-3.pull-md-left.sidebar{display:none!important;} .main-sidebar{display:none!important;} .product-details.clearfix{display:none!important;} .col-md-9.pull-md-right{width:100%!important;} .lagom-layout-left-wide .main-sidebar + .main-content, body:not(.lagom-layout-left-wide) .main-sidebar + .main-content{max-width:100%!important;} .col-lg-4.col-xl-3{display:none!important;} .primary-content{max-width:100%!important; width:100%!important;}</style>');
{/literal}
</script>

<!-- SMTP Analytics -->

<div class="smtp-card">
  <div class="smtp-card-header">
    <h3><i class="fa fa-chart-bar"></i> SMTP Analytics</h3>
  </div>
  <div class="smtp-card-body">
    <div id="mail-usage-container">
      <div id="mail-usage-spinner" class="text-center py-4">
        <div class="spinner-clean"></div>
        <p class="mt-2">Loading usage data...</p>
      </div>
      <div id="mail-usage-content" style="display:none;">
        <div class="usage-grid">
          <div class="usage-item">
            <div class="usage-value" id="mu-current-hour">0</div>
            <div class="usage-label">Sent This Hour</div>
          </div>
          <div class="usage-item">
            <div class="usage-value" id="mu-last-hour">0</div>
            <div class="usage-label">Sent Last Hour</div>
          </div>
          <div class="usage-item">
            <div class="usage-value" id="mu-max-hourly">-</div>
            <div class="usage-label">Max Per Hour</div>
          </div>
          <div class="usage-item" style="display: none">
            <div class="usage-value" id="mu-hour-percent">0%</div>
            <div class="usage-label">Hourly Usage</div>
          </div>
        </div>

        <div class="usage-progress-grid">
          <div class="usage-progress-item">
            <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
              <strong>Hourly Usage</strong>
              <span id="mu-hour-percent-text" style="margin-left: 5px">0/0</span>
            </div>
            <div class="progress-clean">
              <div id="mu-hour-progress" class="progress-bar-clean progress-hourly" style="width:0%">0/0</div>
            </div>
          </div>
        
          <div class="usage-progress-item">
            <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
              <strong>Monthly Usage</strong>
              <span id="mu-month-percent-text" style="margin-left: 5px">0/0</span>
            </div>
            <div class="progress-clean">
              <div id="mu-month-progress" class="progress-bar-clean progress-monthly" style="width:0%; min-width: 25%">0/0</div>
            </div>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; font-size: 14px;">
          <div><strong>Server:</strong> <span id="mu-hostname">-</span></div>
          <div><strong>Domain:</strong> <span id="mu-domain">-</span></div>
          <div><strong>Last Updated:</strong> <span id="mu-collected-at">-</span></div>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- Detailed Status -->

<div class="smtp-card si-sh-card" style="box-shadow: none; border: none">
  <div class="si-sh-card-body">
    <div class="si-sh-service-grid">
    <!-- Service Information -->
      <div class="si-sh-service-card si-sh-service-details">
        <div class="si-sh-card-header-inner" style="background: var(--primarySH); color: white">
          <i class="fa fa-id-card" style="color: white"></i>
          <span>Service Information</span>
          <div class="si-sh-status-badge si-sh-status-{$status|lower}">{$status}</div>
        </div>
        <div class="si-sh-card-content">
          <div class="si-sh-info-row">
            <div class="si-sh-info-label">
              <i class="fa fa-cube"></i>
              <span>Package</span>
            </div>
            <div class="si-sh-info-value">{$product}</div>
          </div>
          <div class="si-sh-info-row">
            <div class="si-sh-info-label">
              <i class="fa fa-tag"></i>
              <span>Pricing</span>
            </div>
            <div class="si-sh-info-value">{$recurringamount} / {$billingcycle}</div>
          </div>
          <div class="si-sh-info-row">
            <div class="si-sh-info-label">
              <i class="fa fa-calendar-plus"></i>
              <span>Registered On</span>
            </div>
            <div class="si-sh-info-value">{$regdate}</div>
          </div>
          <div class="si-sh-info-row">
            <div class="si-sh-info-label">
              <i class="fa fa-calendar-check"></i>
              <span>Due Date</span>
            </div>
            <div class="si-sh-info-value">{$nextduedate}</div>
          </div>
          <div class="si-sh-info-row si-sh-highlight">
            <div class="si-sh-info-label">
              <i class="fa fa-wallet"></i>
              <span>Prepay Balance</span>
            </div>
            <div class="si-sh-info-value">
              {$client.credit|formatCurrency:$currency}
              <a target="_blank" href="/clientarea.php?action=addfunds" class="si-sh-funds-link">
                <i class="fa fa-plus-circle"></i> Add Funds
              </a>
            </div>
          </div>
        </div>
      </div>

      <!-- Quick Actions Card -->
      <div class="si-sh-service-card si-sh-service-actions">
        <div class="si-sh-card-header-inner"  style="background: var(--secondarySH); color: white">
          <i class="fa fa-rocket" style="color: white"></i>
          <span>Quick Actions</span>
        </div>
        <div class="si-sh-action-buttons">
          <a target="_blank" href="/clientarea.php?action=productdetails&id={$serviceid}#tabChangepw" class="si-sh-action-btn si-sh-password">
            <div class="si-sh-action-icon">
              <i class="fa fa-key"></i>
            </div>
            <div class="si-sh-action-text">
              <span>Change Password</span>
              <small>Update SMTP credentials</small>
            </div>
            <i class="fa fa-chevron-right si-sh-action-arrow"></i>
          </a>
          
          <a href="/upgrade.php?type=package&id={$serviceid}" class="si-sh-action-btn si-sh-upgrade">
            <div class="si-sh-action-icon">
              <i class="fa fa-chart-line"></i>
            </div>
            <div class="si-sh-action-text">
              <span>Upgrade Plan</span>
              <small>Increase your limits</small>
            </div>
            <i class="fa fa-chevron-right si-sh-action-arrow"></i>
          </a>
          
          <a href="/service-renewals/{$serviceid}" class="si-sh-action-btn si-sh-renew">
            <div class="si-sh-action-icon">
              <i class="fa fa-redo"></i>
            </div>
            <div class="si-sh-action-text">
              <span>Renew Service</span>
              <small>Extend subscription</small>
            </div>
            <i class="fa fa-chevron-right si-sh-action-arrow"></i>
          </a>
          
          <a href="/clientarea.php?action=cancel&id={$serviceid}" class="si-sh-action-btn si-sh-cancel">
            <div class="si-sh-action-icon">
              <i class="fa fa-times-circle"></i>
            </div>
            <div class="si-sh-action-text">
              <span>Cancel Service</span>
              <small>Terminate account</small>
            </div>
            <i class="fa fa-chevron-right si-sh-action-arrow"></i>
          </a>
        </div>
      </div>

    </div>
  </div>
</div>

<!-- DNS Configuration -->

<div class="smtp-card">
  <div class="smtp-card-header">
    <h3><i class="fa fa-globe"></i> DNS Configuration</h3>
  </div>
  <div class="smtp-card-body">
    <div class="dns-section">
      <table class="dns-table">
        <thead>
          <tr>
            <th>Status</th>
            <th>Record Name</th>
            <th>Type</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody id="dns-records-body">
          <tr data-record-type="spf" data-record-value="include:spf.maildns.net">
            <td class="dns-status"><i class="fas fa-spinner fa-spin" title="Checking..."></i></td>
            <td class="dns-record-name" onclick="copyDnsValueMrx(event, this)">{$domain}</td>
            <td>TXT</td>
            <td class="dns-record-value" onclick="copyDnsValueMrx(event, this)">v=spf1 +mx +a include:spf.maildns.net ~all</td>
          </tr>
          <tr data-record-type="dmarc" data-record-value="v=DMARC1">
            <td class="dns-status"><i class="fas fa-spinner fa-spin" title="Checking..."></i></td>
            <td class="dns-record-name" onclick="copyDnsValueMrx(event, this)">_dmarc.{$domain}</td>
            <td>TXT</td>
            <td class="dns-record-value" onclick="copyDnsValueMrx(event, this)">v=DMARC1; p=none</td>
          </tr>
          <tr data-record-type="dkim" data-record-value="k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...">
            <td class="dns-status"><i class="fas fa-spinner fa-spin" title="Checking..."></i></td>
            <td class="dns-record-name" onclick="copyDnsValueMrx(event, this)">default._domainkey.{$domain}</td>
            <td>TXT</td>
            <td class="dns-record-value" id="dkim-record-value" onclick="copyDnsValueMrx(event, this)">k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div style="text-align: center; font-size: 14px;">
      <p><i class="fas fa-qrcode"></i> Click any value to copy it.</p>
    </div>
  </div>
</div>

<!-- Integration Settings -->

<div class="smtp-card">
  <div class="smtp-card-header">
    <h3><i class="fa fa-plug"></i> Integration Settings</h3>
  </div>
  <div class="smtp-card-body">
    <div class="integration-cards">
      <!-- SSL Card -->
      <div class="integration-card ssl" style="position: relative; overflow: visible;">
        <div class="protocol-title">
          <i class="fas fa-lock" style="color: var(--successSH); margin-right: 5px" title="Recommended"></i> SSL Encryption
          <span class="port">Port 465</span>
        </div>
        <div class="input-group-clean" style="display: flex; align-items: center;">
          <div class="input-label" style="width:100%">Server</div>
          <input id="mu-hostname-input-ssl" onClick="this.select(); copyToClipboard(this)" class="input-field" value="" style="flex:1;">
        </div>
        <div class="input-group-clean" style="display: flex; align-items: center;">
          <div class="input-label" style="width:100%">Username</div>
          <input onClick="this.select(); copyToClipboard(this)" class="input-field" value="{$username}" style="flex:1;">
        </div>
        <div class="input-group-clean" style="display: flex; align-items: center;">
          <div class="input-label" style="width:100%">Password</div>
          <div class="password-wrapper" style="position: relative; flex:1;">
            <input onClick="this.select(); copyToClipboard(this)" class="input-field" type="password" id="password-field-ssl" value="{$password}" style="width: calc(100% - 40px); padding-right: 40px;">
            <button class="password-toggle" onclick="viewPassword('password-field-ssl', this)" style="position: absolute; right: 0; top: 50%; transform: translateY(-50%); border: none; background: transparent; cursor: pointer; z-index: 20; font-size: 16px; color: #6c757d;">
              <i class="fa fa-eye"></i>
            </button>
          </div>
        </div>
      </div>

      <!-- TLS Card -->
      <div class="integration-card tls" style="position: relative; overflow: visible;">
        <div class="protocol-title">
          <i class="fas fa-lock" style="color: var(--infoSH); margin-right: 5px" title="Recommended"></i> TLS Encryption
          <span class="port">Port 587</span>
        </div>
        <div class="input-group-clean" style="display: flex; align-items: center;">
          <div class="input-label" style="width:100%">Server</div>
          <input id="mu-hostname-input-tls" onClick="this.select(); copyToClipboard(this)" class="input-field" value="" style="flex:1;">
        </div>
        <div class="input-group-clean" style="display: flex; align-items: center;">
          <div class="input-label" style="width:100%">Username</div>
          <input onClick="this.select(); copyToClipboard(this)" class="input-field" value="{$username}" style="flex:1;">
        </div>
        <div class="input-group-clean" style="display: flex; align-items: center;">
          <div class="input-label" style="width:100%">Password</div>
          <div class="password-wrapper" style="position: relative; flex:1;">
            <input onClick="this.select(); copyToClipboard(this)" class="input-field" type="password" id="password-field-tls" value="{$password}" style="width: calc(100% - 40px); padding-right: 40px;">
            <button class="password-toggle" onclick="viewPassword('password-field-tls', this)" style="position: absolute; right: 0; top: 50%; transform: translateY(-50%); border: none; background: transparent; cursor: pointer; z-index: 20; font-size: 16px; color: #6c757d;">
              <i class="fa fa-eye"></i>
            </button>
          </div>
        </div>
      </div>

      <!-- None Card -->
      <div class="integration-card none" style="position: relative; overflow: visible;">
        <div class="protocol-title">
          <i class="fas fa-lock-open" style="color: var(--dangerSH); margin-right: 5px" title="Not Recommended"></i>No Encryption
          <span class="port">Port 25</span>
        </div>
        <div class="input-group-clean" style="display: flex; align-items: center;">
          <div class="input-label" style="width:100%">Server</div>
          <input id="mu-hostname-input-none" onClick="this.select(); copyToClipboard(this)" class="input-field" value="" style="flex:1;">
        </div>
        <div class="input-group-clean" style="display: flex; align-items: center;">
          <div class="input-label" style="width:100%">Username</div>
          <input onClick="this.select(); copyToClipboard(this)" class="input-field" value="{$username}" style="flex:1;">
        </div>
        <div class="input-group-clean" style="display: flex; align-items: center;">
          <div class="input-label" style="width:100%">Password</div>
          <div class="password-wrapper" style="position: relative; flex:1;">
            <input onClick="this.select(); copyToClipboard(this)" class="input-field" type="password" id="password-field-none" value="{$password}" style="width: calc(100% - 40px); padding-right: 40px;">
            <button class="password-toggle" onclick="viewPassword('password-field-none', this)" style="position: absolute; right: 0; top: 50%; transform: translateY(-50%); border: none; background: transparent; cursor: pointer; z-index: 20; font-size: 16px; color: #6c757d;">
              <i class="fa fa-eye"></i>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- Sent Mail Logs -->

<div class="smtp-card">
  <div class="smtp-card-header">
    <h3><i class="fa fa-envelope"></i> Sent Mail Logs</h3>
  </div>
  <div class="smtp-card-body">
    <div id="mail-logs-container">
      <div id="mail-logs-spinner" style="text-align:center; padding:40px;">
        <div class="spinner-clean"></div>
        <p class="mt-2">Loading mail logs...</p>
      </div>
      
      <div class="table-container">
        <table id="mail-logs-table" class="table-clean" style="display:none;">
          <thead>
            <tr>
              <th>Time</th>
              <th>Email</th>
              <th>Size</th>
              <th>Host</th>
              <th>Status</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
      
      <div id="mail-logs-pagination" class="pagination-clean" style="display:none;"></div>
    </div>
  </div>
</div>

<!-- Functions -->

<script type="text/javascript">
{literal}

function copyToClipboard(element) {
  element.select();
  document.execCommand("copy");
  
  // Show temporary feedback
  var originalText = element.value;
  element.value = "Copied!";
  setTimeout(function() {
    element.value = originalText;
  }, 1000);
}

function showToast(message) {
  var toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: var(--successSH);
    color: white;
    padding: 12px 20px;
    border-radius: var(--border-radiusSH);
    z-index: 10001;
    font-weight: 500;
    box-shadow: var(--box-shadowSH);
  `;
  toast.textContent = message;
  document.body.appendChild(toast);
  
  setTimeout(function() {
    document.body.removeChild(toast);
  }, 2000);
}

function viewPassword(fieldId, button) {
  var passwordInput = document.getElementById(fieldId);
  var icon = button.querySelector('i');

  if (passwordInput.type == 'password') {
    passwordInput.type='text';
    icon.className='fa fa-eye-slash';
  } else {
    passwordInput.type='password';
    icon.className='fa fa-eye';
  }
}

function loadMailUsage() {
  var spinner = document.getElementById('mail-usage-spinner');
  var content = document.getElementById('mail-usage-content');

  spinner.style.display = 'block';
  content.style.display = 'none';

  var xhr = new XMLHttpRequest();
  xhr.open('GET', '/modules/servers/Smtphosting/smtp-api.php?fn=usage&secret={/literal}lmjHzI2OR1cxk8DAehvhxtN5it5YutZwX5B3{literal}&user_name={/literal}{$username}{literal}&main_domain={/literal}{$domain}{literal}', true);
  xhr.onload = function() {
    spinner.style.display = 'none';
    if (xhr.status === 200) {
      var response = JSON.parse(xhr.responseText);
      if(response.status === 'ok' && response.records.length > 0){
        var record = response.records[0];

        document.getElementById('mu-hostname').innerText = record.hostname || '-';
        document.getElementById('mu-hostname-input-ssl').value = record.hostname || '-';
        document.getElementById('mu-hostname-input-tls').value = record.hostname || '-';
        document.getElementById('mu-hostname-input-none').value = record.hostname || '-';
        document.getElementById('mu-domain').innerText = record.main_domain || '-';
        document.getElementById('mu-max-hourly').innerText = record.max_hourly || '-';
        document.getElementById('mu-current-hour').innerText = record.current_hour_count || '0';
        document.getElementById('mu-last-hour').innerText = record.last_hour_count || '0';
        document.getElementById('mu-collected-at').innerText = record.collected_at ? new Date(record.collected_at + ' UTC').toLocaleString('en-US', { hour12: true }) : '-';

        // Hourly usage progress
        var hourlyPercent = record.max_hourly && record.max_hourly != 0 ? Math.min(Math.round((record.current_hour_count/record.max_hourly)*100),100) : 0;
        var hourBar = document.getElementById('mu-hour-progress');
        hourBar.style.width = hourlyPercent + '%';
        hourBar.innerText = record.current_hour_count + '/' + record.max_hourly;
        document.getElementById('mu-hour-percent-text').innerText = record.current_hour_count + '/' + record.max_hourly;

        // Monthly limit = hourly limit x 24 x days in month
        var now = new Date();
        var year = now.getFullYear();
        var month = now.getMonth();
        var daysInMonth = new Date(year, month+1, 0).getDate();
        var maxMonthly = record.max_hourly * 24 * daysInMonth;
        var monthlyPercent = Math.min(Math.round((record.current_month_count/maxMonthly)*100),100);
        var monthBar = document.getElementById('mu-month-progress');
        monthBar.style.width = monthlyPercent + '%';
        monthBar.innerText = record.current_month_count + '/' + maxMonthly;
        document.getElementById('mu-month-percent-text').innerText = record.current_month_count + '/' + maxMonthly;

        // Update DKIM record if available
        if(record.dkim) {
          document.getElementById('dkim-record-value').innerText = record.dkim;
        }
        content.style.display = 'block';
        // Run DNS check AFTER all content is loaded
        setTimeout(checkDNSRecords, 100);
        
      } else {
        content.innerHTML = '<p class="text-center text-muted">No usage data found</p>';
        content.style.display = 'block';
      }
    } else {
      content.innerHTML = '<p class="text-center text-danger">Failed to load usage data</p>';
      content.style.display = 'block';
    }
    
  };
  xhr.send();
}

function loadMailLogs(page = 1) {
  var spinner = document.getElementById('mail-logs-spinner');
  var table = document.getElementById('mail-logs-table');
  var tbody = table.querySelector('tbody');
  var pagination = document.getElementById('mail-logs-pagination');

  spinner.style.display = 'block';
  table.style.display = 'none';
  pagination.style.display = 'none';
  tbody.innerHTML = '';

  var perPage = 10;
  var xhr = new XMLHttpRequest();
  xhr.open('GET', '/modules/servers/Smtphosting/smtp-api.php?fn=logs&secret={/literal}tiWlB6R1PlyKXUJICSm4tVrdOxVuFgAQOKnJ{literal}&user_name={/literal}{$username}{literal}&main_domain={/literal}{$domain}{literal}&page=' + page + '&per_page=' + perPage, true);
  xhr.onload = function() {
    spinner.style.display = 'none';
    if (xhr.status !== 200) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">Failed to load logs</td></tr>';
      table.style.display = 'table';
      return;
    }

    var response = JSON.parse(xhr.responseText);
    if (response.status !== 'ok') {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">' + response.msg + '</td></tr>';
      table.style.display = 'table';
      return;
    }

    var sends = response.records.sends || [];
    var failures = response.records.failures || [];
    var allRecords = [];

    sends.forEach(function(item){
      allRecords.push({
        sendtime_utc: item.sendtime_utc || '-',
        email: item.email || '-',
        size: item.size || '-',
        domain: item.host || '-',
        status: 'Sent',
        details: JSON.stringify(item, null, 2)
      });
    });

    failures.forEach(function(item){
      allRecords.push({
        sendtime_utc: item.sendtime_utc || '-',
        email: item.email || '-',
        size: '-',
        domain: item.deliverydomain || '-',
        status: 'Failed',
        details: JSON.stringify(item, null, 2)
      });
    });

    allRecords.sort(function(a,b){
      return new Date(b.sendtime_utc) - new Date(a.sendtime_utc);
    });

    if(allRecords.length === 0){
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">No records found</td></tr>';
      table.style.display = 'table';
      return;
    }

    var start = (page-1)*perPage;
    var end = start+perPage;
    var paginatedRecords = allRecords.slice(start,end);

    paginatedRecords.forEach(function(item){
      var tr = document.createElement('tr');
      var localTime = item.sendtime_utc !== '-' ? new Date(item.sendtime_utc + ' UTC').toLocaleString() : '-';
      var statusClass = item.status === 'Sent' ? 'badge-success' : 'badge-danger';

      tr.innerHTML = '<td style="font-family: \'Courier New\', monospace; font-size: 13px;">' + localTime + '</td>' +
                     '<td>' + item.email + '</td>' +
                     '<td style="font-family: \'Courier New\', monospace; font-weight: 600;">' + item.size + '</td>' +
                     '<td>' + item.domain + '</td>' +
                     '<td><span class="badge ' + statusClass + '">' + item.status + '</span></td>' +
                     '<td><div class="mail-tooltip-container">' +
                     '<button class="btn-clean">View</button>' +
                     '<div class="mail-tooltip-content">' + item.details + '</div>' +
                     '</div></td>';
      tbody.appendChild(tr);
    });

    table.style.display = 'table';
    pagination.style.display = 'flex';

    // Pagination buttons
    var totalPages = Math.ceil(allRecords.length/perPage);
    var prevBtn = page > 1 ? '<button onclick="loadMailLogs(' + (page-1) + ')">Previous</button>' : '<button disabled>Previous</button>';
    var nextBtn = page < totalPages ? '<button onclick="loadMailLogs(' + (page+1) + ')">Next</button>' : '<button disabled>Next</button>';
    pagination.innerHTML = prevBtn + '<div class="page-info">Page ' + page + ' of ' + totalPages + '</div>' + nextBtn;

    // Tooltip events
    document.querySelectorAll('.mail-tooltip-container').forEach(function(container){
      var btn = container.querySelector('button');

      btn.addEventListener('click', function(e){
        document.querySelectorAll('.mail-tooltip-container').forEach(function(c){
          if(c !== container) c.classList.remove('show');
        });
        container.classList.toggle('show');
        e.stopPropagation();
      });
    });

    document.addEventListener('click', function(){
      document.querySelectorAll('.mail-tooltip-container').forEach(function(container){
        container.classList.remove('show');
      });
    });

  };
  xhr.send();
}

function copyDnsValueMrx(e, el) {
  var text = el.innerText || el.textContent || '';
  if (!text) return;

  // copy
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text);
  } else {
    var ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }

  // remove any existing tooltip
  document.querySelectorAll('.copy-tooltip').forEach(function(n){ n.remove(); });

  // create tooltip
  var tooltip = document.createElement('div');
  tooltip.className = 'copy-tooltip';
  tooltip.textContent = 'Copied!';
  tooltip.style.cssText = [
    'position: absolute',
    'background: var(--successSH)',
    'color: white',
    'padding: 6px 10px',
    'border-radius: 6px',
    'font-size: 12px',
    'font-weight: 600',
    'pointer-events: none',
    'transform: translate(-50%, -100%)',
    'white-space: nowrap',
    'z-index: 99999',
    'box-shadow: var(--box-shadowSH)'
  ].join(';');

  document.body.appendChild(tooltip);

  // position above mouse click
  var x = e.clientX + window.scrollX;
  var y = e.clientY + window.scrollY;
  // offset a bit above pointer
  var offsetY = 12;
  tooltip.style.left = x + 'px';
  tooltip.style.top = (y - offsetY) + 'px';

  // ensure tooltip stays inside viewport horizontally
  var rect = tooltip.getBoundingClientRect();
  var overRight = rect.right - window.innerWidth;
  if (overRight > 0) tooltip.style.left = (x - overRight - 8) + 'px';
  var overLeft = rect.left;
  if (overLeft < 8) tooltip.style.left = (x + (8 - overLeft)) + 'px';

  setTimeout(function(){ tooltip.remove(); }, 1000);
}

function checkDNSRecords() {
  const rows = document.querySelectorAll('.dns-table tbody tr');
  rows.forEach(row => {
    const recordType = row.dataset.recordType;
    const expectedValue = row.dataset.recordValue;
    const recordName = row.querySelector('.dns-record-name').innerText.trim();
    const valueCell = row.querySelector('.dns-record-value');

    // Add status cell if not exists
    let statusCell = row.querySelector('.dns-status');
    if(!statusCell) {
      statusCell = document.createElement('td');
      statusCell.className = 'dns-status';
      statusCell.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
      row.insertBefore(statusCell, row.firstChild);
    } else {
      statusCell.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    }
    const statusIcon = statusCell.querySelector('i');

    // Get the current value (from cell text or dataset)
    const currentValue = valueCell.innerText.trim() || expectedValue;

    // Async fetch DNS TXT records
    fetch(`https://dns.google/resolve?name=${recordName}&type=TXT`)
      .then(res => res.json())
      .then(data => {
        let found = false;
        let info = '';
        if(data.Answer && data.Answer.length > 0) {
          data.Answer.forEach(ans => {
            const txt = ans.data.replace(/"/g,'').trim();
            info += txt + ' ';
            if(recordType === 'dkim') {
              const cleanExpected = currentValue.replace(/\s+/g, '').replace(/;+$/, '').toUpperCase();
              const cleanTxt = txt.replace(/\s+/g, '').replace(/;+$/, '').toUpperCase();
              
              if(cleanTxt === cleanExpected) found = true;
              else if(cleanTxt.includes('DKIM1') && cleanExpected.includes('DKIM1')) {
                const expectedKey = cleanExpected.match(/P=[A-Z0-9+]+/i);
                const foundKey = cleanTxt.match(/P=[A-Z0-9+]+/i);
                if(expectedKey && foundKey && expectedKey[0] === foundKey[0]) found = true;
              }
            } else if(recordType === 'spf') {
              if(txt.includes('include:spf.maildns.net')) found = true;
            } else if(recordType === 'dmarc') {
              if(txt.toUpperCase().includes('V=DMARC1')) found = true;
            }
          });
        }

        // Update status
        if(found) {
          statusIcon.className = 'fas fa-check-circle';
          statusIcon.style.color = 'green';
          statusIcon.title = info.trim() || 'Record found';
        } else {
          statusIcon.className = 'fas fa-times-circle';
          statusIcon.style.color = 'red';
          statusIcon.title = info.trim() || 'Record not found';
        }
      })
      .catch(err => {
        statusIcon.className = 'fas fa-exclamation-circle';
        statusIcon.style.color = 'orange';
        statusIcon.title = 'Error checking record';
      });
  });
}

document.addEventListener('DOMContentLoaded', function(){
  loadMailUsage();
  loadMailLogs();
});
{/literal}
</script>

{* End of SMTP dashboard *}


{if $configURL}
    <div class="panel panel-default">
        <div class="alert alert-info">
            {$MGLANG->T('awaitingConfigurationAlert')}
        </div>
        <a class="btn btn-primary" href="{$configURL}">{$MGLANG->T('awaitingConfiguration')}</a>
    </div>
{else}
    {if $details}
        <div class="panel panel-default">
            <div class="panel-heading"><b>Information</b></div>
            <table class="table">
                <tbody>
                {foreach from=$details key=name item=value}
                    <tr>
                        <td>{$name}</td>
                        <td class="text-secondary">

                            {if $name =="Status"}
                                <span class="{if $value=='Running'}text-success{else}text-danger{/if}">
                     <i class="glyphicon glyphicon-play-circle"></i>
                       {$value}
                   </span>
                            {else}
                                {$value}
                            {/if}
                        </td>
                    </tr>
                {/foreach}
                </tbody>
            </table>
        </div>
    {/if}
{/if}