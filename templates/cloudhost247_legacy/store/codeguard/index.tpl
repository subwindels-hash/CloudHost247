<!--[if lt IE 9]>
<script src="https://cdnjs.cloudflare.com/ajax/libs/html5shiv/3.7.3/html5shiv.min.js"></script>
<![endif]-->

<link type="text/css" rel="stylesheet" href="{$BASE_PATH_CSS}/ion.rangeSlider.css" property="stylesheet" />
<link type="text/css" rel="stylesheet" href="{$BASE_PATH_CSS}/ion.rangeSlider.skinHTML5.css" property="stylesheet" />
<link href="{assetPath file='store.css'}" rel="stylesheet">
<link href="{$WEB_ROOT}/templates/{$template}/store/css/store-custom.css" rel="stylesheet">

<div class="landing-page codeguard">

    <div class="hero  inner-hero">
        <div class="container">
			<div class="row">
                <div class="col-sm-6">
                    <h2 class="strong-green">{lang key="store.codeGuard.headline"}</h2>
					<h3>{lang key="store.codeGuard.tagline"}</h3>
                </div>
                <div class="col-sm-6">
					<div class="logo-container">
						<img src="{$WEB_ROOT}/assets/img/marketconnect/codeguard/logo.png" alt="code guard icon">
					</div>
                </div>
            </div>
        </div>
    </div>

    <nav class="navbar navbar-default navs_tab_ssl_sec"">
        <div class="container">
            <div class="navbar-header">
                <button type="button" class="navbar-toggle collapsed" data-toggle="collapse" data-target="#nav-landing-page" aria-expanded="false">
                    <span class="sr-only">{lang key="toggleNav"}</span>
                    <span class="icon-bar"></span>
                    <span class="icon-bar"></span>
                    <span class="icon-bar"></span>
                </button>
            </div>
            <div class="collapse navbar-collapse" id="nav-landing-page">
                <ul class="nav navbar-nav nav-sect-list">
                    <li><a href="#" onclick="smoothScroll('#overview');return false">{lang key="store.codeGuard.tab.overview"}</a></li>
                    <li><a href="#" onclick="smoothScroll('#pricing');return false">{lang key="store.codeGuard.tab.pricing"}</a></li>
                    <li><a href="#" onclick="smoothScroll('#features');return false">{lang key="store.codeGuard.tab.features"}</a></li>
                    <li><a href="#" onclick="smoothScroll('#faq');return false">{lang key="store.codeGuard.tab.faq"}</a></li>
                </ul>
            </div>
        </div>
    </nav>

    <div class="content-block image-standout" id="overview">
        <div class="container">
            <div class="row">
                <div class="col-sm-4 text-center">
                    <img src="{$WEB_ROOT}/assets/img/marketconnect/codeguard/hero-image-a.png" alt="code guard icon">
                </div>
                <div class="col-sm-8 inner-pargh-sec">
                    <h2 class="strong-green heading_str">{lang key="store.codeGuard.leadTitle"}</h2>
                    <p>{lang key="store.codeGuard.leadText1"}</p>
                    <p>{lang key="store.codeGuard.leadText2"}</p>
                </div>
            </div>
        </div>
    </div>

    <div class="content-block overview-features">
        <div class="container">
            <ul>
                <li>
					<div class="images-box">
						<embed type="image/svg+xml" src="{$WEB_ROOT}/templates/{$template}/images/backup-icon.svg" class="storesvg" alt="backup icon"/>
					</div>
                    <span>{lang key="store.codeGuard.dailyBackup"}</span>
                </li>
                <li>
					<div class="images-box">
						<embed type="image/svg+xml" src="{$WEB_ROOT}/templates/{$template}/images/client-icon.svg" class="storesvg" alt="user icons"/>
					</div>
                    <span>{lang key="store.codeGuard.timeMachine"}</span>
                </li>
                <li>
					<div class="images-box">
						<embed type="image/svg+xml" src="{$WEB_ROOT}/templates/{$template}/images/wp-icon.svg" class="storesvg" alt="plug icon"/>
					</div>
                    <span>{lang key="store.codeGuard.wpPlugin"}</span>
                </li>
                <li>
					<div class="images-box">
						<embed type="image/svg+xml" src="{$WEB_ROOT}/templates/{$template}/images/alert-icon.svg" class="storesvg" alt="bell icon"/>
					</div>
                    <span>{lang key="store.codeGuard.changeAlerts"}</span>
                </li>
                <li>
					<div class="images-box">
						<embed type="image/svg+xml" src="{$WEB_ROOT}/templates/{$template}/images/malware-icon.svg" class="storesvg" alt="malware icon"/>
					</div>
                    <span>{lang key="store.codeGuard.malwareProtection"}</span>
                </li>
            </ul>
        </div>
    </div>

    <div class="content-block pricing" id="pricing">
        <div class="container">
            <div class="row">
                {if count($products) > 0}
                    <div class="col-md-3 hidden-xs hidden-sm text-center">
						<div class="order-imgs">
							<embed type="image/svg+xml" src="{$WEB_ROOT}/templates/{$template}/images/pick-backup.svg" class="storesvg" alt="server settings"/>
						</div>
                    </div>
                    <div class="col-md-9">
                        {if !$loggedin && $currencies}
                            <form method="post" action="{routePath('store-product-group', $routePathSlug)}" class="pull-right">
                                <select name="currency" class="form-control currency-selector" onchange="submit()">
                                    <option>{lang key="changeCurrency"} ({$activeCurrency.prefix} {$activeCurrency.code})</option>
                                    {foreach $currencies as $currency}
                                        <option value="{$currency['id']}">{$currency['prefix']} {$currency['code']}</option>
                                    {/foreach}
                                </select>
                            </form>
                        {/if}
                        <h2>{lang key='store.codeGuard.chooseBackupPlan'}</h2>
                        <div class="price-calc-container">
                            <div class="price-calc-top">
                                <input type="hidden" id="codeGuardPlanSelector" name="codeguardplan" value="" />
                            </div>
                            <div class="pricing-container">
                                <div id="pricingAmount" class="price">--</div>
                                <div id="pricingCycle"></div>
                            </div>
                            <form action="{routePath('cart-order')}" method="post" class="pull-right">
                                <input id="selectedProductId" type="hidden" name="pid" value="">
                                <button type="submit" class="btn btn-default order-btn" id="product-order-button">
                                    {lang key='ordernowbutton'}
                                </button>
                            </form>
                        </div>
                    </div>
                {elseif $inPreview}
                    <div class="col-xs-12 lead text-center">
                        {lang key="store.codeGuard.adminPreview"}
                    </div>
                {/if}
            </div>
        </div>
    </div>

    <div class="content-block features" id="features">
        <div class="container">
            <div class="row">
                <div class="col-lg-4 col-sm-6">
                    <div class="feature">
                        <div class="icon">
                            <embed type="image/svg+xml" src="{$WEB_ROOT}/templates/{$template}/images/daily-backups-feature.svg" class="storesvg" alt="backup icon"/>
                        </div>
                        <h4>{lang key="store.codeGuard.features.dailyBackup"}</h4>
                        <p>{lang key="store.codeGuard.features.dailyBackupDescription"}</p>
                    </div>
                </div>
                <div class="col-lg-4 col-sm-6">
                    <div class="feature">
                        <div class="icon">
                            <embed type="image/svg+xml" src="{$WEB_ROOT}/templates/{$template}/images/unlimited-files-feature.svg" class="storesvg" alt="files and folder"/>
                        </div>
                        <h4>{lang key="store.codeGuard.features.unlimitedFiles"}</h4>
                        <p>{lang key="store.codeGuard.features.unlimitedFilesDescription"}</p>
                    </div>
                </div>
                <div class="col-lg-4 col-sm-6">
                    <div class="feature">
                        <div class="icon">
                            <embed type="image/svg+xml" src="{$WEB_ROOT}/templates/{$template}/images/click-restore-feature.svg" class="storesvg" alt="cursor icon"/>
                        </div>
                        <h4>{lang key="store.codeGuard.features.oneClickRestore"}</h4>
                        <p>{lang key="store.codeGuard.features.oneClickRestoreDescription"}</p>
                    </div>
                </div>
                <div class="col-lg-4 col-sm-6">
                    <div class="feature">
                        <div class="icon">
                            <embed type="image/svg+xml" src="{$WEB_ROOT}/templates/{$template}/images/malware-feature.svg" class="storesvg" alt="bug icon"/>
                        </div>
                        <h4>{lang key="store.codeGuard.features.malwareMonitoring"}</h4>
                        <p>{lang key="store.codeGuard.features.malwareMonitoringDescription"}</p>
                    </div>
                </div>
                <div class="col-lg-4 col-sm-6">
                    <div class="feature">
                        <div class="icon">
                            <embed type="image/svg+xml" src="{$WEB_ROOT}/templates/{$template}/images/wp-feature.svg" class="storesvg" alt="cord image"/>
                        </div>
                        <h4>{lang key="store.codeGuard.features.wp"}</h4>
                        <p>{lang key="store.codeGuard.features.wpDescription"}</p>
                    </div>
                </div>
                <div class="col-lg-4 col-sm-6">
                    <div class="feature">
                        <div class="icon">
                            <embed type="image/svg+xml" src="{$WEB_ROOT}/templates/{$template}/images/file-monitoring-feature.svg" class="storesvg" alt="files view"/>
                        </div>
                        <h4>{lang key="store.codeGuard.features.fileMonitoring"}</h4>
                        <p>{lang key="store.codeGuard.features.fileMonitoringDescription"}</p>
                    </div>
                </div>
                <div class="col-lg-4 col-sm-6">
                    <div class="feature">
                        <div class="icon">
                            <embed type="image/svg+xml" src="{$WEB_ROOT}/templates/{$template}/images/servers-feature.svg" class="storesvg" alt="server settings"/>
                        </div>
                        <h4>{lang key="store.codeGuard.features.servers"}</h4>
                        <p>{lang key="store.codeGuard.features.serversDescription"}</p>
                    </div>
                </div>
                <div class="col-lg-4 col-sm-6">
                    <div class="feature">
                        <div class="icon">
                            <embed type="image/svg+xml" src="{$WEB_ROOT}/templates/{$template}/images/email-feature.svg" class="storesvg" alt="mail icon"/>
                        </div>
                        <h4>{lang key="store.codeGuard.features.email"}</h4>
                        <p>{lang key="store.codeGuard.features.emailDescription"}</p>
                    </div>
                </div>
                <div class="col-lg-4 col-sm-6">
                    <div class="feature">
                        <div class="icon">
                           <embed type="image/svg+xml" src="{$WEB_ROOT}/templates/{$template}/images/api-feature.svg" class="storesvg" alt="api icon"/>
                        </div>
                        <h4>{lang key="store.codeGuard.features.api"}</h4>
                        <p>{lang key="store.codeGuard.features.apiDescription"}</p>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <div class="content-block faqs" id="faq">	
		<div class="frequbntly_asked frequbntly_asked1">
			<div class="container">
				<div class="top">
				  <h5>{lang key="store.codeGuard.faq.title"}</h5> 
				</div>
				<div class="clearfix"></div>
				{$turns = 1}
					{foreach $codeGuardFaqs as $faq}
						<div class="question_answers">
							<a class="question" href="javascript:;" data="#collapseExample{$turns}" role="button" aria-expanded="false" aria-controls="collapseExample{$turns}">{$faq['question']}
							  <span><img src="{$WEB_ROOT}/templates/{$template}/images/bottom-arro.svg" class="svg" alt="tick icon"></span>  
							</a> 
							<div class="collapse" id="collapseExample{$turns}">
							   {$faq['answer']}
							</div>
						</div>
						{$turns = $turns + 1}
					{/foreach}
			</div>
		</div>
    </div>

    <div class="content-block trusted-by">
        <div class="container">
            <div class="text-center">
                <img src="{$WEB_ROOT}/assets/img/marketconnect/codeguard/logo.png" alt="code guard icon">
            </div>
        </div>
    </div>

