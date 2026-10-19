{* Password-recovery frame.

   The platform renders this wrapper for every step of the reset flow and passes the step
   in `$innerTemplate` (`email-prompt`, `security-prompt`, `change-prompt`). The inner
   template is included from this theme so all three steps share one card, one heading
   scale and one set of links; the form contract is the platform's and unchanged.

   `$innerTemplate` is a dynamic include: the value comes from the server, and the three
   prompt files this theme ships are the only values the platform sends for this flow. *}
<main id="main-content">
<section class="ch-auth ch-auth--wide" aria-labelledby="ch-auth-title">
    <div class="ch-auth__inner">
        <div class="ch-auth__card">
            <div class="ch-auth__panel">
                <p class="ch-auth__eyebrow">CloudHost247 account</p>
                <h1 id="ch-auth-title">
                    {if $innerTemplate == 'email-prompt'}Reset your password
                    {elseif $innerTemplate == 'security-prompt'}Confirm your identity
                    {elseif $innerTemplate == 'change-prompt'}Choose a new password
                    {else}Password recovery{/if}
                </h1>
                <p class="ch-auth__lede">Recovery links are single use and expire. Nothing on the account changes until you choose a new password.</p>

                {if $loggedin && $innerTemplate}
                    <div class="alert alert-danger" role="alert">{lang key='noPasswordResetWhenLoggedIn'}</div>
                {elseif $successMessage}
                    <div class="alert alert-success" role="status">{$successTitle}</div>
                    <p class="ch-auth__hint">{$successMessage}</p>
                {else}
                    {if $errorMessage}
                        <div class="alert alert-danger" role="alert">{$errorMessage}</div>
                    {/if}
                    {if $innerTemplate}
                        {include file="$template/password-reset-$innerTemplate.tpl"}
                    {/if}
                {/if}

                <div class="ch-auth__links">
                    <a href="{$WEB_ROOT}/clientarea.php">{lang key='clientarealogin'}</a>
                    <a href="{$WEB_ROOT}/contact.php">Contact support</a>
                </div>
            </div>
        </div>
    </div>
</section>
</main>
