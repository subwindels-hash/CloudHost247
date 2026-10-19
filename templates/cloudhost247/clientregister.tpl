{* CloudHost247 account registration.

   The form contract is the platform's, unchanged: it posts back to this file with the
   hidden `register` flag, keeps the field names and ids the vendor JavaScript
   (StatesDropdown.js, PasswordStrength.js, registerForm()) expects, and renders the
   custom fields, currencies, tax id, captcha and terms checkbox the server sends.

   The presentation is CloudHost247's: one readable column of grouped fields instead of
   the vendor wizard, every input labelled, and errors shown next to the field the
   platform already flags. *}

{if in_array('state', $optionalFields)}
    <script>
        var statesTab = 10;
        var stateNotRequired = true;
    </script>
{/if}

<script src="{$BASE_PATH_JS}/StatesDropdown.js"></script>
<script src="{$BASE_PATH_JS}/PasswordStrength.js"></script>
<script>
    window.langPasswordStrength = "{lang|addslashes key='pwstrength'}";
    window.langPasswordWeak = "{lang|addslashes key='pwstrengthweak'}";
    window.langPasswordModerate = "{lang|addslashes key='pwstrengthmoderate'}";
    window.langPasswordStrong = "{lang|addslashes key='pwstrengthstrong'}";
</script>

