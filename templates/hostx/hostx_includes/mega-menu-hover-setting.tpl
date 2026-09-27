{if $hostx_theme_settings.dropdown_event eq 'hover'}
<script type="text/javascript">
	jQuery(document).ready(function () {
	   jQuery('#myHeader ul li.hostx-dropdown').mouseover(function() {
			if(jQuery('#myHeader ul li.menu-last-btn').hasClass('open')){
				jQuery('li.menu-last-btn').removeClass('open');
			}
			if(!jQuery(this).hasClass('open')){
			   jQuery(this).addClass('open');
			   jQuery(this).find('a.nav-link.dropdown-toggle').addClass('active');
			   jQuery(this).find('a.nav-link.dropdown-toggle').attr('aria-expanded',true);
			}
		});
		jQuery(document).on('mouseout','#myHeader ul li.hostx-dropdown.open',function(e) {
			jQuery(this).removeClass('open');
			jQuery(this).find('a.nav-link.dropdown-toggle').removeClass('active');
			jQuery(this).find('a.nav-link.dropdown-toggle').attr('aria-expanded',false);
		});
		jQuery('#myHeader ul li a.dropdown-toggle').on('click',function(e) {
			if(!jQuery(this).hasClass('firstclick')){
			if(jQuery(this).attr('aria-expanded') == "true" ){
				jQuery(this).addClass('firstclick');
				return false;
			}
			}
		});				
	});
</script>
{/if}