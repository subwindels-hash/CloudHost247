jQuery(document).ready(function () {
	jQuery('.topnav-right a.bar-icon').on('click',function(){
	  jQuery('.right-menu-admin').toggle();
	});
	jQuery('.topnav-right a.bar-icon').click( function(e){
		e.stopPropagation();
	});
	jQuery('.right-menu-admin').click( function(e) {
		e.stopPropagation(); 
	 });
	jQuery('body').click( function() {
		jQuery('.right-menu-admin').hide();
	});
    activeurlinput($('[name="url_type"]').val());
    jQuery('[name="url_type"]').on('change', function () {
        activeurlinput($(this).val());
    });
    jQuery('#selectIcon').click(function () {
		if(jQuery(".iconDropDown").is(":visible")){
			jQuery('.iconDropDown').hide();	
		}else{
			jQuery('.iconDropDown').show();
		}
		 event.stopPropagation(); 
    });
	
  jQuery(document).click(function() {
      jQuery('.iconDropDown').hide();	
	});
  jQuery('.iconDropDown li').click(function () {
        var iconname = jQuery(this).attr('data');
        setTimeout(function () {
          jQuery('#iconname').val(iconname);
          jQuery('.iconDropDown').hide();
            jQuery('.selectedIcon').html('<i class="fa ' + iconname + '"></i> &nbsp; ' + iconname);
        }, 500);
  });

  // for seo page 
  jQuery('#sco_meta_language').on('change',function(){
    var lang =  jQuery(this).val();
    var input_name = ['keywords','description','robots','og_title','og_description','og_type'];
    jQuery.ajax({
      type: "POST",
      url: '',
      dataType: "json",
      data:{
         'form_data':{'language' :lang },
         'class':'HostxPage',
         'method':'get_seo_content_ajax'
        },
      success: function (data) {
         if(typeof data.id != "undefined"){
          jQuery.each(input_name,function(ind,vals){
            if(['description','og_description'].indexOf(vals) != -1 ){
              jQuery( 'textarea[name='+vals+']' ).val(data[vals]);
            }else if(vals == 'robots'){
              $('select[name="robots"] option[value='+data[vals]+']').prop('selected',true);
            }else{
             $('input[name='+vals+']').val(data[vals]);
            }
          });
         }else{
          jQuery.each(input_name,function(ind,names){
            if(['description','og_description'].indexOf(names) != -1 ){
               jQuery( 'textarea[name='+names+']' ).val("");
            }else if(names == 'robots'){
              $('select[name="robots"] option[value=0]').prop('selected',true);
            }else{
             $('input[name='+names+']').val("");
            }
          });
         }
      },
    }); 
  });
	jQuery('body').on('click', '.growl-close', function(){
		jQuery(this).parent().remove();
	});
  /* V.2.2.0 */
    jQuery('.tv-search-result-ul-tm li').click(function () {
      var iconname = jQuery(this).attr('data');
      var iconnameVal = jQuery(this).attr('data');
      var icontype = jQuery(this).attr('data-type');
      if(icontype == 'font-awesome-4'){
        iconnameVal = iconnameVal.substring(3);
      }
      jQuery('#iconname').val(iconnameVal);
      jQuery('.selectedIcon').html('<i class="' + iconname + '"></i> &nbsp; ' + iconname);
      jQuery("#iconPopupModalShow").modal("hide");		
    });
    jQuery('#selectIcon').click(function () {
      var iconSelected = jQuery('#iconname').val();
      var withFa = 'fa '+iconSelected;
      jQuery('.tv-search-result-ul-tm li').each(function(){
        if(jQuery(this).attr('data') == iconSelected || jQuery(this).attr('data') == withFa){
          jQuery(this).addClass('activeSelected');
        }
      });
      jQuery("#iconPopupModalShow").modal("show");
       event.stopPropagation(); 
      });
    jQuery('#iconPopupModalShow').on('hidden.bs.modal', function (e) {
      jQuery(this)
        .find("input")
         .val('')
         .end();
         jQuery('#searchMenuIcon').keyup();
         jQuery('.tv-search-result-ul-tm li').removeClass("activeSelected");
    });
    jQuery(document).click(function() {
      jQuery('.iconDropDown').hide();	
    }); 
});
function activeurlinput(url_type) {
    jQuery('.url_input').hide();
    jQuery('.url_type_' + url_type).show();
}



function wgsPanelClose(obj){

  jQuery('.panel-collapse.in').collapse('hide');

  jQuery(obj).parent().parent().next('.panel-collapse:not(".in")').collapse('show');

}

function wgsPanelCloseSeoPage(obj){
	jQuery('.panel-collapse.in').collapse('hide');
	jQuery(obj).next('.panel-collapse:not(".in")').collapse('show');
}

function wgsShowCaption(obj){
  var selectVal = jQuery(obj).val();
  var lengthGetExtraDetails = jQuery("#menuDetailsExtraData").length;
  if(selectVal == 0 || selectVal == 2){
    jQuery("#menuDetailsExtraData").addClass("hidden");
  }else if(selectVal == 1){
    jQuery("#menuDetailsExtraData").removeClass("hidden");
  }
  if(selectVal == 0){
    if(lengthGetExtraDetails > 0){
      jQuery("#singleButtonDiv").css('display','block');
    }else{
      jQuery("#singleButtonDiv").css('display','none');
    }
	  jQuery("#menuCaptions").css('display','block');
	  jQuery("#menu_parent_id").html('<option selected="" value="0">(none)</option>');
	  jQuery('#menu_parent_id').prop("disabled",true);
  }else{
		jQuery("#singleButtonDiv").css('display','block');
	  jQuery("#menuCaptions").css('display','none');
		jQuery.ajax({
			type: "POST",
			url: '',
			data:{
				 'parents':selectVal,
				 'getParentdata':'true',
				},
			success: function (data) {
			   jQuery('#menu_parent_id').html(data);
			   jQuery('#menu_parent_id').prop("disabled", false);
			},                                 		         
	  }); 
  }  
}


