{* Step 2 (only when the account has a security question): answer it to continue.
   Posts the platform's `password-reset-security-verify` route. *}
<p class="ch-auth__hint">{lang key='pwresetsecurityquestionrequired'}</p>
<form method="post" action="{routePath('password-reset-security-verify')}" class="ch-auth__form" role="form">
    <div class="ch-auth__field">
        <label for="inputAnswer">{$securityQuestion}</label>
        <input type="text" name="answer" class="form-control" id="inputAnswer" autocomplete="off" autofocus required>
    </div>

    <button type="submit" class="ch-auth__submit {$captcha->getButtonClass($captchaForm)}">
        {lang key='pwresetsubmit'}
    </button>
</form>
