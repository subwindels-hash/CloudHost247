<div class="tab-content min_box">
{include file="$template/includes/flashmessage.tpl"}
<div class="tab-pane active" id="login"> 
    <div class="register_tab">
    <div class="tab-content">
        <div class="providerLinkingFeedback"></div>
        <form method="post" action="{routePath('login-validate')}" class="login-form personal_information_form pl-4 mt-1" role="form">
          <div class="row">
            <div class="col-sm-4">

              <div class="svg-img-ar">
                 <object class="someclass" id="someid" type="image/svg+xml" data="{$WEB_ROOT}/templates/{$template}/images/Shape-img.svg"></object>
               </div>
			
			
              <div class="form-group">
                <label>{$LANG.clientareaemail}</label>                 
                <input type="email" name="username" class="form-control" id="inputEmail" placeholder="{$LANG.enteremail}" autofocus>
              </div>
            </div>
            <div class="col-sm-4">
              <div class="form-group">
                <label>{$LANG.clientareapassword}</label> 
                <input type="password" name="password" class="form-control" id="inputPassword" placeholder="{$LANG.clientareapassword}" autocomplete="off" >
              </div>
            </div>             
            
            <div class="col-sm-12">            
              <div class="clearfix"></div>
                <div class="col-sm-4">
                  <div class="form-group">
                    <label>
                            <input type="checkbox" name="rememberme" /> {$LANG.loginrememberme}
                    </label>
                  </div>
                </div>
                <div class="col-sm-4">
                  <div class="form-group pwreset">                    
                    <a href="{routePath('password-reset-begin')}">{$LANG.forgotpw}</a>                    
                  </div>
                </div>             
            </div>
				{if $captcha->isEnabled()}
					<div class="text-center margin-bottom wgs-captch-login">
						{include file="$template/includes/captcha.tpl"}
					</div>
				{/if}			
            <div class="col-sm-12">
              <div class="clearfix"></div>            
                <input id="login" type="submit" class="button03 mt-0 {$captcha->getButtonClass($captchaForm)}" value="{$LANG.loginbutton}" />
            </div>
            <div class="col-sm-12 {if !$linkableProviders} hidden{/if}">
                {include file="$template/includes/linkedaccounts.tpl" linkContext="login" customFeedback=true}
            </div>
          </div>
      </form>

  
    </div>

  </div>
  </div>


</div>

  </div>
</div>