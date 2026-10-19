{* Step 3: choose the new password. Posts the platform's `password-reset-change-perform`
   route and carries the verified security answer forward in the hidden `answer` field.

   The password strength meter is driven by the platform's PasswordStrength.js; the
   confirm-password comparison here only sets a native validity message, so the form still
   works if that script does not load. *}
{capture assign='langPwStrength'}{lang key='pwstrength'}{/capture}
<p class="ch-auth__hint">{lang key='pwresetenternewpw'}</p>
<form class="ch-auth__form using-password-strength" method="post" action="{routePath('password-reset-change-perform')}">
    <input type="hidden" name="answer" id="answer" value="{$securityAnswer}" />

    <div class="ch-auth__field">
        <label for="inputNewPassword1">{lang key='newpassword'}</label>
        <input type="password" name="newpw" id="inputNewPassword1" class="form-control"
               autocomplete="new-password" minlength="8" required>
        <div class="ch-auth__meter" aria-hidden="true">
            <div id="passwordStrengthMeterBar" role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100"></div>
        </div>
        <span class="ch-auth__hint" id="passwordStrengthTextLabel">{lang key='pwstrength'}: {lang key='pwstrengthenter'}</span>
    </div>

    <div class="ch-auth__field">
        <label for="inputNewPassword2">{lang key='confirmnewpassword'}</label>
        <input type="password" name="confirmpw" id="inputNewPassword2" class="form-control"
               autocomplete="new-password" minlength="8" required>
    </div>

    <button type="submit" name="submit" class="ch-auth__submit {$captcha->getButtonClass($captchaForm)}">
        {lang key='clientareasavechanges'}
    </button>
    <a class="ch-auth__cancel" href="{$WEB_ROOT}/clientarea.php">{lang key='cancel'}</a>
</form>

<script>
    (function () {
        var first = document.getElementById('inputNewPassword1');
        var second = document.getElementById('inputNewPassword2');
        var bar = document.getElementById('passwordStrengthMeterBar');
        var label = document.getElementById('passwordStrengthTextLabel');
        if (!first || !second) return;
        function compare() {
            second.setCustomValidity(second.value && first.value !== second.value
                ? 'The two passwords do not match.'
                : '');
        }
        first.addEventListener('input', compare);
        second.addEventListener('input', compare);
        if (bar && label) {
            // Local score, independent of the vendor script: length plus character variety is
            // enough to tell a visitor whether the password is heading in the right direction.
            first.addEventListener('input', function () {
                var value = first.value;
                var score = 0;
                if (value.length >= 8) score += 30;
                if (value.length >= 12) score += 20;
                if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 15;
                if (/[0-9]/.test(value)) score += 15;
                if (/[^A-Za-z0-9]/.test(value)) score += 20;
                score = Math.min(100, score);
                bar.style.width = score + '%';
                bar.setAttribute('aria-valuenow', String(score));
                label.textContent = '{$langPwStrength|escape:'javascript'}: ' + value.length + ' characters';
            });
        }
    })();
</script>
