{*
    Passkey sign-in control for the client area login page.

    Drop-in include for templates/<theme>/login.tpl, placed just above or
    below the existing password form:

        {include file="$template/../../modules/addons/cloudhost247_passkey/templates/client/login.tpl"}

    The password form is never removed or replaced: this block is purely
    additive, so a browser without WebAuthn, or a misconfigured deployment,
    always leaves a working login behind.
*}
{if $passkeyEnabled}
<div class="passkey-login" data-passkey-only>
    <div class="passkey-login__divider">or</div>
    <label class="sr-only" for="passkey-identifier">Email address</label>
    <input type="email" class="form-control" id="passkey-identifier" autocomplete="username webauthn"
           placeholder="Email address (optional for saved passkeys)">
    <button type="button" class="btn btn-default btn-block" style="margin-top:10px"
            data-passkey-action="authenticate" data-passkey-feedback="#passkey-login-feedback">
        Sign in with a passkey
    </button>
    <p class="passkey-feedback" id="passkey-login-feedback" role="status" aria-live="polite"></p>
</div>
{/if}
