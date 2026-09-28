{include file="orderforms/{$carttpl}/common.tpl"}
<script type="text/javascript">
   jQuery(document).ready(function(){           
        jQuery('.browse_extensions .nav-item').click(function(){
           var cat = jQuery(this).find('a').attr('data-cate');
		   jQuery('.tldlst').removeClass("filtered-row");
           jQuery('.tldlst[data-category*="' + cat + '"]').addClass("filtered-row")
           jQuery('.tldlst').hide();
		   jQuery(".tldlst.filtered-row").show()
           jQuery('.browse_extensions li').find('a').removeClass('active');
           jQuery(this).find('a').addClass('active');
        })
        jQuery('.browse_extensions .nav-item').eq(0).click();
   })
</script>
<div id="order-standard_cart">
    <div class="register-domain-section">
        <div class="row">            
            <div class="col-sm-12">
                {include file="orderforms/{$carttpl}/sidebar-categories.tpl"}
            </div>            
            <div class="col-sm-12">
        <div class="right">
            {include file="orderforms/{$carttpl}/sidebar-categories-collapsed.tpl"}
          <div class="search_domain">
            <h2>{$LANG.registerdomain}</h2> 
            <form method="post" action="{$WEB_ROOT}/cart.php" id="frmDomainChecker">
                <input type="hidden" name="a" value="checkDomain">
                <div class="search_domain_in">
                  <input type="text" name="domain" class="form-control" placeholder="{$LANG.findyourdomain}" value="{$lookupTerm}" id="inputDomain" data-toggle="tooltip" data-placement="left" data-trigger="manual" title="{lang key='orderForm.domainOrKeyword'}" />                  
                  <input type="submit" id="btnCheckAvailability" value="{$LANG.search}" class="btn domain-check-availability {$captcha->getButtonClass($captchaForm)}">
                </div>        
				{if $captcha->isEnabled() && $captcha->isEnabledForForm($captchaForm) && !$captcha->recaptcha->isInvisible()}
					<div class="col-md-8 col-md-offset-2 offset-md-2 col-xs-10 col-xs-offset-1 col-10 offset-1">
						<div class="captcha-container" id="captchaContainer">
							{if $captcha == "recaptcha"}
								<br>
								<div class="form-group recaptcha-container"></div>
							{elseif $captcha != "recaptcha"}
								<div class="default-captcha default-captcha-register-margin">
									<p>{lang key="cartSimpleCaptcha"}</p>
									<div>
										<img id="inputCaptchaImage" src="{$systemurl}includes/verifyimage.php" align="middle" />
										<input id="inputCaptcha" type="text" name="code" maxlength="6" class="form-control input-sm" data-toggle="tooltip" data-placement="right" data-trigger="manual" title="{lang key='orderForm.required'}" />
									</div>
								</div>
							{/if}
						</div>
					</div>
				{/if}
            </form>
          </div>

           <div id="DomainSearchResults" class="w-hidden">
                    <div id="searchDomainInfo" class="domain-checker-result-headline">
                        <p id="primaryLookupSearching" class="domain-lookup-loader domain-lookup-primary-loader domain-searching"><i class="fas fa-spinner fa-spin"></i> {lang key='orderForm.searching'}...</p>
                        <div id="primaryLookupResult" class="domain-lookup-result w-hidden">
                            <p class="domain-invalid domain-checker-invalid">{lang key='orderForm.domainLetterOrNumber'}<span class="domain-length-restrictions">{lang key='orderForm.domainLengthRequirements'}</span></p>
                            <p class="domain-unavailable domain-checker-unavailable">{lang key='orderForm.domainIsUnavailable'}</p>
                            <div class="domain-available">
                              <p class="domain-tld-unavailable domain-checker-unavailable">{lang key='orderForm.domainHasUnavailableTld'}</p>
                              <p class="domain-checker-available">{$LANG.domainavailablemessage}</p>
                              <p class="domain-price">
                                  <span class="price"></span>
                                  <button class="button01  btn-add-to-cart" data-whois="0" data-domain="">
                                      <span class="to-add">{$LANG.addtocart}</span>
                                      <span class="added"><i class="glyphicon glyphicon-shopping-cart"></i> {lang key='checkout'}</span>
                                      <span class="unavailable">{$LANG.domaincheckertaken}</span>
                                  </button>
                              </p>
								<div id="idnLanguageSelector" class="form-group idn-language-selector w-hidden">
									<div class="row">
										<div class="col-sm-10 col-sm-offset-1 col-lg-8 col-lg-offset-2 offset-sm-1 offset-lg-2">
											<div class="margin-10 text-center">
												{lang key='cart.idnLanguageDescription'}
											</div>
										</div>
									</div>
									<div class="row">
										<div class="col-sm-8 col-lg-6 col-sm-offset-2 col-lg-offset-3 offset-sm-2 offset-lg-3">
											<select name="idnlanguage" class="form-control">
												<option value="">{lang key='cart.idnLanguage'}</option>
												{foreach $idnLanguages as $idnLanguageKey => $idnLanguage}
													<option value="{$idnLanguageKey}">{lang key='idnLanguage.'|cat:$idnLanguageKey}</option>
												{/foreach}
											</select>
											<div class="field-error-msg">
												{lang key='cart.selectIdnLanguageForRegister'}
											</div>
										</div>
									</div>
								</div>
                            </div>
							<p class="domain-unavailable domain-error domain-checker-unavailable"></p>
                            <a class="domain-contact-support btn btn-primary">{$LANG.domainContactUs}</a>
                        </div>
                    </div>

                    {if $spotlightTlds}                       
                        <div id="spotlightTlds" class="spotlight-tlds clearfix">
                            <div class="spotlight-tlds-container">
                                <div class="domain_row">
                                    <div class="row">
										<div id="sliderSpotLight">
                                        {foreach $spotlightTlds as $key => $data}                                
                                            <div class="spotlight-tld-container spotlight-tld-container">
                                                <div id="spotlight{$data.tldNoDots}" class="spotlight-tld">
                                                    <div class="{$data.group} domain_colos">
                                                      <h2>{$data.tld} <br> <small>{$data.register}</small></h2>
                                                      <span class="domain-lookup-loader domain-lookup-spotlight-loader">
                                                          <i class="fas fa-spinner fa-spin"></i>
                                                      </span>
                                                      <div class="domain-lookup-result">
                                                          <button type="button" class="btn small-button d-small-button unavailable w-hidden" disabled="disabled">
                                                              {lang key='domainunavailable'}
                                                          </button>
                                                          <button type="button" class="btn small-button d-small-button invalid w-hidden" disabled="disabled">
                                                              {lang key='domainunavailable'}
                                                          </button>
                                                          
                                                          <button type="button" class="w-hidden btn-add-to-cart small-button" data-whois="0" data-domain="">
                                                            <span class="to-add">{lang key='orderForm.add'}</span>
															<span class="loading">
																<i class="fas fa-spinner fa-spin"></i> {lang key='loading'}
															</span>
                                                            <span class="added"><i class="far fa-shopping-cart"></i> {lang key='checkout'}</span>
                                                              <span class="unavailable">{$LANG.domaincheckertaken}</span>
                                                          </button>                                                          
                                                      </div>

                                                    </div>
                                                </div>
                                            </div>
                                        {/foreach}
										</div>
                                  </div>
                                </div>      
                            </div>
                        </div>
                    {/if}

                    <div class="suggested-domains{if !$showSuggestionsContainer} w-hidden{/if}">
                        <div class="browse_extensions">
                            <div class="tab-content">
                              <div id="popular" class="tab-pane active">
                                <div class="domain_table domain_table1">
                                  <p>{lang key='orderForm.suggestedDomains'}</p>
                                  <div id="suggestionsLoader" class="panel-body domain-lookup-loader domain-lookup-suggestions-loader">
                                      <i class="fas fa-spinner fa-spin"></i> {lang key='orderForm.generatingSuggestions'}
                                  </div>                                
									<div id="domainSuggestions" class="domain-lookup-result list-group w-hidden">
										<div class="domain-suggestion list-group-item w-hidden">
											<div class="domain-name">
												<span class="domain"></span><span class="extension"></span>
												<span class="promo w-hidden">
													<span class="sales-group-hot w-hidden">{lang key='domainCheckerSalesGroup.hot'}</span>
													<span class="sales-group-new w-hidden">{lang key='domainCheckerSalesGroup.new'}</span>
													<span class="sales-group-sale w-hidden">{lang key='domainCheckerSalesGroup.sale'}</span>
												</span>
											</div>
											<div class="wgs-domains">
												<span class="price"></span> 
											</div>
											<div class="domain-button">
												<div class="actions">                                            
												<button type="button" class="button01 btn-add-to-cart" data-whois="1" data-domain="">
													<span class="to-add">{$LANG.addtocart}</span>
													<span class="added"><i class="glyphicon glyphicon-shopping-cart"></i> {lang key='checkout'}</span>
													<span class="unavailable">{$LANG.domaincheckertaken}</span>
												</button>                                            
												</div>
											</div>
										</div>
									</div>
                                  <div class="panel-footer more-suggestions w-hidden text-center">
                                      <center>                                        
                                        <a id="moreSuggestions" class="suggestions_button" href="javascript:;" onclick="loadMoreSuggestions();return false;">{lang key='domainsmoresuggestions'}</a>
                                        {* <a id="noMoreSuggestions" class="no-more small w-hidden" href="javascript:;">{lang key='domaincheckernomoresuggestions'}</a> *}
                                      </center>
                                  </div>
                                  <div class="text-center text-muted domain-suggestions-warning">
                                      <p>{lang key='domainssuggestionswarnings'}</p>
                                  </div>
                                </div>
                              </div>
                            </div>
                        </div>

                        
                        
                        
                    </div>

                </div> 

            <div class="domain-pricing">
                  <div class="domain_row">
                    <div class="row">

                  {if $featuredTlds}
                        <div class="featured-tlds-container">                            
                                {foreach $featuredTlds as $num => $tldinfo}
                                    <div class="domain_colos">
                                      <h2>
                                         <div class="img-container">
                                                <img src="{$BASE_PATH_IMG}/tld_logos/{$tldinfo.tldNoDots}.png" style="height: 42px;">
                                            </div>
                                            <br>
                                      <small>
                                            {if is_object($tldinfo.register)}
                                                {$tldinfo.register->toPrefixed()}{if $tldinfo.period > 1}{lang key="orderForm.shortPerYears" years={$tldinfo.period}}{else}{lang key="orderForm.shortPerYear" years=''}{/if}
                                            {else}
                                                {lang key="domainregnotavailable"}
                                            {/if}
                                      </small>
                                    </h2>                                      
                                    </div>                                    
                                {/foreach}                            
                        </div>
                    {/if}                     


                    </div>
                  </div>

                  <div class="browse_extensions">
                    <h2>{lang key='pricing.browseExtByCategory'}</h2>
                    <ul class="nav" role="tablist">  
                        {foreach $categoriesWithCounts as $category => $count}
                        <li class="nav-item">                          
                            <a href="javascript:;" data-cate="{$category}" class="nav-link">{lang key="domainTldCategory.$category" defaultValue=$category} ({$count})</a>
                        </li>
                        {/foreach}
                  </ul>
                  <div class="tab-content">
                    <div id="popular" class="tab-pane active">
                      <div class="domain_table">
                        <table>
                          <tr>
                            <th width="25%">{lang key='orderdomain'}</th>
                            <th width="25%">{lang key='pricing.register'}</th>
                            <th width="25%">{lang key='pricing.transfer'}</th>
                            <th width="25%">{lang key='pricing.renewal'}</th> 
                          </tr>
                          {foreach $pricing['pricing'] as $tld => $price}
                            <tr class="{$price.group} tldlst" data-category="{foreach $price.categories as $category}|{$category}|{/foreach}">
                            <td>.{$tld}</td>                             
                            <td>
								{if isset($price.register) && current($price.register) > 0}
									{current($price.register)}
									<small>{key($price.register)} {if key($price.register) > 1}{lang key="orderForm.years"}{else}{lang key="orderForm.year"}{/if}</small>
								{elseif isset($price.register) && current($price.register) == 0}
									<small>{lang key='orderfree'}</small>
								{else}
									<small>{lang key='na'}</small>
								{/if}    
                            </td>
                            <td>
							    {if isset($price.transfer) && current($price.transfer) > 0}
									{current($price.transfer)}
									<small>{key($price.transfer)} {if key($price.register) > 1}{lang key="orderForm.years"}{else}{lang key="orderForm.year"}{/if}</small>
								{elseif isset($price.transfer) && current($price.transfer) == 0}
									<small>{lang key='orderfree'}</small>
								{else}
									<small>{lang key='na'}</small>
								{/if}
                            </td>
                            <td>
								{if isset($price.renew) && current($price.renew) > 0}
									{current($price.renew)}
									<small>{key($price.renew)} {if key($price.register) > 1}{lang key="orderForm.years"}{else}{lang key="orderForm.year"}{/if}</small>
								{elseif isset($price.renew) && current($price.renew) == 0}
									<small>{lang key='orderfree'}</small>
								{else}
									<small>{lang key='na'}</small>
								{/if}
                            </td> 
                          </tr>
                          {/foreach}                          
                        </table>
                      </div>
                      {*
                      <div class="row tld-row no-tlds">
                        <div class="col-xs-12 text-center">
                            <br>
                            {lang key='pricing.selectExtCategory'}
                            <br><br>
                        </div>
                      </div>
                      *}
                    </div>
                  </div>
                  </div>

                  <div class="add_web_hosting">
                    <div class="row">
                      <div class="col-sm-6">
                        <div class="box">
                          <img src="{$WEB_ROOT}/templates/{$template}/images/{$layoutStyle}/server_icon.png">
                          <h2>{lang key='orderForm.addHosting'}</h2>
                          <p>{lang key='orderForm.chooseFromRange'}</p>
                          <p>{lang key='orderForm.packagesForBudget'}</p>
                          <a href="{$WEB_ROOT}/cart.php" class="button01">{lang key='orderForm.exploreNow'}</a>  
                        </div>
                      </div>
                       <div class="col-sm-6">
                        <div class="box">
                          <img src="{$WEB_ROOT}/templates/{$template}/images/{$layoutStyle}/hosting_icon.png"> 
                          <h2>{lang key='orderForm.transferToUs'}</h2>
                          <p>{lang key='orderForm.transferExtend'}*</p>
                          <p>* {lang key='orderForm.extendExclusions'}</p>
                          <a href="{$WEB_ROOT}/cart.php?a=add&domain=transfer" class="button01"> {lang key='orderForm.transferDomain'}</a>  
                        </div>
                      </div>
                    </div>
                  </div>
            </div>      

        </div>
      </div>

            
        </div>
    </div>        
</div>
<script>
jQuery(document).ready(function() {
    jQuery('.tld-filters a:first-child').click();
{if $lookupTerm && !$captchaError && !$invalid}
    jQuery('#btnCheckAvailability').click();
{/if}
{if $invalid}
    jQuery('#primaryLookupSearching').toggle();
    jQuery('#primaryLookupResult').children().toggle();
    jQuery('#primaryLookupResult').toggle();
    jQuery('#DomainSearchResults').toggle();
    jQuery('.domain-invalid').toggle();
{/if}
});
</script>
