{assign var=unique_id value=10|mt_rand:20000000}
<link rel="stylesheet" href="{$tplVar.urlPath}templates/assets/css/style.css?v={$unique_id}">
<script src="{$tplVar.urlPath}templates/assets/js/script.js?v={$unique_id}"></script>
<script src="https://ajax.aspnetcdn.com/ajax/jquery.validate/1.14.0/jquery.validate.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jquery-validate/1.19.2/additional-methods.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>

{if $tplVar["license"]["status"] eq "Active" && $tplVar["action"] eq ''}
    <div class="module_upgrade">
        <button type="button" id="module_upgrade" class="btn btn-info">Upgrade Database</button>
    </div>
{/if}



<div class="add_hdr">
    <a href="https://whmcsglobalservices.com/" class="small_logo" target="_blank"><img
            src="{$tplVar.urlPath}templates/assets/images/logo.png"></a>
    <div class="add_nav">
        <i class="fa fa-bars" aria-hidden="true"></i>
    </div>
    <div class="right-menu-admin" style="display: none;">
        <ul class="ul-menu-ryt" style="display:flex; margin-top: 30px;flex-wrap: wrap;">
            <li><a href="{$tplVar.moduleLink}"><img class="opacity-img"
                        src="{$tplVar.urlPath}templates/assets/images/icon_1.svg" width="60px"><span>
                        {$tplVar['_lang']['home']}</span></a></li>

            {if $tplVar["license"]["status"] eq "Active"}
                <li><a href="{$tplVar.moduleLink}&action=consumerSetting"><img class="opacity-img"
                            src="{$tplVar.urlPath}templates/assets/images/icon_11.svg"
                            width="43px"><span>{$tplVar['_lang']['keySetup']} </span></a></li>

                <li><a href="{$tplVar.moduleLink}&action=productsetting"><img class="opacity-img"
                            src="{$tplVar.urlPath}templates/assets/images/icon_4.svg"
                            width="43px"><span>{$tplVar['_lang']['productsettings']}</span></a></li>

                <li style="margin-top: 30px;"><a href="{$tplVar.moduleLink}&action=imapsetting"><img class="opacity-img"
                            src="{$tplVar.urlPath}templates/assets/images/envelope.png"
                            width="43px"><span>{$tplVar['_lang']['imapSetting']} </span></a></li>

                <li style="margin-top: 30px;"><a href="{$tplVar.moduleLink}&action=existingserver"><img class="opacity-img"
                            src="{$tplVar.urlPath}templates/assets/images/icon_existing.svg"
                            width="43px"><span>{$tplVar['_lang']['existingserver_header']}</span></a></li>
                <li style="margin-top: 30px;"><a href="{$tplVar.moduleLink}&action=manageemailtemplates"><img
                            class="opacity-img" src="{$tplVar.urlPath}templates/assets/images/icon_2.svg"
                            width="43px"><span>{$tplVar['_lang']['mailTemplate_header']}</span></a></li>
                <li style="margin-top: 30px;"><a href="{$tplVar.moduleLink}&action=serversstatus"><img class="opacity-img"
                            src="{$tplVar.urlPath}templates/assets/images/icon_12.svg"
                            width="43px"><span>{$tplVar['_lang']['serversstatus']} </span></a></li>
                <li style="margin-top: 30px;"><a href="{$tplVar.moduleLink}&action=logs"><img class="opacity-img"
                            src="{$tplVar.urlPath}templates/assets/images/icon_5.svg"
                            width="43px"><span>{$tplVar['_lang']['logs_header']} </span></a></li>
                <li style="margin-top: 30px;"><a href="{$tplVar.moduleLink}&action=ordermanagement"><img class="opacity-img"
                            src="{$tplVar.urlPath}templates/assets/images/delivery-status.svg"
                            width="43px"><span>{$tplVar['_lang']['ordermanagement_header']} </span></a></li>
                <li style="margin-top: 30px;"><a
                        href="https://wiki.whmcsglobalservices.com/index.php?title=WHMCS_OVH_Module_Installation_Guide_%26_Documentation" target="_blank"><img
                            class="opacity-img" src="{$tplVar.urlPath}templates/assets/images/icon_doc.svg"
                            width="43px"><span>{$tplVar['_lang']['documentation']}</span></a></li>
            {/if}
        </ul>
    </div>
</div>
{if isset($tplVar.message)}
    <div class="alert alert-success" role="alert">{$tplVar.message}</div>
{/if}
{if isset($tplVar.warning)}
    <div class="alert alert-warning" role="alert">{$tplVar.warning}</div>
{/if}
{if isset($tplVar.deletemessage)}
    <div class="alert alert-success" role="alert">{$tplVar.deletemessage}</div>
{/if}
<script>
    $(document).ready(function() {
        $('.fa.fa-bars').on('click', function() {
            $('.right-menu-admin').toggle();
        });
        $(document).on("click", ".add_nav", function(e) {
            e.stopPropagation();
        })
        $(document).on("click", "body", function() {
            $(".right-menu-admin").css("display", "none")
        })
    })
</script>