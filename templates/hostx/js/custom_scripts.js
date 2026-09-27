function wgsDomainRegisterCall() {
    jQuery("#formSubMobileDomains").submit();
}
function wgsChangeBarClass(x) {
  x.classList.toggle("hostxchange");
}
function wgsChangeSideBarsClaas(obj,cls){
	if(cls == 'primary'){
		if(jQuery(obj).hasClass("fa-align-left")){
			jQuery(obj).removeClass("fa-align-left");
			jQuery(obj).addClass("fa-times");
		}else{
			jQuery(obj).removeClass("fa-times");
			jQuery(obj).addClass("fa-align-left");			
		}
		jQuery("#menu-sidebar-hostx-sec").removeClass("left-open-hostx-sec");
		jQuery("#menu-sidebar-hostx").toggleClass("left-open-hostx");
		if(jQuery("#rightSideBarIclass").hasClass("fa-times")){
			jQuery("#rightSideBarIclass").removeClass("fa-times");
			jQuery("#rightSideBarIclass").addClass("fa-align-right");			
		}
	}else{
		if(jQuery(obj).hasClass("fa-align-right")){
			jQuery(obj).removeClass("fa-align-right");
			jQuery(obj).addClass("fa-times");
		}else{
			jQuery(obj).removeClass("fa-times");
			jQuery(obj).addClass("fa-align-right");			
		}
		jQuery("#menu-sidebar-hostx").removeClass("left-open-hostx");
		jQuery("#menu-sidebar-hostx-sec").toggleClass("left-open-hostx-sec");
		if(jQuery("#leftPrimaryBarIclass").hasClass("fa-times")){
			jQuery("#leftPrimaryBarIclass").removeClass("fa-times");
			jQuery("#leftPrimaryBarIclass").addClass("fa-align-left");			
		}		
	}
}
function wgsChangeSideBarDesktop(obj,cls){
	if(cls == 'primary'){
		jQuery("#menu-sidebar-hostx").toggleClass("left-open-hostx");
		jQuery(".pimary-side-open-close-side").toggleClass("hidden");
		if(jQuery(obj).hasClass("fa-align-left")){
			setCookieSideBarHostx('primarySideBarStatus','open', 1);
		}else{
			setCookieSideBarHostx('primarySideBarStatus','close', 1);
		}
	}else{
		jQuery("#menu-sidebar-hostx-sec").toggleClass("left-open-hostx-sec");
		jQuery(".secondary-side-open-close-side").toggleClass("hidden");
		if(jQuery(obj).hasClass("fa-align-right")){
			setCookieSideBarHostx('secondarySideBarStatus','open', 1);
		}else{
			setCookieSideBarHostx('secondarySideBarStatus','close', 1);
		}
	}	
}
function wgsChangeSideBarNavigationsButtons(obj,cls){
	if(cls == 'primary'){
		jQuery("#menu-sidebar-hostx").toggleClass("left-open-hostx");
		if(jQuery(obj).hasClass("change-primary")){
			setCookieSideBarHostx('primarySideBarStatus','close', 1);
		}else{
			setCookieSideBarHostx('primarySideBarStatus','open', 1);			
		}
		jQuery(obj).toggleClass("change-primary");		
	}else{
		jQuery("#menu-sidebar-hostx-sec").toggleClass("left-open-hostx-sec");
		if(jQuery(obj).hasClass("change-secondary")){
			setCookieSideBarHostx('secondarySideBarStatus','close', 1);
		}else{
			setCookieSideBarHostx('secondarySideBarStatus','open', 1);			
		}
		jQuery(obj).toggleClass("change-secondary");
	}
}
jQuery(document).ready(function () {
		jQuery("nav#main-nav").remove();
		jQuery("#languageList a").click(function () {
			var e = jQuery(this).html();
			jQuery("#sLanguage").html(e);
		}),
        jQuery("#currencyList a").click(function () {
            var e = jQuery(this).html();
            jQuery("#sCurrency").html(e);
        }),
        jQuery("#locationList a").click(function () {
            var e = jQuery(this).html();
            jQuery("#sLocation").html(e);
        }),
	// form submit in mobile view under menu
        jQuery("body").on("keyup", "#serachBarTopMenu", function (e) {
            13 == e.which ? jQuery("#formSubMobileDomains").submit() : jQuery("#hideenSlds").val(jQuery(this).val());
        }),
	// copy right content remove and append before footer
        jQuery("p").each(function () {
            if ('Powered by <a href="https://www.whmcs.com/" target="_blank">WHMCompleteSolution</a>' == jQuery(this).html()) {
                var e = '<p class="completeSolution">' + jQuery(this).html() + "</p>";
				if(jQuery("#mainfooterhostx").length > 0){
					jQuery(this).remove(), jQuery(e).insertBefore("#mainfooterhostx");	
				}else{
					jQuery(this).remove(), jQuery(e).insertBefore("#copyRightHostx");
				}
            }
        }),
	// side bar settings
		jQuery('#menu_bar_hostx').click(function() {
			jQuery('nav#menu-sidebar-hostx').toggleClass('left-open-hostx');
		}),
		jQuery('#menu_bar_hostx_second').click(function() {
			jQuery('nav#menu-sidebar-hostx-sec').toggleClass('left-open-hostx-sec');
		}),
		jQuery(".nav-dropdown").click(function(e){ 
			if(e.target.class == "nav-sub" || jQuery(e.target).parents(".nav-sub").length) { 	
			}else{
				jQuery(this).toggleClass( "open" );
				jQuery(this).find('.nav-sub').toggle('slow');
			}
		});
	// mobile navigation latest open 
	jQuery("#nav-latest-mega-menu-toggle").click(function(){
		jQuery("#myHeader").toggleClass("active-mobile");
	});
	// mobile device home page slider intial
		jQuery(window).on('load resize orientationchange', function () {
			if(jQuery(window).width() > 1024){
				if(jQuery('.hx_webhosting_plans').hasClass('slick-initialized')){
					jQuery('.hx_webhosting_plans').slick('unslick');
				}
				var getCookiePrimaryBar = getCookieHostx('primarySideBarStatus');
				var getCookieSecondaryBar = getCookieHostx('secondarySideBarStatus');
				if (getCookiePrimaryBar == 'open' || getCookiePrimaryBar == ''){
					jQuery("#menu-sidebar-hostx").addClass("left-open-hostx");
				}
				if (getCookieSecondaryBar == 'open' || getCookieSecondaryBar == ''){
					jQuery("#menu-sidebar-hostx-sec").addClass("left-open-hostx-sec");
				}				
			}else{
				if(!jQuery('.hx_webhosting_plans').hasClass('slick-initialized')){
					homePageSliderIntialized();
				}
				jQuery("#menu-sidebar-hostx").removeClass("left-open-hostx");
				jQuery("#menu-sidebar-hostx-sec").removeClass("left-open-hostx-sec");
				jQuery(".primary-menu-toggle").removeClass("change-primary");
				jQuery(".secondary-menu-toggle").removeClass("change-secondary");
				jQuery(document).on('click','.primary-menu-toggle',function(){
					if(jQuery(".secondary-menu-toggle").hasClass("change-secondary")){
						jQuery(".secondary-menu-toggle").removeClass("change-secondary");
						jQuery("#menu-sidebar-hostx-sec").removeClass("left-open-hostx-sec");
					}
				});
				jQuery(document).on('click','.secondary-menu-toggle',function(){
					if(jQuery(".primary-menu-toggle").hasClass("change-primary")){
						jQuery(".primary-menu-toggle").removeClass("change-primary");
						jQuery("#menu-sidebar-hostx").removeClass("left-open-hostx");
					}
				});
			}
		});
	// marketconnect promo features settings start here
	if(jQuery(".home-promo-product").length > 0){
		jQuery("#home-promo-widget-title").html(jQuery(".home-promo-product").find("h3").eq(0).html());		
	}
	var leftDiv = false;
	var rightDiv = false;
	if(jQuery(".promo-rapidssl_rapidssl").length > 0){
		leftDiv = true;
		jQuery("#ssl-promo-blk").removeClass("hidden");
		jQuery("#rapidSslTitle").html(jQuery(".promo-rapidssl_rapidssl").find(".panel-body").find(".content").find("h3").html());
		jQuery("#rapidSslTitle").attr("href",jQuery(".promo-rapidssl_rapidssl").find(".panel-body").find(".content").find("h3").find("a").attr("href"));
		jQuery("#rapidSslDescp").html(jQuery(".promo-rapidssl_rapidssl").find(".panel-body").find(".content").find("h4").html());
	}
	if(jQuery(".upsell-weebly_starter").length > 0){
		leftDiv = true;
		jQuery("#weebly-promo-blk").removeClass("hidden");
		jQuery("#weeblyTitle").html(jQuery(".upsell-weebly_starter").find(".panel-body").find(".content").find("h3").html());
		jQuery("#weeblyTitle").attr("href",jQuery(".upsell-weebly_starter").find(".panel-body").find(".content").find("h3").find("a").attr("href"));
		jQuery("#weeblyDescp").html(jQuery(".upsell-weebly_starter").find(".panel-body").find(".content").find("h4").html());
	}
	if(jQuery(".promo-codeguard_lite").length > 0){
		leftDiv = true;
		jQuery("#codeguard-promo-blk").removeClass("hidden");
		jQuery("#codeguardTitle").html(jQuery(".promo-codeguard_lite").find(".panel-body").find(".content").find("h3").html());
		jQuery("#codeguardTitle").attr("href",jQuery(".promo-codeguard_lite").find(".panel-body").find(".content").find("h3").find("a").attr("href"));
		jQuery("#codeguardDescp").html(jQuery(".promo-codeguard_lite").find(".panel-body").find(".content").find("h4").html());
	}
	if(jQuery(".promo-marketgoo_lite").length > 0){
		leftDiv = true;
		jQuery("#marketgo-promo-blk").removeClass("hidden");
		jQuery("#marketgooTitle").html(jQuery(".promo-marketgoo_lite").find(".panel-body").find(".content").find("h3").html());
		jQuery("#marketgooTitle").attr("href",jQuery(".promo-marketgoo_lite").find(".panel-body").find(".content").find("h3").find("a").attr("href"));
		jQuery("#marketgooDescp").html(jQuery(".promo-marketgoo_lite").find(".panel-body").find(".content").find("h4").html());
	}
	if(jQuery(".promo-nordvpn_standard").length > 0){
		leftDiv = true;
		jQuery("#nordvpn-promo-blk").removeClass("hidden");
		jQuery("#nordvpnTitle").html(jQuery(".promo-nordvpn_standard").find(".panel-body").find(".content").find("h3").html());
		jQuery("#nordvpnTitle").attr("href",jQuery(".promo-nordvpn_standard").find(".panel-body").find(".content").find("h3").find("a").attr("href"));
		jQuery("#nordvpnDescp").html(jQuery(".promo-nordvpn_standard").find(".panel-body").find(".content").find("h4").html());
	}
	if(jQuery(".upsell-sitelock_find").length > 0){
		rightDiv = true;
		jQuery("#sitelock-promo-blk").removeClass("hidden");
		jQuery("#sitelockTitle").html(jQuery(".upsell-sitelock_find").find(".panel-body").find(".content").find("h3").html());
		jQuery("#sitelockTitle").attr("href",jQuery(".upsell-sitelock_find").find(".panel-body").find(".content").find("h3").find("a").attr("href"));
		jQuery("#sitelockDescp").html(jQuery(".upsell-sitelock_find").find(".panel-body").find(".content").find("h4").html());
	}
	if(jQuery(".promo-spamexperts_incoming").length > 0){
		rightDiv = true;
		jQuery("#spamexpert-promo-blk").removeClass("hidden");
		jQuery("#spamexpertTitle").html(jQuery(".promo-spamexperts_incoming").find(".panel-body").find(".content").find("h3").html());
		jQuery("#spamexpertTitle").attr("href",jQuery(".promo-spamexperts_incoming").find(".panel-body").find(".content").find("h3").find("a").attr("href"));
		jQuery("#spamexpertDescp").html(jQuery(".promo-spamexperts_incoming").find(".panel-body").find(".content").find("h4").html());
	}
	if(jQuery(".promo-sitelockvpn_standard").length > 0){
		rightDiv = true;
		jQuery("#sitelockvpn-promo-blk").removeClass("hidden");
		jQuery("#sitelockvpnTitle").html(jQuery(".promo-sitelockvpn_standard").find(".panel-body").find(".content").find("h3").html());
		jQuery("#sitelockvpnTitle").attr("href",jQuery(".promo-sitelockvpn_standard").find(".panel-body").find(".content").find("h3").find("a").attr("href"));
		jQuery("#sitelockvpnDescp").html(jQuery(".promo-sitelockvpn_standard").find(".panel-body").find(".content").find("h4").html());
	}
	if(jQuery(".upsell-sitebuilder_onepage").length > 0){
		rightDiv = true;
		jQuery("#sitebuilder-promo-blk").removeClass("hidden");
		jQuery("#sitebuilderTitle").html(jQuery(".upsell-sitebuilder_onepage").find(".panel-body").find(".content").find("h3").html());
		jQuery("#sitebuilderTitle").attr("href",jQuery(".upsell-sitebuilder_onepage").find(".panel-body").find(".content").find("h3").find("a").attr("href"));
		jQuery("#sitebuilderDescp").html(jQuery(".upsell-sitebuilder_onepage").find(".panel-body").find(".content").find("h4").html());
	}
	if(jQuery(".promo-cpanelseo_starter").length > 0){
		rightDiv = true;
		jQuery("#cpanelseo-promo-blk").removeClass("hidden");
		jQuery("#cpanelseoTitle").html(jQuery(".promo-cpanelseo_starter").find(".panel-body").find(".content").find("h3").html());
		jQuery("#cpanelseoTitle").attr("href",jQuery(".promo-cpanelseo_starter").find(".panel-body").find(".content").find("h3").find("a").attr("href"));
		jQuery("#cpanelseoDescp").html(jQuery(".promo-cpanelseo_starter").find(".panel-body").find(".content").find("h4").html());
	}
	if(jQuery(".promo-xovinow_starter").length > 0){
		rightDiv = true;
		jQuery("#xovinow-promo-blk").removeClass("hidden");
		jQuery("#xovinowTitle").html(jQuery(".promo-xovinow_starter").find(".panel-body").find(".content").find("h3").html());
		jQuery("#xovinowTitle").attr("href",jQuery(".promo-xovinow_starter").find(".panel-body").find(".content").find("h3").find("a").attr("href"));
		jQuery("#xovinowDescp").html(jQuery(".promo-xovinow_starter").find(".panel-body").find(".content").find("h4").html());
	}
	if(jQuery(".promo-threesixtymonitoring_lite").length > 0){
		rightDiv = true;
		jQuery("#threesixtymonitoring-promo-blk").removeClass("hidden");
		jQuery("#threesixtymonitoringTitle").html(jQuery(".promo-threesixtymonitoring_lite").find(".panel-body").find(".content").find("h3").html());
		jQuery("#threesixtymonitoringTitle").attr("href",jQuery(".promo-threesixtymonitoring_lite").find(".panel-body").find(".content").find("h3").find("a").attr("href"));
		jQuery("#threesixtymonitoringDescp").html(jQuery(".promo-threesixtymonitoring_lite").find(".panel-body").find(".content").find("h4").html());
	}
	if(!leftDiv){
		jQuery("#left-side-promo-div").addClass("hidden");
	}
	if(!rightDiv){
		jQuery("#right-side-promo-div").addClass("hidden");
	}
	var leftCount = -1;
	var rightCount = -1;
	if(!jQuery("#left-side-promo-div").hasClass("hidden")){
		leftCount = parseInt(4)-parseInt(jQuery("#left-side-promo-div").find(".hidden").length);
	}
	if(!jQuery("#right-side-promo-div").hasClass("hidden")){
		rightCount = parseInt(3)-parseInt(jQuery("#right-side-promo-div").find(".hidden").length);
	}
	if(leftCount > 0){
		if(leftCount > rightCount){
			jQuery(".order-div-mx").addClass("rows-"+leftCount);
		}else{
			jQuery(".order-div-mx").addClass("rows-"+rightCount);
		}
	}
	if(rightCount > 0){
		if(rightCount > leftCount){
			jQuery(".order-div-mx").addClass("rows-"+rightCount);	
		}else{
			jQuery(".order-div-mx").addClass("rows-"+leftCount);
		}
	}
	jQuery("#v-pills-tab .nav-link-new").click(function(){
		jQuery(".nav-link-new").removeClass("active"),jQuery(this).addClass("active");
		
	});
	// slider intiated dynmic
	jQuery(".wgsTestimonialCrouselCustom").not('.slick-initialized').slick({
	   dots: true,
	   infinite: true,
	   slidesToShow: 3,
	   slidesToScroll: 3,
	   autoplay: true,
	   autoplaySpeed: 2000,
	   variableWidth: false,
	   rtl:rtlHostx,
	   responsive: [
		{breakpoint: 1024,settings: {slidesToShow: 3,slidesToScroll: 3}},
		{breakpoint: 700,settings: {slidesToShow: 2,slidesToScroll: 2}},
		{breakpoint: 600,settings: {slidesToShow: 1,slidesToScroll: 1}},
		{breakpoint: 480,settings: {slidesToShow: 1,slidesToScroll: 1}},
		{breakpoint: 280,settings: {slidesToShow: 1,slidesToScroll: 1}}
		]
	});
	jQuery(".wgsTestimonialCrouselCustomOneSlide").not('.slick-initialized').slick({
	   dots: true,
	   infinite: true,
	   slidesToShow: 1,
	   slidesToScroll: 1,
	   autoplay: true,
	   autoplaySpeed: 2000,
	   variableWidth: false,
	   rtl:rtlHostx,
	});

});
jQuery(window).load(function() {
	jQuery('.nav.nav-pills li').each(function(){
		var $this = jQuery(this);
		var $this_v = $this.attr('class');
		var myString = 'open';
	});
	jQuery("li.nav-dropdown.active ul.nav-sub").show();
});
function homePageSliderIntialized(){
	jQuery(".hx_webhosting_plans").not('.slick-initialized').slick({
	   dots: true,
	   infinite: true,
	   slidesToShow: 1,
	   slidesToScroll: 1,
	   autoplay: true,
	   autoplaySpeed: 2000,
	   variableWidth: false,
	   rtl:rtlHostx,
	   
	});	
}
function toggleBillingTabsVps(obj,billcycle){
	jQuery("#changeBillingCycle li a").removeClass("active");
	jQuery(obj).addClass("active");
    jQuery(".blpr").hide(); 
	jQuery(".blpr." + billcycle).css("display", "inherit");	
}
function wgsSearchdomainAjax(obj){
	var btnTxt = jQuery(obj).text();
	jQuery(obj).html('<i class="fa fa-spinner fa-spin"></i>');
	jQuery("#loaderSerachBlock").removeClass("hidden");
	var tokenget = csrfToken;
	var domainName = jQuery("#domainnameAjax").val();
	if(jQuery.trim(domainName) == ''){
		jQuery("#domainnameAjax").focus();
		jQuery(obj).html('<i class="fa fa-search mr-2"></i>'+btnTxt);
		jQuery("#loaderSerachBlock").addClass("hidden");
	}else{
		var tldlist = jQuery("#tldDropdownBlock").val();
		var fullDomainName = domainName+tldlist;
		wgsCallAjaxDomainResult(tokenget,fullDomainName,'domain','register');
		wgsCallAjaxDomainResult(tokenget,fullDomainName,'suggestions','register');
		jQuery(obj).html('<i class="fa fa-search mr-2"></i>'+btnTxt);
	}
}
function wgsCallAjaxDomainResult(tokenget,fullDomainName,domaintype,domainresponseFor){
	jQuery("#domainTakenErrorDivsBlock").addClass("hidden");
	jQuery("tbody#domainSuggestionTable").html('');
	jQuery.ajax({
		type: "POST",
		url: 'index.php?rp=/domain/check',
		data:{
			'token':tokenget,
			'a':'checkDomain',
			'domain':fullDomainName,
			'type':domaintype,
		},
		success:function (data) {
			if(domaintype == 'domain'){
				var responseArray = createResponseArrayFromResult(data,domainresponseFor);
				if(responseArray.domainerror){
					var errorsn = '<p><div class="hx_domain"><div class="hx_domain-header"><h3><span><i class="fa fa-times"></i></span>'+responseArray.domainerror+'</h3></div></div>';
					jQuery("#domainErrorD").html('');
					jQuery("#domainErrorD").html(errorsn);
					jQuery("#domainErrorD").removeClass("hidden");
					jQuery('html, body').animate({
						scrollTop: jQuery("#domainErrorD").offset().top
					}, 1000);
					setTimeout(function() { 
						jQuery("#domainErrorD").addClass("hidden");
						jQuery("#domainErrorD").html('');	
					}, 5000);
					jQuery("#loaderSerachBlock").addClass("hidden");					
				}else if(responseArray.domainlegecystatus == 'available'){
					var availableDomain = '<tr class="hx_domain-available"><td class="hx_domaindata1"><p class="hx_domaintxt"><span><i class="fa fa-check"></i>'+responseArray.domainname+'</span> '+domainisavailable +'</p></td><td class="hx-table-price">'+responseArray.domainprice+'</td><td class="hx-table-noprice"><button class="add-to-cart-btn" onclick="wgsDomainAddToCartBlock(this,\''+responseArray.domainname+'\',\''+domainresponseFor+'\',\''+addCartButtonLang+'\');">'+addCartButtonLang+'</button><button class="add-to-cart-btn removeBtnCat hidden" onclick="redirectToViewPage(this);">'+checkoutButtonLang+'</button><button class="add-to-cart-btn addhostingbtn hidden" onclick="wgsAddHostingBtnTrigger(this);">'+orderHostingBtn+'</button></td></tr>';
					jQuery("tbody#domainSuggestionTable").html(availableDomain);
					jQuery("#loaderSerachBlock").addClass("hidden");
				}else{
					jQuery("p.unavail-msg").find("strong").html(responseArray.domainname);
					jQuery("#domainTakenErrorDivsBlock").removeClass("hidden");
				}
				functionIsRunning = true;
			}else if(domaintype == 'suggestions'){
					jQuery("#loaderSerachBlock").removeClass("hidden");
					var suggest = '';
					var counter = 0;
					if(domainSuggestionSeting == '' || domainSuggestionSeting == 0){
						var suggestionCounter = 5;
					}else{
						var suggestionCounter = parseInt(domainSuggestionSeting);
					}
					var classHidden = '';
					jQuery.each(data.result, function(t,n){
						if(counter < suggestionCounter){
							var priceGet = n['pricing'][1].register;
							//priceGet = priceGet.split(' ');
							//var suffixs = '';
							//if(typeof(priceGet[1]) != "undefined"){
								//suffixs = priceGet[1];
							//}
							suggest += '<tr class="'+classHidden+'"><td class="hx-table-extensions">'+n.domainName+'</td><td class="hx-table-price"> '+priceGet+'</td><td class="hx-table-noprice"><button class="add-to-cart-btn" onclick="wgsDomainAddToCartBlock(this,\''+n.domainName+'\',\''+domainresponseFor+'\',\''+addCartButtonLang+'\');">'+addCartButtonLang+'</button><button class="add-to-cart-btn removeBtnCat hidden" onclick="redirectToViewPage(this);">'+checkoutButtonLang+'</button><button class="add-to-cart-btn addhostingbtn hidden" onclick="wgsAddHostingBtnTrigger(this);">'+orderHostingBtn+'</button></td></tr>';
						}
						counter = counter+1;
					});
					setTimeout(function() {
						if(jQuery("tbody#domainSuggestionTable tr:first").length >0 ){
							jQuery("tbody#domainSuggestionTable tr:first").after(suggest);
						}else{
							jQuery("tbody#domainSuggestionTable").html(suggest);
						}
						jQuery("#loaderSerachBlock").addClass("hidden");
					}, 1000);
			}
		},                                 		         
	});
}
function createResponseArrayFromResult(domainArr,domainType){
	var decodeJsons = jQuery.parseJSON(JSON.stringify(domainArr));
	var domainParams = {};
	if(decodeJsons.result['error']){
		domainParams["domainerror"] = decodeJsons.result['error'];
	}else if(decodeJsons.result[0].preferredTLDNotAvailable){
		domainParams["domainerror"] = preferTldError;
	}else{
		var jsonDecodeRes = decodeJsons.result[0];
		var domainStatus = jsonDecodeRes.isAvailable;
		var domainName = jsonDecodeRes.domainName;
		var lagecyStatus = jsonDecodeRes.legacyStatus;
		if (jsonDecodeRes['pricing'][1]){
			var domainPriceRaw = jsonDecodeRes['pricing'][1].register;
		}else if(jsonDecodeRes['pricing'][2]){
			var domainPriceRaw = jsonDecodeRes['pricing'][2].register;
		}else if(jsonDecodeRes['pricing'][3]){
			var domainPriceRaw = jsonDecodeRes['pricing'][3].register;
		}else if(jsonDecodeRes['pricing'][4]){
			var domainPriceRaw = jsonDecodeRes['pricing'][4].register;
		}else if(jsonDecodeRes['pricing'][5]){
			var domainPriceRaw = jsonDecodeRes['pricing'][5].register;
		}else if(jsonDecodeRes['pricing'][6]){
			var domainPriceRaw = jsonDecodeRes['pricing'][6].register;
		}else if(jsonDecodeRes['pricing'][7]){
			var domainPriceRaw = jsonDecodeRes['pricing'][7].register;
		}else if(jsonDecodeRes['pricing'][8]){
			var domainPriceRaw = jsonDecodeRes['pricing'][8].register;
		}else if(jsonDecodeRes['pricing'][9]){
			var domainPriceRaw = jsonDecodeRes['pricing'][9].register;
		}else if(jsonDecodeRes['pricing'][10]){
			var domainPriceRaw = jsonDecodeRes['pricing'][10].register;
		}
		domainParams["domainname"] = domainName;
		domainParams["domainprice"] = domainPriceRaw;
		domainParams["domainstatus"] = domainStatus;
		domainParams["domainlegecystatus"] = lagecyStatus;
	}
	return domainParams;
}
function wgsDomainAddToCartBlock(obj,dname,type,btntxt){
	jQuery(obj).html(btntxt + ' <i class="fa fa-spinner fa-spin"></i>');
	var period = 1;
	jQuery.ajax({
		type: "POST",
		url: "cart.php?a=add&ajax=1",
		data:{
			'actionBlockAddDomain':'callAjaxMethod',
			'methodBlockName':'addDomainToCart',
			'domain':dname,
			'type':type,
			'period':period,
		},
		success:function (data) {
			if(data == 0){
				jQuery("#domainErrorD").html('<div class="hx_domain"><div class="hx_domain-header"><h3><span><i class="fa fa-times"></i></span>'+domainAlreadyInCart+'</h3></div></div>');
				jQuery("#domainErrorD").removeClass("hidden");
				jQuery(obj).html(btntxt);
				jQuery(obj).attr('disabled', false);
				jQuery('html, body').animate({
					scrollTop: jQuery("#domainErrorD").offset().top
				}, 1000);
				setTimeout(function() { 
                    jQuery("#domainErrorD").addClass("hidden");
					jQuery("#domainErrorD").html('');	
                }, 5000); 
			}else{
				jQuery(obj).addClass("hidden");
				jQuery(obj).next("button").removeClass("hidden");
				jQuery(obj).next().next("button").removeClass("hidden");
				jQuery(obj).html(btntxt);
				jQuery(obj).attr('disabled', false);
			}
		},                                 		         
	});
}
function redirectToViewPage(obj){
	window.location.href= 'cart.php?a=view';
}
function wgsAddHostingBtnTrigger(obj){
	jQuery(".nav-link-new").eq(1).click();
}
function wgsReviewReadMore(obj){
	var modalBodyHtml = jQuery(obj).parent().next(".reviewData").html();
	jQuery("#exampleModalLongContent").find(".modal-body").html(modalBodyHtml);
	jQuery("#exampleModalLongContent").modal("show");
}

