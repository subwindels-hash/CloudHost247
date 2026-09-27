<style>
.frntend-banner-section {
  background-color: #f8f8f8;
  padding: 45px 0px 70px;
  clear: both;
}

.frontend-banner-title h1 {
  font-size: 51px;
  letter-spacing: 0.16px;
  line-height: 60px;
  color: #000000;
  font-weight: 700;
  font-family: "Poppins";
  text-align: center;
  max-width: 700px;
  margin: 28px auto;
}

.frontend-banner-title {
  margin-bottom: 40px;
}

.frontend-banner-title p {
  font-size: 18px;
  line-height: 30px;
  color: #585858;
  font-weight: 500;
  font-family: "Poppins";
  text-align: center;
  max-width: 600px;
  margin: auto;
}

.frontend-list .inner {
  text-align: center;
  width: 150px;
  padding: 20px 14px;
  background-color: #FFF;
  border: 1px solid #D8D8D8;
  margin-bottom: 15px;
}

.frontend-list .inner img {
  margin-bottom: 18px;
  width: 28px;
  height: 28px;
}
.frontend-list ul.list-inline, .front-theme-icons ul.list-inline{
  display: inherit;
}
.frontend-list .inner h5 {
  font-size: 12px;
  line-height: 18px;
  color: #3C3C3C;
  font-weight: 600;
  font-family: "Poppins";
}
.frontend-list li.list-inline-item, .front-theme-icons li.list-inline-item{
  width: auto;
  float: none;
  cursor: pointer;
}
.frontend-list .list-inline-item:not(:last-child) {
  /* margin-right: 16px; */
}
.frontend-list .inner:hover {
  border-color: #eaeaea;
  box-shadow: 0px 13px 12.5px rgba(0,0,0,0.08);
  border-color: #fff;
}

.inner {
  border-radius: 6px;
  border: 1px solid #adadad;
  transition: all .3s ease-in;
}
.frontend-list ul {
  text-align: center;
}
li.list-inline-item.common-li-cls.active .inner {
border-color: #F51322;
}
.title_box5 {
color: #464646;
border: 1px solid #D0D0D0;
}
.title_box5 {
float: left;
width: 100%;
padding: 10px;
font-size: 23px;
font-weight: 700;
text-align: center;
color: red;
border: 1px solid red;
}
.frntend-banner-section {
background-color: #F8F8F8;
padding: 40px 0px 40px;
clear: both;
}
.frontend-list .inner h5 {
font-size: 13px;
line-height: 18px;
color: #3C3C3C;
font-weight: 600;
font-family: "Poppins";
}
.frontend-banner-title {
margin-bottom: 20px;
}
.frontend-list .inner img {
margin-bottom: 18px;
width: 32px;
height: 32px;
}
</style>
<div class="frntend-banner-section">
   <div class="container">
      <div class="row">
         <div class="col-12">
            <div class="frontend-banner-title">
               <p>All The Hostx Element And Blocks Available In Theme</p>
            </div>
            <div class="frontend-list">
               <ul class="list-inline">
                  <li class="list-inline-item common-li-cls active" onclick="wgsBlockManaged(this,'BannersElement');">
                     <div class="inner">
                        <img src="{$WEB_ROOT}/templates/{$template}/images/bnr-b-icon.svg" alt="coding" class="img-fluid lazyloaded" data-ll-status="loaded">
                        <noscript><img src="{$WEB_ROOT}/templates/{$template}/images/bnr-b-icon.svg" alt="coding" class="img-fluid"></noscript>
                        <h5>Banners <br> Block</h5>
                     </div>
                  </li>
                  <li class="list-inline-item common-li-cls" onclick="wgsBlockManaged(this,'FeaturesElement');">
                     <div class="inner">
                        <img src="{$WEB_ROOT}/templates/{$template}/images/feature-b-icon.svg" alt="coding" class="img-fluid lazyloaded" data-ll-status="loaded">
                        <noscript><img src="{$WEB_ROOT}/templates/{$template}/images/feature-b-icon.svg" alt="coding" class="img-fluid"></noscript>
                        <h5>Features <br>Block</h5>
                     </div>
                  </li>
                  <li class="list-inline-item common-li-cls" onclick="wgsBlockManaged(this,'PricingElement');">
                     <div class="inner">
                        <img src="{$WEB_ROOT}/templates/{$template}/images/pricein-b-icon.svg" alt="coding" class="img-fluid lazyloaded" data-ll-status="loaded">
                        <noscript><img src="{$WEB_ROOT}/templates/{$template}/images/pricein-b-icon.svg" alt="coding" class="img-fluid"></noscript>
                        <h5>Pricing <br>Block</h5>
                     </div>
                  </li>
                  <li class="list-inline-item common-li-cls" onclick="wgsBlockManaged(this,'TestimonialElement');">
                     <div class="inner">
                        <img src="{$WEB_ROOT}/templates/{$template}/images/review-b-icon.svg" alt="coding" class="img-fluid lazyloaded" data-ll-status="loaded">
                        <noscript><img src="{$WEB_ROOT}/templates/{$template}/images/review-b-icon.svg" alt="coding" class="img-fluid"></noscript>
                        <h5>Testimonial <br>Block</h5>
                     </div>
                  </li>
                  <li class="list-inline-item common-li-cls" onclick="wgsBlockManaged(this,'FaqElement');">
                     <div class="inner">
                        <img src="{$WEB_ROOT}/templates/{$template}/images/faq-b-icon.svg" alt="coding" class="img-fluid lazyloaded" data-ll-status="loaded">
                        <noscript><img src="{$WEB_ROOT}/templates/{$template}/images/faq-b-icon.svg" alt="coding" class="img-fluid"></noscript>
                        <h5>FAQ<br>Block</h5>
                     </div>
                  </li>
                  <li class="list-inline-item common-li-cls" onclick="wgsBlockManaged(this,'OffersElement');">
                     <div class="inner">
                        <img src="{$WEB_ROOT}/templates/{$template}/images/offer-b-icon.svg" alt="coding" class="img-fluid lazyloaded" data-ll-status="loaded">
                        <noscript><img src="{$WEB_ROOT}/templates/{$template}/images/offer-b-icon.svg" alt="coding" class="img-fluid"></noscript>
                        <h5>Offers<br>Block</h5>
                     </div>
                  </li>
                  <li class="list-inline-item common-li-cls" onclick="wgsBlockManaged(this,'ExtraElement');">
                     <div class="inner">
                        <img src="{$WEB_ROOT}/templates/{$template}/images/extra-b-icon.svg" alt="coding" class="img-fluid lazyloaded" data-ll-status="loaded">
                        <noscript><img src="{$WEB_ROOT}/templates/{$template}/images/extra-b-icon.svg" alt="coding" class="img-fluid"></noscript>
                        <h5>Extra<br>Block</h5>
                     </div>
                  </li>
               </ul>
            </div>
         </div>
      </div>
   </div>
</div>
<div id="BannersElement" class="allElement">
	<div class="title_box5">Banner V1</div>
	<div class="new_hx-banner">
	   <div class="container">
		  <div class="row">
			 <div class="col-12">
				<div class="hx-banner-content">
				   <h1>Take Your Business Online With</h1>
				   <h3>Fast, Secure, Powerful Web Hosting!</h3>
				</div>
			 </div>
		  </div>
		  <div class="row hx-list">
			 <div class="col-md-3">
				<div class="hx-banner-list">
				   <div class="hx-box"><img src="{$WEB_ROOT}/templates/{$template}/images/hx-img1.svg" alt="icon"></div>
				   <p>30 Day Guarantee</p>
				</div>
			 </div>
			 <div class="col-md-3">
				<div class="hx-banner-list">
				   <div class="hx-box"><img src="{$WEB_ROOT}/templates/{$template}/images/hx-img2.svg" alt="icon"></div>
				   <p>Trusted by 1.2 Millions user</p>
				</div>
			 </div>
			 <div class="col-md-3">
				<div class="hx-banner-list">
				   <div class="hx-box"><img src="{$WEB_ROOT}/templates/{$template}/images/hx-img3.svg" alt="icon"></div>
				   <p>Speed Like No One Else</p>
				</div>
			 </div>
			 <div class="col-md-3">
				<div class="hx-banner-list">
				   <div class="hx-box"><img src="{$WEB_ROOT}/templates/{$template}/images/hx-img4.png" alt="icon"></div>
				   <p>Full Root and Full Control</p>
				</div>
			 </div>
		  </div>
		  <div class="row">
			 <div class="col-12">
				<div class="text-center mt-5"><a href="#" class="btn hx-getstart-btn">GET STARTED NOW</a></div>
			 </div>
		  </div>
	   </div>
	</div>
	<div class="title_box5">Banner V2</div>
	<div class="new_hx-business-banner">
	   <div class="container">
		  <div class="row">
			 <div class="col-lg-7 col-md-12">
				<div class="hx-business-block">
				   <div class="hx-banner-business-content">
					  <h1>Take Your Business Online With</h1>
					  <span>Fast, Secure, Powerful Web Hosting!</span>
					  <p>Focus on your business and avoid all the web hosting hassles. Our managed hosting guarantees unmatched performance & reliability.</p>
				   </div>
				   <ul class="list-inline-item hx-business-list pl-0 mr-0">
					  <li class=" list-inline-item mb-3">
						 <div class="hx-bnr-list">
							<div class="hx-box"><img src="{$WEB_ROOT}/templates/{$template}/images/hx-business-icon1.svg" alt="icon"></div>
							<p>30 Day <br>Guarantee</p>
						 </div>
					  </li>
					  <li class="list-inline-item mb-3">
						 <div class="hx-bnr-list">
							<div class="hx-box"><img src="{$WEB_ROOT}/templates/{$template}/images/hx-business-icon2.svg" alt="icon"></div>
							<p>Trusted by 1.2 <br>Millions user</p>
						 </div>
					  </li>
					  <li class="list-inline-item mb-3 business-brdr-right">
						 <div class="hx-bnr-list">
							<div class="hx-box"><img src="{$WEB_ROOT}/templates/{$template}/images/hx-business-icon3.svg" alt="icon"></div>
							<p>Speed Like <br>No One Else</p>
						 </div>
					  </li>
				   </ul>
				   <div class="hx-business-btn mb-4 mb-lg-0"><a href="{$WEB_ROOT}/cart.php" class="btn getstart-business-btn">Get Started Now <span><img src="{$WEB_ROOT}/templates/{$template}/images/business-right-arrow3.svg" alt="arrow"></span></a></div>
				</div>
			 </div>
			 <div class="col-lg-5 col-md-12 px-3 px-lg-0">
				<div class="hx-banner-business-img"><img src="{$WEB_ROOT}/templates/{$template}/images/hx-right-img.png" alt="business-img" class="w-100"></div>
			 </div>
		  </div>
	   </div>
	</div>
	<div class="title_box5">Banner V3</div>
	<div class="hx-business-banner">
	   <div class="container">
		  <div class="row">
			 <div class="col-12">
				<div class=" business-content text-center">
				   <h1>Take <span>Your Business</span> Online With</h1>
				   <h5>Fast, Secure, Powerful Web Hosting!</h5>
				   <p>Focus on your business and avoid all the web hosting hassles. Our managed hosting guarantees unmatched performance & reliability.</p>
				</div>
			 </div>
			 <div class="col-12">
				<div class=" business-block">
				   <ul class="list-inline-item hx-business-list pl-0">
					  <li class=" list-inline-item mb-3">
						 <div class="hx-bnr-list">
							<div class="hx-box"><img src="{$WEB_ROOT}/templates/{$template}/images/hx-business-icon1.svg" alt="icon"></div>
							<p>30 Day <br>Guarantee</p>
						 </div>
					  </li>
					  <li class="list-inline-item mb-3">
						 <div class="hx-bnr-list">
							<div class="hx-box"><img src="{$WEB_ROOT}/templates/{$template}/images/hx-business-icon2.svg" alt="icon"></div>
							<p>Trusted by 1.2 <br>Millions user</p>
						 </div>
					  </li>
					  <li class="list-inline-item mb-3 business-brdr-right">
						 <div class="hx-bnr-list">
							<div class="hx-box"><img src="{$WEB_ROOT}/templates/{$template}/images/hx-business-icon3.svg" alt="icon"></div>
							<p>Speed Like <br>No One Else</p>
						 </div>
					  </li>
				   </ul>
				</div>
			 </div>
			 <div class="col-12">
				<div class="business-start-btn mb-4 mb-lg-0 text-center"><a href="{$WEB_ROOT}/cart.php" class="btn business-btn">Get Started Now</a></div>
			 </div>
		  </div>
	   </div>
	</div>
<!-- banner1 -->
<div class="title_box5">Banner 1</div>
<div class="banner1">
    <div class="container">
      <div class="banner_info">
         <h6>{$LANG.bannerhead}</h6>
         <h2>{$LANG.bannerhead2}</h2>
         <p>{$LANG.bannerheadtext}</p>

  </div>          
    </div>
</div> 
<!-- banner1 end--> 

<!-- banner2 -->
<div class="title_box5">Banner 2</div>
<div class="banner">
    <div class="container">
        <div class="big_col">
            <div class="big_col_in">
                <h4>{$LANG.homebig}</h4>
                <small>{$LANG.homesummersale}</small>
            </div>
            <h5>{$LANG.homesharedhostingfrm} <br>{$LANG.homeonly} {$hxselectedcurrency.prefix}1.00/{$LANG.homemonth}*</h5> 
        </div>
        <div class="banner_bottom">
            <h3>{$LANG.hometrusbusiness} <b>20</b> {$LANG.homeyears}</h3>
            <ul>
                <li><a href="#"><embed type="image/svg+xml" src="{$WEB_ROOT}/templates/{$template}/images/icon2.svg" /> {$LANG.homeunlimitedws}</a></li>
                <li><a href="#"><embed type="image/svg+xml" src="{$WEB_ROOT}/templates/{$template}/images/icon2.svg"> {$LANG.homefreedomain}</a></li> 
                <li><a href="#"><embed type="image/svg+xml" src="{$WEB_ROOT}/templates/{$template}/images/icon3.svg"> {$LANG.homeunlimitedbandwidth}</a></li> 
                <li><a href="#"><embed type="image/svg+xml" src="{$WEB_ROOT}/templates/{$template}/images/icon4.svg"> {$LANG.homeunlimitedemail}</a></li>  
            </ul>
            <div class="clearfix"></div>
            <a href="cpanelhosting.php" class="button02">{$LANG.homegetstarted}</a>
        </div>
    </div>
</div>
<!-- banner2 end--> 

<!-- banner3 -->
<div class="title_box5">Banner 3</div>
<div class="banner1 banner3">
    <div class="container">
      <div class="banner_info">
         <h6>{$LANG.bannervpshead}</h6>
         <h2>{$LANG.bannervpshead2}.</h2>
         <p>{$LANG.bannervpsheadtext}</p> 
         <a href="#" class="button03">{$LANG.homegetstarted}</a>  

  </div>          
    </div>

