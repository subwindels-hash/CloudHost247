{literal}
<script>
	jQuery(document).ready(function(){
		if(jQuery(".panel-sidebar.mc-panel-promo").length > 0){
			var pathTemplates = "{/literal}{$WEB_ROOT}/templates/{$template}/{literal}";
			var htmls = '<div class="wgs-side-slide"><div class="carousel slide" data-ride="carousel"><div class="carouselInnerSideBar carousel-inner">';		 
			jQuery(".panel-sidebar.mc-panel-promo").each(function(){
				var menuItemName = jQuery(this).attr("menuitemname").split(" ");
				var menuClass = menuItemName[0].toLowerCase();
				var title = jQuery.trim(jQuery(this).find(".panel-title").text());
				var hrefLink = jQuery(this).find(".panel-footer").find("a").attr("href");
				var hrefLinkName = jQuery.trim(jQuery(this).find(".panel-footer").find("a").html());
				var descriptionP = jQuery.trim(jQuery(this).find(".panel-body").find("span").text());
				var imgSrcLink = pathTemplates+'marketconnect/'+menuClass+'/logo.png';
				htmls += '<div class="carousel-item '+menuClass+'"><div class="side-inner-content"><h6>'+title+'</h6><img src="'+imgSrcLink+'" class="sideBrLogo"><p class="slideDescrip">'+descriptionP+'</p><div class="custom-btn-wgsLearnMore"><a href="'+hrefLink+'" class="wgsLearnMore">'+hrefLinkName+'</a></div></div></div>';
				jQuery(this).remove();
			});
			htmls += '</div></div></div>';
			jQuery(".panel-sidebar:last").after(htmls);
		}
	});
</script>
{/literal}