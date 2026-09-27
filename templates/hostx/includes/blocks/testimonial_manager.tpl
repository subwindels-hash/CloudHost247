<!-- testimonial dynmic data -->
{if $crouselDataFrontEnd}
	{if $sidebarHostxRemove || $templatefile eq 'homepage'}
	<div class="hx_testimonial-wrapper pt-5">
		<div class="container">
		<div class="row">
		<div class="{if $crouselDataFrontEnd['style'] eq '0'}wgsTestimonialCrouselCustomOneSlide{else}wgsTestimonialCrouselCustom{/if} carousel-inner">
			{foreach from=$crouselDataFrontEnd['data'] item=crouselData}
				<div class="{if $crouselDataFrontEnd['style'] eq '0'}col-md-12{else}col-md-4{/if}">
					<div class="hx-testimonial-wrap-inner text-center">
						<div class="hx-testimonial-img">
							<img src="{$WEB_ROOT}/templates/{$template}/testimonial_images/{$crouselData->reviewer_image}" alt="user">
						</div>
						<div class="hx-testimonial-content">
							<h3>{$crouselData->review_tag_line}</h3>
							{if $crouselDataFrontEnd['style'] eq '0'}
								{assign var=truncateVal value=400}
							{else}
								{assign var=truncateVal value=120}
							{/if}
							{if $crouselData->full_review|strip_tags|strlen >= $truncateVal}
								<p class="testimonial_full_review">
									{$crouselData->full_review|truncate:$truncateVal}
									<a class="cursorPointerCss" onclick="wgsReviewReadMore(this);">{$LANG.readmore}</a>
								</p>
								<div class="reviewData hidden">{$crouselData->full_review}</div>
							{else}
								<p class="testimonial_full_review">
									{$crouselData->full_review}
								</p>
							{/if}
							<h4 class="hx-client-name">{$crouselData->reviewer_name}</h4>
							<div class="hx-client-rating">
								{if $crouselData->rating eq '1'}
									<i class="fa fa-star" aria-hidden="true"></i>
								{elseif $crouselData->rating eq '2'}
									<i class="fa fa-star" aria-hidden="true"></i>
									<i class="fa fa-star" aria-hidden="true"></i>
								{elseif $crouselData->rating eq '3'}
									<i class="fa fa-star" aria-hidden="true"></i>
									<i class="fa fa-star" aria-hidden="true"></i>
									<i class="fa fa-star" aria-hidden="true"></i>
								{elseif $crouselData->rating eq '4'}
									<i class="fa fa-star" aria-hidden="true"></i>
									<i class="fa fa-star" aria-hidden="true"></i>
									<i class="fa fa-star" aria-hidden="true"></i>
									<i class="fa fa-star" aria-hidden="true"></i>
								{elseif $crouselData->rating eq '5'}
									<i class="fa fa-star" aria-hidden="true"></i>
									<i class="fa fa-star" aria-hidden="true"></i>
									<i class="fa fa-star" aria-hidden="true"></i>
									<i class="fa fa-star" aria-hidden="true"></i>
									<i class="fa fa-star" aria-hidden="true"></i>
									<i class="fa fa-star" aria-hidden="true"></i>
								{/if}
							</div>
							{if $crouselData->reviewer_position neq '' || $crouselData->reviewer_company neq ''}
								<div class="hx-client-designation">
								{if $crouselData->reviewer_position neq '' && $crouselData->reviewer_company neq ''}
									{$crouselData->reviewer_position} - {$crouselData->reviewer_company}
								{elseif $crouselData->reviewer_position neq '' && $crouselData->reviewer_company eq ''}
									{$crouselData->reviewer_position}
								{elseif $crouselData->reviewer_position eq '' && $crouselData->reviewer_company neq ''}
									{$crouselData->reviewer_company}
								{/if}
								</div>
							{/if}
							<ul class="list-unstyled hx-client-info">
								{if $crouselData->reviewer_location neq ''}
									<li>{$crouselData->reviewer_location}</li>
								{/if}
								{if $crouselData->reviewer_mobile neq ''}
									<li>{$crouselData->reviewer_mobile}</li>
								{/if}
								{if $crouselData->reviewer_email neq ''}
									<li>{$crouselData->reviewer_email}</li>
								{/if}
								<li>{$crouselData->updated_at}</li>
								<li><a href="{$crouselData->reviewer_url}" target="_blank" class="hx-client-url">{$crouselData->reviewer_url}</a></li>
							</ul>
							{if $crouselData->facebook_url neq '' || $crouselData->twitter_url neq '' || $crouselData->linkedin_url neq '' || $crouselData->instagram_url neq '' || $crouselData->youtube_url neq '' || $crouselData->skype_id neq ''}
							<ul class="list-inline hx_social-icons">
								{if $crouselData->facebook_url neq ''}
									<li class="list-inline-item"><a href="{$crouselData->facebook_url}" target="_blank"><i class="fab fa-facebook"></i></a></li>
								{/if}
								{if $crouselData->twitter_url neq ''}
									<li class="list-inline-item"><a href="{$crouselData->twitter_url}" target="_blank"><i class="fab fa-twitter"></i></a></li>
								{/if}
								{if $crouselData->linkedin_url neq ''}
									<li class="list-inline-item"><a href="{$crouselData->linkedin_url}" target="_blank"><i class="fab fa-linkedin"></i></a></li>
								{/if}
								{if $crouselData->instagram_url neq ''}
									<li class="list-inline-item"><a href="{$crouselData->instagram_url}" target="_blank"><i class="fab fa-instagram"></i></a></li>
								{/if}
								{if $crouselData->youtube_url neq ''}
									<li class="list-inline-item"><a href="{$crouselData->youtube_url}" target="_blank"><i class="fab fa-youtube"></i></a></li>
								{/if}
								{if $crouselData->skype_id neq ''}
									<li class="list-inline-item"><a href="{$crouselData->skype_id}" target="_blank"><i class="fab fa-skype"></i></a></li>
								{/if}
							</ul>
							{/if}
						</div>
					</div>
				</div>	
			{/foreach}
		</div>
		</div>
		</div>
	</div>
	<div class="modal fade" id="exampleModalLongContent" tabindex="-1" role="dialog" aria-labelledby="exampleModalLongTitle" aria-hidden="true">
	  <div class="modal-dialog" role="document">
		<div class="modal-content">
		  <div class="modal-header">
			<h5 class="modal-title">{$LANG.fullReview}</h5>
			<button type="button" class="close mdlCloseBtn" data-dismiss="modal" aria-label="Close">
			  <span aria-hidden="true">&times;</span>
			</button>
		  </div>
		  <div class="modal-body"></div>
		</div>
	  </div>
	</div>
	<script>
		function wgsReviewReadMore(obj){
			var modalBodyHtml = jQuery(obj).parent().next(".reviewData").html();
			jQuery("#exampleModalLongContent").find(".modal-body").html(modalBodyHtml);
			jQuery("#exampleModalLongContent").modal("show");
		}
	</script>
	{/if}
{/if}
<!-- testimonial dynmic data end -->