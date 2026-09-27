{if $templatefile == 'clientregister' || $templatefile == 'login'  || $templatefile == 'password-reset-container' || $templatefile == 'logout' || $templatefile == 'email-prompt'}
	<div class="register_page">
		<div class="left">
			{if $templatefile == 'clientregister'}
				 <div class="register-side-image">
					<div class="left-logo-image">
					  {if !empty($hostx_theme_settings.lg_pw_logo)}
						<img src="{$hostx_theme_settings.lg_pw_logo}" alt="logo" height="{$hostx_theme_settings.lg_pw_logo_height}" width="{$hostx_theme_settings.lg_pw_logo_width}">
					  {else}
						<img src="{$hostx_theme_settings.header_logo}" alt="logo" height="{$hostx_theme_settings.lg_pw_logo_height}" width="{$hostx_theme_settings.lg_pw_logo_width}">
					  {/if}
					</div>
				 </div>							 
			{else}
				<div class="login-side-image">
					<div class="left-logo-image">
						{if !empty($hostx_theme_settings.lg_pw_logo)}
							<img src="{$hostx_theme_settings.lg_pw_logo}" alt="logo" height="{$hostx_theme_settings.lg_pw_logo_height}" width="{$hostx_theme_settings.lg_pw_logo_width}">
						{else}
							<img src="{$hostx_theme_settings.header_logo}" alt="logo" height="{$hostx_theme_settings.lg_pw_logo_height}" width="{$hostx_theme_settings.lg_pw_logo_width}">
						{/if}
					</div>
				</div>
			{/if}
		</div>
		<div class="right">
			 {if $templatefile == 'clientregister' || $templatefile == 'login'}
				 <h1>{$LANG.welcometo} <span>{$companyname}</span></h1> 
			 {elseif $templatefile == 'logout'}
				 <h1>{$LANG.logouttitle}</h1> 
			 {else}
				 <h1>{$LANG.pwreset}</h1>
			 {/if}
			 <ul class="nav">
				 <li class="nav-item">
					 <a class="nav-link {if $templatefile == 'login'}active{/if}" href="{$WEB_ROOT}/login.php">{$LANG.loginbutton}</a>
				 </li>
				 <li class="nav-item">
					 <a class="nav-link {if $templatefile == 'clientregister'}active{/if}" href="{$WEB_ROOT}/register.php">{$LANG.register}</a>  
				 </li> 
			 </ul>
{/if}