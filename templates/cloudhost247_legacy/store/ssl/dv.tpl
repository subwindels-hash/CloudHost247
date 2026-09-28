<link href="{assetPath file='store.css'}" rel="stylesheet">
<link href="{$WEB_ROOT}/templates/{$template}/store/css/store-custom.css" rel="stylesheet">
<div class="landing-page ssl">

    <div class="hero top_banner_sections_ssl">
        <div class="container">
            <div class="row">
                <div class="col-sm-6">
                    <h2>{lang key="store.ssl.dv.title"}</h2>
                     <h3>{lang key="store.ssl.dv.tagline"}</h3>
                </div>
                <div class="col-sm-6">
                    <img src="{$WEB_ROOT}/templates/{$template}/images/ssl-certificates_banner_icon.png">
                </div>
            </div>
            
        </div>
    </div>

    {include file="$template/store/ssl/shared/nav.tpl" current="dv"}

    <div class="content-block standout">
        <div class="container">

            <div class="row">
                <div class="col-sm-4 col-md-4 col-sm-push-8 col-md-push-9 text-right hidden-xs">
                   <img src="{$WEB_ROOT}/templates/{$template}/images/ssl_img_l.png" class="check_list_icon11">
                </div>
                <div class="col-sm-8 col-md-8 col-sm-pull-4">
                    <h3 class="heading_str">{lang key="store.ssl.dv.descriptionTitle"}</h3>
                    <div class="text-center visible-xs">
                        <img src="{$WEB_ROOT}/assets/img/marketconnect/symantec/ssl.png">
                        <br><br>
                    </div>
                    {lang key="store.ssl.dv.descriptionContent"}
                    <br>
                    <h3>{lang key="store.ssl.useCases.title"}</h3>
                    <div class="row ideal-for dv">
                        <div class="col-sm-4">
                            <i class="fas fa-comment-alt-lines"></i>
                            <h4>{lang key="store.ssl.useCases.blogs"}</h4>
                        </div>
                        <div class="col-sm-4">
                            <i class="fas fa-file-alt"></i>
                            <h4>{lang key="store.ssl.useCases.infoPages"}</h4>
                        </div>
                        <div class="col-sm-4">
                            <i class="fas fa-server"></i>
                            <h4>{lang key="store.ssl.useCases.serverComms"}</h4>
                        </div>
                    </div>
                </div>
            </div>

        </div>
    </div>

    {include file="$template/store/ssl/shared/certificate-pricing.tpl" type="dv"}

    {include file="$template/store/ssl/shared/features.tpl" type="dv"}

    {include file="$template/store/ssl/shared/logos.tpl"}

</div>
