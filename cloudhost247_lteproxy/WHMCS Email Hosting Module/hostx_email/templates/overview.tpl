{* HostX Email Module - Client Area Overview Template *}
{* Shows email account details, status, login links, and DNS records *}

<div class="hostx-email-module">
    {* Provider Header *}
    <div class="row">
        <div class="col-md-12">
            <div class="card mb-4">
                <div class="card-header d-flex justify-content-between align-items-center">
                    <h5 class="mb-0">
                        <i class="fas fa-envelope mr-2"></i>
                        {$provider_name} - {$plan} Plan
                    </h5>
                    <span class="badge badge-{$status_class}">
                        {if $status eq 'active'}
                            <i class="fas fa-check-circle mr-1"></i>
                        {elseif $status eq 'suspended'}
                            <i class="fas fa-pause-circle mr-1"></i>
                        {else}
                            <i class="fas fa-exclamation-circle mr-1"></i>
                        {/if}
                        {$status|capitalize}
                    </span>
                </div>
                <div class="card-body">
                    {* Email Account Details *}
                    <div class="row">
                        <div class="col-md-6">
                            <h6 class="text-muted mb-3">Account Information</h6>
                            <table class="table table-borderless table-sm">
                                <tr>
                                    <td class="text-muted" style="width: 140px;">Email Address:</td>
                                    <td>
                                        <strong>{$email_address}</strong>
                                        <button class="btn btn-xs btn-link" onclick="copyToClipboard('{$email_address}')" title="Copy to clipboard">
                                            <i class="fas fa-copy"></i>
                                        </button>
                                    </td>
                                </tr>
                                <tr>
                                    <td class="text-muted">Domain:</td>
                                    <td>{$domain}</td>
                                </tr>
                                <tr>
                                    <td class="text-muted">Username:</td>
                                    <td>{$username}</td>
                                </tr>
                                <tr>
                                    <td class="text-muted">Plan:</td>
                                    <td><span class="badge badge-info">{$plan}</span></td>
                                </tr>
                                <tr>
                                    <td class="text-muted">Created:</td>
                                    <td>{$created_at}</td>
                                </tr>
                                <tr>
                                    <td class="text-muted">Provider:</td>
                                    <td>{$provider_name}</td>
                                </tr>
                            </table>
                        </div>
                        
                        <div class="col-md-6">
                            {* Quick Login Links *}
                            <h6 class="text-muted mb-3">Quick Access</h6>
                            <div class="list-group">
                                {if $provider eq 'microsoft365'}
                                    <a href="{$login_urls.webmail}" target="_blank" class="list-group-item list-group-item-action d-flex justify-content-between align-items-center">
                                        <span><i class="fab fa-microsoft mr-2 text-primary"></i> Outlook Web Access</span>
                                        <i class="fas fa-external-link-alt text-muted"></i>
                                    </a>
                                    <a href="{$login_urls.admin}" target="_blank" class="list-group-item list-group-item-action d-flex justify-content-between align-items-center">
                                        <span><i class="fas fa-cog mr-2 text-secondary"></i> Microsoft 365 Admin</span>
                                        <i class="fas fa-external-link-alt text-muted"></i>
                                    </a>
                                {elseif $provider eq 'google_workspace'}
                                    <a href="{$login_urls.webmail}" target="_blank" class="list-group-item list-group-item-action d-flex justify-content-between align-items-center">
                                        <span><i class="fab fa-google mr-2 text-danger"></i> Gmail</span>
                                        <i class="fas fa-external-link-alt text-muted"></i>
                                    </a>
                                    <a href="{$login_urls.admin}" target="_blank" class="list-group-item list-group-item-action d-flex justify-content-between align-items-center">
                                        <span><i class="fas fa-cog mr-2 text-secondary"></i> Google Admin</span>
                                        <i class="fas fa-external-link-alt text-muted"></i>
                                    </a>
                                {else}
                                    <a href="{$login_urls.webmail}" target="_blank" class="list-group-item list-group-item-action d-flex justify-content-between align-items-center">
                                        <span><i class="fas fa-globe mr-2 text-info"></i> Webmail</span>
                                        <i class="fas fa-external-link-alt text-muted"></i>
                                    </a>
                                    <div class="list-group-item">
                                        <small class="text-muted">
                                            <strong>IMAP:</strong> {$login_urls.imap}:993 (SSL)<br>
                                            <strong>SMTP:</strong> {$login_urls.smtp}:587 (TLS)
                                        </small>
                                    </div>
                                {/if}
                            </div>
                            
                            {* Password Reset Button *}
                            <div class="mt-3">
                                <button type="button" class="btn btn-warning btn-sm btn-block" data-toggle="modal" data-target="#passwordResetModal">
                                    <i class="fas fa-key mr-2"></i> Reset Password
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
    
    {* DNS Records Section *}
    {if $enable_dns}
        <div class="row">
            <div class="col-md-12">
                <div class="card mb-4">
                    <div class="card-header">
                        <h5 class="mb-0">
                            <i class="fas fa-network-wired mr-2"></i>
                            DNS Configuration
                        </h5>
                        <small class="text-muted">Add these DNS records to your domain for proper email delivery</small>
                    </div>
                    <div class="card-body">
                        {if $dns_records|@count gt 0}
                            <div class="table-responsive">
                                <table class="table table-hover table-sm" id="dnsRecordsTable">
                                    <thead class="thead-light">
                                        <tr>
                                            <th style="width: 80px;">Type</th>
                                            <th style="width: 150px;">Host</th>
                                            <th>Priority</th>
                                            <th>Value</th>
                                            <th style="width: 50px;"></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {foreach from=$dns_records item=record}
                                            <tr>
                                                <td>
                                                    <span class="badge badge-{if $record.type eq 'MX'}primary{elseif $record.type eq 'TXT'}secondary{elseif $record.type eq 'CNAME'}info{else}light{/if}">
                                                        {$record.type}
                                                    </span>
                                                </td>
                                                <td><code>{$record.host}</code></td>
                                                <td>{if $record.priority gt 0}{$record.priority}{else}-{/if}</td>
                                                <td>
                                                    <code class="dns-value" id="dns-{$record.type}-{$record.host}">{$record.value}</code>
                                                    <small class="text-muted d-block">{$record.description}</small>
                                                </td>
                                                <td>
                                                    <button class="btn btn-xs btn-outline-secondary" onclick="copyToClipboard('{$record.value|escape:javascript}')" title="Copy value">
                                                        <i class="fas fa-copy"></i>
                                                    </button>
                                                </td>
                                            </tr>
                                        {/foreach}
                                    </tbody>
                                </table>
                            </div>
                            
                            <div class="mt-3">
                                <button type="button" class="btn btn-outline-primary btn-sm" onclick="copyAllDNSRecords()">
                                    <i class="fas fa-copy mr-2"></i> Copy All Records
                                </button>
                                <a href="https://mxtoolbox.com/SuperTool.aspx?action=mx%3a{$domain}&run=toolpage" target="_blank" class="btn btn-outline-info btn-sm ml-2">
                                    <i class="fas fa-check-circle mr-2"></i> Verify DNS
                                </a>
                            </div>
                            
                            {* SPF Record Helper *}
                            <div class="alert alert-info mt-3 mb-0">
                                <i class="fas fa-info-circle mr-2"></i>
                                <strong>Note:</strong> DNS changes may take up to 24-48 hours to propagate across the internet. 
                                Use the <strong>Verify DNS</strong> button to check if your records are live.
                            </div>
                        {else}
                            <div class="alert alert-warning mb-0">
                                <i class="fas fa-exclamation-triangle mr-2"></i>
                                No DNS records available. Please contact support.
                            </div>
                        {/if}
                    </div>
                </div>
            </div>
        </div>
    {/if}
    
    {* Status Messages *}
    {if $status eq 'suspended'}
        <div class="alert alert-warning">
            <i class="fas fa-exclamation-triangle mr-2"></i>
            <strong>Account Suspended:</strong> Your email account is currently suspended. Please contact support for assistance.
        </div>
    {/if}
