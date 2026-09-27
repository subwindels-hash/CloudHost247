<link href="{assetPath file='store.css'}" rel="stylesheet">
<link href="{$WEB_ROOT}/templates/{$template}/store/css/store-custom.css" rel="stylesheet">
<div class="landing-page sitelock">
    <div class="hero site-locks-backg">
        <div class="container top_banner_sections_ssl">
             <div class="row">
                <div class="col-sm-6">
                    <h2>Site Lock</h2>
                    <h3>{lang key="store.sitelock.tagline"}</h3>
                </div>
                <div class="col-sm-6">
					<div class="logo-container">
						<img src="{$WEB_ROOT}/templates/{$template}/images/protected_banner_img_sec.png" class="float-right banner_protected_img">
					</div>
                </div>
            </div>
        </div>
       
    <div></div></div>
    <nav class="navbar navbar-default navs_tab_ssl_sec">
      <div class="container">
        <div class="navbar-header">
          <button type="button" class="navbar-toggle collapsed" data-toggle="collapse" data-target="#nav-landing-page" aria-expanded="false">
            <span class="sr-only">{lang key="toggleNav"}</span>
            <span class="icon-bar"></span>
            <span class="icon-bar"></span>
            <span class="icon-bar"></span>
          </button>
        </div>
        <div class="collapse navbar-collapse nav_tb_ssl" id="nav-landing-page">
          <ul class="nav navbar-nav">
            <li><a href="#" onclick="smoothScroll('#plans');return false">{lang key="store.sitelock.plansAndPricing"}</a></li>
            <li><a href="#" onclick="smoothScroll('#features');return false">{lang key="store.sitelock.featuresLink"}</a></li>
            <li><a href="#" onclick="smoothScroll('#emergency');return false">{lang key="store.sitelock.websiteHacked"}</a></li>
            <li><a href="#" onclick="smoothScroll('#faq');return false">{lang key="store.sitelock.faq"}</a></li>
          </ul>
        </div>
      </div>
    </nav>

