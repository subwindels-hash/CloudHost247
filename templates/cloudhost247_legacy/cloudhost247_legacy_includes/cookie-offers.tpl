{if $cloudhost247.settings.enable_browser_cookies_cloudhost247 == 'on'}
	{if $templatefile == 'homepage'}
		<link rel="stylesheet" type="text/css" href="{$WEB_ROOT}/templates/{$template}/css/cookies_library_style_cloudhost247.css" />
		<script src="{$WEB_ROOT}/templates/{$template}/js/cookies_library_cloudhost247_file.js"></script>
		<script>
		window.addEventListener("load", function(){ldelim}
		window.cookieconsent.initialise({ldelim}
		  "palette": {ldelim}
			"popup": {ldelim}
			  "background": "{if $cloudhost247.settings.banner_background_color != ''}{$cloudhost247.settings.banner_background_color}{else}#000{/if}"
			  {if $cloudhost247.settings.banner_text_color != ''}
				,"text": "{$cloudhost247.settings.banner_text_color}"
			  {/if}
			{rdelim},
			"button": {ldelim}
			  "background": "{if $cloudhost247.settings.banner_button_background_color != ''}{$cloudhost247.settings.banner_button_background_color}{else}#f1d600{/if}"
			  {if $cloudhost247.settings.banner_button_text_color != ''}
				,"text": "{$cloudhost247.settings.banner_button_text_color}"
			  {/if}
			{rdelim}
		  {rdelim}
		  {if $cloudhost247.settings.cookies_position != 'banner_bottom'}
			,"position": "{if $cloudhost247.settings.cookies_position == 'banner_top'}top{elseif $cloudhost247.settings.cookies_position == 'banner_top_push'}top{elseif $cloudhost247.settings.cookies_position == 'floating_left'}bottom-left{elseif $cloudhost247.settings.cookies_position == 'floating_right'}bottom-right{/if}"
		  {/if}
		  {if $cloudhost247.settings.cookies_position == 'banner_top_push'}
			,"static": true
		  {/if}
		  {if $cloudhost247.settings.policy_link_text != '' || $cloudhost247.settings.policy_link != '' || $cloudhost247.settings.dismiss_button_text != '' || $cloudhost247.settings.cookies_message_text != ''}
		  ,"content": {ldelim}
			{if $cloudhost247.settings.cookies_message_text != ''}
				"message": "{$cloudhost247.settings.cookies_message_text}",
			{/if}
			{if $cloudhost247.settings.dismiss_button_text != ''}
				"dismiss": "{$cloudhost247.settings.dismiss_button_text}",
			{/if}
			{if $cloudhost247.settings.policy_link_text != ''}
				"link": "{$cloudhost247.settings.policy_link_text}",
			{/if}
			{if $cloudhost247.settings.policy_link != ''}
				"href": "{$cloudhost247.settings.policy_link}"
			{/if}
			{rdelim}
		  {/if}
		{rdelim}){rdelim});
		</script>
	{/if}
{/if}