function getGroupProducts(gid,method){
  jQuery.ajax({
      type: "POST",
      url: '',
      data:{
         'gid':gid,
         'method': method,
        },
      success: function (data) {
         jQuery('.gproduct').remove();
         jQuery('#gproupProducts').after(data);             
      },
    });
}



function wgsHomeProductPage(pageType){
    jQuery.ajax({
      type: "POST",
      url: '',
      data:{
         'pageType':pageType,
         'method': 'getHomeProducts',
        },
      success: function (data) {
         jQuery('.gproduct').remove();
         jQuery('#gproupProducts').after(data);             
      },
    });	
}

function wgsInsertSampleContent(obj){
  var contentAdding = '<div class="container"><div class="row"><div class="col-sm-6"><div class="left"><h2><span>Sample</span> Banner</h2><h6>The best performance for online gaming</h6><p>Our Game dedicated server range offers gaming servers that are specially designed to host associated software, such as voice chat programs. With OVH dedicated servers, gamers can play their favourite online games without any limits in terms of performance and stability.</p><a class="button04 mt-4" href="#">Get started Now</a></div></div><div class="col-sm-6"><div class="right"><picture><source media="(max-width: 100%)" srcset="{$WEB_ROOT}/templates/{$template}/banners/game_server_banner.webp" type="image/webp" /> <source media="(max-width: 100%)" srcset="{$WEB_ROOT}/templates/{$template}/banners/game_server_banner.png" type="image/png" /> <img src="{$WEB_ROOT}/templates/{$template}/banners/game_server_banner.webp" /></picture></div></div></div></div>';
  var idOfEditorBlockEnglish = "editor-english";
  var contentBlocks = tinymce.get(idOfEditorBlockEnglish).getContent();
  if(contentBlocks == ''){
		tinymce.get(idOfEditorBlockEnglish).setContent(contentAdding);  
  }else{
	  alert('Banner Already have Html');
  }
}

function wgsChangeValueTextLabel(obj,vals){
	jQuery('#cht_id').text(vals);
}

function wgsDynmicTranslateContent(obj,callfor){
	jQuery("#modalBodyTranslation").html('');
	var inputTypeGet = jQuery(obj).prev().prop('tagName').toLowerCase();
	if(inputTypeGet == 'textarea'){
		var prevColumnName = jQuery(obj).prev("textarea").attr("name");
		if(prevColumnName == 'menu_caption' || prevColumnName == 'menu_side_description'){
			prevColumnName = jQuery(obj).prev("textarea").attr("menuid");
		}
		var prevDbColAttr = jQuery(obj).prev("textarea").attr("dbcolumn");
	}else if(inputTypeGet == 'input'){
		inputTypeGet = 'text';
		var prevColumnName = jQuery(obj).prev("input").attr("name");
		if(prevColumnName == 'menu_name' || prevColumnName == 'caption_button_name' || prevColumnName == 'name' || prevColumnName == 'menu_tag_line' || prevColumnName == 'menu_head_line' || prevColumnName == 'menu_bottom_sec_head_line'){
			prevColumnName = jQuery(obj).prev("input").attr("menuid");
		}
		var prevDbColAttr = jQuery(obj).prev("input").attr("dbcolumn");
	}
	jQuery("#modalDynmicTranslation").find(".modal-title").html(jQuery(obj).attr("data-modal-title"));
	jQuery("#modalBodyTranslation").html('<div class="loaderCenterialize"><i class="fa fa-spinner spin"></i>');
	jQuery("#modalDynmicTranslation").modal("show");
	jQuery.ajax({
		type: "post",
		url: "",
		data: "transLationAjaxCalled=true&texttype="+inputTypeGet+"&columnName="+prevColumnName+"&pageCall="+callfor+"&relatedType="+prevDbColAttr,
		success: function (result) {
			jQuery("#modalBodyTranslation").html(result);
		}
	});
}
function wgsDynmicTranslateSubmitForm(obj){
	var formSerialize = jQuery("form#formDynmicTranslation").serialize();
	jQuery.ajax({
		type: "post",
		url: "",
		data: "transLationAjaxSaved=true&"+formSerialize,
		success: function (result) {
			jQuery('#growls').append('<div class="growl growl-notice growl-medium"><div class="growl-close">×</div><div class="growl-title">Success!</div><div class="growl-message">Your changes have been saved.</div></div>');
			jQuery("#modalBodyTranslation").html('');
			jQuery("#modalDynmicTranslation").modal("hide");
           setTimeout(function(){
                jQuery('.growl').fadeOut(300);
                jQuery('.growl').remove();
            }, 5000);
		}
	});
}
function wgsDynmicSetCookieEnjoyHint(obj,cookieFor){
	jQuery.ajax({
		type: "post",
		url: "",
		data: "setCookiesForEnjoyHint=true&cookiePage="+cookieFor,
		success: function (result) {
		}
	});
}