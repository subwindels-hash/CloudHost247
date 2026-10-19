{* CloudHost247 log-in page.

   This template is shipped by the theme rather than inherited from twenty-one so the
   account entry point matches the rest of the site. It keeps the platform's form
   contract exactly: the POST target is the named `login-validate` route, the field
   names are `username` and `password`, `rememberme` is optional, and the captcha block
   is the shared partial. Only the presentation is CloudHost247's. *}
<section class="ch-auth" aria-labelledby="ch-auth-title">
    <div class="ch-auth__inner">
        <div class="ch-auth__card">
            <div class="ch-auth__panel">
                <p class="ch-auth__eyebrow">CloudHost247 account</p>
                <h1 id="ch-auth-title">{lang key='clientarealogin'}</h1>
                <p class="ch-auth__lede">Sign in to manage services, invoices, domains and support tickets in one place.</p>

                <ul class="ch-auth__points">
                    <li>Use the email address registered on the account.</li>
                    <li>Password recovery is available if you no longer have it.</li>
                    <li>Multi-factor prompts expire, so a stale code is rejected on purpose.</li>
                </ul>

                <div class="ch-auth__links">
                    <a href="{routePath('password-reset-begin')}">{lang key='forgotpw'}</a>
                </div>
            </div>

            <div class="ch-auth__panel">
                {include file="$template/includes/flashmessage.tpl"}

                <form method="post" action="{routePath('login-validate')}" class="ch-auth__form" role="form">
                    {if $redirectUrl}
                        <input type="hidden" name="redirect" value="{$redirectUrl|escape}">
                    {/if}

                    <div class="ch-auth__field">
                        <label for="inputEmail">{lang key='clientareaemail'}</label>
                        <input type="email" name="username" class="form-control" id="inputEmail"
                               placeholder="{lang key='enteremail'}" autocomplete="email"
                               autocapitalize="none" spellcheck="false" autofocus required>
                    </div>

                    <div class="ch-auth__field">
                        <label for="inputPassword">{lang key='clientareapassword'}</label>
                        <input type="password" name="password" class="form-control" id="inputPassword"
                               placeholder="{lang key='clientareapassword'}" autocomplete="current-password" required>
                    </div>

                    <label class="ch-auth__check" for="inputRememberMe">
                        <input type="checkbox" name="rememberme" id="inputRememberMe" value="1">
                        <span>{lang key='loginrememberme'}</span>
                    </label>

                    {include file="$template/includes/captcha.tpl"}

                    <button type="submit" class="ch-auth__submit {$captcha->getButtonClass($captchaForm)}">
                        {lang key='loginbutton'}
                    </button>
                </form>

                <div class="ch-auth__links">
                    <span>New to CloudHost247?</span>
                    <a href="{$WEB_ROOT}/register.php">{lang key='clientregistertitle'}</a>
                </div>
            </div>
        </div>
    </div>
</section>