</div>

<!-- RangeSlider JS -->
<script type="text/javascript" src="{$BASE_PATH_JS}/ion.rangeSlider.js"></script>
<script type="text/javascript">

    var sliderActivated = false;

    var sliderProductNames = [
    {foreach $products as $product}
        "{$product->diskSpace}",
    {/foreach}
    ];

    var allProducts = {
        {foreach $products as $num => $product}
        "{$num}": {
            "pid": "{$product->id}",
            "name": "{$product->name}",
            "desc": "{$product->formattedProductFeatures.featuresDescription|nl2br|trim}",
            "price": "{$product->pricing()->first()->price()}",
            "cycle": "{lang key={'orderpaymentterm'|cat:$product->pricing()->first()->cycle()}}"
        },
        {/foreach}
    };

    var definedProducts = {
        {foreach $products as $product}
            "{$product->id}": "{$product@index}"{if !($product@last)},{/if}
        {/foreach}
    };

    {foreach $products as $product}
        {if $product->isFeatured}
            var firstFeatured = definedProducts["{$product->id}"];
            {break}
        {/if}
    {/foreach}

    var rangeSliderValues = {
        type: "single",
        grid: true,
        grid_snap: true,
        hide_min_max: true,
        step: 1,
        from: 1,
        onStart: refreshSelectedProduct,
        {if $products|@count eq 1}
            disable: true,
        {/if}
        onChange: refreshSelectedProduct,
        values: sliderProductNames
    };

    if (typeof firstFeatured !== 'undefined') {
        rangeSliderValues['from'] = firstFeatured;
    }

    function refreshSelectedProduct(data)
    {
        var featureName = "";
        var featureMarkup = "";
        var i = parseInt(data.from);
        if (isNaN(i)) {
            i = 0;
            jQuery(".irs-single").text(sliderProductNames[0]);
            jQuery(".irs-grid-text").text('');
        }

        jQuery("#selectedProductId").val(allProducts[i].pid);
        jQuery("#productDescription").html(allProducts[i].desc);
        jQuery("#pricingAmount").html(allProducts[i].price);
        jQuery("#pricingCycle").html(allProducts[i].cycle);
    }

    jQuery("#codeGuardPlanSelector").ionRangeSlider(rangeSliderValues);
    {if $products|@count eq 1}
    jQuery(".irs-single").text(sliderProductNames[0]);
    jQuery(".irs-grid-text").text('');
    {/if}

    sliderActivated = true;
</script>