<div class="content-block ssl_standouts_section">
        <div class="container">

            <div class="row">
                <div class="col-sm-4 col-md-4 col-sm-push-8 col-md-push-9 text-right hidden-xs">
                    <br><br>
                     <img src="{$WEB_ROOT}/templates/{$template}/images/ssl_img_l.png" class="check_list_icon11">
                </div>
                <div class="col-sm-8 col-md-8 col-sm-pull-4 ">

                    <h2 class="heading_str">{lang key="store.sitelock.contentHeadline"}</h2>

            <br>
            <p>{lang key="store.sitelock.contentBodyParagraph1"}</p>
            <p>{lang key="store.sitelock.contentBodyParagraph2"}</p>
            <p>{lang key="store.sitelock.contentBodyParagraph3"}</p>

                </div>
            </div>

        </div>
    <div></div></div>
    <div class="content-block plans" id="plans">
        <div class="container">
            {if !$loggedin && $currencies}
                <form method="post" action="" class="pull-right">
                    <select name="currency" class="form-control currency-selector" onchange="submit()">
                        <option>{lang key="changeCurrency"} ({$activeCurrency.prefix} {$activeCurrency.code})</option>
                        {foreach $currencies as $currency}
                            <option value="{$currency['id']}">{$currency['prefix']} {$currency['code']}</option>
                        {/foreach}
                    </select>
                </form>
            {/if}
            <h2>{lang key="store.sitelock.comparePlans"}</h2>
            <h3>{lang key="store.sitelock.comparePlansSubtitle"}</h3>

            <div class="row plan-comparison">
                {foreach $plans as $plan}
                    <div class="col-lg-{if count($plans) == 4}3{elseif count($plans) == 3}4{elseif count($plans) == 2}6{else}12{/if} col-md-{if count($plans) == 3}4{/if} col-sm-6">
                        
                        <div class="plan">
                            <div class="header">
                                <h4>
                                    {$plan->name}
                                </h4>
                                    
                                
                                <p>{$plan->description}</p>
                                <span class="new_mothly-text">
                                        {if $plan->isFree()}
                                            FREE
                                        {elseif $plan->pricing()->annually()}
                                            {$plan->pricing()->annually()->toPrefixedString()}
                                        {elseif $plan->pricing()->first()}
                                            {$plan->pricing()->first()->toPrefixedString()}
                                        {else}
                                            -
                                        {/if}
                                    </span>
                            </div>
                            <ul>
                                {foreach $plan->features as $label => $value}
                                    <li>
                                        <span>{$label}</span>

                                        {if is_bool($value)}
                                            <i class="fas fa-{if $value}check{else}times{/if}"></i>
                                        {else}
                                            {$value}
                                        {/if}
                                    </li>
                                {/foreach}
                            </ul>
                            <div class="footer">
                                <form method="post" action="{routePath('cart-order')}">
                                    <input type="hidden" name="pid" value="{$plan->id}">
                                    <select name="billingcycle" class="form-control">
                                        {foreach $plan->pricing()->allAvailableCycles() as $cycle}
                                            <option value="{$cycle->cycle()}">
                                                {if $cycle->isRecurring()}
                                                    {if $cycle->isYearly()}
                                                        {$cycle->cycleInYears()}
                                                    {else}
                                                        {$cycle->cycleInMonths()}
                                                    {/if}
                                                    -
                                                {/if}
                                                {$cycle->toFullString()}</option>
                                        {/foreach}
                                    </select>
                                    <button type="submit" class="btn btn-block">{lang key="store.sitelock.buyNow"}</button>
                                </form>
                            </div>
                        </div>
                         
                    </div>
                {/foreach}
            </div>

        </div>
    </div>

    <div class="content-block features" id="features">
        <div class="container">

            <h2 class="headings_inner_content color_blackk">{lang key="store.sitelock.featuresTitle"}</h2>
            <h3 class="inner_sub_headings color_blackk">{lang key="store.sitelock.featuresHeadline"}</h3>

            <br>

            <div class="row">
                <div class="col-md-6">
                    <div class="feature-wrapper">
                        <i class="fas fa-search fa-fw"></i>
                        <div class="content">
                            <h4>{lang key="store.sitelock.featuresMalwareTitle"}</h4>
                            <p>{lang key="store.sitelock.featuresMalwareContent"}</p>
                        </div>
                    </div>
                </div>
                <div class="col-md-6">
                    <div class="feature-wrapper">
                        <i class="fas fa-wrench fa-fw"></i>
                        <div class="content">
                            <h4>{lang key="store.sitelock.featuresMalwareRemovalTitle"}</h4>
                            <p>{lang key="store.sitelock.featuresVulnerabilityContent"}</p>
                        </div>
                    </div>
                </div>
            </div>
            <div class="row">
                <div class="col-md-6">
                    <div class="feature-wrapper">
                        <i class="fas fa-code fa-fw"></i>
                        <div class="content">
                            <h4>{lang key="store.sitelock.featuresVulnerabilityTitle"}</h4>
                            <p>{lang key="store.sitelock.featuresVulnerabilityContent"}</p>
                        </div>
                    </div>
                </div>
                <div class="col-md-6">
                    <div class="feature-wrapper">
                        <i class="far fa-file-code fa-fw"></i>
                        <div class="content">
                            <h4>{lang key="store.sitelock.featuresOWASPTitle"}</h4>
                            <p>{lang key="store.sitelock.featuresOWASPContent"}</p>
                        </div>
                    </div>
                </div>
            </div>
            <div class="row">
                <div class="col-md-6">
                    <div class="feature-wrapper">
                        <i class="fas fa-trophy fa-fw"></i>
                        <div class="content">
                            <h4>{lang key="store.sitelock.featuresTrustSealTitle"}</h4>
                            <p>{lang key="store.sitelock.featuresTrustSealContent"}</p>
                        </div>
                    </div>
                </div>
                <div class="col-md-6">
                    <div class="feature-wrapper">
                        <i class="fas fa-shield fa-fw"></i>
                        <div class="content">
                            <h4>{lang key="store.sitelock.featuresFirewallTitle"}</h4>
                            <p>{lang key="store.sitelock.featuresFirewallContent"}</p>
                        </div>
                    </div>
                </div>
            </div>
            <div class="row">
                <div class="col-md-6">
                    <div class="feature-wrapper">
                        <i class="fas fa-lock fa-fw"></i>
                        <div class="content">
                            <h4>{lang key="store.sitelock.featuresReputationTitle"}</h4>
                            <p>{lang key="store.sitelock.featuresReputationContent"}</p>
                        </div>
                    </div>
                </div>
                <div class="col-md-6">
                    <div class="feature-wrapper">
                        <i class="fas fa-star fa-fw"></i>
                        <div class="content">
                            <h4>{lang key="store.sitelock.featuresSetupTitle"}</h4>
                            <p>{lang key="store.sitelock.featuresSetupContent"}</p>
                        </div>
                    </div>
                </div>
            </div>
            <div class="row">
                <div class="col-md-6">
                    <div class="feature-wrapper">
                        <i class="fas fa-globe fa-fw"></i>
                        <div class="content">
                            <h4>{lang key="store.sitelock.featuresCDNTitle"}</h4>
                            <p>{lang key="store.sitelock.featuresCDNContent"}</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    {if !is_null($emergencyPlan)}
    <div class="content-block emergency" id="emergency">
        <div class="container">

            <h2 class="headings_inner_content color_white">{lang key="store.sitelock.emergencyPlanTitle"}</h2>
            <h3>{lang key="store.sitelock.emergencyPlanHeadline"}</h3>

            <p class="inner_sub_headings color_white">{lang key="store.sitelock.emergencyPlanBody"}</p>

            <br>
            <div class="row">
                <div class="col-md-4 col-sm-4">
                    <div class="new_ssl_inner_bx first_new_ssl">
                         <img src="{$WEB_ROOT}/templates/{$template}/images/icon_a1.png" class="imgg-tops-margin">
                         <h4>{lang key="store.sitelock.emergencyPlanResponseTitle"}</h4>
                         <p>{lang key="store.sitelock.emergencyPlanResponseContent"}</p>
                    </div>
                    
                </div>
                <div class="col-md-4 col-sm-4">
                      <div class="new_ssl_inner_bx sec_new_ssl">
                        <img src="{$WEB_ROOT}/templates/{$template}/images/icon_a2.png">
                        <h4>{lang key="store.sitelock.emergencyPlanMalwareTitle"}</h4>
                        <p>{lang key="store.sitelock.emergencyPlanMalwareContent"}</p>
                    </div>
                </div>
                <div class="col-md-4 col-sm-4">
                    <div class="new_ssl_inner_bx third_new_ssl">
                       <img src="{$WEB_ROOT}/templates/{$template}/images/icon_a3.png">
                        <h4>{lang key="store.sitelock.emergencyPlanPriorityTitle"}</h4>
                          <p>{lang key="store.sitelock.emergencyPlanPriorityContent"}</p>
                    </div>
                </div>
                <div class="col-md-4 col-sm-4">
                    <div class="new_ssl_inner_bx fourth_new_ssl">
                       <img src="{$WEB_ROOT}/templates/{$template}/images/icon_a4.png">
                          <h4>{lang key="store.sitelock.emergencyPlanAftercareTitle"}</h4>
                        <p>{lang key="store.sitelock.emergencyPlanAftercareContent"}</p>
                    </div>
                </div>
                <div class="col-md-4 col-sm-4">
                    <div class="new_ssl_inner_bx fivth_new_ssl">
                         <img src="{$WEB_ROOT}/templates/{$template}/images/icon_a5.png">
                         <h4>{lang key="store.sitelock.emergencyPlanUpdatesTitle"}</h4>
                        <p>{lang key="store.sitelock.emergencyPlanUpdatesContent"}</p>
                    </div>
                </div>
                <div class="col-md-4 col-sm-4">
                    <div class="new_ssl_inner_bx six_new_ssl">
                        <img src="{$WEB_ROOT}/templates/{$template}/images/icon_a6.png">
                        <<h4>{lang key="store.sitelock.emergencyPlanPaymentTitle"}</h4>
                            <p>{lang key="store.sitelock.emergencyPlanPaymentContent"}</p>
                    </div>
                </div>
            </div>
        </div>
    </div>
    {/if}

    <div class="innr_bx_lastsec">
             <div class="container">
                <div class="price pull-left">
                    <h3>{lang key="store.sitelock.emergencyPlanOnlyCost" price="{if $emergencyPlan->pricing()->best()}{$emergencyPlan->pricing()->best()->toFullString()}{else}-{/if}" }</h3>
                </div>
                <form method="post" action="{routePath('cart-order')}">
                    <input type="hidden" name="pid" value="{$emergencyPlan->id}">
                    <button type="submit" class="btn btn-default pull-right">
                     {lang key="store.sitelock.buyNow"}
                    </button>
                </form>
            </div>
    </div>

