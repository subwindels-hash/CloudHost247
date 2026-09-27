{if $hostx_blocks[$block_slug]}
   <div class="review-option features-option2 features-option4">
      <div class="container">
         {eval var=$hostx_blocks[$block_slug]->description}
         <div class="row">
            {foreach $hostx_blocks[$block_slug]->widgets as $widget}
               {eval var=$widget->widget_description|html_entity_decode}
            {/foreach}
         </div>
      </div>
   </div>
{else}
<div class="review-option features-option2 features-option4">
   <div class="container">
      <div class="top">
         <h2>The Highest Rated Web Hosting Company</h2>
         <p>Checkout our ratings on the most popular review platforms.</p>
      </div>
      <div class="clearfix"></div>
      <div class="row">
         <div class="col-sm-4">
            <div class="review-col" data-url="https://www.hostingseekers.com/" data-tab="new">
               <p>4.7<span>/ 5</span></p>
               <div class="review-by">
                  <img src="{$WEB_ROOT}/templates/{$template}/images/review-logo-hostingseeker.svg" alt="image">
                  <div class="rating-stars"><i class="fas fa-star"></i><i class="fas fa-star"></i><i class="fas fa-star"></i><i class="fas fa-star"></i><i class="fas fa-star"></i></div>
               </div>
            </div>
         </div>
         <div class="col-sm-4">
            <div class="review-col" data-url="#" data-tab="new">
               <p>4.3<span>/ 5</span></p>
               <div class="review-by">
                  <img src="{$WEB_ROOT}/templates/{$template}/images/review-logo-google.png" alt="image">
                  <div class="rating-stars"><i class="fas fa-star"></i><i class="fas fa-star"></i><i class="fas fa-star"></i><i class="fas fa-star"></i><i class="fas fa-star"></i></div>
               </div>
            </div>
         </div>
         <div class="col-sm-4">
            <div class="review-col" data-url="#" data-tab="new">
               <p>4.3<span>/ 5</span></p>
               <div class="review-by">
                  <img src="{$WEB_ROOT}/templates/{$template}/images/review-logo-trustpilot.png" alt="image">
                  <div class="rating-stars"><i class="fas fa-star"></i><i class="fas fa-star"></i><i class="fas fa-star"></i><i class="fas fa-star"></i><i class="fas fa-star"></i></div>
               </div>
            </div>
         </div>
         <div class="col-sm-4">
            <div class="review-col" data-url="#" data-tab="new">
               <p>4.3<span>/ 5</span></p>
               <div class="review-by">
                  <img src="{$WEB_ROOT}/templates/{$template}/images/review-logo-hostadvice.png" alt="image">
                  <div class="rating-stars"><i class="fas fa-star"></i><i class="fas fa-star"></i><i class="fas fa-star"></i><i class="fas fa-star"></i><i class="fas fa-star"></i></div>
               </div>
            </div>
         </div>
         <div class="col-sm-4">
            <div class="review-col" data-url="#" data-tab="new">
               <p>4.3<span>/ 5</span></p>
               <div class="review-by">
                  <img src="{$WEB_ROOT}/templates/{$template}/images/review-logo-searchen.png" alt="image">
                  <div class="rating-stars"><i class="fas fa-star"></i><i class="fas fa-star"></i><i class="fas fa-star"></i><i class="fas fa-star"></i><i class="fas fa-star"></i></div>
               </div>
            </div>
         </div>
         <div class="col-sm-4">
            <div class="review-col" data-url="#" data-tab="new">
               <p>4.3<span>/ 5</span></p>
               <div class="review-by">
                  <img src="{$WEB_ROOT}/templates/{$template}/images/review-logo-hostreview.png" alt="image">
                  <div class="rating-stars"><i class="fas fa-star"></i><i class="fas fa-star"></i><i class="fas fa-star"></i><i class="fas fa-star"></i><i class="fas fa-star"></i></div>
               </div>
            </div>
         </div>
      </div>
   </div>
</div>
{/if}
<script>
   jQuery(".review-col").on('click',function(){
      var linkUrl = jQuery(this).attr("data-url");
      var trimed = jQuery.trim(linkUrl);
      var openInLink = jQuery(this).attr("data-tab");
      if(openInLink == 'new' && trimed != '#'){
         window.open(trimed, '_blank');
      }else if(openInLink != 'new' && trimed != '#'){
         window.open(trimed, '_self');
      }
   });
</script>