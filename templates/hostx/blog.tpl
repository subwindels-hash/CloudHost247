<!-- blog-banner -->
<div class="cpanel_banner blog-banner"> 
  <div class="container">
    <div class="row">
      <div class="col-sm-12">
        <div class="left">
          <h2>OUR BLOG</h2>
        </div>
      </div>
    </div>
  </div>
</div>  
<!-- blog-banner --> 
<!--  blog-post-sec-->
  <div class="blog-post-sec">
        <div class="container">
		  <div class="row row-blog-post">
		    {foreach $blogs as $announce}
            <div class="col-sm-4">
                <div class="sam-blog-style">
                     <div class="blog-img-bx">
				        <div class="blog-img-bx">
                            {if $announce.image}
    				            <img src="{$announce.image}">
    				        {else}
    				            <img src="{$WEB_ROOT}/templates/{$template}/og_images/default-image.png">
    				        {/if}
    				 </div>
				    <div class="sam-blog-style-inner">
    				 <ul class="list-inline">
    				    <li class="list-inline-item"><i class="fa fa-comments" aria-hidden="true"></i>{$announce.date|date_format:'%D'}</li>
    				 </ul>
				    <h4><a href="{$announce.link}">{$announce.title}</a></h4>
				 </div>
                </div>
            </div>
            </div>
            
           {/foreach}  
          </div>
       </div>
  </div>
<!--  blog-post-sec-->