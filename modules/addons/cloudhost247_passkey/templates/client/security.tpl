{*
    Passkey management panel for the client area security page.

    Drop-in include for templates/<theme>/clientareasecurity.tpl:

        {include file="$template/../../modules/addons/cloudhost247_passkey/templates/client/security.tpl"}

    Every value it needs is supplied by the ClientAreaPage hook in
    modules/addons/cloudhost247_passkey/hooks.php. If the addon is disabled or
    misconfigured the hook supplies nothing and this panel renders nothing.
*}
{if $passkeyEnabled}
<div class="passkey-panel" id="passkey-panel">
    <h3 class="passkey-panel__title">Passkeys</h3>
    <p class="passkey-panel__hint">
        A passkey lets you sign in with your device's fingerprint, face or screen lock instead of a password.
        Your biometric data never leaves your device &mdash; we only store a public key.
    </p>

    <div data-passkey-unsupported class="alert alert-info">
        This browser does not support passkeys. You can still sign in with your password.
    </div>

    <div data-passkey-only>
        {if $passkeyCredentials}
            <ul class="passkey-list">
                {foreach from=$passkeyCredentials item=credential}
                    <li class="passkey-list__item">
                        <div>
                            <span class="passkey-list__name">{$credential.device_name|escape}</span>
                            <span class="passkey-badge passkey-badge--{$credential.status|escape}">{$credential.status|escape}</span>
                            <span class="passkey-list__meta">
                                Added {$credential.created_at|escape}
                                {if $credential.last_used_at} &middot; last used {$credential.last_used_at|escape}
                                {else} &middot; never used{/if}
                                &middot; ref {$credential.reference|escape}
                            </span>
                        </div>
                        <button type="button" class="btn btn-default btn-sm"
                                data-passkey-action="revoke"
                                data-passkey-id="{$credential.id}"
                                data-passkey-feedback="#passkey-feedback">Remove</button>
                    </li>
                {/foreach}
            </ul>
        {else}
            <p class="passkey-panel__hint">You have not added a passkey yet.</p>
        {/if}

        {if $passkeyEnrolled < $passkeyMax}
            <div class="form-inline">
                <label class="sr-only" for="passkey-device-name">Passkey name</label>
                <input type="text" class="form-control" id="passkey-device-name" maxlength="64"
                       placeholder="Name this device (optional)">
                <button type="button" class="btn btn-primary" data-passkey-action="register"
                        data-passkey-feedback="#passkey-feedback">Add a passkey</button>
            </div>
        {else}
            <p class="passkey-panel__hint">
                You have reached the maximum of {$passkeyMax} passkeys. Remove one before adding another.
            </p>
        {/if}

        {if $passkeyRequired}
            <p class="passkey-panel__hint"><strong>A passkey is required for this account.</strong></p>
        {elseif !$passkeyPasswordFallback}
            <p class="passkey-panel__hint">Password sign-in is disabled for accounts with a registered passkey.</p>
        {/if}

        <p class="passkey-feedback" id="passkey-feedback" role="status" aria-live="polite"></p>
    </div>
</div>
{/if}