{if $cloudhost247.settings.enable_offer_setting_cloudhost247 eq 'on'}
	{if $templatefile == 'homepage'}
		<link rel="stylesheet" type="text/css" href="{$WEB_ROOT}/templates/{$template}/css/style_offer_pop_up.css" />
		<script src="{$WEB_ROOT}/templates/{$template}/js/pop-offer-cookies-lib.js"></script>
			<div id="offerStyleOne" class="modal fade" role="dialog">
			  <div class="modal-dialog">
				  <div class="modal-body">
					<style>
						{if $cloudhost247.settings.offer_background_style_one_color != ''}
								.inner{
									background-color:{$cloudhost247.settings.offer_background_style_one_color};
								}
								.pop-inner-box h3 span::before {
									background: {$cloudhost247.settings.offer_background_style_one_color};
								}
								.pop-inner-box h3 span::after {
									background: {$cloudhost247.settings.offer_background_style_one_color};
								}
						{/if}
						{if $cloudhost247.settings.offer_hthree_style_one_background_color != ''}
							.pop-inner-box h3 span{
								background:{$cloudhost247.settings.offer_hthree_style_one_background_color};
							}
						{/if}
						{if $cloudhost247.settings.offer_hthree_style_one_text_color != ''}
							.pop-inner-box h3 span{
								color:{$cloudhost247.settings.offer_hthree_style_one_text_color};
							}
						{/if}
						{if $cloudhost247.settings.offer_hthree_style_one_off_color != ''}
							.pop-inner-box h2 {
								color:{$cloudhost247.settings.offer_hthree_style_one_off_color};
							}					
						{/if}
						{if $cloudhost247.settings.offer_style_one_plan_color != ''}
							.pop-inner-box h5 {
								color: {$cloudhost247.settings.offer_style_one_plan_color};
							}
						{/if}
						{if $cloudhost247.settings.offer_style_one_use_coupon_color != ''}
							.pop-inner-box h4 {
								color: {$cloudhost247.settings.offer_style_one_use_coupon_color};
							}
						{/if}
						{if $cloudhost247.settings.offer_style_one_coupon_code_color != ''}
							.pop-inner-box h6 {
								color: {$cloudhost247.settings.offer_style_one_coupon_code_color};
							}
						{/if}
						{if $cloudhost247.settings.offer_style_one_coupon_border_color != ''}
							.pop-inner-box h6 {
								border-color: {$cloudhost247.settings.offer_style_one_coupon_border_color};
							}
						{/if}
						{if $cloudhost247.settings.offer_style_one_close_button_color != ''}
							button.close {
								color: {$cloudhost247.settings.offer_style_one_close_button_color};
							}
						{/if}
						{if $cloudhost247.settings.offer_style_one_close_button_background_color != ''}
							button.close {
								background: {$cloudhost247.settings.offer_style_one_close_button_background_color};
							}
						{/if}				
				    </style>
					<div class="inner">
						<div class="logo-img">
						<img src="{if $cloudhost247.settings.offer_logo_style_one != ''}{$cloudhost247.settings.offer_logo_style_one}{else}{$WEB_ROOT}/templates/{$template}/images/host-logo.png{/if}" alt="host-logo" class="host-logo" {if $cloudhost247.settings.offer_logo_style_one_width != ''}width="{$cloudhost247.settings.offer_logo_style_one_width}"{/if} {if $cloudhost247.settings.offer_logo_style_one_height  != ''}height="{$cloudhost247.settings.offer_logo_style_one_height }"{/if}/>
						</div>
						<div class="pop-inner-box">
							<h3><span>{if $cloudhost247.settings.offer_hthree_style_one_text != ''}{$cloudhost247.settings.offer_hthree_style_one_text}{else}GET INSTANT{/if}</span></h3>
							<h2>{if $cloudhost247.settings.offer_price_style_one_text != ''}{$cloudhost247.settings.offer_price_style_one_text}{else}35&#37;{/if} <span>{if $cloudhost247.settings.offer_style_one_off != ''}{$cloudhost247.settings.offer_style_one_off}{else}OFF{/if}</span></h2>
							<h5>{if $cloudhost247.settings.offer_style_one_plan != ''}{$cloudhost247.settings.offer_style_one_plan}{else}On All Hosting Plans{/if}</h5>
							<h4>{if $cloudhost247.settings.offer_style_one_use_coupon != ''}{$cloudhost247.settings.offer_style_one_use_coupon}{else}USE Coupon Code{/if}</h4>
							<h6>{if $cloudhost247.settings.offer_style_one_coupon_code != ''}{$cloudhost247.settings.offer_style_one_coupon_code}{else}CLOUDHOST247-40{/if}</h6>
						</div>
						<div class="close-box">
							<img src="{$WEB_ROOT}/templates/{$template}/images/cloase-icon-bg.png" alt="close-icon-bg" class="cloase-icon-bg">
							<button type="button" class="close" data-dismiss="modal">&times;</button>
						</div>
					</div>
				  </div>
			  </div>
			</div>
			<script>
				jQuery(document).ready(function(){
					if(Cookies.get('offerStyleOne') != "true"){
						jQuery(window).scroll(function (event) {
							var scrollBars = jQuery(window).scrollTop();
							if(scrollBars > 1000){
								if(Cookies.get('offerStyleOne') != "true"){
									jQuery("#offerStyleOne").modal({
										backdrop: 'static',
										keyboard: false
									});
									jQuery("#offerStyleOne").modal("show");
								}
							}
						})
					}
				    jQuery('#offerStyleOne .close').on('click', function (e) {
					  	Cookies.set('offerStyleOne', 'true', { expires: 1 });
					});
				});
			</script>
		{/if}
{/if}