</div> 
<!-- banner3 end--> 
<!-- banner4 -->
<div class="title_box5">Banner 4</div>
<div class="banner">
    <div class="container">
      <div class="banner2"> 
              <h1>{$LANG.banner4head}</h1>
              <h6>{$LANG.banner4truebussnes} </h6>
              <div class="clearfix"></div>
              <ul class="banner_list">
                <li><a href="#">{$LANG.banner4webspace}</a></li>
                <li><a href="#">{$LANG.banner4freedomain}</a></li>
                <li><a href="#">{$LANG.banner4freedomain}</a></li>
                <li><a href="#">{$LANG.banner4ub}</a></li>
               
              </ul>
              <div class="clearfix"></div>
            <a href="#" class="button02">{$LANG.homegetstarted}</a>
            </div>
      </div>
</div>  
<!-- banner4 end-->
<!-- banner5-->
<div class="title_box5">Banner 5</div>
<div class="banner">
    <div class="container">
      <div class="row">
        <div class="col-sm-6">
          <div class="left">
            <h2>{$LANG.cpanelwebhosting}</h2>
            <h6>{$LANG.cpanelessyinstall}</h6>
            <p>{$LANG.cpanelessyinstalltext}</p>
    <a href="#" class="button04 mt-4">{$LANG.homegetstarted}</a>  
          </div>
        </div>
        <div class="col-sm-6">
          <div class="right">
            <img src="{$WEB_ROOT}/templates/{$template}/images/cpanel-img.png">
          </div>
        </div>
      </div>
    </div>
  </div> 
<!-- banner5 end-->

<!-- banner6-->
<div class="title_box5">Banner 6</div>
<div class="banner developer_friendly dedicatedpage">
  <div class="container">
    <div class="row">
      <div class="col-sm-6">
        <div class="left">
          <h2>{$LANG.dedicateddfbannerhd}</h2>
          <h6>{$LANG.dedicateddfbannerhd2}</h6> 
          <p>{$LANG.dedicateddfbannertext}</p> 
  <a href="#" class="button04 mt-4">{$LANG.homegetstarted}</a>  
        </div>
      </div>
      <div class="col-sm-6">
        <div class="right">
          <img src="{$WEB_ROOT}/templates/{$template}/images/developer_friendly-img.png"> 
        </div>
      </div>
    </div>
  </div>
</div>
<!-- banner6 end-->

<!-- banner7-->
<div class="title_box5">Banner 7</div>
<div class="banner enterprise_servers dedicatedpage"> 
  <div class="container">
    <div class="row">
      <div class="col-sm-6">
        <div class="left">
          <h2>{$LANG.dedicatedepbannerhd}</h2>
          <h6>{$LANG.dedicatedepbannerhd2}</h6> 
          <p>{$LANG.dedicatedepbannertext} </p> 
  <a href="#" class="button04 mt-4">{$LANG.homegetstarted}</a>  
        </div>
      </div>
      <div class="col-sm-6">
        <div class="right">
          <img src="{$WEB_ROOT}/templates/{$template}/images/enterprise_servers_back.png">  
        </div>
      </div>
    </div>
  </div>
</div>
<!-- banner7 end-->

<!-- banner8-->
<div class="title_box5">Banner 8</div>
<div class="banner enterprise_servers dedicatedpage"> 
  <div class="container">
    <div class="row">
      <div class="col-sm-6">
        <div class="left">
          <h2>{$LANG.dedicatedgmbannerhd}</h2>
          <h6>{$LANG.dedicatedgmbannerhd2}</h6> 
          <p>{$LANG.dedicatedgmbannertext}</p> 
  <a href="#" class="button04 mt-4">{$LANG.homegetstarted}</a>  
        </div>
      </div>
      <div class="col-sm-6">
        <div class="right">
          <img src="{$WEB_ROOT}/templates/{$template}/images/game_back.png">  
        </div>
      </div>
    </div>
  </div>
</div>
<!-- banner8 end-->
<!-- banner9-->
<div class="title_box5">Banner 9</div>
<div class="banner enterprise_servers dedicatedpage" style="background-image: url({$WEB_ROOT}/templates/{$template}/images/hosting_server_back1.png);"> 
  <div class="container">
    <div class="row">
      <div class="col-sm-6">
        <div class="left">
          <h2> {$LANG.dedicatedbannerhead}</h2>
          <h6>{$LANG.dedicatedbannerhead2}</h6> 
          <p>{$LANG.dedicatedbannerheadtext}. </p>  
          <a href="#" class="button04 mt-4">{$LANG.homegetstarted}</a>
        </div>
      </div>
      <div class="col-sm-6">
        <div class="right">
          <img src="{$WEB_ROOT}/templates/{$template}/images/hosting_server_back.png">   
        </div>
      </div>
    </div>
  </div>
</div>
<!-- banner9 end-->

<!-- banner10-->
<div class="title_box5">Banner 10</div>
<div class="banner enterprise_servers"> 
  <div class="container">
    <div class="row">
      <div class="col-sm-6">
        <div class="left pt-5 mt-2">
          <h2>{$LANG.pleskbannerhead}</h2>
          <h6>{$LANG.pleskeasysetup}</h6>  
          <p>{$LANG.pleskbannertext}.</p>  
  <a href="#" class="button04 mt-4">{$LANG.homegetstarted}</a>  
        </div>
      </div>
      <div class="col-sm-6">
        <div class="right">
          <img src="{$WEB_ROOT}/templates/{$template}/images/plesk-hosting_back.png">   
        </div>
      </div>
    </div>
  </div>
</div>
<!-- banner10 end-->


<!-- banner11-->
<div class="title_box5">Banner 11</div>
<div class="banner enterprise_servers"> 
  <div class="container">
    <div class="row">
      <div class="col-sm-6">
        <div class="left">
          <h2>{$LANG.vpsplcbannerhead}</h2>
          <h6>{$LANG.vpsplcbannerhead2}</h6>  
          <p>{$LANG.vpsplcbannertext}</p>  
  <a href="#" class="button04 mt-4">{$LANG.homegetstarted}</a>  
        </div>
      </div>
      <div class="col-sm-6">
        <div class="right">
          <img src="{$WEB_ROOT}/templates/{$template}/images/vps_public_cloud_back.png">   
        </div>
      </div>
    </div>
  </div>
</div> 
<!-- banner11 end-->


<!-- banner12-->
<div class="title_box5">Banner 12</div>
<div class="banner enterprise_servers"> 
  <div class="container">
    <div class="row">
      <div class="col-sm-6">
        <div class="left">
          <h2>{$LANG.vpspcbannerhead}</h2>
          <h6>{$LANG.vpspcbannerhead2} </h6>  
          <p>{$LANG.vpspcbannertext}. </p>  
  <a href="#" class="button04 mt-4">{$LANG.homegetstarted}</a>  
        </div>
      </div>
      <div class="col-sm-6">
        <div class="right">
          <img src="{$WEB_ROOT}/templates/{$template}/images/vps_public_cloud_back1.png">   
        </div>
      </div>
    </div>
  </div>
</div>
<!-- banner12 end-->


<!-- banner13-->
<div class="title_box5">Banner 13</div>
<div class="banner enterprise_servers"> 
  <div class="container">
    <div class="row">
      <div class="col-sm-6">
        <div class="left">
          <h2><span>{$LANG.headervpsssd}</span></h2>
          <h6>{$LANG.vpsbannerhead} </h6>  
          <p>{$LANG.vpsbannertext}. </p>  
  <a href="#" class="button04 mt-4">{$LANG.homegetstarted}</a>  
        </div>
      </div>
      <div class="col-sm-6">
        <div class="right">
          <img src="{$WEB_ROOT}/templates/{$template}/images/vps_ssd_back.png">    
        </div>
      </div>
    </div>
  </div>
</div>
<!-- banner13 end-->


<!-- banner14-->
<div class="title_box5">Banner 14</div>
<div class="banner enterprise_servers"> 
    <div class="container">
      <div class="row">
        <div class="col-sm-6">
          <div class="left">
            <h2>{$LANG.windowbannerhead}</h2>
            <h6>{$LANG.windoweasysetup}</h6>  
            <p>{$LANG.windowbannertext}.</p>  
    <a href="#" class="button04 mt-4">{$LANG.homegetstarted}</a>  
          </div>
        </div>
        <div class="col-sm-6">
          <div class="right">
            <img src="{$WEB_ROOT}/templates/{$template}/images/window-hosting_back.png">     
          </div>
        </div>
      </div>
    </div>
  </div>  
<!-- banner14 end--> 
<!-- banner15-->
<div class="title_box5">Banner 15</div>
<div class="banner enterprise_servers wordpress_banner" style="background-image: url({$WEB_ROOT}/templates/{$template}/images/wordpree_hosting_back.png);"> 
  <div class="container">
    <div class="row">
      <div class="col-sm-6 pb-5">
        <div class="left pb-5 float-left">
          <h2>{$LANG.wordpressbannerhead}</h2>
          <h6>{$LANG.wordpressopensource}</h6>  
          <p>{$LANG.wordpressbannertext}.</p>   
  <a href="#" class="button04 mt-4">{$LANG.homegetstarted}</a>  
        </div>
      </div>
      <!-- <div class="col-sm-6">
        <div class="right">
          <img src="{$WEB_ROOT}/templates/{$template}/images/window-hosting_back.png">     
        </div>
      </div> -->
    </div>
  </div>
