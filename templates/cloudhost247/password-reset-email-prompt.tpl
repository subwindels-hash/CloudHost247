{* Step 1: request the reset email. Posts the platform's `password-reset-validate-email`
   route with the hidden `action=reset` field it expects. *}
<p class="ch-auth__hint">{lang key='pwresetemailneeded'}</p>
<form method="post" action="{routePath('password-reset-validate-email')}" class="ch-auth__form" role="form">
    <input type="hidden" name="action" value="reset" />

    <div class="ch-auth__field">
        <label for="inputEmail">{lang key='loginemail'}</label>
        <input type="email" name="email" class="form-control" id="inputEmail"
               placeholder="{lang key='enteremail'}" autocomplete="email"
               autocapitalize="none" spellcheck="false" autofocus required>
    </div>

    <button type="submit" class="ch-auth__submit {$captcha->getButtonClass($captchaForm)}">
        {lang key='pwresetsubmit'}
    </button>

    {include file="$template/includes/captcha.tpl"}
</form>