</div>

{* Password Reset Modal *}
<div class="modal fade" id="passwordResetModal" tabindex="-1" role="dialog" aria-labelledby="passwordResetModalLabel" aria-hidden="true">
    <div class="modal-dialog" role="document">
        <div class="modal-content">
            <form method="post" action="clientarea.php?action=productdetails&id={$service_id}" id="passwordResetForm">
                <input type="hidden" name="modop" value="custom">
                <input type="hidden" name="a" value="resetPassword">
                <div class="modal-header">
                    <h5 class="modal-title" id="passwordResetModalLabel">
                        <i class="fas fa-key mr-2"></i>Reset Password
                    </h5>
                    <button type="button" class="close" data-dismiss="modal" aria-label="Close">
                        <span aria-hidden="true">&times;</span>
                    </button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label for="new_password">New Password</label>
                        <div class="input-group">
                            <input type="password" class="form-control" id="new_password" name="new_password" required 
                                   minlength="8" placeholder="Enter new password">
                            <div class="input-group-append">
                                <button class="btn btn-outline-secondary" type="button" onclick="togglePasswordVisibility()">
                                    <i class="fas fa-eye" id="togglePasswordIcon"></i>
                                </button>
                            </div>
                        </div>
                        <small class="form-text text-muted">Minimum 8 characters</small>
                    </div>
                    <div class="form-group">
                        <label for="confirm_password">Confirm Password</label>
                        <input type="password" class="form-control" id="confirm_password" name="confirm_password" required 
                               minlength="8" placeholder="Confirm new password">
                    </div>
                    <div class="alert alert-info">
                        <i class="fas fa-info-circle mr-2"></i>
                        Changing your password here will update it across all your email clients (Outlook, Gmail, Webmail, etc.)
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-dismiss="modal">Cancel</button>
                    <button type="submit" class="btn btn-primary" id="passwordSubmitBtn">
                        <i class="fas fa-save mr-2"></i>Update Password
                    </button>
                </div>
            </form>
        </div>
    </div>
