{* Captcha block for any form that carries one.

   `$captcha` is the platform's captcha object. The three shapes it can take are handled:
   recaptcha mounts its own container, invisible captcha renders nothing here (its token is
   attached when the form submits), and the default image captcha renders the image plus the
   six-character field. `getMarkup()` is deliberately not called twice: header.tpl already
   emits the provider script once per page. *}
{if $captcha && $captcha->isEnabled() && $captcha->isEnabledForForm($captchaForm)}
    <div class="ch-auth__captcha">
        {if $captcha == 'recaptcha'}
            <div id="google-recaptcha-domainchecker" class="form-group recaptcha-container"></div>
        {elseif !in_array($captcha, ['invisible', 'recaptcha'])}
            <div class="ch-auth__field">
                <p class="ch-auth__hint">{lang key='captchaverify'}</p>
                <img id="inputCaptchaImage" src="{$systemurl}includes/verifyimage.php" alt="{lang key='captchaverify'}" width="180" height="60">
                <input id="inputCaptcha" type="text" name="code" maxlength="6" class="form-control"
                       autocomplete="off" aria-label="{lang key='captchaverify'}" required>
            </div>
        {/if}
    </div>
{/if}