</div> 
<!-- banner15 end-->
</div>
<div id="FeaturesElement" class="allElement hidden">
	<div class="title_box5">All Hosting Features</div>
	<div class="custom-block-3">
	   <div class="container">
		  <div class="row">
			 <div class="col-md-6">
				<div class="b-left-box">
				   <div class="figure-icon"><img src="{$WEB_ROOT}/templates/{$template}/images/{$layoutStyle}/fgr-icon1.svg" alt="right icon"></div>
				   <div class="b-left-box-cont">
					  <h5>Everything You’ll need</h5>
					  <p>We monitor and manage multiple domain centralization in real-time to ensure your websites are always up and running.</p>
				   </div>
				</div>
				<div class="b-left-box">
				   <div class="figure-icon"><img src="{$WEB_ROOT}/templates/{$template}/images/{$layoutStyle}/fgr-icon3.svg" alt="server reload"></div>
				   <div class="b-left-box-cont">
					  <h5>Backup</h5>
					  <p>We provide website backup and disaster recovery services in the easiest way possible; saving time and securing data.</p>
				   </div>
				</div>
				<div class="b-left-box">
				   <div class="figure-icon"><img src="{$WEB_ROOT}/templates/{$template}/images/{$layoutStyle}/fgr-icon2.svg" alt="open source code"></div>
				   <div class="b-left-box-cont">
					  <h5>Free SSL</h5>
					  <p>Start protecting your e-commerce, logins, and more in just a few minutes with an automated domain validated FreeSSL.</p>
				   </div>
				</div>
				<div class="b-left-box">
				   <div class="figure-icon"><img src="{$WEB_ROOT}/templates/{$template}/images/{$layoutStyle}/fgr-icon4.svg" alt="user system"></div>
				   <div class="b-left-box-cont">
					  <h5>Convenience Softaculous</h5>
					  <p>Softaculous takes care of the complete application lifecycle inclusive of installation, backup, restoration, and updation.</p>
				   </div>
				</div>
			 </div>
			 <div class="col-md-6">
				<div class="b-left-box">
				   <div class="figure-icon"><img src="{$WEB_ROOT}/templates/{$template}/images/{$layoutStyle}/fgr-icon5.svg" alt="settings icon"></div>
				   <div class="b-left-box-cont">
					  <h5>Control Panel - cPanel</h5>
					  <p>Easy manage your domain name, renew the order, & make the most of your purchase with our intuitive control panel.</p>
				   </div>
				</div>
				<div class="b-left-box">
				   <div class="figure-icon"><img src="{$WEB_ROOT}/templates/{$template}/images/{$layoutStyle}/fgr-icon6.svg" alt="lock icon"></div>
				   <div class="b-left-box-cont">
					  <h5>Security - Imunify360</h5>
					  <p>The comprehensive multi-layered defense architecture ensures precision targeting and eradication of malware and viruses.</p>
				   </div>
				</div>
				<div class="b-left-box">
				   <div class="figure-icon"><img src="{$WEB_ROOT}/templates/{$template}/images/{$layoutStyle}/fgr-icon7.svg" alt="speed-server"></div>
				   <div class="b-left-box-cont">
					  <h5>Performance - LiteSpeed + LSCache</h5>
					  <p>Boost your WordPress, Joomla, and other dynamic websites performance and manage cache while spiking traffic.</p>
				   </div>
				</div>
				<div class="b-left-box">
				   <div class="figure-icon"><img src="{$WEB_ROOT}/templates/{$template}/images/{$layoutStyle}/fgr-icon8.svg" alt="server connnection"></div>
				   <div class="b-left-box-cont">
					  <h5>Convenience Migrations</h5>
					  <p>We offer convenience website migration services by transferring files, databases, scripts, and free domain registration transfer.</p>
				   </div>
				</div>
			 </div>
		  </div>
	   </div>
	</div>
	<div class="title_box5">Include all features</div>
	<div class="features-option2">
		<div class="container">
			<div class="top">
			  <h2>{$LANG.dedicatedfeature}</h2>
			  <p>{$LANG.dedicatedfeaturetext}</p>
			</div>
			<div class="clearfix"></div>
			<div class="row">
			  <div class="col-sm-3">
				<div class="features-col">
				  <div class="img-box">
					<img class="svg" src="{$WEB_ROOT}/templates/{$template}/images/ddos-icon.svg" alt="ddos icon"></div>
					<h3>{$LANG.dedicatedddosprotect}</h3>
					<p>{$LANG.dedicatedddosprotecttext}</p>
				</div>
			  </div>
			  <div class="col-sm-3">
				<div class="features-col">
				  <div class="img-box">
					<img class="svg" src="{$WEB_ROOT}/templates/{$template}/images/rpn.svg" alt="lock icon"></div>
					<h3>{$LANG.dedicatedrpn} </h3>
					<p>{$LANG.dedicatedrpntext}</p>
				</div>
			  </div>
			  <div class="col-sm-3">
				<div class="features-col">
				  <div class="img-box">
					<img class="svg box-svg" src="{$WEB_ROOT}/templates/{$template}/images/icon05.svg" alt="svg icons"></div>
					<h3>{$LANG.dedicatedvmware}</h3>
					<p>{$LANG.dedicatedvmwaretext}</p>
				</div>
			  </div>
			  <div class="col-sm-3">
				<div class="features-col">
				  <div class="img-box">
					<img class="svg" src="{$WEB_ROOT}/templates/{$template}/images/kvm-over-ip.svg" alt="user settings"></div>
					<h3>{$LANG.dedicatedkvmip}</h3>
					<p>{$LANG.dedicatedkvmiptext}</p>
				</div>
			  </div>
			  <div class="col-sm-3">
				<div class="features-col">
				  <div class="img-box">
					<img class="svg raid" src="{$WEB_ROOT}/templates/{$template}/images/rpn1.svg" alt="raid icon"></div>
					<h3>{$LANG.dedicatedraid}</h3>
					<p>{$LANG.dedicatedraidtext}</p>          
				</div>
			  </div>
			  <div class="col-sm-3">
				<div class="features-col">
				  <div class="img-box">
					<img class="svg" src="{$WEB_ROOT}/templates/{$template}/images/support.svg" alt="24*7 Support"></div>
					<h3>{$LANG.dedicatesupport}</h3>
					<p>{$LANG.dedicatesupporttext}</p>
				</div>
			  </div>
			  <div class="col-sm-3">
				<div class="features-col">
				  <div class="img-box">
					<img class="svg" src="{$WEB_ROOT}/templates/{$template}/images/certified-datacenter.svg" alt="datacenter"></div>
					<h3>{$LANG.dedicatecertifiedcenter}</h3>
					<p>{$LANG.dedicatecertifiedcentertext}</p>
				</div>
			  </div>
			  <div class="col-sm-3">
				<div class="features-col">
				  <div class="img-box"> 
					<img class="svg" src="{$WEB_ROOT}/templates/{$template}/images/premium-network.svg" alt="network"></div>
					<h3>{$LANG.dedicatedpremiumnetwork} </h3>
					<p>{$LANG.dedicatedpremiumnetworktext}</p>
				</div>
			  </div>
			</div> 
		</div> 
	</div>
	<div class="title_box5">Linux cloud Features Section</div>
	<div class="best-vps-server">
	  <h2>{$LANG.vpssearchvps}</h2>
	  <div class="container">
		<div class="row">

		  <div class="col-sm-4">
			<div class="cols">
			   <img src="{$WEB_ROOT}/templates/{$template}/images/cpu.png" alt="cpu-server-image">
			   <h3>{$LANG.vpsfastsimple}</h3>
			   <p>{$LANG.vpsfastsimpletext}</p>
			</div>
		  </div>

		  <div class="col-sm-4">
			<div class="cols">
			   <img src="{$WEB_ROOT}/templates/{$template}/images/EASY.png" alt="video player settings">
			   <h3>{$LANG.vpseasypanel}</h3>
			   <p>{$LANG.vpseasypaneltext}</p>
			</div>
		  </div>

		  <div class="col-sm-4">
			<div class="cols">
			   <img src="{$WEB_ROOT}/templates/{$template}/images/support1.png" alt="support icon">
			   <h3>{$LANG.vpsawardwinsupport}</h3>
			   <p>{$LANG.vpsawardwinsupporttext}</p>
			</div>
		  </div>

		  <div class="col-sm-4">
			<div class="cols">
			   <img src="{$WEB_ROOT}/templates/{$template}/images/custom.png" alt="custom icon">
			   <h3>{$LANG.vpsedgehardware}</h3>
			   <p>{$LANG.vpsedgehardwaretext}</p>
			</div>
		  </div>

		  <div class="col-sm-4">
			<div class="cols">
			   <img src="{$WEB_ROOT}/templates/{$template}/images/PRIVATe.png" alt="private network">
			   <h3>{$LANG.vpsprivateserver}</h3>
			   <p>{$LANG.vpsprivateservertext}.</p>
			</div>
		  </div>

		  <div class="col-sm-4">
			<div class="cols">
			   <img src="{$WEB_ROOT}/templates/{$template}/images/cloud.png" alt="cloud database">
			   <h3>{$LANG.vpshighcloudserver}</h3>
			   <p>{$LANG.vpshighcloudservertext}. </p> 
			</div>
		  </div>

		</div>
	  </div>
	</div>
	<div class="title_box5">More Feature</div> 
	<div id="feature" class="hosting_feature">
	  <div class="container">
		<h2>{$LANG.cpanelmorefeature} </h2>
		<p>{$LANG.cpanelmorefeaturetext}</p>
	  <div class="hosting_sections">
		<div class="row">
		  <div class="col-sm-4 mt-3">
			<div class="hosting_box"> 
			  <span><img class="svg" src="{$WEB_ROOT}/templates/{$template}/images/icon001.svg" alt="www icon"></span>
			  <h3>{$LANG.cpanelfreename} </h3>
			  <p>{$LANG.cpanelfreenametext}.</p>
			</div>
		  </div>
			<div class="col-sm-4 mt-3">
			<div class="hosting_box"> 
			  <span><img class="svg" src="{$WEB_ROOT}/templates/{$template}/images/icon002.svg" alt="message icon"></span>
			  <h3>{$LANG.cpanelfreepersonalised}</h3>
			  <p>{$LANG.cpanelfreepersonalisedtext}.</p>
			</div>
		  </div>
		  <div class="col-sm-4 mt-3">
			<div class="hosting_box"> 
			  <span><img class="svg" src="{$WEB_ROOT}/templates/{$template}/images/icon003.svg" alt="lock"></span>
			  <h3>{$LANG.cpanelfreeencreypt} </h3>
			  <p>{$LANG.cpanelfreeencreypttext}.</p>
			</div>
		  </div>
		  <div class="col-sm-4 mt-3">
			<div class="hosting_box"> 
			  <span><img class="svg" src="{$WEB_ROOT}/templates/{$template}/images/icon004.svg" alt="svg icon"></span>
			  <h3>{$LANG.cpanelfreebackup}</h3>
			  <p>{$LANG.cpanelfreebackuptext}.</p>
			</div>
		  </div>
		  <div class="col-sm-4 mt-3">
			<div class="hosting_box"> 
			  <span><img class="svg" src="{$WEB_ROOT}/templates/{$template}/images/icon005.svg" alt="cloud server"></span>
			  <h3>{$LANG.cpanelfreemigration}</h3>
			  <p>{$LANG.cpanelfreemigrationtext}</p>
			</div>
		  </div>
		  <div class="col-sm-4 mt-3">
			<div class="hosting_box"> 
			  <span><img class="svg" src="{$WEB_ROOT}/templates/{$template}/images/icon006.svg" alt="wordpress logo"></span>
			  <h3>{$LANG.cpaneloneclickhosting}</h3>
			  <p>{$LANG.cpaneloneclickhostingtext}</p>
			</div>
		  </div>
		</div>
	  </div> 
	  </div>
	</div>
	<div class="title_box5">Other Options</div>
	 <div class="custom-block-4">
	  <div class="container">
		<div class="opt-title">
		  <h2>Other Options?</h2>
		  <p>We cater more managed hosting services that help businesses unleash the full potential of their websites.</p>
		</div>
		<div class="row">
		  <div class="col-md-3">
		  <div class="block-box blck-4"> 
		  <div class="img-blc"><img src="{$WEB_ROOT}/templates/{$template}/images/{$layoutStyle}/blk-icon1.svg" alt="network icon"></div>
		  <div class="block-box-cont">
			<h3>Reseller Hosting</h3>
			<p>Our servers and infrastructure are by default protected against denial of service attacks (DDoS). </p>
		  </div>
		  </div>
		  </div>

		  <div class="col-md-3">
		  <div class="block-box blck-4"> 
		  <div class="img-blc"><img src="{$WEB_ROOT}/templates/{$template}/images/{$layoutStyle}/blk-icon2.svg" alt="vps server"></div>
		  <div class="block-box-cont">
			<h3>Managed VPS</h3>
			<p>Our servers and infrastructure are by default protected against denial of service attacks (DDoS). </p>
		  </div>
		  </div>
		  </div>
		  <div class="col-md-3">
		  <div class="block-box blck-4"> 
		  <div class="img-blc"><img src="{$WEB_ROOT}/templates/{$template}/images/{$layoutStyle}/blk-icon3.svg" alt="cloud settings"></div>
		  <div class="block-box-cont">
			<h3>Cloud VPS</h3>
			<p>Our servers and infrastructure are by default protected against denial of service attacks (DDoS). </p>
		  </div>
		  </div>
		  </div>
		   <div class="col-md-3">
		  <div class="block-box blck-4"> 
		  <div class="img-blc"><img src="{$WEB_ROOT}/templates/{$template}/images/{$layoutStyle}/blk-icon4.svg" alt="ssl certificate"></div>
		  <div class="block-box-cont">
			<h3>SSL Certificates</h3>
			<p>Our servers and infrastructure are by default protected against denial of service attacks (DDoS). </p>
		  </div>
		  </div>
		  </div>
		</div>
	  </div>
	</div>	
	<div class="title_box5">We Have a Hosting Solution</div>
	<div class="features-option2 features-option4">
	  <div class="container">
		<div class="top">
		  <h2>{$LANG.homehostsolution4you}</h2>
		  <p>{$LANG.homechooseplatform}</p>
		</div>
		<div class="clearfix"></div>
		<div class="row">
		  <div class="col-sm-4">
			<div class="features-col active">
			  <div class="img-box">
				<img class="svg" src="{$WEB_ROOT}/templates/{$template}/images/new/closed-lock-.svg" alt="lock icon"></div>
				<h3>{$LANG.homehackersecur}</h3>
				<p>{$LANG.homehackersecurtext}. </p>
			  <div class="features-option4_border"></div>
			</div>
		  </div>
		  <div class="col-sm-4">
			<div class="features-col"> 
			  <div class="img-box">
				<img src="{$WEB_ROOT}/templates/{$template}/images/new/icon.svg" class="svg" alt="speed-server"></div>
				<h3>{$LANG.homeblazingspeed}</h3>  
				<p>{$LANG.homeblazingspeedtext}.</p>
			  <div class="features-option4_border"></div>
			</div>
		  </div>
		  <div class="col-sm-4">
			<div class="features-col">
			  <div class="img-box">
				<img class="svg" src="{$WEB_ROOT}/templates/{$template}/images/new/history-clock-button.svg" alt="clock image"></div>
				<h3>{$LANG.homenightlybackup}</h3>
				<p>{$LANG.homenightlybackuptext}.</p>
			  <div class="features-option4_border"></div>
			</div>
		  </div>
		  <div class="col-sm-4">
			<div class="features-col">
			  <div class="img-box">
				<img class="svg" src="{$WEB_ROOT}/templates/{$template}/images/new/worldwide.svg" alt="globe"></div>
				<h3>{$LANG.homeglobalavailty}</h3>
				<p>{$LANG.homeglobalavailtytext}.</p>
			  <div class="features-option4_border"></div>
			</div>
		  </div>
		  <div class="col-sm-4">
			<div class="features-col">
			  <div class="img-box">
				<img class="svg raid" src="{$WEB_ROOT}/templates/{$template}/images/new/shield-checked.svg" alt="safe and secure"></div>
				<h3>{$LANG.homereimaginedsetp}</h3>
				<p>{$LANG.homereimaginedsetptext}. </p>
			  <div class="features-option4_border"></div>
			</div>
		  </div>
		  <div class="col-sm-4">
			<div class="features-col">
			  <div class="img-box">
				<img class="svg" src="{$WEB_ROOT}/templates/{$template}/images/new/wordpress-logo.svg" alt="wordpress logo"></div>
				<h3>{$LANG.hometunedwordpress}</h3>
				<p>{$LANG.hometunedwordpresstext}.</p>
			  <div class="features-option4_border"></div>
			</div>
		  </div> 
		</div>        
	  </div>
	</div>
	<div class="title_box5">Our Products</div>
	<div class="features-option2 features-option3">
	  <div class="container">
		<div class="top">
		  <h2>{$LANG.homeourproducts}</h2>
		  <p>{$LANG.homeourproductstext}.</p>
		</div>
		<div class="clearfix"></div>
		<div class="row">
		  <div class="col-sm-4">
			<div class="features-col active"> 
			  <div class="img-box">
				<img class="" src="{$WEB_ROOT}/templates/{$template}/images/{$layoutStyle}/icon-a1.svg" alt="cloud server"></div>
				<h3>{$LANG.homevpshosting}</h3>
				<p>{$LANG.homevpshostingtext}. </p>
			  
			</div>
		  </div>
		  <div class="col-sm-4">
			<div class="features-col">
			  <div class="img-box">
				<img class="" src="{$WEB_ROOT}/templates/{$template}/images/{$layoutStyle}/icon-a2.svg" alt="server"></div>
				<h3>{$LANG.homevirtualserver}</h3>
				<p>{$LANG.homevirtualservertext}</p>
			  
			</div>
		  </div>
		  <div class="col-sm-4">
			<div class="features-col">
			  <div class="img-box">
				<img class=" box-svg" src="{$WEB_ROOT}/templates/{$template}/images/{$layoutStyle}/icon-a3.svg" alt="cloud server"></div>
				<h3>{$LANG.headerwebhosting}</h3>
				<p>{$LANG.homewebhostcert}.</p>
			  
			</div>
		  </div>
		  <div class="col-sm-4">
			<div class="features-col">
			  <div class="img-box">
				<img class="" src="{$WEB_ROOT}/templates/{$template}/images/{$layoutStyle}/icon-a4.svg" alt="database"></div>
				<h3>{$LANG.homesharehost}</h3>
				<p>{$LANG.homesharehosttext}</p>
			  
			</div>
		  </div>
		  <div class="col-sm-4">
			<div class="features-col">
			  <div class="img-box">
				<img class=" raid" src="{$WEB_ROOT}/templates/{$template}/images/{$layoutStyle}/icon-a5.svg" alt="wordpress logo"></div>
				<h3>{$LANG.homewordpresshosting}</h3>
				<p>{$LANG.homewordpresshostingtext}. </p>
			  
			</div>
		  </div>
		  <div class="col-sm-4">
			<div class="features-col">
			  <div class="img-box">
				<img class="" src="{$WEB_ROOT}/templates/{$template}/images/{$layoutStyle}/icon-a6.svg" alt="cloud icon"></div>
				<h3>{$LANG.homecloudhosting}</h3>
				<p>{$LANG.homecloudhostingtext}.</p>
			</div>
		  </div>  
		</div>
	  </div>
	</div>
	<div class="title_box5">Security Optimizations & 500 Gbps+ DDoS Protection</div>
	<div class="custom-block-1">
	  <div class="container">
		<div class="row">
		  <div class="col-md-4">
		  <div class="block-box"> 
		  <div class="img-blc"><img src="{$WEB_ROOT}/templates/{$template}/images/{$layoutStyle}/blc-icon1.svg" alt="ddos icon"></div>
		  <div class="block-box-cont">
			<h3>Security Optimizations & 500 Gbps+ DDoS Protection</h3>
			<p>Our servers and infrastructure are by default protected against denial of service attacks (DDoS). </p>
		  </div>
		  </div>
		  </div>
		   <div class="col-md-4">
		  <div class="block-box"> 
		  <div class="img-blc"><img src="{$WEB_ROOT}/templates/{$template}/images/{$layoutStyle}/blc-icon2.svg" alt="server backup"></div>
		  <div class="block-box-cont">
			<h3>Free Data Backup</h3>
			<p>Our servers and infrastructure are by default protected against denial of service attacks (DDoS). </p>
		  </div>
		  </div>
		  </div>
		   <div class="col-md-4">
		  <div class="block-box"> 
		  <div class="img-blc"><img src="{$WEB_ROOT}/templates/{$template}/images/{$layoutStyle}/blc-icon3.svg" alt="ddos icon"></div>
		  <div class="block-box-cont">
			<h3>Web Hosting Choices Suits</h3>
			<p>Our servers and infrastructure are by default protected against denial of service attacks (DDoS). </p>
		  </div>
		  </div>
		  </div>
		</div>
	  </div>
	</div>
	<div class="title_box5">Available Operating System</div>
	<div class="features-option2">
		<div class="choose_section tabing-sec"> 
				<ul class="nav tab" role="tablist">
				  <li><a class="nav-link active" data-toggle="tab" href="#tab1"><img class="svg" src="{$WEB_ROOT}/templates/{$template}/images/icon007.svg" alt="svg icon">{$LANG.dedicatedmonitroing}</a></li>
				  <li><a class="nav-link" data-toggle="tab" href="#tab2"><img class="svg" src="{$WEB_ROOT}/templates/{$template}/images/icon008.svg" alt="svg icon"> {$LANG.dedicatedddosprotect}</a></li>
				  <li><a class="nav-link" data-toggle="tab" href="#tab3"><img class="svg" src="{$WEB_ROOT}/templates/{$template}/images/icon009.svg" alt="svg icon"> {$LANG.dedicatedlicence}</a></li>   
				</ul>
				<div class="tab-content">
					<div role="tabpanel" class="tab-pane fade in active" id="tab1">
						<div class="cloud_hosting">
						  <div class="container">
							<div class="cloud_hosting_in">
							<div class="row">
							  <div class="col-sm-6">
								<div class="left">
								  <h2>{$LANG.dedicatetabcontent}</h2>
								  <p>{$LANG.dedicatetabcontentsimplicity}</p>
								  <div class="hosting_list">
								  <ul>
									<li>{$LANG.cpaneldualprocess}</li>
									<li>24GB {$LANG.cpanelram}</li>
									<li>24x7x365 {$LANG.cpanelSupport}</li>
									<li>250GB {$LANG.cpanelraidos}</li>
									<li>1TB {$LANG.cpanelcacheddrive}</li>
									<li>{$LANG.cpanelapache} 2.2x</li>
									<li>{$LANG.cpanelphpversion}</li>
									<li>{$LANG.cpanelfreednsmanage}</li>
								  </ul>
								  <ul>
									<li>{$LANG.cpanelmysql} 5</li>
									<li>{$LANG.cpanelrubyrail}</li>
									<li>{$LANG.cpanelantiprotect}</li>
									<li>{$LANG.cpanelsecureftp}</li>
									<li>{$LANG.cpanelleechprotect}</li>
									<li>{$LANG.cpanelphpmyadmin}</li>
									<li>{$LANG.cpanelemailaddress}</li>
									<li>{$LANG.cpanelvarnishcach}</li>
								  </ul>
								</div>
								</div>
							  </div>
							  <div class="col-sm-6">
								<div class="right">
								  <div class="row">  
									<div class="col-sm-6">
								  <div class="hosting_box" style="background-image: url({$WEB_ROOT}/templates/{$template}/images/img001.png);">
									<img src="{$WEB_ROOT}/templates/{$template}/images/icon011.svg" alt="clock image">
									<h2>{$LANG.cpanelreliablepower} </h2>
									<p>{$LANG.cpaneluninterrup}</p>
								  </div>
								  <div class="hosting_box mt-3" style="background-image: url({$WEB_ROOT}/templates/{$template}/images/img002.png);">
									<img src="{$WEB_ROOT}/templates/{$template}/images/icon012.svg" alt="lock settings">
									<h2>{$LANG.cpanelnetworksecurity}</h2>
									<p>{$LANG.cpanelmustability}</p>
								  </div>
								</div>
								<div class="col-sm-6 justify-content-center d-flex pl-0">
								  <div class="hosting_box" style="background-image: url({$WEB_ROOT}/templates/{$template}/images/img003.png);"> 
									<img src="{$WEB_ROOT}/templates/{$template}/images/icon013.svg" alt="safe and secure"> 
									<h2>{$LANG.cpanelhvacprotection}</h2>
									<p>{$LANG.cpanelresilience}</p>
								  </div>
								</div>
								  </div>
								</div>
							  </div>
							</div></div>
						  </div>
						</div>
					</div>
				  <div role="tabpanel" class="tab-pane fade" id="tab2">
					  <div class="clearfix"></div>
					  <div class="certificate">
						<div class="container">
						  <div class="row">
							<div class="col-sm-5">
							  <div class="left text-right">
								<img src="{$WEB_ROOT}/templates/{$template}/images/AntiddosShe2.png" alt="firewall network">
							  </div>
							</div>
							<div class="col-sm-7">
							  <div class="right">
								<h4>{$LANG.dedicatetabcontentantiddosc}</h4>
								<h2>{$LANG.dedicatetabcontentantiddoshead}!</h2>
								<p>{$LANG.dedicatetabcontentantiddos}.</p>
								
								<p>{$LANG.antiddosprotection}.</p>
								<a href="#" class="button03">{$LANG.cpanelgetout}</a>
							  </div>
							</div>
						  </div>
						</div>
					  </div> 
				  </div>
				  <div role="tabpanel" class="tab-pane fade" id="tab3">
						<div class="operating-system">
						  <div class="container">
							<div class="left">
							  <h2>{$LANG.dedicatedos}</h2>
							  <p>{$LANG.dedicatedostext}</p>
							</div>
							<div class="clearfix"></div>
							<div class="operating-table">
							  <table>
								<tr>
								  <td></td>
								  <td><img src="{$WEB_ROOT}/templates/{$template}/images/system_icon1.png" alt="centos"> <span>{$LANG.dedicatedcentos}</span></td>
								  <td><img src="{$WEB_ROOT}/templates/{$template}/images/system_icon2.png" alt="operating system"> <span>{$LANG.dedicatedubuntu}</span></td>
								  <td><img src="{$WEB_ROOT}/templates/{$template}/images/system_icon3.png" alt="operating system"> <span>{$LANG.dedicatedcloudlinux}</span></td>
								  <td><img src="{$WEB_ROOT}/templates/{$template}/images/system_icon4.png" alt="operating system"> <span>{$LANG.dedicatedfedora}</span></td>
								  <td><img src="{$WEB_ROOT}/templates/{$template}/images/system_icon5.png" alt="system icon"> <span>{$LANG.dedicateddebian}</span></td>
								  <td><img src="{$WEB_ROOT}/templates/{$template}/images/system_icon6.png" alt="cpanel"> <span>{$LANG.dedicatedcpanel}</span></td>
								  <td><img src="{$WEB_ROOT}/templates/{$template}/images/system_icon7.png" alt="network"> <span>{$LANG.dedicatedplesk}</span></td>
								  <td><img src="{$WEB_ROOT}/templates/{$template}/images/system_icon8.png" alt="windows icon"> <span>{$LANG.dedicatedwindows}</span></td> 
								</tr>
								<tr>
								  <td>{$LANG.dedicatedpricing}</td>
								  <td>{$LANG.dedicatedfree}</td>
								  <td>{$LANG.dedicatedfree}</td>
								  <td>{$LANG.dedicatedfree}</td>
								  <td>{$LANG.dedicatedfree}</td>
								  <td>{$hxselectedcurrency.prefix}35/{$LANG.homemonth}</td>
								  <td>{$LANG.dedicatedfree}</td>
								  <td>{$hxselectedcurrency.prefix}35/{$LANG.homemonth}</td>
								  <td></td>
								   
								</tr>
								<tr>
								  <td></td>
								  <td></td>
								  <td></td>
								  <td></td>
								  <td></td>
								  <td></td>
								  <td>{$LANG.dedicatedwebpro} {$hxselectedcurrency.prefix}2</td>
								  <td></td>
								  <td></td>
								</tr>
								<tr>
								  <td></td>
								  <td></td>
								  <td></td>
								  <td></td>
								  <td></td>
								  <td></td>
								  <td>{$LANG.dedicatedwebpro} {$hxselectedcurrency.prefix}10</td>
								  <td></td>
								  <td></td>
								</tr>
								<tr>
								  <td></td>
								  <td></td>
								  <td></td>
								  <td></td>
								  <td></td>
								  <td></td>
								  <td>{$LANG.dedicatedwebpro} {$hxselectedcurrency.prefix}2</td>
								  <td></td>
								  <td></td>
								</tr>
							  </table>
							</div>
						  </div>
						</div>
				  </div>
				</div>
		</div>
	</div>
	<div class="title_box5">Domain Services</div>
	<div class="custom-block-9">
	  <div class="container">
		<div class="b-9-title">
		  <h2>Domain Services</h2>
		</div>
		<div class="row">
		  <div class="col-md-6">
			<div class="b-9-box">
			<h3><i class="fa fa-envelope" aria-hidden="true"></i> Free Email Accounts</h3>
			<p>You can send and receive emails with your personalized email account. Plus, you can take advantage of FREE fraud, spam, and virus protection.</p>
			</div>
		  </div>
		   <div class="col-md-6">
			<div class="b-9-box">
			<h3><i class="fa fa-cogs" aria-hidden="true"></i> DNS Management</h3>
			<p>The service offers the fastest response time, unparalleled redundancy, and advanced security. Manage your DNS records, website location, email, sub-domains, aliases & FTP.</p>
			</div>
		  </div>
		  <div class="col-md-6">
			<div class="b-9-box">
			<h3><i class="fa fa-globe" aria-hidden="true"></i> Domain Forwarding</h3>
			<p>Employ the services to forward your domain to any URL you select. We offer three services: direct domain forwarding, mask forwarding, and IP forwarding.</p>
			</div>
		  </div>
		  <div class="col-md-6">
			<div class="b-9-box">
			<h3><i class="fa fa-sign-in" aria-hidden="true"></i> Domain Lock</h3>
			<p>When you have selected your domain, protect it by locking while preventing unauthorized transfers. This domain lock service will save your credentials and keep them secure.</p>
			</div>
		  </div>
		</div>
		</div>
	</div>
	<div class="title_box5">Technical Specifications</div>
	<div class="technical-specifications">
	  <h2>{$LANG.vpstechnicalspeci}</h2>
	  <div class="container">
		<div class="row">
		  <div class="col-sm-6">
			<div class="cols">
			  <span><img src="{$WEB_ROOT}/templates/{$template}/images/icon-b1.png" alt="safe and secure"></span>
			  <h3>{$LANG.vpsguaranteeresour}</h3>
			  <p>{$LANG.vpsguaranteeresourtext}.</p>
			</div>
		  </div>
		  <div class="col-sm-6">
			<div class="cols">
			  <span><img src="{$WEB_ROOT}/templates/{$template}/images/Secure-Environment.png" alt="lock"></span>
			  <h3>{$LANG.vpssecureenvironment}</h3>
			  <p>{$LANG.vpssecureenvironmenttext}</p>
			</div>
		  </div>
		  <div class="col-sm-6">
			<div class="cols">
			  <span><img src="{$WEB_ROOT}/templates/{$template}/images/key.png" alt="key icon"></span>
			  <h3>{$LANG.vpsedgeserverhard}</h3>
			  <p>{$LANG.vpsedgeserverhardtext}</p>
			</div>
		  </div>
		  <div class="col-sm-6">
			<div class="cols">
			  <span><img src="{$WEB_ROOT}/templates/{$template}/images/network.png" alt="network"></span>
			  <h3>{$LANG.vpstopnetwork}</h3> 
			  <p>{$LANG.vpstopnetworktext}</p>
			</div>
		  </div>
		</div>
	  </div>
	</div>
	<div class="title_box5">Dedicated Server Slider</div>
	<div class="dedicated-server">
	  <div class="container">
		<div id="owl-demo1">  
		  <div class="item">
			<img src="{$WEB_ROOT}/templates/{$template}/images/server-img.png" alt="vps panel">
			<h2>{$LANG.dedicateserver}</h2>
			<p>{$LANG.dedicateservertext}</p>
			<div class="clearfix"></div>
			<div class="dedicated_box">
			  <div class="dedicated_box_col">
				<div class="gol"></div>
			  </div>
			  <div class="dedicated_box_col">
				<h5>{$LANG.dedicateserv}</h5>
				<h6>{$LANG.dedicatedintel}</span></h6>
				<h6>8 GB  <span>{$LANG.dedicatedram}</span></h6>
			  </div>
			  <div class="dedicated_box_col">
				<h6>2X2 TB <span>{$LANG.dedicatedraid} 0/1</span></h6>
				<h6>1000/1000 <span>{$LANG.dedicatedmbit}</span></h6>
			  </div>
			  <div class="dedicated_box_col">
				<h6>499 Kr <span>/{$LANG.homemonth}</span></h6>
				<a href="#" class="button02">{$LANG.dedicatedgstart}</a>
			  </div>
			</div>
			<div class="packages">{$LANG.dedicatedpackage} <a href="#">{$LANG.dedicatedpackage2}</a></div>
		  </div>
		  
		  <div class="item">
			<img src="{$WEB_ROOT}/templates/{$template}/images/server-img.png" alt="vps panel">
			<h2>{$LANG.dedicateserver}</h2>
			<p>{$LANG.dedicateservertext}</p>
			<div class="clearfix"></div>
			<div class="dedicated_box">
			  <div class="dedicated_box_col">
				<div class="gol"></div>
			  </div>
			  <div class="dedicated_box_col">
				<h5>{$LANG.dedicateserv}</h5>
				<h6>{$LANG.dedicatedintel}</span></h6>
				<h6>8 GB  <span>{$LANG.dedicatedram}</span></h6>
			  </div>
			  <div class="dedicated_box_col">
				<h6>2X2 TB <span>{$LANG.dedicatedraid} 0/1</span></h6>
				<h6>1000/1000 <span>{$LANG.dedicatedmbit}</span></h6>
			  </div>
			  <div class="dedicated_box_col">
				<h6>499 Kr <span>/{$LANG.homemonth}</span></h6>
				<a href="#" class="button02">{$LANG.dedicatedgstart}</a>
			  </div>
			</div>
			<div class="packages">{$LANG.dedicatedpackage} <a href="#">{$LANG.dedicatedpackage2}</a></div>
		  </div>
		  
		</div>
	  </div>
	</div>	
	<div class="title_box5">Why Choose VPS Hosting?</div>
	<div class="vps-hosting">
	  <div class="container">
		<h2>{$LANG.vpschoosehosting}?</h2>
			<div class="vps-hosting-list"> 
				<div class="row">      
					<div class="col-sm-3 left">
					  <img class="img-responsive" src="{$WEB_ROOT}/templates/{$template}/images/icon_b1.png" alt="server">
					</div>
					<div class="col-sm-8 right">  
					  <h2>{$LANG.vpsfullaccess}</h2>
					  <p>{$LANG.vpsfullaccesstext}</p> 
					</div>
				  </div>
			</div>
			<div class="vps-hosting-list"> 
			  <div class="row">      
				<div class="col-sm-3 left">
				  <img class="img-responsive" src="{$WEB_ROOT}/templates/{$template}/images/icon_b2.png" alt="computer image">
				</div>
				<div class="col-sm-8 right">  
				  <h2>{$LANG.vpsintegratedcpanel}</h2> 
				  <p>{$LANG.vpsintegratedcpaneltext}</p> 
				  <p>{$LANG.vpsintegratedcpaneltext2}.</p> 
				</div>
			  </div>
			</div>
			<div class="vps-hosting-list"> 
			  <div class="row">
				  <div class="col-sm-3 left">
					<img class="img-responsive" src="{$WEB_ROOT}/templates/{$template}/images/icon_b3.png" alt="vps globe">
				  </div>
				  <div class="col-sm-8 right">  
					<h2>{$LANG.vpsinstantprovision}</h2>  
					<p>{$LANG.vpsinstantprovisiontext}.</p> 
					<p>{$LANG.vpsinstantprovisiontext2}.</p> 
				  </div>
			  </div>
			</div>
	  </div>
	</div>
	<div class="title_box5">Why choose us? (Dedicated)</div>
	<div class="why-choose">
	  <div class="container">
		<div class="top"> 
		  <h2>{$LANG.dedicatedwhychoose}</h2> 
		  <p>{$LANG.dedicatedwhychoosetext}</p>
		</div>
		<div class="clearfix"></div>
		<div class="row">
		  <div class="col-sm-3">
			<div class="choose-col">
			  <img src="{$WEB_ROOT}/templates/{$template}/images/choose_icon1.png" class="svg" alt="maze icon">
			  <h2>{$LANG.dedicatedsolutions}</h2>
			  <p>{$LANG.dedicatedsolutionstext}</p> 
			</div>
		  </div>
		  <div class="col-sm-3">
			<div class="choose-col">
			  <img src="{$WEB_ROOT}/templates/{$template}/images/choose_icon2.png" class="svg" alt="rocket speed icon">
			  <h2>{$LANG.dedicatedspeed}</h2>
			  <p>{$LANG.dedicatedspeedtext}</p>
			</div>
		  </div>
		  <div class="col-sm-3">
			<div class="choose-col">
			  <img src="{$WEB_ROOT}/templates/{$template}/images/choose_icon3.png" class="svg" alt="user image">
			  <h2>{$LANG.dedicatedsupport}</h2>
			  <p>{$LANG.dedicatedsupporttext} </p>
			</div>
		  </div>
		  <div class="col-sm-3">
			<div class="choose-col">
			  <img src="{$WEB_ROOT}/templates/{$template}/images/choose_icon4.png" class="svg" alt="gurantee">
			  <h2>{$LANG.dedicateduptime}</h2>
			  <p>{$LANG.dedicateduptimetext}</p>
			</div>
		  </div>
		</div>
	  </div>
	</div>
	<div class="title_box5">SSL Certification</div>
	<div class="about-why-choose-us ssl-certification">
			<div class="container">
			  <div class="row choose-us-row">
				<div class="col-sm-12">
				  <h2>{$LANG.sslPageEasyStepHead}</h2>
				  <p>{$LANG.sslPageEasyStepHeadP}</p>
				</div>
			  </div>
			  <div class="row choose-us-row-two">
				<div class="col-sm-3">
				   <div class="why-choose-inner-abt border-light-blue">
					<span>{$LANG.sslPageEasyStepBox1Span}</span>
					<img src="{$WEB_ROOT}/templates/{$template}/images/ssl-icon-1.png" alt="ssl icon">
					 <h5>{$LANG.sslPageEasyStepBox1H5}</h5>
					 <p>{$LANG.sslPageEasyStepBox1P}</p>
				   </div>
				</div>
				<div class="col-sm-3">
				   <div class="why-choose-inner-abt  border-yellow">
					<span>{$LANG.sslPageEasyStepBox2Span}</span>
					<img src="{$WEB_ROOT}/templates/{$template}/images/ssl-icon-2.png" alt="point click">
					 <h5>{$LANG.sslPageEasyStepBox2H5}</h5>
					 <p>{$LANG.sslPageEasyStepBox2P}</p>
				   </div>
				</div>
				<div class="col-sm-3">
				   <div class="why-choose-inner-abt  border-light-yellow">
					<span>{$LANG.sslPageEasyStepBox3Span}</span>
					<img src="{$WEB_ROOT}/templates/{$template}/images/ssl-icon-3.png" alt="code icon">
					 <h5>{$LANG.sslPageEasyStepBox3H5}</h5>
					 <p>{$LANG.sslPageEasyStepBox3P}</p>
				   </div>
				</div>
				<div class="col-sm-3">
				   <div class="why-choose-inner-abt sky-blue-border">
					<span>{$LANG.sslPageEasyStepBox4Span}</span>
					<img src="{$WEB_ROOT}/templates/{$template}/images/ssl-icon-4.png" alt="ssl icon">
					 <h5>{$LANG.sslPageEasyStepBox4H5}</h5>
					 <p>{$LANG.sslPageEasyStepBox4P}</p>
				   </div>
				</div>
			  </div>
		   </div>
	</div>	
	<div class="title_box5">Three Simple Steps</div>
	<div class="simple-steps">
		<h2>{$LANG.domainsimplesteps}</h2>
		<div class="container">
		  <div class="row">
			<div class="col-sm-4">
			  <div class="simple-col">
				<img src="{$WEB_ROOT}/templates/{$template}/images/icon-01.png" alt="www icon">  
				<h3>{$LANG.domainchoosename}</h3>
				<p>{$LANG.domainchoosenametext}</p>
			  </div>
			</div>
			<div class="col-sm-4">
			  <div class="simple-col">
				<img src="{$WEB_ROOT}/templates/{$template}/images/icon-02.png" alt="notepad pen">  
				<h3>{$LANG.domainselecthostplan}</h3>
				<p>{$LANG.domainselecthostplantext}</p>
			  </div>
			</div>
			<div class="col-sm-4">
			  <div class="simple-col">
				<img src="{$WEB_ROOT}/templates/{$template}/images/icon-03.png" alt="settings icon">   
				<h3>{$LANG.domainsetupwebsite}</h3> 
				<p>{$LANG.domainsetupwebsitetext}</p>
			  </div>
			</div>
		  </div>
		</div>
	</div>
	</div>
	<div id="PricingElement" class="allElement hidden">
		<div class="title_box5">Pricing Table 1</div>
		<div class="pricing_section">
			<div class="container">
			<div class="tab-content">
			  <div class="tab-pane container active" id="pricing">
				  <div class="price_top">
					  <h2>{$LANG.cpanelwhychoosehd}</h2>
					  <p>{$LANG.cpanelwhychoosetext}</p>
					 <ul class="months-ul" id="changeBillingCycle">
						<li><a href="javascript:;" class="active" onclick="toggleBillingTabsVps(this,'monthly');">{$LANG.orderpaymenttermmonthly}</a></li>
						<li><a href="javascript:;" onclick="toggleBillingTabsVps(this,'quarterly');">{$LANG.orderpaymenttermquarterly}</a></li>
						<li><a href="javascript:;" onclick="toggleBillingTabsVps(this,'semiannually');">{$LANG.orderpaymenttermsemiannually}</a></li>
						<li><a href="javascript:;" onclick="toggleBillingTabsVps(this,'annually');">{$LANG.orderpaymenttermannually}</a></li>
						<li><a href="javascript:;" onclick="toggleBillingTabsVps(this,'biennially');">{$LANG.orderpaymenttermbiennially}</a></li>
						<li><a href="javascript:;" onclick="toggleBillingTabsVps(this,'triennially');">{$LANG.orderpaymenttermtriennially}</a></li>
					</ul>
				  </div>
				  <div class="price_group">
					<div id="productList">
						<div class="price_sect">            
						  <h2>text product 1</h2>
						  <p>The perfect starting point for growing an online presence.</p>
							<h5 class="blpr monthly" style="display: block;"><strong>$10.00 </strong><span>Monthly</span></h5>
							<h5 class="blpr quarterly"><strong>$20.00</strong> <span>Quarterly</span></h5>
							<h5 class="blpr semiannually"><strong>$30.00</strong> <span>Semi-Annually</span></h5>
							<h5 class="blpr annually"><strong>$40.00</strong> <span>Annually</span></h5>
							<h5 class="blpr biennially"><strong>$50.00</strong> <span>Biennially</span></h5>
							<h5 class="blpr triennially"><strong>$60.00</strong> <span>Triennially</span></h5>
							<ul class="list"><li>Starts with <b>1</b> site</li><li><b>3</b> environments/site</li><li><b>25K</b> visits/month</li><li><b>50GB</b> bandwidth</li><li><b>CDN &amp; SSl</b> included</li><li><b>Migrations</b> free</li><li><b>Page Performance</b> free</li><li>Powerful <b>tools</b> available</li></ul>
						  <div class="bottom_sect">
							<h4>Risk-free for 90 days.</h4>
							<p>Get 2 months free with <br>  annual prepay.</p>
							<a href="cart.php?a=add&amp;pid=1&amp;billingcycle=monthly" class="button03 blpr monthly" style="display: block;">ORDER NOW</a>  
							<a href="#" class="button03 blpr quarterly">ORDER NOW</a>  
							<a href="#" class="button03 blpr semiannually">ORDER NOW</a>  
							<a href="#" class="button03 blpr annually">ORDER NOW</a>
							<a href="#" class="button03 blpr biennially">ORDER NOW</a>
							<a href="#" class="button03 blpr triennially">ORDER NOW</a> 
						  </div>
						</div>
						<div class="price_sect">            
						  <h2>text product 2</h2>
						  <p>The perfect starting point for growing an online presence.</p>
							<h5 class="blpr monthly" style="display: block;"><strong>$10.00 </strong><span>Monthly</span></h5>
							<h5 class="blpr quarterly"><strong>$20.00</strong> <span>Quarterly</span></h5>
							<h5 class="blpr semiannually"><strong>$30.00</strong> <span>Semi-Annually</span></h5>
							<h5 class="blpr annually"><strong>$40.00</strong> <span>Annually</span></h5>
							<h5 class="blpr biennially"><strong>$50.00</strong> <span>Biennially</span></h5>
							<h5 class="blpr triennially"><strong>$60.00</strong> <span>Triennially</span></h5>
							<ul class="list"><li>Starts with <b>1</b> site</li><li><b>3</b> environments/site</li><li><b>25K</b> visits/month</li><li><b>50GB</b> bandwidth</li><li><b>CDN &amp; SSl</b> included</li><li><b>Migrations</b> free</li><li><b>Page Performance</b> free</li><li>Powerful <b>tools</b> available</li></ul>
						  <div class="bottom_sect">
							<h4>Risk-free for 90 days.</h4>
							<p>Get 2 months free with <br>  annual prepay.</p>
							<a href="cart.php?a=add&amp;pid=1&amp;billingcycle=monthly" class="button03 blpr monthly" style="display: block;">ORDER NOW</a>  
							<a href="#" class="button03 blpr quarterly">ORDER NOW</a>  
							<a href="#" class="button03 blpr semiannually">ORDER NOW</a>  
							<a href="#" class="button03 blpr annually">ORDER NOW</a>
							<a href="#" class="button03 blpr biennially">ORDER NOW</a>
							<a href="#" class="button03 blpr triennially">ORDER NOW</a> 
						  </div>
						</div>
						<div class="price_sect">            
						  <h2>text product 3</h2>
						  <p>The perfect starting point for growing an online presence.</p>
							<h5 class="blpr monthly" style="display: block;"><strong>$10.00 </strong><span>Monthly</span></h5>
							<h5 class="blpr quarterly"><strong>$20.00</strong> <span>Quarterly</span></h5>
							<h5 class="blpr semiannually"><strong>$30.00</strong> <span>Semi-Annually</span></h5>
							<h5 class="blpr annually"><strong>$40.00</strong> <span>Annually</span></h5>
							<h5 class="blpr biennially"><strong>$50.00</strong> <span>Biennially</span></h5>
							<h5 class="blpr triennially"><strong>$60.00</strong> <span>Triennially</span></h5>
							<ul class="list"><li>Starts with <b>1</b> site</li><li><b>3</b> environments/site</li><li><b>25K</b> visits/month</li><li><b>50GB</b> bandwidth</li><li><b>CDN &amp; SSl</b> included</li><li><b>Migrations</b> free</li><li><b>Page Performance</b> free</li><li>Powerful <b>tools</b> available</li></ul>
						  <div class="bottom_sect">
							<h4>Risk-free for 90 days.</h4>
							<p>Get 2 months free with <br>  annual prepay.</p>
							<a href="#" class="button03 blpr monthly" style="display: block;">ORDER NOW</a>  
							<a href="#" class="button03 blpr quarterly">ORDER NOW</a>  
							<a href="#" class="button03 blpr semiannually">ORDER NOW</a>  
							<a href="#" class="button03 blpr annually">ORDER NOW</a>
							<a href="#" class="button03 blpr biennially">ORDER NOW</a>
							<a href="#" class="button03 blpr triennially">ORDER NOW</a> 
						  </div>
						</div>
						<div class="price_sect">            
						  <h2>text product 4</h2>
						  <p>The perfect starting point for growing an online presence.</p>
							<h5 class="blpr monthly" style="display: block;"><strong>$10.00 </strong><span>Monthly</span></h5>
							<h5 class="blpr quarterly"><strong>$20.00</strong> <span>Quarterly</span></h5>
							<h5 class="blpr semiannually"><strong>$30.00</strong> <span>Semi-Annually</span></h5>
							<h5 class="blpr annually"><strong>$40.00</strong> <span>Annually</span></h5>
							<h5 class="blpr biennially"><strong>$50.00</strong> <span>Biennially</span></h5>
							<h5 class="blpr triennially"><strong>$60.00</strong> <span>Triennially</span></h5>
							<ul class="list"><li>Starts with <b>1</b> site</li><li><b>3</b> environments/site</li><li><b>25K</b> visits/month</li><li><b>50GB</b> bandwidth</li><li><b>CDN &amp; SSl</b> included</li><li><b>Migrations</b> free</li><li><b>Page Performance</b> free</li><li>Powerful <b>tools</b> available</li></ul>
						  <div class="bottom_sect">
							<h4>Risk-free for 90 days.</h4>
							<p>Get 2 months free with <br>  annual prepay.</p>
							<a href="#" class="button03 blpr monthly" style="display: block;">ORDER NOW</a>  
							<a href="#" class="button03 blpr quarterly">ORDER NOW</a>  
							<a href="#" class="button03 blpr semiannually">ORDER NOW</a>  
							<a href="#" class="button03 blpr annually">ORDER NOW</a>
							<a href="#" class="button03 blpr biennially">ORDER NOW</a>
							<a href="#" class="button03 blpr triennially">ORDER NOW</a> 
						  </div>
						</div>
					</div>
				  </div>
			  </div>
			</div>
		  </div>
		  <div class="vat_col">{$LANG.cpanelvat}</div>
		</div>
		<div class="title_box5">Home Page 1 Pricing</div>
		<div class="price_list">
		  <div class="container">
			<h2>{$companyNameWhmcs}</h2>
			<p>{$LANG.homehostxwebhosttext}</p>
			<div class="row">
			    <div class="col-sm-3">
					<div class="price_grid">
					  <h2>linux hosting</h2>
					  <div class="price_box pricehfirstbox">
						<div class="tag"><img src="{$WEB_ROOT}/templates/{$template}/images/tag.svg" class="svg" alt="tag">Starting From</div>
						<h4>$10.00</h4>
					  </div>
					  <div class="deschfirstbox">
						<ul class="price_grid_list"><li>Starts with <b>1</b> site</li><li><b>3</b> environments/site</li><li><b>25K</b> visits/month</li><li><b>50GB</b> bandwidth</li><li><b>CDN &amp; SSl</b> included</li><li><b>Migrations</b> free</li><li><b>Page Performance</b> free</li><li>Powerful <b>tools</b> available</li></ul>
					  </div>
					  <div class="footcaptionhfirstbox">
						<h6>Risk-free for 60 days.</h6>
					  </div>
					  <div class="footsorthfirstbox">
						<p>Get 2 months free with <br>  annual prepay.</p>
					  </div>
					  <a href="#" class="button03">View Plan</a> 
					</div>
			    </div>
			    <div class="col-sm-3">
					<div class="price_grid">
					  <h2>linux hosting</h2>
					  <div class="price_box pricehfirstbox">
						<div class="tag"><img src="{$WEB_ROOT}/templates/{$template}/images/tag.svg" class="svg" alt="tag">Starting From</div>
						<h4>$10.00</h4>
					  </div>
					  <div class="deschfirstbox">
						<ul class="price_grid_list"><li>Starts with <b>1</b> site</li><li><b>3</b> environments/site</li><li><b>25K</b> visits/month</li><li><b>50GB</b> bandwidth</li><li><b>CDN &amp; SSl</b> included</li><li><b>Migrations</b> free</li><li><b>Page Performance</b> free</li><li>Powerful <b>tools</b> available</li></ul>
					  </div>
					  <div class="footcaptionhfirstbox">
						<h6>Risk-free for 60 days.</h6>
					  </div>
					  <div class="footsorthfirstbox">
						<p>Get 2 months free with <br>  annual prepay.</p>
					  </div>
					  <a href="#" class="button03">View Plan</a> 
					</div>
			    </div>
			    <div class="col-sm-3">
					<div class="price_grid">
					  <h2>linux hosting</h2>
					  <div class="price_box pricehfirstbox">
						<div class="tag"><img src="{$WEB_ROOT}/templates/{$template}/images/tag.svg" class="svg" alt="tag">Starting From</div>
						<h4>$10.00</h4>
					  </div>
					  <div class="deschfirstbox">
						<ul class="price_grid_list"><li>Starts with <b>1</b> site</li><li><b>3</b> environments/site</li><li><b>25K</b> visits/month</li><li><b>50GB</b> bandwidth</li><li><b>CDN &amp; SSl</b> included</li><li><b>Migrations</b> free</li><li><b>Page Performance</b> free</li><li>Powerful <b>tools</b> available</li></ul>
					  </div>
					  <div class="footcaptionhfirstbox">
						<h6>Risk-free for 60 days.</h6>
					  </div>
					  <div class="footsorthfirstbox">
						<p>Get 2 months free with <br>  annual prepay.</p>
					  </div>
					  <a href="#" class="button03">View Plan</a> 
					</div>
			    </div>
			    <div class="col-sm-3">
					<div class="price_grid">
					  <h2>linux hosting</h2>
					  <div class="price_box pricehfirstbox">
						<div class="tag custom_paln"><img src="{$WEB_ROOT}/templates/{$template}/images/tag.svg" class="svg" alt="tag">Starting From</div>
						<h4>$10.00</h4>
					  </div>
					  <div class="deschfirstbox">
						<ul class="price_grid_list"><li>Starts with <b>1</b> site</li><li><b>3</b> environments/site</li><li><b>25K</b> visits/month</li><li><b>50GB</b> bandwidth</li><li><b>CDN &amp; SSl</b> included</li><li><b>Migrations</b> free</li><li><b>Page Performance</b> free</li><li>Powerful <b>tools</b> available</li></ul>
					  </div>
					  <div class="footcaptionhfirstbox">
						<h6>Call +1(929)8002575</h6>
					  </div>
					  <div class="footsorthfirstbox">
						<p>to talk to a sales specialist.</p>
					  </div>
					  <a href="#" class="button03">View Plan</a> 
					</div>
			    </div>
			  </div>      
			</div>
		</div> 	
		<div class="title_box5">Pricing Table V2</div>
		<div class="new-hx-tabs">
			<div class="container">
			  <div class="row hx-tab-inner">
				<div class="col-12">
				  <div class="row">
					<div class="col-md-3 tab-leftwidth">
					  <div class="nav flex-column nav-pills" id="v-pills-tab" role="tablist" aria-orientation="vertical">
						{if $domainSectionAllowed}
							<a class="nav-link-new active" id="v-pills-home-tab" data-toggle="pill" href="#v-pills-home" role="tab"
							  aria-controls="v-pills-home" aria-selected="true">
							  <span><img src="{$WEB_ROOT}/templates/{$template}/caticons/hx_blueicon1.svg" alt=""></span>{$LANG.buyadomain}
							</a>
						{/if}
						{if $productDataNewBlock}
							{$turns = 0}
							{foreach from=$productDataNewBlock item=newBlkData}
								<a class="nav-link-new {if !$domainSectionAllowed && $turns eq '0'}active{/if}" data-toggle="pill" id="v-pills-group-content-tab{$newBlkData.groupId}" href="#v-pills-group-content{$newBlkData.groupId}" role="tab" aria-controls="v-pills-group-content{$newBlkData.groupId}" aria-selected="false">
								  <span><img src="{$WEB_ROOT}/templates/{$template}/caticons/{$newBlkData.groupIcon}" alt="{$newBlkData.groupIcon}"></span>
								  {$newBlkData.groupName}
								</a>
								{$turns = $turns+1}
							{/foreach}
						{/if}
					  </div>
					</div>
					<div class="col-md-9 tab-rightwidth">
					  <div class="tab-content" id="v-pills-tabContent">
						{if $domainSectionAllowed}
							<div class="tab-pane fade active in" id="v-pills-home" role="tabpanel"
							  aria-labelledby="v-pills-home-tab">
							  <div class="hx-table-content">
								{if $captchaEnabledDomainHostx eq 'yes'}
									<div class="hx-tablesearchbar">
										<form method="post" action="domainchecker.php">
										<input type="hidden" name="register">
										<div class="input-group">
										  <div class="input-group-prepend pr-0">
											<span class="input-group-text bg-transparent border-right-0 pr-0 pl-4" id="basic-addon1">{$LANG.orderForm.www}</span>
										  </div>
										  <input type="text" class="form-control border-0" name="sld" id="domainnameAjax" placeholder="{$LANG.domainBlockPlaceHolder}">
										  <div class="input-group-append">
											{if !empty($domaintldextensions)}
												<select class="form-control hx_customdropdown" name="tld" id="tldDropdownBlock">
												{foreach from=$domaintldextensions item=tldextensionData}
													<option value="{$tldextensionData}">{$tldextensionData}</option>
												{/foreach}
												</select>
											{/if}
											<button class="btn btn-secondary" type="submit">
											  <i class="fa fa-search mr-2"></i>{$LANG.domainsearch}
											</button>
										  </div>
										</div>
										</form>
									</div>
								{else}
									<div class="hx-tablesearchbar">
										<div class="input-group">
										  <div class="input-group-prepend pr-0">
											<span class="input-group-text bg-transparent border-right-0 pr-0 pl-4" id="basic-addon1">{$LANG.orderForm.www}</span>
										  </div>
										  <input type="text" class="form-control border-0" name="sld" id="domainnameAjax" placeholder="{$LANG.domainBlockPlaceHolder}">
										  <div class="input-group-append">
											{if !empty($domaintldextensions)}
												<select class="form-control hx_customdropdown" id="tldDropdownBlock">
												{foreach from=$domaintldextensions item=tldextensionData}
													<option value="{$tldextensionData}">{$tldextensionData}</option>
												{/foreach}
												</select>
											{/if}
											<button class="btn btn-secondary" type="button" onclick="wgsSearchdomainAjax(this);">
											  <i class="fa fa-search mr-2"></i>{$LANG.domainsearch}
											</button>
										  </div>
										</div>
									</div>
								{/if}
								<div class="hidden" id="loaderSerachBlock">
									<img src="{$WEB_ROOT}/templates/{$template}/images/loaderforblock.gif" alt="loader">
								</div>
								<div class="hidden" id="domainErrorD"></div>
								<div class="hx_domain hidden" id="domainTakenErrorDivsBlock">
									<div class="hx_domain-header">
										<h3><span><i class="fa fa-times"></i></span>{$LANG.domainreserved1} {$LANG.domainunavailable2}</h3>
									</div>
									<div class="hx_domain-body">
										<p class="unavail-msg"><span>{$LANG.domainunavailable1}</span> 
											{$LANG.orderForm.domainIsUnavailable}
										</p>
										<p>{$LANG.domainchecker.suggestiontakenmsg}</p>
									</div>
								</div>
								{if $tld_data['show_on_domain']}
								<div class="hx-tbl-data pt-4">
								  <table class="table table-striped" id="tbl-new-block-tld">
									<tbody id="domainSuggestionTable">
										{foreach from=$tld_data['show_on_domain']  item=domain_item}
											<tr>
											<td class="hx-table-extensions">.{$domain_item->tld_id}</td>
											<td class="hx-table-price"> {$domain_item->register} /{$LANG.pricingCycleShort.annually}</td>
											<td class="hx-table-noprice">{$tld_data['currency']['prefix']}{$domain_item->price}</td>
											</tr>
										{/foreach}
									</tbody>
								  </table>
								  <p><span class="hx-domain-txt cursorPointerCss" onclick="location.href='/cart.php?a=add&domain=register'">{$LANG.fullDomainPricingTxt}</span> <span class="hx-arrow"><img src="{$WEB_ROOT}/templates/{$template}/images/hx-right-arrow.svg" alt="right arrow"></span>{$LANG.promotionPriceTxt}</p>
								</div>
								{/if}
							  </div>
							  <div class="hx_supprt-sec">
								<a href="#" class="hx_hide-btn"><span class="pr-1"><img src="{$WEB_ROOT}/templates/{$template}/images/hx_hand.svg" alt="hand"></span>{$LANG.domainNoHiddenFee}
								</a>                              
								<ul class="list-inline m-0">
								  <li class="list-inline-item"><span><img src="{$WEB_ROOT}/templates/{$template}/images/hx_headphone.svg" alt="headphone"></span>{$LANG.domain24Seven}</li>
								  <li class="list-inline-item"><span><img src="{$WEB_ROOT}/templates/{$template}/images/hx_db.svg" alt="db"></span>{$LANG.domainFreeDnsHost}</li>
								  <li class="list-inline-item"><span><img src="{$WEB_ROOT}/templates/{$template}/images/hx_attchment.svg" alt="attachment"></span>{$LANG.domainFreeUrlForward} </li>
								  <li class="list-inline-item"><span><img src="{$WEB_ROOT}/templates/{$template}/images/hx-mail.svg" alt="mail"></span>{$LANG.domainFreeEmailForward}</li>
								</ul>
							  </div>
							</div>
						{/if}
						{if $productDataNewBlock}
							{$turns = 0}
							{foreach from=$productDataNewBlock item=newBlkData}
								<div class="tab-pane fade {if !$domainSectionAllowed && $turns eq '0'}active in{/if}" id="v-pills-group-content{$newBlkData.groupId}" role="tabpanel" aria-labelledby="v-pills-group-content-tab{$newBlkData.groupId}">
									<div class="hx_web-hosting-sec">
									  <div class="row hx_webhost-pdng">
										<div class="col-md-6">
										  <div class="hx_web-host-heading">
											<h3>{$newBlkData.groupHead}</h3>
											  <p>{$newBlkData.groupSubHead}</p>
										  </div>
										</div>
										<div class="col-md-6">
											{$newBlkData.groupDescp}
										</div>
									  </div>
									{if $newBlkData.productArray}
										<div class="row hx_webhosting_plans">
											{foreach from=$newBlkData.productArray item=productArrayData}
												<div class="col-md-4 hx_brd-r">
												  <div class="hx_plans">
												  <div class="hx_wb-hostplans">
													<h3>{$productArrayData['name']}</h3>
													<div class="hx_wb-hostprice">
														<div class="txt value">{$productArrayData['price']}</div>
														{if $productArrayData['cycle'] neq ''}
															<div class="txt period">/{$productArrayData['cycle']}</div>
															<div class="txt currency">{$tld_data['currency']['suffix']}</div>
														{/if}
													  </div>  
												  </div>
												  <div class="hx_description">
													{$productArrayData['description']}
												  </div>
												  <div class="hx_buybtn">
													{if $productArrayData['domainOption'] eq '1'}
														<a onclick="wgsAddHomePageProduct(this,'{$productArrayData['pid']}');" class="cursorPointerCss">{$LANG.ordernowbutton}</a>
													{else}
													<a href="{$WEB_ROOT}/cart.php?a=add&pid={$productArrayData['pid']}">{$LANG.ordernowbutton}</a>
													{/if}
												  </div>
												 </div>
												</div>
											{/foreach}
										</div>
										<div class="col-12 px-0">
										  <p class="hx_plans-find m-0"><a href="{$WEB_ROOT}/cart.php?gid={$newBlkData.groupId}">{$LANG.domainFindOutMore} <i class="fa fa-angle-right ml-2"></i></a></p>
										</div>
									{/if}
									</div>
								</div>
								{$turns = $turns+1}
							{/foreach}
						{/if}
					  </div>
					</div>
				  </div>
				</div>
			  </div>
			</div>
		</div>
		<div class="title_box5">All Services</div>
		<div class="custom-block-5">
		  <div class="container">
			<div class="row">
				
			  <div class="col-md-4">
			  <div class="block-box block-5"> 
			  <div class="img-blc"><img src="{$WEB_ROOT}/templates/{$template}/images/{$layoutStyle}/blc-5-icon1.png" alt="server icon"></div>
			  <div class="block-box-cont">
				<h3>Server Auction</h3>
				<p>Enter your required specifications, and when the moment is right, snap up your offer!</p>
			  </div>
			  <div class="block-5-btm">
			  <h4><small>Starting at </small>$19.33</h4>
			  <a href="#">Overview</a>
			  </div>
			  </div>
			  </div>

			   <div class="col-md-4">
			  <div class="block-box block-5"> 
			  <div class="img-blc"><img src="{$WEB_ROOT}/templates/{$template}/images/{$layoutStyle}/blc-5-icon2.png" alt="database"></div>
			  <div class="block-box-cont">
				<h3>Web Hosting</h3>
				<p>We give digital agencies & e-commerce businesses flexibility in how websites are hosted.</p>
			  </div>
			  <div class="block-5-btm">
			  <h4><small>Starting at </small>$19.33</h4>
			  <a href="#">Overview</a>
			  </div>
			  </div>
			  </div>
			   <div class="col-md-4">
			  <div class="block-box block-5"> 
			  <div class="img-blc"><img src="{$WEB_ROOT}/templates/{$template}/images/{$layoutStyle}/blc-5-icon3.png" alt="dedicated server"></div>
			  <div class="block-box-cont">
				<h3>Dedicated Servers</h3>
				<p>We offer dedicated servers for websites excelling in performance, security, and control.</p>
			  </div>
			  <div class="block-5-btm">
			  <h4><small>Starting at </small>$19.33</h4>
			  <a href="#">Overview</a>
			  </div>
			  </div>
			  </div>
			  <div class="col-md-4">
			  <div class="block-box block-5"> 
			  <div class="img-blc"><img src="{$WEB_ROOT}/templates/{$template}/images/{$layoutStyle}/blc-5-icon4.png" alt="cloud server icon"></div>
			  <div class="block-box-cont">
				<h3>Cloud</h3>
				<p>With cloud hosting, give your site more flexibility and power than traditional single-server hosting.</p>
			  </div>
			  <div class="block-5-btm">
			  <h4><small>Starting at </small>$19.33</h4>
			  <a href="#">Overview</a>
			  </div>
			  </div>
			  </div>
			  
			   <div class="col-md-4">
			  <div class="block-box block-5"> 
			  <div class="img-blc"><img src="{$WEB_ROOT}/templates/{$template}/images/{$layoutStyle}/blc-5-icon5.png" alt="server settings"></div>
			  <div class="block-box-cont">
				<h3>Managed Server</h3>
				<p>Manages your server infrastructure to ensure continuous service availability of mission- critical systems.</p>
			  </div>
			  <div class="block-5-btm">
			  <h4><small>Starting at </small>$19.33</h4>
			  <a href="#">Overview</a>
			  </div>
			  </div>
			  </div>
			   <div class="col-md-4">
			  <div class="block-box block-5"> 
			  <div class="img-blc"><img src="{$WEB_ROOT}/templates/{$template}/images/{$layoutStyle}/blc-5-icon6.png" alt="cloud server"></div>
			  <div class="block-box-cont">
				<h3>Colocation</h3>
				<p>Get a powerful mix of state-of-the-art facilities and global best practices in colocation services.</p>
			  </div>
			  <div class="block-5-btm">
			  <h4><small>Starting at </small>$19.33</h4>
			  <a href="#">Overview</a>
			  </div>
			  </div>
			  </div>
			</div>
		  </div>
		</div>
		<div class="title_box5">VPS Pricing Plan</div>
		<div class="custom-block-6">
		  <div class="container">
			<div class="row">
			  <div class="col-md-4">
				 <div class="vps-plan-box">
				 <div class="vps-top">
				 <h3>VPS SSD</h3>
				 <p>SLA 99.95%<br>
				 Top performance at an affordable price</p>
				 </div>
				 <div class="vps-btm">
				 <p>Annual plan starting at:</p>
				 <h2>$3.35</h2>
				 <p>/month*</p>
				 <a href="#"  class="choose-btn">Choose</a>
				 </div>
				</div>
			  </div>
			   <div class="col-md-4">
				 <div class="vps-plan-box">
				 <div class="vps-top">
				 <h3>VPS SSD</h3>
				 <p>SLA 99.95%<br>
				 Top performance at an affordable price</p>
				 </div>
				 <div class="vps-btm">
				 <p>Annual plan starting at:</p>
				 <h2>$3.35</h2>
				 <p>/month*</p>
				 <a href="#"  class="choose-btn">Choose</a>
				 </div>
				</div>
			  </div>
			   <div class="col-md-4">
				 <div class="vps-plan-box">
				 <div class="vps-top">
				 <h3>VPS SSD</h3>
				 <p>SLA 99.95%<br>
				 Top performance at an affordable price</p>
				 </div>
				 <div class="vps-btm">
				 <p>Annual plan starting at:</p>
				 <h2>$3.35</h2>
				 <p>/month*</p>
				 <a href="#" class="choose-btn">Choose</a>
				 </div>
				</div>
			  </div>
			</div>
		  </div>
		</div>		
	</div>
	<div id="TestimonialElement" class="allElement hidden">
		<div class="title_box5">Testimonials</div>
		<div class="testimonials-1">
		  <div class="container">
			  <h2>{$LANG.hometestimonials}</h2>
			  <h6>{$LANG.hometestimhead}.</h6>
				<div class="carousel slide" data-ride="carousel">
					<div class="wgsTestimonial carousel-inner">
						<div class="carousel-item testimonials_box">
						  <img src="{$WEB_ROOT}/templates/{$template}/images/user05.png" alt="user settings">
						  <h2>{$LANG.hometestimname} <span>www.website.com</span></h2>
						  <p>{$LANG.hometestimtext}.</p>
						</div>
						<div class="carousel-item testimonials_box">
						  <img src="{$WEB_ROOT}/templates/{$template}/images/user05.png" alt="user settings">
						  <h2>{$LANG.hometestimname} <span>www.website.com</span></h2>
						  <p>{$LANG.hometestimtext}.</p>
						</div>			
					</div>
				</div>
			</div>
		</div>
		<div class="title_box5">What Our Customers Have To Say?</div>
			<div class="customers">
				<div class="container">
				  <h2>{$LANG.domaincustomersay}</h2>
				  <ul id="owl-demo" class="nav nav-pills">
					<li class="item nav-item">    
					  <div class="customers_box " data-toggle="pill" href="#tabs1">  
					  <img src="{$WEB_ROOT}/templates/{$template}/images/user01.png" alt="user icon">   
					  <h2>{$LANG.domaincustomername}</h2> 
					  <p>{$LANG.domaincustomerdata}</p>
					  </div>
					</li>
					<li class="item nav-item active">    
					  <div class="customers_box" data-toggle="pill" href="#tabs2">  
					  <img src="{$WEB_ROOT}/templates/{$template}/images/user02.png" alt="user image">   
					  <h2>{$LANG.domaincustomername2}</h2> 
					  <p>{$LANG.domaincustomerdata2}</p>
					  </div>
					</li>
					<li class="item nav-item">    
					  <div class="customers_box" data-toggle="pill" href="#tabs3">  
					  <img src="{$WEB_ROOT}/templates/{$template}/images/user03.png" alt="user icon">   
					  <h2>{$LANG.domaincustomername3}</h2> 
					  <p> {$LANG.domaincustomerdata3}</p>
					  </div>
					</li>
					<li class="item nav-item">    
					  <div class="customers_box" data-toggle="pill" href="#tabs4">  
					  <img src="{$WEB_ROOT}/templates/{$template}/images/user04.png" alt="user image">   
					  <h2>{$LANG.domaincustomername4}</h2> 
					  <p>{$LANG.domaincustomerdata4}</p>
					  </div>
					</li>
					  <li class="item nav-item">    
					  <div class="customers_box" data-toggle="pill" href="#tabs2">  
					  <img src="{$WEB_ROOT}/templates/{$template}/images/user02.png" alt="user image">   
					  <h2>{$LANG.domaincustomername2}</h2> 
					  <p>{$LANG.domaincustomerdata2}</p>
					  </div>
					</li>
					<li class="item nav-item">    
					  <div class="customers_box" data-toggle="pill" href="#tabs3">  
					  <img src="{$WEB_ROOT}/templates/{$template}/images/user03.png" alt="user icon">   
					  <h2>{$LANG.domaincustomername3}</h2> 
					  <p> {$LANG.domaincustomerdata3}</p>
					  </div>
					</li>
					<li class="item nav-item">    
					  <div class="customers_box" data-toggle="pill" href="#tabs4">  
					  <img src="{$WEB_ROOT}/templates/{$template}/images/user04.png" alt="user image">   
					  <h2>{$LANG.domaincustomername4}</h2> 
					  <p>{$LANG.domaincustomerdata4}</p>
					  </div>
					</li>
				  </ul>
				  <div class="tab-content user_bottom_data">
					<div id="tabs1" class="tab-pane"> 
					 <div class="data_box">{$LANG.domaincustomereview}</div>
					</div>
					<div id="tabs2" class="tab-pane active"> 
					  <div class="data_box">{$LANG.domaincustomereview}</div>
					</div>
					<div id="tabs3" class="tab-pane"> 
					 <div class="data_box">{$LANG.domaincustomereview}</div>
					</div>
					<div id="tabs4" class="tab-pane"> 
					  <div class="data_box">{$LANG.domaincustomereview}</div> 
					</div>
				  </div>
				</div>
			</div>		
	</div>
	<div id="FaqElement" class="allElement hidden">
		<div class="title_box5">FAQ (Style 1)</div>
		<div class="frequbntly_asked mt-5">
			  <div class="container">
				<div class="top">
				  <h2>{$LANG.domainfrequentlyask}</h2>
				  <h5>{$LANG.domainquesanss}</h5>
				</div>
				<div class="clearfix"></div>

				<div class="question_answers">
					<span>01</span>
					<a class="question" href="javascript:;" data="#collapseExample_" role="button" aria-expanded="false" aria-controls="collapseExample_">{$LANG.domainque1}
					  <span><img src="{$WEB_ROOT}/templates/{$template}/images/bottom-arro.svg" class="svg" alt="tick icon"></span>  
					</a> 
					<div class="collapse" id="collapseExample_">
					  {$LANG.domainqueans}
					</div>
				</div>
				<div class="question_answers">
					<span>02</span>
					<a class="question" href="javascript:;" data="#collapseExample1_" role="button" aria-expanded="false" aria-controls="collapseExample1_">{$LANG.domainque2}
					  <span><img src="{$WEB_ROOT}/templates/{$template}/images/bottom-arro.svg" class="svg" alt="tick icon"></span>  
					</a> 
					<div class="collapse" id="collapseExample1_">
					  {$LANG.domainqueans}
					</div>
				</div> 
				<div class="question_answers">
					<span>03</span>
					<a class="question" href="javascript:;" data="#collapseExample2_" role="button" aria-expanded="false" aria-controls="collapseExample2_">{$LANG.domainque3}
					  <span><img src="{$WEB_ROOT}/templates/{$template}/images/bottom-arro.svg" class="svg" alt="tick icon"></span>  
					</a> 
					<div class="collapse" id="collapseExample2_">
					  {$LANG.domainqueans}
					</div>
				</div>
				<div class="question_answers">
					<span>04</span>
					<a class="question" href="javascript:;" data="#collapseExample3_" role="button" aria-expanded="false" aria-controls="collapseExample3_">{$LANG.domainque4}
					  <span><img src="{$WEB_ROOT}/templates/{$template}/images/bottom-arro.svg" class="svg" alt="tick icon"></span>  
					</a> 
					<div class="collapse" id="collapseExample3_">
					  {$LANG.domainqueans}
					</div>
				</div>
			  </div>
		</div>
		<div class="title_box5">FAQ (Style 2)</div>
		<div class="frequbntly_asked frequbntly_asked1">
		  <div class="container">
			<div class="top">
			  <h2>{$LANG.vpsaskque}</h2> 
			</div>

			<div class="clearfix"></div>

			<div class="question_answers">
			  <a class="question" href="javascript:;" data="#collapseExample" role="button" aria-expanded="false" aria-controls="collapseExample">{$LANG.domainque1}
				  <span><img src="{$WEB_ROOT}/templates/{$template}/images/bottom-arro.svg" class="svg" alt="tick icon"></span>  
			  </a> 
			  <div class="collapse" id="collapseExample">
				   {$LANG.domainqueans}
			  </div>
			</div>
			
			<div class="question_answers">
				 
				<a class="question" href="javascript:;" data="#collapseExample1" role="button" aria-expanded="false" aria-controls="collapseExample">{$LANG.domainque2}
				  <span><img src="{$WEB_ROOT}/templates/{$template}/images/bottom-arro.svg" class="svg" alt="tick icon"></span>  
				</a> 
				<div class="collapse" id="collapseExample1">
				  {$LANG.domainqueans}
				</div>
			</div> 

			<div class="question_answers">
				  
				<a class="question" href="javascript:;" data="#collapseExample2" role="button" aria-expanded="false" aria-controls="collapseExample">{$LANG.domainque3}
				  <span><img src="{$WEB_ROOT}/templates/{$template}/images/bottom-arro.svg" class="svg" alt="tick icon"></span>  
				</a> 
				<div class="collapse" id="collapseExample2">
				   {$LANG.domainqueans}
				</div>
			</div>

			<div class="question_answers">
			  <a class="question" href="javascript:;" data="#collapseExample3" role="button" aria-expanded="false" aria-controls="collapseExample">{$LANG.domainque4}
				<span><img src="{$WEB_ROOT}/templates/{$template}/images/bottom-arro.svg" class="svg" alt="tick icon"></span>  
			  </a> 
			  <div class="collapse" id="collapseExample3">
				 {$LANG.domainqueans}
			  </div>
			</div>
		  </div>
		</div>
		<div class="title_box5">Frequently Asked (Advanced Layout)</div>
		<div class="frequently-questions">
				<div class="container">
				  <div class="row frequently-questions-row">
					<h2>{$LANG.sslPageFaqHead}</h2>
					  <div class="col-sm-12">
					   <div class="accordion-container-main">
						   <!--Accordion wrapper-->
							  <div class="accordion md-accordion" id="accordionEx1" role="tablist" aria-multiselectable="true">
								  <!-- Accordion card -->
								  <div class="card">
									<!-- Card header -->
									<div class="card-header" role="tab" id="headingTwo1">
									  <a class="collapsed" data-toggle="collapse" data-parent="#accordionEx1" href="#collapseTwo"
										aria-expanded="false" aria-controls="collapseTwo">
										<h5 class="mb-0">{$LANG.sslPageFaqAccord1Head}</h5>
									  </a>
									</div>
									<!-- Card body -->
									<div id="collapseTwo" class="collapse" role="tabpanel" aria-labelledby="headingTwo1" data-parent="#accordionEx1">
									  <div class="card-body">{$LANG.sslPageFaqAccord1Body}</div>
									</div>
								  </div>
								  <!-- Accordion card -->
								  <div class="card current">
									<!-- Card header -->
									<div class="card-header" role="tab" id="headingTwo2">
									  <a class="collapsed" data-toggle="collapse" data-parent="#accordionEx1" href="#collapseTwo1"
										aria-expanded="false" aria-controls="collapseTwo1">
										<h5 class="mb-0">{$LANG.sslPageFaqAccord2Head}</h5>
									  </a>
									</div>
									<!-- Card body -->
									<div id="collapseTwo1" class="collapse show" role="tabpanel" aria-labelledby="headingTwo2" data-parent="#accordionEx1">
									  <div class="card-body">{$LANG.sslPageFaqAccord2Body}</div>
									</div>
								  </div>
								  <!-- Accordion card -->
								  <div class="card">
									<!-- Card header -->
									<div class="card-header" role="tab" id="headingTwo3">
									  <a class="collapsed" data-toggle="collapse" data-parent="#accordionEx1" href="#collapseThree"
										aria-expanded="false" aria-controls="collapseThree">
										<h5 class="mb-0">{$LANG.sslPageFaqAccord3Head}</h5>
									  </a>
									</div>
									<!-- Card body -->
									<div id="collapseThree" class="collapse" role="tabpanel" aria-labelledby="headingTwo3" data-parent="#accordionEx1">
									  <div class="card-body">{$LANG.sslPageFaqAccord3Body}</div>
									</div>
								  </div>
								  <!-- Accordion card -->
								  <div class="card">
									<!-- Card header -->
									<div class="card-header" role="tab" id="headingTwo4">
									  <a class="collapsed" data-toggle="collapse" data-parent="#accordionEx1" href="#headingfour"
										aria-expanded="false" aria-controls="headingfour">
										<h5 class="mb-0">{$LANG.sslPageFaqAccord4Head}</h5>
									  </a>
									</div>
									<!-- Card body -->
									<div id="headingfour" class="collapse" role="tabpanel" aria-labelledby="headingTwo4" data-parent="#accordionEx1">
									  <div class="card-body">{$LANG.sslPageFaqAccord4Body}</div>
									</div>
								  </div>
								  <!-- Accordion card -->
								  <div class="card">
									<!-- Card header -->
									<div class="card-header" role="tab" id="headingTwo5">
									  <a class="collapsed" data-toggle="collapse" data-parent="#accordionEx1" href="#collapsefive"
										aria-expanded="false" aria-controls="collapsefive">
										<h5 class="mb-0">{$LANG.sslPageFaqAccord5Head}</h5>
									  </a>
									</div>
									<!-- Card body -->
									<div id="collapsefive" class="collapse" role="tabpanel" aria-labelledby="headingTwo5" data-parent="#accordionEx1">
									  <div class="card-body">{$LANG.sslPageFaqAccord5Body}</div>
									</div>
								  </div>
								  <!-- Accordion card -->
							  </div>
							<!-- Accordion wrapper -->
					   </div>
					  </div>
				  </div>
			   </div>
		</div>
	</div>
	<div id="OffersElement" class="allElement hidden">
		<div class="title_box5">Offer Block(2)</div>
			<div class="custom-block-7">
			  <div class="container">
					<div class="sp-offer">
					  <h3>Special Offer</h3>
					  <h2>50% Off</h2>
					</div>
					<div class="cuppon-box">
						<h5><strong>SHARED / RESELLER</strong> - Save 50% on First Term (up to 3 years) with code: <span class="c-code">KH50DEAL</span><br> 
							<strong>SSD VPS / CLOUD VPS</strong> - Save 30% for LIFE with Code: <span class="c-code">KH30DEAL</span><br>
							<strong>DEDICATED</strong> - Check back
						</h5>
					</div>
					<a href="#" class="see-ofr-btn">See Special Offers</a>
			  </div>
			</div>

		<div class="title_box5">Offers</div>
		<div class="offers-banner">
		   <div class="container">
			  <div class="row">
				 <div class="col-sm-12">
					<div class="offers-banner-inner">
					   <h2>Something special just for YOU</h2>
					   <h5>Cutting-edge web hosting for $0.80 exclusive FREE!</h5>
						<ul class="list-inline">
						<li class="list-inline-item"><b id="offer-Days">58</b><span>Days</span></li>
						<li class="list-inline-item"><b id="offer-Hours">42</b><span>Hours</span></li>
						<li class="list-inline-item"><b id="offer-Minutes">39</b><span>Minutes</span></li>
						<li class="list-inline-item"><b id="offer-Seconds">59</b><span>Seconds</span></li>
						</ul>
						<div class="offer-view-plan">
						<div class="left-offer-inner">
						<h5>50<sup>%</sup> <sub>OFF</sub> <span> <b>OFFERS</b></span></h5>
						</div>
						<div class="get-started-box-offers">
						<p>30-day money-back Guarantee</p>
						<a href="#" class="button04 button-7">Get Started Now</a></div>
						</div>
					</div>
				 </div>
			  </div>
		   </div>
		</div>
		<script>
		   var x = setInterval( function(){ t(); } , 1000);
		   var date_ = "{$hostx_theme_settings.offer_timer}";
		   function t() {
			 var now = new Date().getTime();
			 var countDownDate = new Date(date_).getTime();
			 var distance = countDownDate - now;

			 var days = Math.floor(distance / (1000 * 60 * 60 * 24));
			 var hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
			 var minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
			 var seconds = Math.floor((distance % (1000 * 60)) / 1000);

			 if (distance > 0) {

				document.getElementById("offer-Days").innerHTML = days.toString().length < 2 ? "0"+days : days  ;
				document.getElementById("offer-Hours").innerHTML =  hours.toString().length < 2 ? "0"+hours : hours  ;
				document.getElementById("offer-Minutes").innerHTML =  minutes.toString().length < 2 ? "0"+minutes : minutes;
				document.getElementById("offer-Seconds").innerHTML =  seconds.toString().length < 2 ? "0"+seconds : seconds;
			 }else{
			   clearInterval(x);
			 }
			 
		   }
		</script>
	</div>
	<div id="ExtraElement" class="allElement hidden">
		<div class="title_box5">Domain Search Banner</div>
		<div class="domain-block-home">
			<div class="container">
			  <div class="row">
				<div class="col-md-7">
				 <div class="domain-block-content">
				   <h2>{$LANG.domainBlockFindDomain}</h2>
				   <form action="domainchecker.php" method="post">
					<input type="hidden" name="register">
					 <div class="domain-search-frm">
					   <div class="domain-block-search">
						<div class="domain-block-inner"><input type="text" class="domain-b-search" name="domain" placeholder="{$LANG.domainBlockPlaceHolder}">
						</div>
						<input type="submit" class="btn" value="{$LANG.domainsearch}">   
					  </div>
					 </div>
					 </form>
				 </div>
				</div>
				<div class="col-md-5">
				  <div class="domain-block-tld">
					<ul class="domain-block-tld-price">
						{foreach from=$tld_data['show_on_home']  item=sale_item}
						  <li class="block-{$sale_item->tld_id}"><strong><span>.</span>{$sale_item->tld_id}</strong><p>{$sale_item->register}</p></li>
						{/foreach}
					</ul>
				  </div>
				</div>
			  </div>
			</div>
		 </div>
		<div class="title_box5">Business Email CTA</div>
		<div class="business-row">
			<div class="container">
			  <div class="row">
				<div class="col-sm-6">
				  <div class="left">
					<h2>{$LANG.domaingetemailaddress}.</h2> 
					<p>{$LANG.domaingetemailtext}.</p> 
					<a href="#" class="button03">{$LANG.domainregister}</a> 
				  </div>
				</div>
			  </div>
			</div>
		</div>
		<div class="title_box5">Find your ideal Domain</div>
		<div class="domain">
			<div class="container">
			  <div class="top">
				<h5>{eval var=$LANG.domainregister}</h5>
				<h2>{$LANG.domainfindideal}</h2> 
				<p>{$LANG.domainsecureyourdmn}</p> 
			  </div>
			  <div class="search_box">
				<form action="cart.php" method="get">  
				  <input type="hidden" name="a" value="add">
				  <input type="hidden" name="domain" value="register">
				  <img src="{$WEB_ROOT}/templates/{$template}/images/search-icon.svg" alt="search icon"> 
				  <input class="search_input" type="text" placeholder="Search a Domain" name="sld">  
				  <input type="submit" class="submit" value="{$LANG.domainsearch}" name="submit">
				</form>  
			  </div>
			  <ul class="domain-options">
				  {foreach from=$tld_data['show_on_domain'] key=k  item=tld_d}
				  <li>.{$tld_d->tld_id}  <span>{$LANG.homeonly}  {$tld_d->register}
				  /{$LANG.domainyr}</span></li>
				  {/foreach}
			  </ul>
			  <div class="domain-companys">

				{assign var="currency_formate" value="</b><small>`$tld_data.currency_formate`"} 

				{foreach from=$tld_data['show_on_domain_companys'] key=k  item=tld_d}
				  <div class="domain-companys-col"> 
				  <img src="{$WEB_ROOT}/templates/{$template}/domain_icons/{$tld_d->tld_id|replace:'.':'_'}.png" alt="{$tld_d->tld_id|replace:'.':'_'}">
				  <h3>{$LANG.homeonly}
					{if $tld_data.currency_formate eq 'empty'}
					<b>{$tld_d->register}</b>/{$LANG.domainyr}
					{else}
					 <b>{$tld_d->register|replace:$tld_data['currency_formate']:$currency_formate}</small>/{$LANG.domainyr}
					{/if}
				  </h3> 
				</div>
				{/foreach}

			  </div>

			</div>
		</div>
		<div class="title_box5">How Google's Recent Changes Affect You</div>
		<div class="ssl-effect-site recent-changes-effact">
			<div class="container">
			  <div class="row ssl-effect-site-row">
				 <div class="col-sm-7">
				  <h4>{$LANG.sslPageEffectSiteH4}</h4>
				  <p>{$LANG.sslPageEffectSiteP}<span>{$LANG.sslPageEffectSitePSpan}</span></p>
				</div>
				<div class="col-sm-5">
				  <div class="http-image-box">
					<img src="{$WEB_ROOT}/templates/{$template}/images/http-domain-ssl.png" alt="ssl certificate">  
				  </div>
				</div>
			  </div>
		   </div>
		</div>
		<div class="title_box5">Premium Everything - Especially Support</div>
		<div class="custom-block-2">
		  <div class="container">
			<div class="row">
			  <div class="col-md-4">
				<div class="b-support-img"><img src="{$WEB_ROOT}/templates/{$template}/images/b-support-img.png" alt="support icon"></div>
			  </div>	   
			   <div class="col-md-8">
				  <div class="block2-cont">
					<h2>Premium Everything - Especially Support</h2>
					<p>An in-house, expert team is available round-the-clock to help resolve your queries to get you started and grow your presence online. We are there when you get stuck-anytime, day or night. We help you create a website fast and easy by resolving all web hosting queries!</p>
					<h3>Need Help? We are here right now</h3>
					<div class="c-support-btn"><a href="#" class="live-btn">contact Support</a> <a href="#" class="button03">Live sales Support</a></div>
				  </div>
				</div>
			</div>
		  </div>
		</div>
		<div class="title_box5">How SSL effect on your site</div>
		<div class="ssl-effect-site">
			  <div class="container">
				<div class="row ssl-effect-site-row">
				  <div class="col-sm-6">
				   <img src="{$WEB_ROOT}/templates/{$template}/images/ssl-effect-img.png" alt="ssl certificate">  
				  </div>
				   <div class="col-sm-6">
					<h4>{$LANG.sslPageHowSsl}</h4>
					<p>{$LANG.sslPageHowSslP}</p>
					<ul>
					  <li>{$LANG.sslPageHowSslLi1}</li>
					  <li>{$LANG.sslPageHowSslLi2}</li>
					  <li>{$LANG.sslPageHowSslLi3}</li>
					  <li>{$LANG.sslPageHowSslLi4}</li>
					  <li>{$LANG.sslPageHowSslLi5}</li>
					  <li>{$LANG.sslPageHowSslLi6}</li>
					  <li>{$LANG.sslPageHowSslLi7}</li>
					  <li>{$LANG.sslPageHowSslLi8}</li>
					</ul>
				  </div>
				</div>
			 </div>
		</div>
		<div class="title_box5">Call To Us Banner</div>
		<div class="toll-free">
			<div class="container">
			  <div class="row">
				<div class="col-sm-7">
				  <div class="toll-free-col">
					<img class="svg" src="{$WEB_ROOT}/templates/{$template}/images/toll-free.svg" alt="phone icon"> 
					<h6>{$LANG.domaincallus}</h6>
					<h5>+1(929)8002575</h5>
					<span>({$LANG.domaintollfree})</span>
				  </div>
				</div> 
				<div class="col-sm-5"> 
				  <div class="toll-free-col">
					<img class="svg" src="{$WEB_ROOT}/templates/{$template}/images/chart.svg" alt="chart">  
					<h6>{$LANG.domainchatwith}</h6>
					<h5>{$LANG.domainexperts}</h5>
				  </div>
				</div>
			  </div>
			</div>
		</div>
		<div class="title_box5">Risk Free Trial Program</div>
		<div class="free-trial">
		  <div class="container">
			  <div class="free-trial-col">
				<img src="{$WEB_ROOT}/templates/{$template}/images/30day.png" alt="free trial">
				<h2>{$LANG.vpsguarantee}.</h2>
				<p>{$LANG.vpsguaranteetext}.</p> 
			  </div>
		  </div>
		</div>
		<div class="title_box5">Unlimited Bandwidth</div>
		<div class="bandwidth">
		  <div class="container">
			<div class="bandwidth_in">
			<div class="row">
			  <div class="col-sm-5 left">
				<h2>{$LANG.homeunlimitedbandwidth}*</h2>
				<p>{$LANG.cpanelovercharge}</p>
			  </div>
			  <div class="col-sm-7 left">
				<img src="{$WEB_ROOT}/templates/{$template}/images/img01.png" class="img-responsive" alt="optimize player"> 
			  </div>
			</div>
		  </div>
		  </div>
		</div>		
	</div>

<script>
var addCartButtonLang = "{$LANG.orderForm.addToCart}";
var checkoutButtonLang = "{$LANG.ordercheckout}";
var domainAlreadyInCart = "{$LANG.domainAlreadyExist}";
var orderHostingBtn = "{$LANG.orderhosting}";
var preferTldError = "{$LANG.domainTldPreffer}";
var domainisavailable = "{$LANG.domainavailable2}";
var domainSuggestionSeting = "{$hostx_theme_settings.domain_suggestion_display_hmpg}";
function wgsBlockManaged(obj,id){
	jQuery(".allElement").addClass('hidden');
	jQuery(".common-li-cls").removeClass('active');
	jQuery(obj).addClass("active");
	jQuery('#'+id).removeClass('hidden');
}
</script>