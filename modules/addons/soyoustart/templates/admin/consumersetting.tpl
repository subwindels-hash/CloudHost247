{include file=$tplVar.header}

<script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>

<ul class="tabs">
    <li class="active-tab" data-tabmenu="generateKey">{$tplVar['_lang']['tab_generate_api_key']}</li>
    <li data-tabmenu="priceSettings">{$tplVar['_lang']['tab_priceSettings']}</li>
    <li data-tabmenu="imap">{$tplVar['_lang']['tab_imap']}</li>
    <li data-tabmenu="general">{$tplVar['_lang']['tab_general']}</li>
    <li data-tabmenu="aclSettings">{$tplVar['_lang']['tab_aclSettings']}</li>
    <li data-tabmenu="orderformSettings">{$tplVar['_lang']['tab_orderformSettings']}</li>
</ul>

<ul class="tabs-content">
    <li style="display: block!important;">
        <div class="innerContent">
            <div class="alert alert-secondary" role="alert"> {$tplVar['_lang']['consumerSetting_page_note']} <span class="documentation"><a href="https://wiki.whmcsglobalservices.com/index.php?title=WHMCS_OVH_Module_Installation_Guide_%26_Documentation#Generate_the_OVH_API_Key" target="_blank"> {$tplVar['_lang']['doc']}</a> </span></div>
            <div class="btn_section">
                <button onclick="jQuery('.key_setting').fadeToggle(1000);"
                    class="btn  btn-info">{$tplVar['_lang']['generate_api_key']}</button>
            </div>

            <div class="tab0box" id="tab0box">
                <div id="tab_content">
                    <div class="p_text">{$tplVar['_lang']['generate_api_key']}</div>
                    <div class="tabbox2" id="tabbox1">
                        <div id="tab_content">
                            <form method="post" enctype="multipart/form-data" action=""
                                {if !isset($tplVar["edit_data"])} class="key_setting" style="display: none;" {/if}>
                                <div class="container form">
                                    <div class="row">
                                        <div class="col-md-6">
                                            <div class="form-group">
                                                <label for="server"> {$tplVar['_lang']['server_location']}</label>
                                                <select name="location" id="soyoulocation"
                                                    class="form-control getlocaldata">
                                                    <option value="europe"
                                                        {if $tplVar["edit_data"]->location eq "europe" }selected {/if}>
                                                        Europe
                                                    </option>
                                                    <option value="canada"
                                                        {if $tplVar["edit_data"]->location eq "canada" }selected {/if}>
                                                        Canada
                                                    </option>
                                                    <option value="us"
                                                        {if $tplVar["edit_data"]->location eq "us" }selected {/if}>US
                                                    </option>
                                                    <option value="uk"
                                                        {if $tplVar["edit_data"]->location eq "uk" }selected {/if}>UK
                                                    </option>
                                                    <option value="singapore"
                                                        {if $tplVar["edit_data"]->location eq "singapore" }selected
                                                        {/if}>
                                                        Singapore</option>
                                                    <option value="world"
                                                        {if $tplVar["edit_data"]->location eq "world" }selected {/if}>
                                                        World
                                                    </option>
                                                </select> &nbsp; <small class="form-text text-muted">
                                                    {$tplVar['_lang']['get_secret_key_desc1']} <a id="set_ser_pro"
                                                        href="https://api.ovh.com/createApp/"
                                                        target="_blank">{$tplVar['_lang']['get_secret_key_desc2']}</a>.
                                                    {$tplVar['_lang']['get_secret_key_desc3']}</small>
                                            </div>
                                        </div>

                                        <div class="col-md-6">
                                            <div class="form-group">
                                                <label for="servertype">{$tplVar['_lang']['application_key']}</label>
                                                <input id="application_key_so" type="text"
                                                    value="{$tplVar["edit_data"]->application_key}" name="application"
                                                    placeholder="{$tplVar['_lang']['application_key_placeholder']}"
                                                    class="form-control" required>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="row">
                                        <div class="col-md-6">
                                            <div class="form-group">
                                                <label for="server"> {$tplVar['_lang']['secret_key']}</label>
                                                <input id="secret_key_so" type="text"
                                                    value="{$tplVar["edit_data"]->secret_key}" name="secret"
                                                    placeholder="{$tplVar['_lang']['secret_key_placeholder']}"
                                                    class="form-control" required>
                                            </div>
                                        </div>
                                        <div class="col-md-6">
                                            <div class="form-group">
                                                <label for="server"> {$tplVar['_lang']['user_name']}</label>
                                                <input id="accountnumber" type="text"
                                                    value="{$tplVar["edit_data"]->account_number}" name="account_number"
                                                    placeholder="{$tplVar['_lang']['user_name_placeholder']}"
                                                    class="form-control" required>
                                            </div>
                                        </div>
                                    </div>

                                    <img width="1" height="10" src="images/spacer.gif"><br>
                                    <div align="center"><input type="submit" class="btn btn-info" name="submit"
                                            id="submit" value="{$tplVar['_lang']['btn_generate_key']}">
                                        {if $tplVar["edit_data"]->account_number }<a
                                                href="{$tplVar["moduleLink"]}&action=consumerSetting" class="btn btn-info"
                                            name="submit" id="submit"> Back </a>{/if}
                                    </div>

                                </div>

                            </form>
                        </div>
                    </div>
                    <div class="tabbox2" id="tabbox2"
                        style="width: 100%; border-top-width: 1px; border-top-color: rgb(210, 210, 210);">
                        <table id="employeetable" class="datatable" width="100%" border="0" cellspacing="1"
                            cellpadding="3">
                            <thead>
                                <tr>
                                    <th>{$tplVar['_lang']['account_user']}</th>
                                    <th>{$tplVar['_lang']['location']}</th>
                                    <th>{$tplVar['_lang']['status']}</th>
                                    <th>{$tplVar['_lang']['expiry_date']}</th>
                                    <th>{$tplVar['_lang']['action']}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {foreach $tplVar["consumerKeyData"] as $value}
                                    <tr data-auth-id="{$value->id}">
                                        <td class="text-center">{$value->account_number}</td>
                                        <td class="text-center">{$value->location|upper}</td>
                                        <td class="text-center consumer-status status{$value->id}"><i
                                                class="fa fa-spinner fa-spin" style="color: red;"></i></td>
                                        <td class="text-center expiry_date{$value->id}"><i class="fa fa-spinner fa-spin"
                                                style="color: red;"></i></td>
                                        <td class="text-center">
                                            {if $value->status eq "0"}<span class="re_generate"><i class="fas fa-sync"></i>
                                            </span>{else} <span>&nbsp;&nbsp;&nbsp; </span>
                                            {/if}
                                    
                                            &nbsp;&nbsp;<i class="fa fa-eye viewCredentials" data-toggle="modal" data-target="#viewCredentials"></i>
                                            &nbsp;<i class="fas fa-trash-alt deleteCredentials"></i>
                                        </td>
                                    </tr>
                                {/foreach}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>

    </li>
    <li id="priceSettings">
        <div class="price-settings-loader"></div>
        <div class="innerContent">
            <div class="tablebg">
                <div class="alert alert-secondary" role="alert">{$tplVar['_lang']['price_setting_note']}
                    <span class="documentation"><a href="https://wiki.whmcsglobalservices.com/index.php?title=WHMCS_OVH_Module_Installation_Guide_%26_Documentation#Price_Margin_Setting" target="_blank"> {$tplVar['_lang']['doc']}</a> </span>
                 </div>

                <h2>{$tplVar['_lang']['price_setting_heading']}</h2>
                <div class="btn_section addprice">
                    <button onclick="jQuery('#priceSettingForm').fadeToggle(1000); $('#priceSettingForm .EditPriceMargin').hide();$('#priceSettingForm .fa-spin').hide(); $('#priceSettingForm .addPriceMargin').show();$('#sameMargin').css('display', 'block');" class="btn  btn-info">{$tplVar['_lang']['add_price_margin']}</button>
                </div>
                <table id="sortabletbl1" class="datatable" width="100%" border="0" cellspacing="1" cellpadding="3">
                    <thead>
                        <tr>
                            <th>{$tplVar['_lang']['server_name']}</th>
                            <th>{$tplVar['_lang']['server_type']}</th>
                            <th>{$tplVar['_lang']['product_margin']}</th>
                            <th>{$tplVar['_lang']['additional_ip_margin']}</th>
                            <th>{$tplVar['_lang']['setup_fees_margin']}</th>
                            <th>{$tplVar['_lang']['payment_method']}</th>
                            <th>{$tplVar['_lang']['edit']}</th>
                            <th>{$tplVar['_lang']['delete']}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {* from ajax *}
                    </tbody>
                </table>
            </div>
            {if isset($tplVar["priceEditSettings"])}
                <h2>{$tplVar['_lang']['edit_price_margin']}</h2>
            {else}
            {/if}
            <form method="POST" action="" {if !isset($tplVar["priceEditSettings"])} style="display: none;"
                id="priceSettingForm" {/if}>

                <input type="hidden" name="priceId" id="priceId">
                <div class="container form">
                    <div class="row">
                        <div class="col-md-6">
                            <div class="form-group">
                                <label for="server">{$tplVar['_lang']['server_name']}</label>
                                <select name="server" class="form-control" id="server" disabled>
                                    <option value="OVH">OVH</option>
                                </select>
                            </div>
                        </div>

                        <div class="col-md-6">
                            <div class="form-group">
                                <label for="servertype">{$tplVar['_lang']['server_type']}</label>
                                <select name="servertype" class="form-control" id="servertype">
                                    <option value="Dedicated">Dedicated</option>
                                    <option value="VPS">VPS</option>
                                    <option value="PublicCloud">Public Cloud</option>
                                </select>
                            </div>
                        </div>

                        <div class="col-md-6">
                            <div class="form-group">
                                <label for="productprice">{$tplVar['_lang']['product_margin']}</label>
                                {if isset($tplVar["priceEditSettings"]->productprice)}
                                    <input type="text" name="productprice" id="productprice" class="form-control"
                                        value='{$tplVar["priceEditSettings"]->productprice}'></td>
                                {else}
                                    <input type="text" name="productprice" id="productprice" class="form-control"
                                        value='30'></td>
                                {/if}
                            </div>
                        </div>

                        <div class="col-md-6">
                            <div class="form-group">
                                <label for="additionalIPprice">{$tplVar['_lang']['additional_ip_margin']}</label>
                                {if isset($tplVar["priceEditSettings"]->additionalIPprice)}
                                    <input type="text" name="additionalIPprice" id="additionalIPprice" class="form-control"
                                        value='{$tplVar["priceEditSettings"]->additionalIPprice}'>
                                {else}
                                    <input type="text" name="additionalIPprice" id="additionalIPprice" class="form-control"
                                        value="2">
                                {/if}
                            </div>
                        </div>

                        <div class="col-md-6">
                            <div class="form-group">
                                <label
                                    for="autobackupprice">{$tplVar['_lang']['config_option_auto_backup_margin']}</label>
                                {if isset($tplVar["priceEditSettings"]->autobackupprice)}
                                    <input type="text" name="autobackupprice" id="autobackupprice" class="form-control"
                                        value='{$tplVar["priceEditSettings"]->autobackupprice}'>
                                {else}
                                    <input type="text" name="autobackupprice" id="autobackupprice" class="form-control"
                                        value="10">
                                {/if}
                            </div>
                        </div>
                        <div class="col-md-6">
                            <div class="form-group">
                                <label for="imageprice">{$tplVar['_lang']['config_option_image_margin']}</label>
                                {if isset($tplVar["priceEditSettings"]->imageprice)}
                                    <input type="text" name="imageprice" id="imageprice" class="form-control"
                                        value='{$tplVar["priceEditSettings"]->imageprice}'>
                                {else}
                                    <input type="text" name="imageprice" id="imageprice" class="form-control" value="10">
                                {/if}
                            </div>
                        </div>

                        <div class="col-md-6">
                            <div class="form-group">
                                <label for="setupprice">{$tplVar['_lang']['setup_fees_margin']}</label>
                                {if isset($tplVar["priceEditSettings"]->setupprice)}
                                    <input type="text" name="setupprice" id="setupprice" class="form-control"
                                        value='{$tplVar["priceEditSettings"]->setupprice}'>
                                {else}
                                    <input type="text" name="setupprice" id="setupprice" class="form-control" value="10">
                                {/if}
                            </div>
                        </div>
                        <div class="col-md-6">
                            <div class="form-group">
                                <label for="snapprice">Snapshot Price</label>
                                {if isset($tplVar["priceEditSettings"]->snapprice)}
                                    <input type="text" name="snapprice" id="snapprice" class="form-control"
                                        value='{$tplVar["priceEditSettings"]->snapprice}'>
                                {else}
                                    <input type="text" name="snapprice" id="snapprice" class="form-control"
                                        value="1.20">
                                {/if}
                            </div>
                        </div>


                        <div class="col-md-6">
                            <div class="form-group">
                                <label for="snapshotprice">{$tplVar['_lang']['config_option_snapshot_margin']}</label>
                                {if isset($tplVar["priceEditSettings"]->snapshotprice)}
                                    <input type="text" name="snapshotprice" id="snapshotprice" class="form-control"
                                        value='{$tplVar["priceEditSettings"]->snapshotprice}'>
                                {else}
                                    <input type="text" name="snapshotprice" id="snapshotprice" class="form-control"
                                        value="10">
                                {/if}
                            </div>
                        </div>

                        <div class="col-md-6">
                            <div class="form-group">
                                <label
                                    for="additionaldiskprice">{$tplVar['_lang']['config_option_additional_disk_margin']}</label>
                                {if isset($tplVar["priceEditSettings"]->additionaldiskprice)}
                                    <input type="text" name="additionaldiskprice" id="additionaldiskprice"
                                        class="form-control" value='{$tplVar["priceEditSettings"]->additionaldiskprice}'>
                                {else}
                                    <input type="text" name="additionaldiskprice" id="additionaldiskprice"
                                        class="form-control" value="10">
                                {/if}
                            </div>
                        </div>

                        <div class="col-md-6">
                            <div class="form-group">
                                <label
                                    for="backupspaceprice">{$tplVar['_lang']['confi_option_backup_space_margin']}</label>
                                {if isset($tplVar["priceEditSettings"]->backupspaceprice)}
                                    <input type="text" name="backupspaceprice" id="backupspaceprice" class="form-control"
                                        value='{$tplVar["priceEditSettings"]->backupspaceprice}'>
                                {else}
                                    <input type="text" name="backupspaceprice" id="backupspaceprice" class="form-control"
                                        value="10">
                                {/if}
                            </div>
                        </div>

                        <div class="col-md-6">
                            <div class="form-group">
                                <label
                                    for="publicNetwork">{$tplVar['_lang']['config_option_public_network_margin']}</label>
                                {if isset($tplVar["priceEditSettings"]->publicnetworkprice)}
                                    <input type="text" name="publicnetworkprice" id="publicNetwork" class="form-control"
                                        value='{$tplVar["priceEditSettings"]->publicnetworkprice}'>
                                {else}
                                    <input type="text" name="publicnetworkprice" class="form-control" id="publicNetwork"
                                        value="10">
                                {/if}
                            </div>
                        </div>

                        <div class="col-md-6">
                            <div class="form-group">
                                <label
                                    for="privateNetwork">{$tplVar['_lang']['config_option_private_network_margin']}</label>
                                {if isset($tplVar["priceEditSettings"]->privateetworkprice)}
                                    <input type="text" name="privateetworkprice" id="privateNetwork" class="form-control"
                                        value='{$tplVar["priceEditSettings"]->privateetworkprice}'>
                                {else}
                                    <input type="text" name="privateetworkprice" id="privateNetwork" class="form-control"
                                        value="10">
                                {/if}
                            </div>
                        </div>

                        <div class="col-md-6">
                            <div class="form-group">
                                <label for="storage">{$tplVar['_lang']['config_option_storage']}</label>
                                {if isset($tplVar["priceEditSettings"]->storageprice)}
                                    <input type="text" name="storageprice" id="storage" class="form-control"
                                        value='{$tplVar["priceEditSettings"]->storageprice}'>
                                {else}
                                    <input type="text" name="storageprice" id="storage" class="form-control" value="10">
                                {/if}
                            </div>
                        </div>

                        <div class="col-md-6">
                            <div class="form-group">
                                <label for="plesk">{$tplVar['_lang']['config_option_plesk']}</label>
                                {if isset($tplVar["priceEditSettings"]->pleskprice)}
                                    <input type="text" name="pleskprice" id="plesk" class="form-control"
                                        value='{$tplVar["priceEditSettings"]->pleskprice}'>
                                {else}
                                    <input type="text" name="pleskprice" id="plesk" class="form-control" value="10">
                                {/if}
                            </div>
                        </div>

                        <div class="col-md-6">
                            <div class="form-group">
                                <label
                                    for="cpanelsoftprice">{$tplVar['_lang']['config_option_cpanel_soft_margin']}</label>
                                {if isset($tplVar["priceEditSettings"]->cpanelsoftprice)}
                                    <input type="text" name="cpanelsoftprice" id="cpanelsoftprice" class="form-control"
                                        value='{$tplVar["priceEditSettings"]->cpanelsoftprice}'>
                                {else}
                                    <input type="text" name="cpanelsoftprice" id="cpanelsoftprice" class="form-control"
                                        value="10">
                                {/if}
                            </div>
                        </div>
                        <div class="col-md-6">
                            <div class="form-group">
                                <label for="imageprice">{$tplVar['_lang']['payment_method']}</label>
                                <select name="paymentmethod" id="productpaymentmethod" class="form-control">
                                    <option value="PAYPAL">PayPal</option>
                                    <option value="CREDIT_CARD">CreditCard</option>
                                    <option value="BANK_ACCOUNT">Bank Account</option>
                                    <option value="ovhAccount">ovhAccount</option>
                                </select>
                                <small>{$tplVar['_lang']['support_payment_methods']}</small>
                            </div>
                        </div>
                        <div class="col-md-6" id="sameMargin"><div class="form-group">
                            <div style="margin-top: 30px;">
                                <input type="checkbox" name="sameMargin"> <b>Do you want the same margin for all the product groups?</b>
                            </div>
                        </div>
                        </div>
                    </div>
                    <div class="btn-container">
                        <button type="button" class="btn btn-info EditPriceMargin" name="editedPriceSettingData"
                            style="display:none;">Edit price margin</button>
                        <button type="button" class="btn btn-info addPriceMargin" name="priceSettingData"> Add Price
                            Margin</button>
                        <button type="button" class="btn btn-info"
                            onclick="jQuery('#priceSettingForm').fadeToggle(1000);" name="priceSettingData">
                            {$tplVar['_lang']['back']}</button>
              
                    </div>

                </div>
            </form>
        </div>
    </li>
    <li id="imapNotificationSetting">
        <div class="alert alert-secondary" role="alert">{$tplVar['_lang']['imap_notification_note']}
         <span class="documentation"><a href="https://wiki.whmcsglobalservices.com/index.php?title=WHMCS_OVH_Module_Installation_Guide_%26_Documentation#Notification_Settings" target="_blank"> {$tplVar['_lang']['doc']}</a> </span>
        </div>
        <form method="POST" action="" id="imapACLSettings">

        </form>
    </li>

    <li id="generalSettings">
        <div class="alert alert-secondary" role="alert">{$tplVar['_lang']['general_note']}
             <span class="documentation"><a href="https://wiki.whmcsglobalservices.com/index.php?title=WHMCS_OVH_Module_Installation_Guide_%26_Documentation#Price_Margin_Setting" target="_blank"> {$tplVar['_lang']['doc']}</a> </span>
        </div>
        <form method="POST" action="" id="generalACLSettings">

        </form>

    </li>
    <li id="aclSettings">

        <div class="innerContent">
            <div class="tab0box" id="tab0box">
                <div id="tab_content">
                    <h1>{$tplVar['_lang']['product_setting']}</h1>
                    <div class="alert alert-secondary" role="alert"> {$tplVar['_lang']['acl_setting_note']}
                        <span class="documentation"><a href="https://wiki.whmcsglobalservices.com/index.php?title=WHMCS_OVH_Module_Installation_Guide_%26_Documentation#ACL_settings" target="_blank"> {$tplVar['_lang']['doc']}</a> </span>
                    </div>
                    <div class="tabbox2">
                        <div id="tab_content">
                            <form method="post" enctype="multipart/form-data">
                                <div class="tabbox2" id="tabbox2"
                                    style="width: 100%; border-top-width: 1px; border-top-color: rgb(210, 210, 210);">
                                    <table id="" class="datatable" width="100%" border="0" cellspacing="1"
                                        cellpadding="3">
                                        <thead>
                                            <tr>
                                                <th style="width: 36%">{$tplVar['_lang']['setting_product_name']}</th>
                                                <th style="width: 54%">{$tplVar['_lang']['settings']}</th>
                                            </tr>
                                        </thead>
                                        <tbody>

                                        </tbody>
                                    </table>
                                </div>
                                <div align="center">

                                    <button class="btn btn-info UpdateAclSettings" type="button" style="display: none;">Save Changes</button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            </div>
        </div>

    </li>

     <li id="orderformSettings">
        <div class="alert alert-secondary" role="alert">{$tplVar['_lang']['orderformSettings_note']}
         <span class="documentation"><a href="https://wiki.whmcsglobalservices.com/index.php?title=WHMCS_OVH_Module_Installation_Guide_%26_Documentation#OVH_Order_Form_Settings" target="_blank"> {$tplVar['_lang']['doc']}</a> </span>
        </div>
        <form method="POST" action="" id="orderformACLSettings">

        </form>

    </li>
    
