{*
    CloudHost247 Email Hosting - client area service overview (Smarty, WHMCS
    tabOverviewReplacementTemplate).

    Every value is escaped. No credential, provider payload or diagnostic is
    exposed here: unsupported capabilities are stated plainly instead.
*}
{if $accessDenied}
    <div class="alert alert-danger" role="alert">{$notice.message|escape}</div>
{else}

{if $notice}
    <div class="alert alert-{$notice.type|escape} ch247-email-notice" role="alert">{$notice.message|escape}</div>
{/if}

<div class="ch247-email-service">

    <div class="row ch247-email-summary">
        <div class="col-md-8">
            <h3 class="ch247-email-address">{$email|escape}</h3>
            <p class="text-muted">
                {$providerLabel|escape} &middot; {$planTier|escape} plan
                {if $planSku} &middot; <span title="Provider SKU">{$planSku|escape}</span>{/if}
                &middot; domain <strong>{$domain|escape}</strong>
            </p>
            <p>
                <span class="label label-{$statusClass|escape}">{$statusLabel|escape}</span>
                {if $licenseState && $licenseState != 'n/a' && $licenseState != 'unknown'}
                    <span class="label label-default">Licence: {$licenseState|escape}</span>
                {/if}
                {if $needsReconcile}
                    <span class="label label-warning">Being verified with the provider</span>
                {/if}
            </p>
        </div>
        <div class="col-md-4 text-right ch247-email-actions">
            {if $loginUrl}
                <a href="{$loginUrl|escape}" target="_blank" rel="noopener noreferrer" class="btn btn-primary">
                    {$loginLabel|escape}
                </a>
            {/if}
            {if $canRefreshStatus}
                <form method="post" action="" class="ch247-email-inline-form">
                    <input type="hidden" name="token" value="{$token|escape}">
                    <input type="hidden" name="ch247_email_action" value="refresh_status">
                    <button type="submit" class="btn btn-default">Refresh status</button>
                </form>
            {/if}
        </div>
    </div>

    <div class="row ch247-email-facts">
        <div class="col-sm-3">
            <div class="ch247-email-fact">
                <span class="ch247-email-fact__label">Storage used</span>
                <span class="ch247-email-fact__value">{$storage.used_label|escape}</span>
                {if $storage.quota_mb}<small class="text-muted">of {$storage.quota_label|escape}</small>{/if}
            </div>
            {if $storage.percent !== null}
                <div class="progress ch247-email-progress">
                    <div class="progress-bar" role="progressbar" style="width: {$storage.percent|escape}%"
                         aria-valuenow="{$storage.percent|escape}" aria-valuemin="0" aria-valuemax="100">
                        {$storage.percent|escape}%
                    </div>
                </div>
            {/if}
        </div>
        <div class="col-sm-3">
            <div class="ch247-email-fact">
                <span class="ch247-email-fact__label">DNS setup</span>
                <span class="ch247-email-fact__value">{$dnsStateLabel|escape}</span>
                {if $dnsCheckedAt}<small class="text-muted">checked {$dnsCheckedAt|escape}</small>{/if}
            </div>
        </div>
        <div class="col-sm-3">
            <div class="ch247-email-fact">
                <span class="ch247-email-fact__label">Last synchronised</span>
                <span class="ch247-email-fact__value">{if $lastSyncAt}{$lastSyncAt|escape}{else}Not yet{/if}</span>
                {if $lastSyncResult}<small class="text-muted">{$lastSyncResult|escape}</small>{/if}
            </div>
        </div>
        <div class="col-sm-3">
            <div class="ch247-email-fact">
                <span class="ch247-email-fact__label">Provider</span>
                <span class="ch247-email-fact__value">{$providerLabel|escape}</span>
            </div>
        </div>
    </div>

    {* ------------------------------------------------------------------ *}
    <div class="panel panel-default ch247-email-panel">
        <div class="panel-heading"><strong>Mailbox password</strong></div>
        <div class="panel-body">
            {if $canChangePassword}
                <form method="post" action="" class="form-horizontal ch247-email-password-form">
                    <input type="hidden" name="token" value="{$token|escape}">
                    <input type="hidden" name="ch247_email_action" value="change_password">
                    <div class="form-group">
                        <label class="col-sm-3 control-label" for="ch247-email-new-password">New password</label>
                        <div class="col-sm-5">
                            <input type="password" class="form-control" id="ch247-email-new-password"
                                   name="new_password" autocomplete="new-password" required minlength="12">
                        </div>
                    </div>
                    <div class="form-group">
                        <label class="col-sm-3 control-label" for="ch247-email-confirm-password">Confirm password</label>
                        <div class="col-sm-5">
                            <input type="password" class="form-control" id="ch247-email-confirm-password"
                                   name="confirm_password" autocomplete="new-password" required minlength="12">
                        </div>
                    </div>
                    <div class="form-group">
                        <div class="col-sm-offset-3 col-sm-9">
                            <button type="submit" class="btn btn-primary">Change password</button>
                            <p class="help-block">{$passwordPolicy|escape}</p>
                        </div>
                    </div>
                </form>
            {else}
                <p class="text-muted">
                    Password changes for {$providerLabel|escape} are handled in the provider's own console.
                </p>
            {/if}
        </div>
    </div>

    {* ------------------------------------------------------------------ *}
    <div class="panel panel-default ch247-email-panel ch247-email-dns">
        <div class="panel-heading">
            <strong>DNS records</strong>
            <span class="pull-right">
                {if $dnsRecords}
                    <button type="button" class="btn btn-xs btn-default" data-ch247-copy-all
                            data-clipboard="{$dnsCopyAll|escape}">Copy all</button>
                {/if}
            </span>
        </div>
        <div class="panel-body">
            {if $dnsRecords}
                <p class="text-muted">
                    These are the records {$providerLabel|escape} issued for {$domain|escape}. Add them wherever your
                    DNS is hosted. We never change your DNS automatically.
                </p>
                <div class="table-responsive">
                    <table class="table table-condensed ch247-email-dns-table">
                        <thead>
                            <tr>
                                <th scope="col">Purpose</th>
                                <th scope="col">Type</th>
                                <th scope="col">Host</th>
                                <th scope="col">Value</th>
                                <th scope="col">Priority</th>
                                <th scope="col">TTL</th>
                                <th scope="col"><span class="sr-only">Copy</span></th>
                            </tr>
                        </thead>
                        <tbody>
                        {foreach $dnsRecords as $record}
                            <tr>
                                <td>{$record.purpose|upper|escape}</td>
                                <td><code>{$record.type|escape}</code></td>
                                <td><code>{$record.host|escape}</code></td>
                                <td class="ch247-email-dns-value"><code>{$record.value|escape}</code></td>
                                <td>{if $record.priority !== null}{$record.priority|escape}{else}&mdash;{/if}</td>
                                <td>{if $record.ttl !== null}{$record.ttl|escape}{else}&mdash;{/if}</td>
                                <td class="text-right">
                                    <button type="button" class="btn btn-xs btn-default" data-ch247-copy
                                            data-clipboard="{$record.clipboard|escape}"
                                            aria-label="Copy the {$record.type|escape} record for {$record.host|escape}">
                                        Copy
                                    </button>
                                </td>
                            </tr>
                        {/foreach}
                        </tbody>
                    </table>
                </div>
            {elseif $dnsSupported}
                <p class="text-muted">
                    No DNS records have been retrieved for this domain yet.
                </p>
            {else}
                <p class="text-muted">
                    {$providerLabel|escape} does not publish DNS records through its API. Follow the setup instructions
                    in the provider's admin console, or contact support and we will confirm the values for you.
                </p>
            {/if}

            {if $dnsSupported}
                <form method="post" action="" class="ch247-email-inline-form">
                    <input type="hidden" name="token" value="{$token|escape}">
                    <input type="hidden" name="ch247_email_action" value="refresh_dns">
                    <button type="submit" class="btn btn-default btn-sm">Refresh and re-check DNS</button>
                </form>
            {/if}
        </div>
    </div>

    <p class="text-muted small ch247-email-footnote">
        Status and usage are read from the provider on a schedule; figures the provider does not report are shown as
        "not reported" rather than estimated. Module {$moduleVersion|escape}.
    </p>
</div>

<script>
(function () {
    'use strict';

    function flash(button, text) {
        var original = button.getAttribute('data-original') || button.textContent;
        button.setAttribute('data-original', original);
        button.textContent = text;
        window.setTimeout(function () { button.textContent = original; }, 1600);
    }

    function copy(button) {
        var value = button.getAttribute('data-clipboard') || '';

        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(value).then(function () {
                flash(button, 'Copied');
            }, function () {
                fallback(value, button);
            });
            return;
        }

        fallback(value, button);
    }

    function fallback(value, button) {
        var area = document.createElement('textarea');
        area.value = value;
        area.setAttribute('readonly', 'readonly');
        area.style.position = 'absolute';
        area.style.left = '-9999px';
        document.body.appendChild(area);
        area.select();

        try {
            document.execCommand('copy');
            flash(button, 'Copied');
        } catch (error) {
            flash(button, 'Press Ctrl+C');
        }

        document.body.removeChild(area);
    }

    document.addEventListener('click', function (event) {
        var button = event.target.closest('[data-ch247-copy], [data-ch247-copy-all]');

        if (button) {
            event.preventDefault();
            copy(button);
        }
    });
}());
</script>
{/if}
