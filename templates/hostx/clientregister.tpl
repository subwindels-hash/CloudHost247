{if in_array('state', $optionalFields)}
    <script>
        var statesTab = 10;
        var stateNotRequired = true;
    </script>
{/if}

<script type="text/javascript" src="{$BASE_PATH_JS}/StatesDropdown.js"></script>
<script type="text/javascript" src="{$BASE_PATH_JS}/PasswordStrength.js"></script>
{literal}
<script>
    window.langPasswordStrength = "{/literal}{$LANG.pwstrength}{literal}";
    window.langPasswordWeak = "{/literal}{$LANG.pwstrengthweak}{literal}";
    window.langPasswordModerate = "{/literal}{$LANG.pwstrengthmoderate}{literal}";
    window.langPasswordStrong = "{/literal}{$LANG.pwstrengthstrong}{literal}";
    jQuery(document).ready(function()
    {
        jQuery("#inputNewPassword1").keyup(registerFormPasswordStrengthFeedback);

        jQuery('#registerbtn').click(function()
        {
            inputFirstName = jQuery('#inputFirstName').val();
            inputLastName = jQuery('#inputLastName').val();
            inputEmail = jQuery('#inputEmail').val();
            inputAddress1 = jQuery('#inputAddress1').val();
            inputCity = jQuery('#inputCity').val();
            stateselect = jQuery('#stateselect').val();
            if (typeof stateselect === "undefined") {
                stateselect = jQuery('#stateinput').val();
            }            
            inputPostcode = jQuery('#inputPostcode').val();
            if(inputFirstName=='' || inputLastName=='' || inputEmail=='' || inputAddress1=='' || inputCity=='' || stateselect=='' || inputPostcode==''){
                resActiveTab(1);
            }  
            jQuery('.register_tab').find('.requireError').remove();
            newPassword1 = jQuery('#inputNewPassword1').val();
            if(newPassword1==''){
              jQuery('#inputNewPassword1').css('border-color','#e61919');
              var label = jQuery('#inputNewPassword1').closest(".form-group").find('label').text();                          
              jQuery('#inputNewPassword1').after('<span class="requireError">Please enter the ' + label + '</span>');
            }             

            newPassword2 = jQuery('#inputNewPassword2').val();            
            if(newPassword2==''){
              jQuery('#inputNewPassword2').css('border-color','#e61919');
              var label = jQuery('#inputNewPassword2').closest(".form-group").find('label').text();                          
              jQuery('#inputNewPassword2').after('<span class="requireError">Please enter the ' + label + '</span>');
            }

            if(newPassword1=='' || newPassword2==''){
              return false; 
            }

        });

        jQuery('.form-control').focus(function(){
            jQuery('.register_tab').find('.form-control').css('border-color','#c5c5c5');
            jQuery('.register_tab').find('.requireError').remove();
        });

        jQuery('#nextButton').click(function(){
            resActiveTab(2);           
        });

        jQuery('#personalTab').click(function(){
            resActiveTab(1);           
        });      

        jQuery('#securityTab').click(function(){
            resActiveTab(2);           
        });
    });  

    function resActiveTab(id){
        if(id=='1'){
            jQuery('#personal_information').addClass('active');
            jQuery('#account_security').removeClass('active');
            jQuery('.register_tab').find('li').removeClass('active');
            jQuery('.register_tab').find('li').eq(0).addClass('active');
        }else{
            jQuery('.register_tab').find('.form-control').css('border-color','#c5c5c5');
            jQuery('.register_tab').find('.requireError').remove();
            var check = 0;
            jQuery('.form-control').each(function(){
                chkRequire = jQuery(this).attr('required');
                if(chkRequire=='required'){
                    value = jQuery(this).val();
                    if(value==''){
                      check++;
                          jQuery(this).css('border-color','#e61919');
                          var label = jQuery(this).closest(".form-group").find('label').text();                          
                          jQuery(this).after('<span class="requireError">Please enter the ' + label + '</span>');
                    }
                }                
            });

            var sEmail = jQuery('#inputEmail').val();
            if(sEmail!=''){
                if(/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{1,15})+$/.test(sEmail))
                {
                  
                }else{
                    check++;
                    jQuery('#inputEmail').css('border-color','#e61919');
                    var label = jQuery('#inputEmail').closest(".form-group").find('label').text();                          
                    jQuery('#inputEmail').after('<span class="requireError">Please enter the valid ' + label + '</span>');
                }          
            }      

            var accepttos = jQuery('#accepttos').attr('type');            
            if(accepttos=='checkbox'){
                chkval = $("#accepttos").prop('checked');
                if(chkval== false){
                  check++;
                 jQuery('.custom_checkbox').after('<span class="requireError" style="position: inherit;">Please tick the checkbox of {/literal}{$LANG.ordertos}{literal}</span>');
                }
            }
            if(check!='0'){
              return false;
            }
            jQuery('#personal_information').removeClass('active');
            jQuery('#account_security').addClass('active');
            jQuery('.register_tab').find('li').removeClass('active');
            jQuery('.register_tab').find('li').eq(1).addClass('active');
        }
    }