function wgsAddHomePageProduct(obj,pid){
	jQuery.ajax({
		type: "POST",
		url: "cart.php?a=add&ajax=1",
		data:{
			'actionBlockProducts':'callAjaxMethod',
			'methodBlockName':'addProductDomainToCart',
			'pid':pid,
		},
		success:function (data) {
			if(data == 1){
				window.location.href= 'cart.php?a=view';
			}else{
				window.location.href= 'cart.php?a=add&pid='+pid;
			}
		},                                 		         
	});	
}
function setCookieSideBarHostx(cname, cvalue, exdays) {
	var d = new Date();
	d.setTime(d.getTime() + (exdays * 24 * 60 * 60 * 1000));
	var expires = "expires=" + d.toUTCString();
	document.cookie = cname + "=" + cvalue + ";" + expires + ";path=/";
}
function getCookieHostx(cname) {
	var name = cname + "=";
	var decodedCookie = decodeURIComponent(document.cookie);
	var ca = decodedCookie.split(';');
	for (var i = 0; i < ca.length; i++) {
		var c = ca[i];
		while (c.charAt(0) == ' ') {
			c = c.substring(1);
		}
		if (c.indexOf(name) == 0) {
			return c.substring(name.length, c.length);
		}
	}
	return "";
}
function deleteCookieHostx(cname) {
	document.cookie = cname + '=0;expires=Thu, 01 Jan 1970 00:00:01 GMT;';
}
function toggleBillingTabsVpsLatest(obj,dataShow){
	jQuery("#billingcycle-tabs-block p").removeClass("active");
	jQuery(obj).addClass("active");
    jQuery(".btn-cnfgr").hide(); 
	jQuery(".btn-cnfgr." + dataShow).css("display", "inherit");	
}