</div>

{* JavaScript for Client Area Functionality *}
<script type="text/javascript">
    {* Copy to Clipboard Function *}
    function copyToClipboard(text) {
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(text).then(function() {
                showToast('Copied to clipboard!', 'success');
            }, function() {
                fallbackCopyToClipboard(text);
            });
        } else {
            fallbackCopyToClipboard(text);
        }
    }
    
    function fallbackCopyToClipboard(text) {
        var textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        try {
            document.execCommand('copy');
            showToast('Copied to clipboard!', 'success');
        } catch (err) {
            showToast('Failed to copy. Please copy manually.', 'error');
        }
        document.body.removeChild(textarea);
    }
    
    {* Copy All DNS Records *}
    function copyAllDNSRecords() {
        var records = [];
        var table = document.getElementById('dnsRecordsTable');
        if (table) {
            var rows = table.querySelectorAll('tbody tr');
            rows.forEach(function(row) {
                var cells = row.querySelectorAll('td');
                if (cells.length >= 4) {
                    var type = cells[0].innerText.trim();
                    var host = cells[1].innerText.trim();
                    var priority = cells[2].innerText.trim();
                    var value = cells[3].querySelector('.dns-value') ? cells[3].querySelector('.dns-value').innerText.trim() : '';
                    
                    var record = type + '\t' + host + '\t';
                    if (priority !== '-') {
                        record += priority + '\t';
                    }
                    record += value;
                    records.push(record);
                }
            });
        }
        
        if (records.length > 0) {
            copyToClipboard(records.join('\n'));
        } else {
            showToast('No records to copy', 'warning');
        }
    }
    
    {* Toggle Password Visibility *}
    function togglePasswordVisibility() {
        var passwordInput = document.getElementById('new_password');
        var icon = document.getElementById('togglePasswordIcon');
        if (passwordInput.type === 'password') {
            passwordInput.type = 'text';
            icon.classList.remove('fa-eye');
            icon.classList.add('fa-eye-slash');
        } else {
            passwordInput.type = 'password';
            icon.classList.remove('fa-eye-slash');
            icon.classList.add('fa-eye');
        }
    }
    
    {* Form Validation *}
    document.addEventListener('DOMContentLoaded', function() {
        var passwordForm = document.getElementById('passwordResetForm');
        if (passwordForm) {
            passwordForm.addEventListener('submit', function(e) {
                var password = document.getElementById('new_password').value;
                var confirmPassword = document.getElementById('confirm_password').value;
                
                if (password !== confirmPassword) {
                    e.preventDefault();
                    showToast('Passwords do not match!', 'error');
                    return false;
                }
                
                if (password.length < 8) {
                    e.preventDefault();
                    showToast('Password must be at least 8 characters long.', 'error');
                    return false;
                }
                
                // Disable submit button to prevent double submission
                var submitBtn = document.getElementById('passwordSubmitBtn');
                if (submitBtn) {
                    submitBtn.disabled = true;
                    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Updating...';
                }
                
                return true;
            });
        }
    });
    
    {* Toast Notification *}
    function showToast(message, type) {
        type = type || 'info';
        
        // Remove existing toasts
        var existingToasts = document.querySelectorAll('.hostx-toast');
        existingToasts.forEach(function(t) { t.remove(); });
        
        var toast = document.createElement('div');
        toast.className = 'alert alert-' + (type === 'error' ? 'danger' : type) + ' hostx-toast';
        toast.style.cssText = 'position: fixed; top: 20px; right: 20px; z-index: 9999; min-width: 250px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);';
        toast.innerHTML = '<i class="fas fa-' + (type === 'success' ? 'check-circle' : type === 'error' ? 'times-circle' : 'info-circle') + ' mr-2"></i>' + message;
        
        document.body.appendChild(toast);
        
        setTimeout(function() {
            if (toast.parentNode) {
                toast.remove();
            }
        }, 3000);
    }
</script>

<style type="text/css">
    .hostx-email-module .card {
        border-radius: 8px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.05);
    }
    .hostx-email-module .card-header {
        background-color: #f8f9fa;
        border-bottom: 1px solid #e9ecef;
        border-radius: 8px 8px 0 0 !important;
    }
    .hostx-email-module .table-borderless td {
        padding: 0.5rem 0;
    }
    .hostx-email-module .list-group-item {
        border-radius: 6px;
        margin-bottom: 4px;
    }
    .hostx-email-module code {
        background-color: #f8f9fa;
        padding: 2px 6px;
        border-radius: 4px;
        font-size: 0.9em;
    }
    .hostx-email-module .badge {
        font-size: 0.85em;
        padding: 0.5em 0.75em;
    }
    .hostx-email-module .btn-xs {
        padding: 0.15rem 0.4rem;
        font-size: 0.75rem;
    }
    .hostx-toast {
        animation: slideIn 0.3s ease-out;
    }
    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
</style>