</script>
{/literal}
 <div class="tab-content min_box">
  <div id="register"> 
    <div class="register_tab">
    {if $registrationDisabled}
		{include file="$template/includes/alert.tpl" type="error" msg=$LANG.registerCreateAccount|cat:' <strong><a href="'|cat:"$WEB_ROOT"|cat:'/cart.php" class="alert-link">'|cat:$LANG.registerCreateAccountOrder|cat:'</a></strong>'}
    {/if}

      {if $errormessage}
          {include file="$template/includes/alert.tpl" type="error" errorshtml=$errormessage}
      {/if}
      {if !$registrationDisabled}
        <form method="post" class="using-password-strength" action="{$smarty.server.PHP_SELF}" onsubmit="return registerForm();" role="form" name="orderfrm" id="frmCheckout">
           <input type="hidden" name="register" value="true"/>
           <div class="svg-img-ar reg">
                 <object class="someclass" id="someid" type="image/svg+xml" data="{$WEB_ROOT}/templates/{$template}/images/Shape-img.svg"></object>
               </div>
           <ul class="nav">
            <li class="nav-item active">
              <a class="nav-link" data-toggle="tab" id="personalTab" href="#personal_information">{$LANG.orderForm.personalInformation}</a>
            </li>
            <li class="nav-item">
              <a class="nav-link" data-toggle="tab" id="securityTab" href="#account_security">{$LANG.orderForm.accountSecurity}</a>  
            </li> 
          </ul>

          <div class="tab-content">
          <div class="tab-pane active" id="personal_information"> 
            <div class="personal_information_form">
                <div class="row">
                  <div class="col-sm-4">
                    <div class="form-group">
                      <label>{$LANG.orderForm.firstName}</label>                      
                      <input type="text" name="firstname" id="inputFirstName" class="form-control" placeholder="" value="{$clientfirstname}" {if !in_array('firstname', $optionalFields)}required{/if}>
                    </div>
                  </div>
                  <div class="col-sm-4">
                    <div class="form-group">
                      <label>{$LANG.orderForm.lastName}</label>                      
                      <input type="text" name="lastname" id="inputLastName" class="form-control" placeholder="" value="{$clientlastname}" {if !in_array('lastname', $optionalFields)}required{/if}>
                    </div>
                  </div>
                  <div class="col-sm-4">
                    <div class="form-group">
                      <label>{$LANG.orderForm.companyName} ({$LANG.orderForm.optional})</label>                       
                      <input type="text" name="companyname" id="inputCompanyName" class="form-control" placeholder="" value="{$clientcompanyname}">
                    </div>
                  </div>
                  <div class="col-sm-4">
                    <div class="form-group">
                      <label>{$LANG.orderForm.emailAddress}</label>
                      <input type="email" name="email" id="inputEmail" class="form-control" placeholder="" value="{$clientemail}" required>
                    </div>
                  </div>
                  <div class="col-sm-4">
                    <div class="form-group">
                      <label>{$LANG.orderForm.streetAddress}</label> 
                      <input type="text" name="address1" id="inputAddress1" class="form-control" placeholder="" value="{$clientaddress1}"  {if !in_array('address1', $optionalFields)}required{/if}>
                    </div>
                  </div>
                  <div class="col-sm-4">
                    <div class="form-group">
                      <label>{$LANG.orderForm.streetAddress2}</label> 
                      <input type="text" name="address2" id="inputAddress2" class="form-control" placeholder="" value="{$clientaddress2}">
                    </div>
                  </div>
                  <div class="col-sm-4">
                    <div class="form-group">
                      <label>{$LANG.orderForm.phoneNumber}</label> 
                      <input type="tel" name="phonenumber" id="inputPhone" class="form-control" placeholder="" value="{$clientphonenumber}"  {if !in_array('phonenumber', $optionalFields)}required{/if}>
                    </div>
                  </div>
                  <div class="col-sm-4">
                    <div class="form-group">
                      <label>{$LANG.orderForm.city}</label> 
                      <input type="text" name="city" id="inputCity" class="form-control" placeholder="" value="{$clientcity}"  {if !in_array('city', $optionalFields)}required{/if}>
                    </div>
                  </div>
                  <div class="col-sm-4">
                    <div class="form-group">
                      <label>{$LANG.orderForm.state}</label>                       
                      <input type="text" name="state" id="state" class="form-control" placeholder="" value="{$clientstate}"  {if !in_array('state', $optionalFields)}required{/if}>
                    </div>
                  </div>
                  <div class="col-sm-4">
                    <div class="form-group">
                      <label>{$LANG.orderForm.postcode}</label>                       
                      <input type="text" name="postcode" id="inputPostcode" class="form-control" placeholder="" value="{$clientpostcode}" {if !in_array('postcode', $optionalFields)}required{/if}>
                    </div>
                  </div>
                  <div class="col-sm-4">
                    <div class="form-group">
                      <label>{$LANG.clientareacountry}</label> 
                      <select name="country" id="inputCountry" class="form-control">
                          {foreach $clientcountries as $countryCode => $countryName}
                              <option value="{$countryCode}"{if (!$clientcountry && $countryCode eq $defaultCountry) || ($countryCode eq $clientcountry)} selected="selected"{/if}>
                                  {$countryName}
                              </option>
                          {/foreach}
                      </select>
                    </div>
                  </div>
				{if $showTaxIdField}
                  <div class="col-sm-4">
                    <div class="form-group">
                      <label>{$taxLabel} ({$LANG.orderForm.optional})</label>                       
                      <input type="text" name="tax_id" id="inputTaxId" class="form-control" placeholder="" value="{$clientTaxId}">
                    </div>
                  </div>
				{/if}
				
                  {if $customfields}
                    {foreach $customfields as $customfield}
                    <div class="col-sm-4">
                      <div class="form-group">
                        <label>{$customfield.name}{$customfield.required}</label>                       
                        {$customfield.input}
                        {if $customfield.description}
                            <span class="field-help-text">{$customfield.description}</span>
                        {/if}
                      </div>
                    </div>
                    {/foreach}
                  {/if} 
                  {if $currencies}
                    <div class="col-sm-4">
                      <div class="form-group">
                        <label>{$LANG.choosecurrency}</label>
                        <select id="inputCurrency" name="currency" class="form-control">
                            {foreach from=$currencies item=curr}
                                <option value="{$curr.id}"{if !$smarty.post.currency && $curr.default || $smarty.post.currency eq $curr.id } selected{/if}>{$curr.code}</option>
                            {/foreach}
                        </select>
                      </div>
                    </div>
                  {/if}  
                  <div class="col-sm-12">
                      {if $accepttos}                       
                          <label class="accepttos custom_checkbox">
                            &nbsp; <input type="checkbox" name="accepttos" id="accepttos" class="accepttos"> <span></span>  {$LANG.ordertosagreement} <a href="{$tosurl}" target="_blank">{$LANG.ordertos}</a>
                          </label>                            
                      {/if}

                      {if $showMarketingEmailOptIn}
                          <div class="col-sm-12" style="padding: 10px 0;">
                              <h4><b>{lang key='emailMarketing.joinOurMailingList'}</b></h4>
                              <p>{$marketingEmailOptInMessage}</p>
                              <input type="checkbox" name="marketingoptin" value="1"{if $marketingEmailOptIn} checked{/if} class="no-icheck toggle-switch-success" data-size="small" data-on-text="{lang key='yes'}" data-off-text="{lang key='no'}">
                           </div>                          
                      {/if}
                      <div class="clearfix"></div>                    
                      <a class="button03" href="javascript:;" id="nextButton">{$LANG.tablepagesnext}</a>
                  </div>
                </div>
            </div>

          </div>

          <div class="tab-pane" id="account_security"> 
            <div class="personal_information_form">
                <div class="row">
                    <div {if $remote_auth_prelinked && !$securityquestions } class="hidden" {else} style="display: contents;"{/if}>
                          <div {if $remote_auth_prelinked && $securityquestions} class="hidden" {else} style="display: contents;"{/if}>
                            <div class="col-sm-4">
                              <div class="form-group wgs-alert-invc">
                                <label>{$LANG.clientareapassword}</label> 
                                <input type="password" name="password" id="inputNewPassword1" data-error-threshold="{$pwStrengthErrorThreshold}" data-warning-threshold="{$pwStrengthWarningThreshold}" class="form-control" placeholder="{$LANG.clientareapassword}" autocomplete="off"{if $remote_auth_prelinked} value="{$password}"{/if}>
 								<button type="button" class="btn btn-default btn-sm btn-xs-block generate-password" data-targetfields="inputNewPassword1,inputNewPassword2">
									{$LANG.generatePassword.btnLabel}
								</button>                             
							  </div>
                            </div>
                            <div class="col-sm-4">
                              <div class="form-group">
                                <label>{$LANG.clientareaconfirmpassword}</label> 
                                <input type="password" name="password2" id="inputNewPassword2" class="form-control" placeholder="{$LANG.clientareaconfirmpassword}" autocomplete="off"{if $remote_auth_prelinked} value="{$password}"{/if}>
                              </div>
                            </div>
                            <div class="col-sm-4">
                              <div class="form-group">
                                <div class="progress">
                                  <div class="progress-bar progress-bar-success progress-bar-striped" role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100" id="passwordStrengthMeterBar">
                                  </div>
                                </div>
                                <span class="text-center small text-muted" id="passwordStrengthTextLabel">{$LANG.pwstrength}: {$LANG.pwstrengthenter}</span>
                              </div>
                            </div>
                        </div>        
                        {if $securityquestions}
                          <div class="col-sm-4">
                            <div class="form-group">                                                 
                              <select name="securityqid" id="inputSecurityQId" class="form-control">
                                <option value="">{$LANG.clientareasecurityquestion}</option>
                                {foreach $securityquestions as $question}
                                    <option value="{$question.id}"{if $question.id eq $securityqid} selected{/if}>
                                        {$question.question}
                                    </option>
                                {/foreach}
                            </select>
                            </div>
                          </div>
                          <div class="col-sm-4">
                            <div class="form-group">                                                    
                              <input type="password" name="securityqans" id="inputSecurityQAns" class="field form-control" placeholder="{$LANG.clientareasecurityanswer}" autocomplete="off">
                            </div>
                          </div>
                        {/if} 
                    </div>
					<div class="col-12 Rcaptcha">
					{include file="$template/includes/captcha.tpl"}
					</div>
					
                  <div class="col-sm-12">                  
                  <div class="clearfix"></div>
                  <input type="submit" class="button03 mt-0 {$captcha->getButtonClass($captchaForm)}" id="registerbtn" value="{$LANG.clientregistertitle}" name=""> </div>
                </div>
            </div>
          </div>
          </div>
        </form>  
     {/if}   
  </div>
  </div>
</div>

  </div>
</div>