<section class="ch-auth ch-auth--wide ch-auth--register" aria-labelledby="ch-auth-title">
    <div class="ch-auth__inner">
        <div class="ch-auth__card">
            <div class="ch-auth__panel">
                <p class="ch-auth__eyebrow">CloudHost247 account</p>
                <h1 id="ch-auth-title">{lang key='clientregistertitle'}</h1>
                <p class="ch-auth__lede">One account for hosting, cloud, domains and support. No card details are needed to create it.</p>

                {if $registrationDisabled}
                    <div class="alert alert-danger" role="alert">
                        {lang key='registerCreateAccount'} <a class="alert-link" href="{$WEB_ROOT}/cart.php">{lang key='registerCreateAccountOrder'}</a>
                    </div>
                {/if}
                {if $errormessage}
                    <div class="alert alert-danger" role="alert">{$errormessage}</div>
                {/if}

                {if !$registrationDisabled}
                    <form method="post" class="ch-auth__form using-password-strength" action="{$smarty.server.PHP_SELF}"
                          onsubmit="return typeof registerForm === 'function' ? registerForm() : true;" role="form" name="orderfrm" id="frmCheckout">
                        <input type="hidden" name="register" value="true"/>

                        <div class="ch-auth__section">
                            <h2>{lang key='orderForm.personalInformation'}</h2>
                            <p>Use the details that should appear on invoices and support tickets.</p>

                            <div class="ch-auth__grid">
                                <div class="ch-auth__field">
                                    <label for="inputFirstName">{lang key='orderForm.firstName'}</label>
                                    <input type="text" name="firstname" id="inputFirstName" class="form-control"
                                           value="{$clientfirstname}" autocomplete="given-name"
                                           {if !in_array('firstname', $optionalFields)}required{/if}>
                                </div>
                                <div class="ch-auth__field">
                                    <label for="inputLastName">{lang key='orderForm.lastName'}</label>
                                    <input type="text" name="lastname" id="inputLastName" class="form-control"
                                           value="{$clientlastname}" autocomplete="family-name"
                                           {if !in_array('lastname', $optionalFields)}required{/if}>
                                </div>
                                <div class="ch-auth__field">
                                    <label for="inputCompanyName">{lang key='orderForm.companyName'} ({lang key='orderForm.optional'})</label>
                                    <input type="text" name="companyname" id="inputCompanyName" class="form-control"
                                           value="{$clientcompanyname}" autocomplete="organization">
                                </div>
                                <div class="ch-auth__field">
                                    <label for="inputEmail">{lang key='orderForm.emailAddress'}</label>
                                    <input type="email" name="email" id="inputEmail" class="form-control"
                                           value="{$clientemail}" autocomplete="email"
                                           autocapitalize="none" spellcheck="false" required>
                                </div>
                                <div class="ch-auth__field">
                                    <label for="inputPhone">{lang key='orderForm.phoneNumber'}</label>
                                    <input type="tel" name="phonenumber" id="inputPhone" class="form-control"
                                           value="{$clientphonenumber}" autocomplete="tel"
                                           {if !in_array('phonenumber', $optionalFields)}required{/if}>
                                </div>
                                <div class="ch-auth__field">
                                    <label for="inputAddress1">{lang key='orderForm.streetAddress'}</label>
                                    <input type="text" name="address1" id="inputAddress1" class="form-control"
                                           value="{$clientaddress1}" autocomplete="address-line1"
                                           {if !in_array('address1', $optionalFields)}required{/if}>
                                </div>
                                <div class="ch-auth__field">
                                    <label for="inputAddress2">{lang key='orderForm.streetAddress2'}</label>
                                    <input type="text" name="address2" id="inputAddress2" class="form-control"
                                           value="{$clientaddress2}" autocomplete="address-line2">
                                </div>
                                <div class="ch-auth__field">
                                    <label for="inputCity">{lang key='orderForm.city'}</label>
                                    <input type="text" name="city" id="inputCity" class="form-control"
                                           value="{$clientcity}" autocomplete="address-level2"
                                           {if !in_array('city', $optionalFields)}required{/if}>
                                </div>
                                <div class="ch-auth__field">
                                    <label for="state">{lang key='orderForm.state'}</label>
                                    <input type="text" name="state" id="state" class="form-control"
                                           value="{$clientstate}" autocomplete="address-level1"
                                           {if !in_array('state', $optionalFields)}required{/if}>
                                </div>
                                <div class="ch-auth__field">
                                    <label for="inputPostcode">{lang key='orderForm.postcode'}</label>
                                    <input type="text" name="postcode" id="inputPostcode" class="form-control"
                                           value="{$clientpostcode}" autocomplete="postal-code"
                                           {if !in_array('postcode', $optionalFields)}required{/if}>
                                </div>
                                <div class="ch-auth__field">
                                    <label for="inputCountry">{lang key='clientareacountry'}</label>
                                    <select name="country" id="inputCountry" class="form-control" autocomplete="country">
                                        {foreach $clientcountries as $countryCode => $countryName}
                                            <option value="{$countryCode}"{if (!$clientcountry && $countryCode eq $defaultCountry) || ($countryCode eq $clientcountry)} selected="selected"{/if}>
                                                {$countryName}
                                            </option>
                                        {/foreach}
                                    </select>
                                </div>
                                {if $showTaxIdField}
                                    <div class="ch-auth__field">
                                        <label for="inputTaxId">{$taxLabel} ({lang key='orderForm.optional'})</label>
                                        <input type="text" name="tax_id" id="inputTaxId" class="form-control" value="{$clientTaxId}">
                                    </div>
                                {/if}
                                {if $currencies}
                                    <div class="ch-auth__field">
                                        <label for="inputCurrency">{lang key='choosecurrency'}</label>
                                        <select id="inputCurrency" name="currency" class="form-control">
                                            {foreach from=$currencies item=curr}
                                                <option value="{$curr.id}"{if !$smarty.post.currency && $curr.default || $smarty.post.currency eq $curr.id } selected{/if}>{$curr.code}</option>
                                            {/foreach}
                                        </select>
                                    </div>
                                {/if}
                                {if $customfields}
                                    {foreach $customfields as $customfield}
                                        <div class="ch-auth__field{if !$customfield.required} ch-auth__field--full{/if}">
                                            <label for="customfield{$customfield.id}">{$customfield.name}</label>
                                            {$customfield.input}
                                            {if $customfield.description}
                                                <p class="ch-auth__hint">{$customfield.description}</p>
                                            {/if}
                                        </div>
                                    {/foreach}
                                {/if}
                            </div>
                        </div>

                        <div class="ch-auth__section">
                            <h2>{lang key='orderForm.accountSecurity'}</h2>
                            <p>Choose a password you do not use anywhere else.</p>

                            <div class="ch-auth__grid">
                                <div class="ch-auth__field"{if $remote_auth_prelinked && !$securityquestions} style="display:none;"{/if}>
                                    <label for="inputNewPassword1">{lang key='clientareapassword'}</label>
                                    <input type="password" name="password" id="inputNewPassword1" class="form-control"
                                           data-error-threshold="{$pwStrengthErrorThreshold}" data-warning-threshold="{$pwStrengthWarningThreshold}"
                                           autocomplete="new-password"{if $remote_auth_prelinked} value="{$password}"{/if} required>
                                    <div class="ch-auth__meter" aria-hidden="true">
                                        <div id="passwordStrengthMeterBar" role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100"></div>
                                    </div>
                                    <span class="ch-auth__hint" id="passwordStrengthTextLabel">{lang key='pwstrength'}: {lang key='pwstrengthenter'}</span>
                                </div>
                                <div class="ch-auth__field"{if $remote_auth_prelinked && !$securityquestions} style="display:none;"{/if}>
                                    <label for="inputNewPassword2">{lang key='clientareaconfirmpassword'}</label>
                                    <input type="password" name="password2" id="inputNewPassword2" class="form-control"
                                           autocomplete="new-password"{if $remote_auth_prelinked} value="{$password}"{/if} required>
                                    <span class="ch-auth__hint">Both passwords must match.</span>
                                </div>
                                {if $securityquestions}
                                    <div class="ch-auth__field">
                                        <label for="inputSecurityQId">{lang key='clientareasecurityquestion'}</label>
                                        <select name="securityqid" id="inputSecurityQId" class="form-control">
                                            <option value="">{lang key='clientareasecurityquestion'}</option>
                                            {foreach $securityquestions as $question}
                                                <option value="{$question.id}"{if $question.id eq $securityqid} selected{/if}>
                                                    {$question.question}
                                                </option>
                                            {/foreach}
                                        </select>
                                    </div>
                                    <div class="ch-auth__field">
                                        <label for="inputSecurityQAns">{lang key='clientareasecurityanswer'}</label>
                                        <input type="password" name="securityqans" id="inputSecurityQAns" class="form-control"
                                               placeholder="{lang key='clientareasecurityanswer'}" autocomplete="off">
                                    </div>
                                {/if}
                            </div>

                            <button type="button" class="btn btn-default btn-sm generate-password" data-targetfields="inputNewPassword1,inputNewPassword2">
                                {lang key='generatePassword.btnLabel'}
                            </button>
                        </div>

                        <div class="ch-auth__section">
                            {if $accepttos}
                                <label class="ch-auth__check" for="accepttos">
                                    <input type="checkbox" name="accepttos" id="accepttos" value="on" required>
                                    <span>{lang key='ordertosagreement'} <a href="{$tosurl}" target="_blank" rel="noopener">{lang key='ordertos'}</a></span>
                                </label>
                            {/if}

                            {if $showMarketingEmailOptIn}
                                <label class="ch-auth__check" for="marketingoptin">
                                    <input type="checkbox" name="marketingoptin" id="marketingoptin" value="1"{if $marketingEmailOptIn} checked{/if}>
                                    <span>{lang key='emailMarketing.joinOurMailingList'}</span>
                                </label>
                                <p class="ch-auth__hint">{$marketingEmailOptInMessage}</p>
                            {/if}

                            {include file="$template/includes/captcha.tpl"}

                            <button type="submit" id="registerbtn" class="ch-auth__submit {$captcha->getButtonClass($captchaForm)}">
                                {lang key='clientregistertitle'}
                            </button>
                        </div>
                    </form>
                {/if}

                <div class="ch-auth__links">
                    <span>Already have an account?</span>
                    <a href="{$WEB_ROOT}/clientarea.php">{lang key='clientarealogin'}</a>
                    <a href="{$WEB_ROOT}/contact.php">Contact support</a>
                </div>
            </div>
        </div>
    </div>
</section>

<script>
    // Match feedback only: the server remains the authority on whether the pair is valid, and
    // nothing here disables the submit button (a disabled button is a dead end on a phone when
    // the script does not run).
    (function () {
        var first = document.getElementById('inputNewPassword1');
        var second = document.getElementById('inputNewPassword2');
        var label = document.getElementById('passwordStrengthTextLabel');
        if (!first || !second) return;
        function compare() {
            if (!second.value) { second.setCustomValidity(''); return; }
            second.setCustomValidity(first.value === second.value ? '' : 'The two passwords do not match.');
        }
        first.addEventListener('input', compare);
        second.addEventListener('input', compare);
        if (label) {
            // The vendor script updates the meter bar; this keeps the text next to it honest.
            first.addEventListener('input', function () {
                label.textContent = first.value.length
                    ? '{lang|addslashes key='pwstrength'}: ' + first.value.length + ' characters'
                    : '{lang|addslashes key='pwstrength'}: {lang|addslashes key='pwstrengthenter'}';
            });
        }
    })();
</script>
