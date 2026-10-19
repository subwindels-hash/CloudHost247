{* CloudHost247 contact page.

   Shipped by the theme rather than inherited from twenty-one so the page a visitor reaches from
   the footer, the mega menu and every "talk to us" link is CloudHost247's, not the parent theme's
   Bootstrap form.

   The platform contract is the one WHMCS `contact.php` posts and validates, copied from the
   preserved legacy theme (`templates/cloudhost247_legacy/contact.tpl`), which is the only
   in-tree proof of it:

     POST contact.php, hidden `action=send`
     fields: `name`, `email`, `subject`, `message` and the captcha `code`
     result: `$sent` (success), `$errormessage` (HTML error text from the platform),
             `$name` / `$email` / `$subject` / `$message` repopulated on error.

   Nothing here invents contact details: the phone block renders only when the operator has set
   one in Theme Manager, and the other routes are pages this site actually serves. *}
<main id="main-content">
<section class="ch-auth ch-auth--wide" aria-labelledby="ch-auth-title">
    <div class="ch-auth__inner">
        <div class="ch-auth__card">
            <div class="ch-auth__panel">
                <p class="ch-auth__eyebrow">CloudHost247</p>
                <h1 id="ch-auth-title">{lang key='contactus'}</h1>
                <p class="ch-auth__lede">Questions about hosting, a migration, billing or a service you already run with us. Send a message and it reaches the team that can answer it.</p>

                <ul class="ch-auth__points">
                    <li>Account and service questions: open a ticket from your client area, which keeps the history in one place.</li>
                    <li>Sales and pre-sales: use the form, or write to the address published in the footer.</li>
                    <li>Abuse and security reports are handled as priority tickets.</li>
                </ul>

                {if $cloudhost247.settings.phone}
                <div class="ch-auth__section">
                    <p class="ch-auth__hint">Phone</p>
                    <p><a href="tel:{$cloudhost247.settings.country_calling_code_phone|escape|replace:" ":""}{$cloudhost247.settings.phone|escape|replace:" ":""}">{$cloudhost247.settings.country_calling_code_phone|escape} {$cloudhost247.settings.phone|escape}</a></p>
                </div>
                {/if}

                <div class="ch-auth__links">
                    <a href="{$WEB_ROOT}/submitticket.php">Open a ticket</a>
                    <a href="{$WEB_ROOT}/knowledgebase.php">Knowledge base</a>
                    <a href="{$WEB_ROOT}/serverstatus.php">Service status</a>
                </div>
            </div>

            <div class="ch-auth__panel">
                {if $sent}
                    <div class="alert alert-success" role="status">
                        {lang key='contactsent'}
                    </div>
                    <p class="ch-auth__hint">A copy of the message is on its way to the address you gave us. If it does not arrive, check the spam folder before sending it again.</p>
                    <div class="ch-auth__links">
                        <a href="{$WEB_ROOT}/index.php">Back to the homepage</a>
                        <a href="{$WEB_ROOT}/clientarea.php">Client area</a>
                    </div>
                {else}
                    {if $errormessage}
                        <div class="alert alert-danger" role="alert">{$errormessage}</div>
                    {/if}

                    <form method="post" action="{$WEB_ROOT}/contact.php" class="ch-auth__form" role="form">
                        <input type="hidden" name="action" value="send">

                        <div class="ch-auth__field">
                            <label for="inputName">{lang key='supportticketsclientname'}</label>
                            <input type="text" name="name" id="inputName" class="form-control"
                                   value="{$name|escape}" autocomplete="name" required>
                        </div>

                        <div class="ch-auth__field">
                            <label for="inputEmail">{lang key='supportticketsclientemail'}</label>
                            <input type="email" name="email" id="inputEmail" class="form-control"
                                   value="{$email|escape}" autocomplete="email"
                                   autocapitalize="none" spellcheck="false" required>
                        </div>

                        <div class="ch-auth__field">
                            <label for="inputSubject">{lang key='supportticketsticketsubject'}</label>
                            <input type="text" name="subject" id="inputSubject" class="form-control"
                                   value="{$subject|escape}" required>
                        </div>

                        <div class="ch-auth__field ch-auth__field--full">
                            <label for="inputMessage">{lang key='contactmessage'}</label>
                            <textarea name="message" id="inputMessage" class="form-control" rows="8"
                                      required>{$message|escape}</textarea>
                        </div>

                        {include file="$template/includes/captcha.tpl"}

                        <button type="submit" class="ch-auth__submit">
                            {lang key='contactsend'}
                        </button>
                    </form>
                {/if}
            </div>
        </div>
    </div>
</section>
</main>
