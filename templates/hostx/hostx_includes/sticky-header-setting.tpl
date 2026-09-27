{if $hostx_theme_settings.enable_sticky_header eq 'on'}
    <script>
        window.onscroll = function () {
            make_header_sticky();
        };
        var myHeader = document.getElementById("myHeader");
        var sticky = myHeader.offsetTop;
        function make_header_sticky() {
            if (window.pageYOffset > sticky) {
                myHeader.classList.add("sticky");
                myHeader.nextElementSibling.style.marginTop = myHeader.offsetHeight+'px';
				if(jQuery('#menu-sidebar-hostx').length > 0){
					document.getElementById("menu-sidebar-hostx").style.top = myHeader.offsetHeight+'px';
				}
				if(jQuery('#menu-sidebar-hostx-sec').length > 0){
					document.getElementById("menu-sidebar-hostx-sec").style.top = myHeader.offsetHeight+'px';
				}
            } else {
                myHeader.classList.remove("sticky");
                myHeader.nextElementSibling.style.marginTop = '0px';
				if(jQuery('#menu-sidebar-hostx').length > 0){
					document.getElementById("menu-sidebar-hostx").style.top = 'inherit';
					document.getElementById("menu-sidebar-hostx").style.marginTop = '0px';
				}
				if(jQuery('#menu-sidebar-hostx-sec').length > 0){
					document.getElementById("menu-sidebar-hostx-sec").style.top = 'inherit';
					document.getElementById("menu-sidebar-hostx-sec").style.marginTop = '0px';
				}
            }
        }
    </script>
{else}
	<script>
        window.onscroll = function () {
			if(jQuery('#menu-sidebar-hostx').length > 0 || jQuery('#menu-sidebar-hostx-sec').length > 0){
				make_nav_sticky();
			}
        };
        var myHeader = document.getElementById("myHeader");
        var sticky = myHeader.offsetTop;
        function make_nav_sticky() {
            if (window.pageYOffset > sticky) {
				if(jQuery('#menu-sidebar-hostx').length > 0){
					document.getElementById("menu-sidebar-hostx").style.top = '0px';
				}
				if(jQuery('#menu-sidebar-hostx-sec').length > 0){
					document.getElementById("menu-sidebar-hostx-sec").style.top = '0px';
				}
            } else {
				if(jQuery('#menu-sidebar-hostx').length > 0){
					document.getElementById("menu-sidebar-hostx").style.top = 'inherit';
				}
				if(jQuery('#menu-sidebar-hostx-sec').length > 0){
					document.getElementById("menu-sidebar-hostx-sec").style.top = 'inherit';
				}
            }
        }
    </script>
{/if}