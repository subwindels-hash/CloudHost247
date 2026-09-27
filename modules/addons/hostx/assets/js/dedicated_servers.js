var POST_DATA = {
                  method: 'getAllProducts',
                  group_ids: [],
                  disks: [],
                  ram: {
                    from: 8,
                    to: 1536,
                  },
                  price: {
                    from: 0,
                    to: 0,
                  },
                  location : ''
                };
var sliderAmountRAM =   [8, 16, 32, 64, 128, 256, 512, 1536];

jQuery(document).ready(function(){
 setTimeout(function(){
  jQuery('.groups').each(function(){
        var group_id = jQuery(this).val();
        var index = POST_DATA.group_ids.indexOf(group_id);
         if((this.checked == true) && (index == -1) ){
          POST_DATA.group_ids.push(group_id); 
         }else if(index != -1){
          POST_DATA.group_ids.splice(index, 1);
         }
    });

  jQuery('#disk_filter input[type=checkbox]').each(function(){
     var disk_name = jQuery(this).val();
     if(this.checked){
      var index = POST_DATA.disks.indexOf(disk_name);
       if(index == -1){
        POST_DATA.disks.push(disk_name); 
       }
     }
  });

  get_all_products();
}, 1000);

jQuery('.groups').on('change',function(){
	jQuery('.groups').each(function(){
		var group_id = jQuery(this).val();
		var index = POST_DATA.group_ids.indexOf(group_id);
		 if((this.checked == true) && (index == -1)){
		  POST_DATA.group_ids.push(group_id); 
		 }else if((jQuery(this).prop('checked') == false) && (index != -1)) {
		  POST_DATA.group_ids.splice(index, 1);
		 }
	});
 get_all_products();
});


   //disk_filter
jQuery('#disk_filter input[type=checkbox]').on('change',function(){
	 var disk_name = jQuery(this).val();
	 var index = POST_DATA.disks.indexOf(disk_name);
	 if(index == -1){
		POST_DATA.disks.push(disk_name); 
	 }else{
		POST_DATA.disks.splice(index, 1)
	 }
 get_all_products();
});

  // ram filter
jQuery("#ram_filter").ionRangeSlider({
	type: "double",
	grid: true,
	from: 0,
	to: (sliderAmountRAM.length - 1),
	values: sliderAmountRAM,
	postfix: "GB",
	onFinish: function (data) {
	  var _from =   sliderAmountRAM[data.from];
	  var _to  = sliderAmountRAM[data.to];
	  POST_DATA.ram.from =  _from;
	  POST_DATA.ram.to =  _to;
	  get_all_products();
	}
}); 

// price filter
jQuery("#price_filter").ionRangeSlider({
	type: "double",
	min: dedicated_min_filter_value,
	max: dedicated_max_filter_value,
	from: dedicated_min_filter_value,
	to: dedicated_max_filter_value,
	prefix: currency_prefix_slider,
	onFinish: function (data) {
		POST_DATA.price.from =  data.from;
		POST_DATA.price.to =  data.to;
		get_all_products();
	}
});
// location filter
jQuery('#locationList  a').click(function (e) {
	  e.preventDefault();
	  POST_DATA.location = jQuery(this).data('value');
	  get_all_products();

});
});

jQuery(function() {
	if(jQuery("#filters-row").length > 0){
    var $sidebar   = $("#filters-row"), 
        $window    = $(window),
        offset     = $sidebar.offset(),
        topPadding = 15,
        scroll_down_limit = 0,
        filter_box_height = 60;

        $('#filters-row .filters_box').each(function(inx){
          filter_box_height+= $(this).height();
        });
      if($window.width() > 1000 ){
        $window.scroll(function() {
            scroll_down_limit = $sidebar.next().height();
            if ($window.scrollTop() > offset.top) {
              if($window.scrollTop() <= ((scroll_down_limit+offset.top)-filter_box_height) ){
                $sidebar.stop().animate({
                    top: $window.scrollTop() - offset.top + topPadding
                });
              }
            } else {
                $sidebar.stop().animate({
                    top: 6
                });
            }
        });
      }
	}
});