</ul>


<script>
    $(function() {
        var activeIndex = $('.active-tab').index(),
            $contentlis = $('.tabs-content li'),
            $tabslis = $('.tabs li');
        $('.tabs').on('click', 'li', function(e) {
            var $current = $(e.currentTarget),
                index = $current.index();

            $tabslis.removeClass('active-tab');
            $current.addClass('active-tab');
            $contentlis.hide().eq(index).show();
        });
    });

    $("#server option").each(function() {
        if ($(this).val() == '{$tplVar["priceEditSettings"]->server}') {
        $(this).attr('selected', 'selected');
    }
    });

    $("#servertype option").each(function() {
        if ($(this).val() == '{$tplVar["priceEditSettings"]->servertype}') {
        $(this).attr('selected', 'selected');
    }
    });

    $("#productpaymentmethod option").each(function() {
        if ($(this).val() == '{$tplVar["priceEditSettings"]->paymentmethod}') {
        $(this).attr('selected', 'selected');
    }
    });
</script>



<!-- Modal -->
<div class="modal fade" id="viewCredentials" tabindex="-1" role="dialog" aria-labelledby="viewCredentialsTitle"
    aria-hidden="true">
    <div class="modal-dialog" role="document">
        <div class="modal-content">
            <div class="modal-header">
                <h5 class="modal-title" id="viewCredentialsTitle"><b>{$tplVar['_lang']['your_ovh_credentials']}</b></h5>
                <button type="button" class="close" data-dismiss="modal" aria-label="Close">
                    <span aria-hidden="true">&times;</span>
                </button>
            </div>
            <div class="modal-body">
                <div class="loading-overlay"></div>
                <div class="form-group">
                    <label for="view_app_key">{$tplVar['_lang']['application_key']}</label>
                    <input type="email" class="form-control" id="view_app_key" readonly>
                </div>
                <div class="form-group">
                    <label for="view_secret_key">{$tplVar['_lang']['secret_key']}</label>
                    <input type="email" class="form-control" id="view_secret_key" readonly>
                </div>
                <div class="form-group">
                    <label for="view_consumer_key">{$tplVar['_lang']['consumer_key']}</label>
                    <input type="email" class="form-control" id="view_consumer_key" readonly>
                </div>
            </div>
            <div class="modal-footer">
                <button type="button" class="btn btn-secondary"
                    data-dismiss="modal">{$tplVar['_lang']['close']}</button>
            </div>
        </div>
    </div>
