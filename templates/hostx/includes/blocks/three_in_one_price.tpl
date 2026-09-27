<div class="new-hx-tabs">
    <div class="container">
      <div class="row hx-tab-inner">
        <div class="col-12">
          <div class="row">
            <div class="col-md-3 tab-leftwidth">
              <div class="nav flex-column nav-pills" id="v-pills-tab" role="tablist" aria-orientation="vertical">
				{if $domainSectionAllowed}
					<a class="nav-link-new active" id="v-pills-home-tab" data-toggle="pill" href="#v-pills-home" role="tab"
					  aria-controls="v-pills-home" aria-selected="true">
					  <span><img src="{$WEB_ROOT}/templates/{$template}/caticons/hx_blueicon1.svg" alt=""></span>{$LANG.buyadomain}
					</a>
				{/if}
				{if $productDataNewBlock}
					{$turns = 0}
					{foreach from=$productDataNewBlock item=newBlkData}
						<a class="nav-link-new {if !$domainSectionAllowed && $turns eq '0'}active{/if}" data-toggle="pill" id="v-pills-group-content-tab{$newBlkData.groupId}" href="#v-pills-group-content{$newBlkData.groupId}" role="tab" aria-controls="v-pills-group-content{$newBlkData.groupId}" aria-selected="false">
						  <span><img src="{$WEB_ROOT}/templates/{$template}/caticons/{$newBlkData.groupIcon}" alt="{$newBlkData.groupIcon}"></span>
						  {$newBlkData.groupName}
						</a>
						{$turns = $turns+1}
					{/foreach}
				{/if}
              </div>
            </div>
            <div class="col-md-9 tab-rightwidth">
              <div class="tab-content" id="v-pills-tabContent">
				{if $domainSectionAllowed}
					<div class="tab-pane fade active in" id="v-pills-home" role="tabpanel"
					  aria-labelledby="v-pills-home-tab">
					  <div class="hx-table-content">
						{if $captchaEnabledDomainHostx eq 'yes'}
							<div class="hx-tablesearchbar">
								<form method="post" action="domainchecker.php">
								<input type="hidden" name="register">
								<div class="input-group">
								  <div class="input-group-prepend pr-0">
									<span class="input-group-text bg-transparent border-right-0 pr-0 pl-4" id="basic-addon1">{$LANG.orderForm.www}</span>
								  </div>
								  <input type="text" class="form-control border-0" name="sld" id="domainnameAjax" placeholder="{$LANG.domainBlockPlaceHolder}">
								  <div class="input-group-append">
									{if !empty($domaintldextensions)}
										<select class="form-control hx_customdropdown" name="tld" id="tldDropdownBlock">
										{foreach from=$domaintldextensions item=tldextensionData}
											<option value="{$tldextensionData}">{$tldextensionData}</option>
										{/foreach}
										</select>
									{/if}
									<button class="btn btn-secondary" type="submit">
									  <i class="fa fa-search mr-2"></i>{$LANG.domainsearch}
									</button>
								  </div>
								</div>
								</form>
							</div>
						{else}
							<div class="hx-tablesearchbar">
								<div class="input-group">
								  <div class="input-group-prepend pr-0">
									<span class="input-group-text bg-transparent border-right-0 pr-0 pl-4" id="basic-addon1">{$LANG.orderForm.www}</span>
								  </div>
								  <input type="text" class="form-control border-0" name="sld" id="domainnameAjax" placeholder="{$LANG.domainBlockPlaceHolder}">
								  <div class="input-group-append">
									{if !empty($domaintldextensions)}
										<select class="form-control hx_customdropdown" id="tldDropdownBlock">
										{foreach from=$domaintldextensions item=tldextensionData}
											<option value="{$tldextensionData}">{$tldextensionData}</option>
										{/foreach}
										</select>
									{/if}
									<button class="btn btn-secondary" type="button" onclick="wgsSearchdomainAjax(this);">
									  <i class="fa fa-search mr-2"></i>{$LANG.domainsearch}
									</button>
								  </div>
								</div>
							</div>
						{/if}
						<div class="hidden" id="loaderSerachBlock">
							<img src="{$WEB_ROOT}/templates/{$template}/images/loaderforblock.gif" alt="loader">
						</div>
						<div class="hidden" id="domainErrorD"></div>
						<div class="hx_domain hidden" id="domainTakenErrorDivsBlock">
							<div class="hx_domain-header">
								<h3><span><i class="fa fa-times"></i></span>{$LANG.domainreserved1} {$LANG.domainunavailable2}</h3>
							</div>
							<div class="hx_domain-body">
								<p class="unavail-msg"><span>{$LANG.domainunavailable1}</span> 
									{$LANG.orderForm.domainIsUnavailable}
								</p>
								<p>{$LANG.domainchecker.suggestiontakenmsg}</p>
							</div>
						</div>
						{if $tld_data['show_on_price_table']}
						<div class="hx-tbl-data pt-4">
						  <table class="table table-striped" id="tbl-new-block-tld">
							<tbody id="domainSuggestionTable">
								{foreach from=$tld_data['show_on_price_table']  item=domain_item}
									<tr>
									<td class="hx-table-extensions">.{$domain_item->tld_id}</td>
									<td class="hx-table-price"> {$domain_item->register} /{$LANG.pricingCycleShort.annually}</td>
									<td class="hx-table-noprice">{$domain_item->price}</td>
									</tr>
								{/foreach}
							</tbody>
						  </table>
						  <p><span class="hx-domain-txt cursorPointerCss" onclick="location.href='/cart.php?a=add&domain=register'">{$LANG.fullDomainPricingTxt}</span> <span class="hx-arrow"><img src="{$WEB_ROOT}/templates/{$template}/images/hx-right-arrow.svg" alt="right arrow"></span>{$LANG.promotionPriceTxt}</p>
						</div>
						{/if}
					  </div>
					  <div class="hx_supprt-sec">
						<a href="#" class="hx_hide-btn"><span class="pr-1"><img src="{$WEB_ROOT}/templates/{$template}/images/hx_hand.svg" alt="hand"></span>{$LANG.domainNoHiddenFee}
						</a>                              
						<ul class="list-inline m-0">
						  <li class="list-inline-item"><span><img src="{$WEB_ROOT}/templates/{$template}/images/hx_headphone.svg" alt="headphone"></span>{$LANG.domain24Seven}</li>
						  <li class="list-inline-item"><span><img src="{$WEB_ROOT}/templates/{$template}/images/hx_db.svg" alt="db"></span>{$LANG.domainFreeDnsHost}</li>
						  <li class="list-inline-item"><span><img src="{$WEB_ROOT}/templates/{$template}/images/hx_attchment.svg" alt="attachment"></span>{$LANG.domainFreeUrlForward} </li>
						  <li class="list-inline-item"><span><img src="{$WEB_ROOT}/templates/{$template}/images/hx-mail.svg" alt="mail"></span>{$LANG.domainFreeEmailForward}</li>
						</ul>
					  </div>
					</div>
				{/if}
				{if $productDataNewBlock}
					{$turns = 0}
					{foreach from=$productDataNewBlock item=newBlkData}
						<div class="tab-pane fade {if !$domainSectionAllowed && $turns eq '0'}active in{/if}" id="v-pills-group-content{$newBlkData.groupId}" role="tabpanel" aria-labelledby="v-pills-group-content-tab{$newBlkData.groupId}">
							<div class="hx_web-hosting-sec">
							  <div class="row hx_webhost-pdng">
								<div class="col-md-6">
								  <div class="hx_web-host-heading">
									<h3>{$newBlkData.groupHead}</h3>
									  <p>{$newBlkData.groupSubHead}</p>
								  </div>
								</div>
								<div class="col-md-6">
									{$newBlkData.groupDescp}
								</div>
							  </div>
							{if $newBlkData.productArray}
								<div class="row hx_webhosting_plans">
									{foreach from=$newBlkData.productArray item=productArrayData}
										<div class="col-md-4 hx_brd-r">
										  <div class="hx_plans">
										  <div class="hx_wb-hostplans">
											<h3>{$productArrayData['name']}</h3>
											<div class="hx_wb-hostprice">
												<div class="txt value">{$productArrayData['price']}</div>
												{if $productArrayData['type'] eq 'recurring'}
													<div class="txt period">/{$productArrayData['cycle']}</div>
												{elseif $productArrayData['type'] eq 'onetime'}
													<div class="txt period">{$productArrayData['cycle']}</div>
												{/if}
											  </div>  
										  </div>
										  <div class="hx_description">
											{$productArrayData['description']}
										  </div>
										  <div class="hx_buybtn">
											{if $productArrayData['domainOption'] eq '1'}
												<a onclick="wgsAddHomePageProduct(this,'{$productArrayData['pid']}');" class="cursorPointerCss">{$LANG.ordernowbutton}</a>
											{else}
											<a href="{$WEB_ROOT}/cart.php?a=add&pid={$productArrayData['pid']}">{$LANG.ordernowbutton}</a>
											{/if}
										  </div>
										 </div>
										</div>
									{/foreach}
								</div>
								<div class="col-12 px-0">
								  <p class="hx_plans-find m-0"><a href="{$WEB_ROOT}/cart.php?gid={$newBlkData.groupId}">{$LANG.domainFindOutMore} <i class="fa fa-angle-right ml-2"></i></a></p>
								</div>
							{/if}
							</div>
						</div>
						{$turns = $turns+1}
					{/foreach}
				{/if}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
</div>
<script>
	var addCartButtonLang = "{$LANG.orderForm.addToCart}";
	var checkoutButtonLang = "{$LANG.ordercheckout}";
	var domainAlreadyInCart = "{$LANG.domainAlreadyExist}";
	var orderHostingBtn = "{$LANG.orderhosting}";
	var preferTldError = "{$LANG.domainTldPreffer}";
	var domainisavailable = "{$LANG.domainavailable2}";
	var domainSuggestionSeting = "{$hostx_theme_settings.domain_suggestion_display_hmpg}";
</script>