function get_all_products() {
   jQuery('.loader-wrapper').show();
    jQuery.ajax({
      type: "POST",
      url: '',
      data: POST_DATA,
      dataType: 'json',
      success: function(response){
		if(jQuery("#filters-row").length > 0){
			 window.scrollTo({
			  top: jQuery('.dedicated_servers').offset().top,
			  behavior: 'smooth',
			});
			jQuery('#filters-row').stop().animate({ top: 0 });
		}
        if(response){
          var html =  '';
          jQuery('.results').html(dedicated_result_found+' : '+response.length+'');
          jQuery.each(response, function(inx,val){
            html+='<div class="results_box">'+
                    '<div class="col1">'+
                      '<div class="col_in">'+
                        '<h5>'+val.name+'</h5>'+
                      render_disk(val.disk_type)+
                      '</div>'+
                    '</div>'+
                    '<div class="col1 col2">'+
                        '<div class="col_in"> '+
                        '<i>Basic configuration</i>'+
                         filter_configoptions(val.configuration,templateNameWgs,templateSystemUrl) +
                        '</div>'+
                    '</div>'+
                    '<div class="col1">'+
                      '<div class="col_in">'+
                       render_location(val.location,val.deliver_in,templateNameWgs,templateSystemUrl)+
                      '</div>'+
                    '</div>'+
                   ' <div class="col1">'+
                        '<div class="col_in"> '+
                         filter_price(val.paytype,val.monthly,val.quarterly,val.semiannually,val.annually,val.biennially,val.triennially,val.prefix,val.suffix)+
                       '</div>'+
                   ' </div>'+
                    '<div class="col1 text-center">'+
                     '<div class="col_in"> '+
                         '<a href="cart.php?a=add&pid=' + val.id + '" class="button02">'+dedicated_configure_btn+'</a>'+
                      ' </div>'+
                    '</div>'+
                '</div>';
          });
          jQuery('#result-container').html(html);
          jQuery('.loader-wrapper').fadeOut('slow');
        }
      }
    });
}
function render_location(location,deliver_in,templateNameWgs,templateSystemUrl){
  var deliverIn = '72h';
  if(deliver_in != ''){
    deliverIn = deliver_in;
  }
  var html ='<div class="flag_text">';
  if(location != null &&  location != '' && (typeof location != 'undefined') ){
      var numbersArray = location.split(',');
      jQuery.each(numbersArray,function(inx,val){
        html+='<img src="'+templateSystemUrl+'/templates/'+templateNameWgs+'/flags/blank.gif" class="flag flag-'+val+'" >';
      });
  }
  html+='</div><p>'+dedicated_deliver_in+' </p><p>'+deliverIn+'</p>';
  return html;   
}
function  filter_price(paytype,monthly,quarterly,semiannually,annually,biennially,triennially,prefix,suffix){
  if(paytype == 'free'){
    return  '<p>'+dedicated_start_from+'</p><h2>'+freeProductPrice+'</h2>';
  }else if(paytype == 'recurring'){
    if(monthly >= 0){
      var priceProduct = monthly;
      var cycles = 'monthly';
    }else if(quarterly >= 0){
      var priceProduct = quarterly;
      var cycles = 'quarterly';
    }else if(semiannually >= 0){
      var priceProduct = semiannually;
      var cycles = 'semiannually';
    }else if(annually >= 0){
      var priceProduct = annually;
      var cycles = 'annually';
    }else if(biennially >= 0){
      var priceProduct = biennially;
      var cycles = 'biennially';
    }else if(triennially >= 0){
      var priceProduct = triennially;
      var cycles = 'triennially';
    }
    var priceFormated = price_format_currency_wise(priceProduct,prefix,suffix);
    return  '<p>'+dedicated_start_from+'</p><h2>'+priceFormated+'</h2><p>'+langugeBillingCycle[cycles]+'</p>';
  }else if(paytype == 'onetime'){
    var priceFormated = price_format_currency_wise(monthly,prefix,suffix);
    return  '<p>'+dedicated_start_from+'</p><h2>'+priceFormated+'</h2><p>'+langugeBillingCycle['onetime']+'</p>';
  }
}
function filter_configoptions(configuration,templateNameWgs,templateSystemUrl){
  var html  =  '<ul class="list">';
  var icon =  ['icon03.svg','ram.svg','disk.svg'];
  var name =  [dedicated_cpu_lang,dedicated_ram_lang,dedicated_disk_lang];
  var html  = '';
  if(configuration != null &&  configuration != '' && (typeof configuration != 'undefined') ){
        var conf = configuration.split(',');
        jQuery.each(conf,function(inx,val){
          html+='<li><img class="svg" src="'+templateSystemUrl+'/templates/'+templateNameWgs+'/images/'+icon[inx]+'"> <b>'+name[inx]+':</b> '+val+'</li>';
        }); 
  }
  html+='</ul>';
  return html; 
}
function render_disk(disk_type){
  var html  = '';
  if(disk_type != null &&  disk_type != '' && typeof disk_type != 'undefined' ){
      var numbersArray = disk_type.split(',');
      jQuery.each(numbersArray,function(inx,val){
        html+='<a href="#" class="sata_button">'+val+'</a>';
      });
  }
  return html;
}
function price_format_currency_wise(priceNumeric,prefix,suffix){
    if(currencyFormatData == 'prefix'){
      var priceFormated = prefix+''+priceNumeric;
    }else if(currencyFormatData == 'suffix'){
      var priceFormated = priceNumeric+''+suffix;
    }else if(currencyFormatData == 'both'){
      var priceFormated = prefix+''+priceNumeric+''+suffix;
    }
    return priceFormated;
}