</div>

<div class="modal fade" id="deleteMerzeCredentials" tabindex="-1" role="dialog" aria-labelledby="deleteMerzeCredentialsTitle"
    aria-hidden="true">
    <div class="modal-dialog" role="document">
        <div class="modal-content">
            <div class="modal-header">
                <h5 class="modal-title" id="deleteMerzeCredentialsTitle"><b>{$tplVar['_lang']['merge_account_heading']}</b></h5>
                <button type="button" class="close" data-dismiss="modal" aria-label="Close">
                    <span aria-hidden="true">&times;</span>
                </button>
            </div>
            <div class="modal-body">
                <div class="alert alert-warning" role="alert"> {$tplVar['_lang']['merge_account_note']} </div>
                <div class="form-group">
                    <label for="chose_account">{$tplVar['_lang']['merge_account']}</label>
                    <input type="hidden" id="authIdToDelete" value="">
                    <select id="chose_account" class="form-control" name="merge_account">
                        {foreach $tplVar["consumerKeyData"] as $value}
                            <option value="{$value->id}">{$value->account_number} - {$value->location|upper}</option>
                        {/foreach}
                    </select>
                </div>
               
            </div>
            <div class="modal-footer">
                <button type="button" class="btn btn-secondary" data-dismiss="modal">{$tplVar['_lang']['close']}</button>
                <button type="button" class="btn btn-danger confirmDeleteCredentials">{$tplVar['_lang']['confirmDeleteCredentialbtn']}</button>
            </div>
        </div>
    </div>
</div>

{include file=$tplVar.footer}