<!-- site lock acording part -->
<div class="frequently-questions" id="faq">
	<div class="container">
		<div class="row frequently-questions-row">
			<h2>{lang key="store.sitelock.faqTitle"}</h2>
			<div class="col-sm-12 wgs-question-div">
				<div class="panel">
				  <div class="panel-heading">
					<h4 data-toggle="collapse" data-parent="#accordion" href="#collapsePanelOne" class="panel-title expand">
					   <span class="arrow"><i class="fas fa-chevron-right"></i></span>&nbsp;&nbsp;
					  <a href="#">{lang key="store.sitelock.faqOneTitle"}</a>
					</h4>
				  </div>
				  <div id="collapsePanelOne" class="panel-collapse collapse">
					<div class="panel-body">
						{lang key="store.sitelock.faqOneBody"}
						<br/><br/>
                        {lang key="store.sitelock.faqOneBodyLearnMore" learnMoreLink={$learnMoreLink}}
					</div>
				  </div>
				</div>
				<div class="panel">
				  <div class="panel-heading">
					<h4 data-toggle="collapse" data-parent="#accordion" href="#collapsePanelTwo" class="panel-title expand">
					   <span class="arrow"><i class="fas fa-chevron-right"></i></span>&nbsp;&nbsp;
					  <a href="#">{lang key="store.sitelock.faqTwoTitle"}</a>
					</h4>
				  </div>
				  <div id="collapsePanelTwo" class="panel-collapse collapse">
					<div class="panel-body">
						{lang key="store.sitelock.faqTwoBody"}
					</div>
				  </div>
				</div>
				<div class="panel">
				  <div class="panel-heading">
					<h4 data-toggle="collapse" data-parent="#accordion" href="#collapsePanelThree" class="panel-title expand">
					   <span class="arrow"><i class="fas fa-chevron-right"></i></span>&nbsp;&nbsp;
					  <a href="#">{lang key="store.sitelock.faqThreeTitle"}</a>
					</h4>
				  </div>
				  <div id="collapsePanelThree" class="panel-collapse collapse">
					<div class="panel-body">
						{lang key="store.sitelock.faqThreeBody"}
						<br>
						<ul>
							<li><strong>{lang key="store.sitelock.faqThreeBodyList1Title"}:</strong> {lang key="store.sitelock.faqThreeBodyList1"}</li>
							<li><strong>{lang key="store.sitelock.faqThreeBodyList2Title"}:</strong> {lang key="store.sitelock.faqThreeBodyList2"}</li>
							<li><strong>{lang key="store.sitelock.faqThreeBodyList3Title"}:</strong> {lang key="store.sitelock.faqThreeBodyList3"}</li>
						</ul>
					</div>
				  </div>
				</div>
				<div class="panel">
				  <div class="panel-heading">
					<h4 data-toggle="collapse" data-parent="#accordion" href="#collapsePanelFour" class="panel-title expand">
					   <span class="arrow"><i class="fas fa-chevron-right"></i></span>&nbsp;&nbsp;
					  <a href="#">{lang key="store.sitelock.faqFourTitle"}</a>
					</h4>
				  </div>
				  <div id="collapsePanelFour" class="panel-collapse collapse">
					<div class="panel-body">
						{lang key="store.sitelock.faqFourBodyParagraph1" vulnerabilityStrong="<strong>{lang key="store.sitelock.websiteVulnerability"}</strong>"}<br/><br/>
                        {lang key="store.sitelock.faqFourBodyParagraph2" malwareStrong="<strong>{lang key="store.sitelock.malware"}</strong>"}
					</div>
				  </div>
				</div>
				<div class="panel">
				  <div class="panel-heading">
					<h4 data-toggle="collapse" data-parent="#accordion" href="#collapsePanelFive" class="panel-title expand">
					   <span class="arrow"><i class="fas fa-chevron-right"></i></span>&nbsp;&nbsp;
					  <a href="#">{lang key="store.sitelock.faqFiveTitle"}</a>
					</h4>
				  </div>
				  <div id="collapsePanelFive" class="panel-collapse collapse">
					<div class="panel-body">
						{lang key="store.sitelock.faqFiveBody"}
					</div>
				  </div>
				</div>
				<div class="panel">
				  <div class="panel-heading">
					<h4 data-toggle="collapse" data-parent="#accordion" href="#collapsePanelSix" class="panel-title expand">
					   <span class="arrow"><i class="fas fa-chevron-right"></i></span>&nbsp;&nbsp;
					  <a href="#">{lang key="store.sitelock.faqSixTitle"}</a>
					</h4>
				  </div>
				  <div id="collapsePanelSix" class="panel-collapse collapse">
					<div class="panel-body">
						{lang key="store.sitelock.faqSixBody"}
					</div>
				  </div>
				</div>
			</div>
		</div>
	</div>
    <div class="content-block wgs-site-lok">
        <div class="container text-center">
            <img src="{$WEB_ROOT}/assets/img/marketconnect/sitelock/logo.png" class="inner_bottom_logoo">
        </div>
    </div>
</div>
<!--  site-lock-faq-questions-->

</div>
<script type="text/javascript">
$(function() {
  $(".expand").on( "click", function() {
    $expand = $(this).find(">:first-child");
    if($expand.html() == '<i class="fas fa-chevron-right"></i>') {
      $expand.html('<i class="fas fa-chevron-down"></i>');
    } else {
      $expand.html('<i class="fas fa-chevron-right"></i>');
    }
  });
});
</script>
