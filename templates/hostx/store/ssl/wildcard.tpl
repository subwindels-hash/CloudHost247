<link href="{assetPath file='store.css'}" rel="stylesheet">
<link href="{$WEB_ROOT}/templates/{$template}/store/css/store-custom.css" rel="stylesheet">
<div class="landing-page ssl">

    <div class="hero top_banner_sections_ssl">
        <div class="container">
            
              <div class="row">
                <div class="col-sm-6">
                   <h2>{lang key="store.ssl.wildcard.title"}</h2>
                    <h3>{lang key="store.ssl.wildcard.tagline"}</h3>
                </div>
                <div class="col-sm-6">
                    <img src="{$WEB_ROOT}/templates/{$template}/images/ssl-certificates_banner_icon.png">
                </div>
            </div>
        </div>
    </div>

    {include file="$template/store/ssl/shared/nav.tpl" current="wildcard"}
  <div class="content-block standout">
        <div class="container">

            <div class="row">
              
               <div class="col-sm-8 col-md-8 ">


                    <h3 class="heading_str">{lang key="store.ssl.wildcard.descriptionTitle"}</h3>
                    <div class="text-center visible-xs">
                        <img src="{$WEB_ROOT}/assets/img/marketconnect/symantec/ssl-subs.png">
                        <br><br>
                    </div>

                     {lang key="store.ssl.wildcard.descriptionContent"}

                </div>
                <div class="col-sm-4 col-md-4">
                   <img src="{$WEB_ROOT}/templates/{$template}/images/ssl_img_l.png" class="check_list_icon11">
                </div>
            </div>

        </div>
    </div>
    
    {include file="$template/store/ssl/shared/certificate-pricing.tpl" type="wildcard"}

    {include file="$template/store/ssl/shared/features.tpl" type="wildcard"}

    {include file="$template/store/ssl/shared/logos.tpl"}

</div>
