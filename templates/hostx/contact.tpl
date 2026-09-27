<div class="register-domain-banner register-domain-banner2 contact-us-banner" style="background-image: url({$WEB_ROOT}/templates/{$template}/images/contact-us-banner.jpg);"> 
  <div class="container">
    <h1>{$LANG.contactuspagemainhead}</h1>
    <p>{$LANG.contactuspagemainsubhead}</p>
  </div>
</div>
<div class="submit_your_inquiry">
  <div class="container">
	  <div class="row">
		<div class="col-sm-12 wgs-alert-contact">
			{if $sent}
				{include file="$template/includes/alert.tpl" type="success" msg=$LANG.contactsent textcenter=true}
			{/if}
			{if $errormessage}
				{include file="$template/includes/alert.tpl" type="error" errorshtml=$errormessage}
			{/if}
		</div>
	  </div>
    <div class="row">
      <div class="col-sm-6">
        <div class="left-contact-sec"> 
           <h4>{$companyNameContact}</h4> 
           <address>{$LANG.contactusaddress}</address>
           <div class="tab-left-contact">
				<div class="tab">
					<button class="productlinks tab-active" onclick="productdetailsContactPage(event, 'size')">{$LANG.contactussalemain}</button>
					<button class="productlinks" onclick="productdetailsContactPage(event, 'measure')">{$LANG.contactuscustomerservicemain}</button>
					<button class="productlinks" onclick="productdetailsContactPage(event, 'technical')">{$LANG.contactustechnicalmain}</button>     
                </div>
				<div id="size" class="tabcontent" >
					<div class="size-product-des">
					 <h3>{$LANG.contactussaleenquery}</h3>
					 <ul class="list-inline">
					  <li class="list-inline-item"><a href="submitticket.php" class="sales-btn">{$LANG.contactusemailssaleticket}</a></li>
					  <li class="list-inline-item"><a href="#" class="live-chat-con">{$LANG.contactuslivechat}</a></li>
					 </ul>
					 <p>{$LANG.contactushotlinesale1} +{$hostx_theme_settings.country_calling_code_phone} {$hostx_theme_settings.phone}</p>
					 <p>{$LANG.contactusbusinesshoursale}</p>
					 <p>{$LANG.contactusemailssale}</p>
					</div>
				</div>
				<div id="measure" class="tabcontent" style="display:none;">
					<div class="size-product-des">
						 <h3>{$LANG.contactuscustomerenquery}</h3>
						 <ul class="list-inline">
						  <li class="list-inline-item"><a href="submitticket.php" class="sales-btn">{$LANG.contactusemailscustomerticket}</a></li>
						  <li class="list-inline-item"><a href="#" class="live-chat-con">{$LANG.contactuslivechat}</a></li>
						 </ul>
						 <p>{$LANG.contactushotlinecustomer1} +{$hostx_theme_settings.country_calling_code_phone} {$hostx_theme_settings.phone}</p>
						 <p>{$LANG.contactusbusinesshourcustomer}</p>
						 <p>{$LANG.contactusemailscustomer}</p>
					</div>
                </div>
                <div id="technical" class="tabcontent" style="display:none;">
                    <div class="size-product-des">
						 <h3>{$LANG.contactustechenquery}</h3>
						 <ul class="list-inline">
						  <li class="list-inline-item"><a href="submitticket.php" class="sales-btn">{$LANG.contactusemailstechnicalticket}</a></li>
						  <li class="list-inline-item"><a href="#" class="live-chat-con">{$LANG.contactuslivechat}</a></li>
						 </ul>
						 <p>{$LANG.contactushotlinetechnical1} +{$hostx_theme_settings.country_calling_code_phone} {$hostx_theme_settings.phone}</p>
						 <p>{$LANG.contactusbusinesshourtechnical}</p>
						 <p>{$LANG.contactusemailstechnical}</p>
					</div>
                </div>
           </div>
        </div>  
      </div>
		<div class="col-sm-6">
			<div class="ryt-contact-sec">
				{if !$sent}
					<form method="post" action="contact.php" class="form-horizontal" role="form">
						<input type="hidden" name="action" value="send" />
							<div class="form-group">
								<h3>Submit Your Inquiry</h3>
							</div>
							<div class="form-group">
								<label for="inputName">{$LANG.supportticketsclientname}</label>
								<input type="text" name="name" value="{$name}" class="form-control" id="inputName" />
							</div>
							<div class="form-group">
								<label for="inputEmail">{$LANG.supportticketsclientemail}</label>
								<input type="email" name="email" value="{$email}" class="form-control" id="inputEmail" />
							</div>
							<div class="form-group">
								<label for="inputSubject">{$LANG.supportticketsticketsubject}</label>
								<input type="subject" name="subject" value="{$subject}" class="form-control" id="inputSubject" />
							</div>
							<div class="form-group">
								<label for="inputMessage">{$LANG.contactmessage}</label>
								<textarea name="message" rows="7" class="form-control" id="inputMessage">{$message}</textarea>
							</div>
							{if $captcha}
								<div class="form-group">
									<div class="text-center margin-bottom">
									  {include file="$template/includes/captcha.tpl"}
									</div>
								</div>
							{/if}
					<button type="submit" class="btn btn-primary wgs-submit-button {$captcha->getButtonClass($captchaForm)}">{$LANG.contactsend}</button>
					</form>
				{/if}
			</div>
		</div>
    </div>
 </div>
</div>
{literal}
<script>
 function productdetailsContactPage(evt, cityName) {
	   var i, tabcontent, productlinks;
	   tabcontent = document.getElementsByClassName("tabcontent");
	   for (i = 0; i < tabcontent.length; i++) {
		 tabcontent[i].style.display = "none";
	   }
	   productlinks = document.getElementsByClassName("productlinks");
	   for (i = 0; i < productlinks.length; i++) {
		 productlinks[i].className = productlinks[i].className.replace(" tab-active", "");
	   }
	   document.getElementById(cityName).style.display = "block";
	   evt.currentTarget.className += " tab-active";
 }
</script>
{/literal}