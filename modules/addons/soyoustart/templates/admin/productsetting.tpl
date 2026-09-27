{include file=$tplVar.header}
<script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>
<style>
    p {
        font-size: 11px !important;
        color: #5c5c5c !important;
    }

    .panel-heading {
        background: #2162a3 !important;
        color: #fff !important;
        text-align: center;
    }

    .top-su-form .product-creation-types .type {
        padding: 20px 10px;
        border: 2px solid #dde6ef;
        border-radius: 4px;
        text-align: center;
        margin: 10px 3px;
        box-shadow: none;
        background: #fff;
    }

    .multi-select-blocks div.active {
        border-color: #369 !important;
        background-color: #eff7ff !important;
    }

    .fieldlabel {
        padding: 10px;
    }

    .warning {
        background-position: 15px;
        margin: 10px 0;
        padding: 6px 10px 6px 60px;
        min-height: 28px;
        background-color: #f3f2ea;
        border: 1px solid #dfe0e0;
        color: #000;
        text-align: center;
        -moz-border-radius: 5px;
        -webkit-border-radius: 5px;
        -o-border-radius: 5px;
        border-radius: 5px;
    }

    #ovhgroupnamewhmcs {
        text-transform: capitalize !important;
    }

    .adon_ftrlinks p {
        color: #fff !important;
    }

    .product-data td.fieldarea {
        position: relative;
        display: flex;
        align-items: center;
    }

    .product-data span.form-icon {
        margin-left: 10px;
    }

    .product-data td.fieldarea input {
        margin-left: 10px;

    }

    #ovhproducthtml tbody tr:first-child td {
        padding-top: 10px;
        padding-bottom: 10px;
    }

    td.productNotFound {
        color: red;
        font-weight: bolder;
        text-align: center;
        height: 173px;
    }

    #ovhproducthtml i.fa-spin {
        top: 50%;
        position: absolute;
        left: 50%;
        font-size: 30px;
        font-weight: bolder;
    }

    /* .ovhproducts {
        position: absolute;
        top: 0;
        bottom: 19px;
        background: #0000001a;
        left: 15px;
        right: 15px;
    }

    img#ovhproducts {
        position: absolute;
        left: 50%;
        top: 50%;
        width: 24px;
    } */
</style>

<div class="innerContent">
    <h1>{$tplVar['_lang']['productSettingHeading']}</h1>

    <div class="alert alert-secondary" role="alert"> {$tplVar['_lang']['product_setting_note']}
        <span class="documentation"><a href="https://wiki.whmcsglobalservices.com/index.php?title=WHMCS_OVH_Module_Installation_Guide_%26_Documentation#Setup_the_OVH_VPS_.2F_Dedicated_Products" target="_blank"> {$tplVar['_lang']['doc']}</a> </span>
    </div>
    <form id="product_setup" name="product_setup" method="post" onsubmit="ShowLoading()">

        <table class="form top-su-form" width="100%" border="0" cellspacing="0" cellpadding="0"
            style="background:#eff4f9!important">
            <tbody>
                <tr>
                    <td class="" style="text-align:center;"><strong>{$tplVar['_lang']['productType']}</strong></td>
                    <td class="">
                        <div class="multi-select-blocks product-creation-types clearfix">
                            <div class="block">
                                <div class="type active" data-type="hostingaccount" id="productTypeDedicated"
                                    data-productType="Dedicated">
                                    <i class="fa fa-server"></i><span>{$tplVar['_lang']['productTypeDedicated']}</span>
                                </div>
                            </div>

                            <div class="block">
                                <div class="type" data-type="hostingaccount" id="productTypeVPS" data-productType="VPS">
                                    <i class="fa fa-hdd"></i><span>{$tplVar['_lang']['productTypeVps']}</span>
                                </div>
                            </div>
                            <div class="block">
                                <div class="type" data-type="hostingaccount" id="productTypeECO" data-productType="ECO">
                                    <i class="fa fa-server"></i><span>{$tplVar['_lang']['productTypeECO']}</span>
                                </div>
                            </div>
                        </div>
                    </td>
                </tr>
            </tbody>
        </table>
        <input type="hidden" name="ovhproductgroupname" value="Dedicated" id="ovhproductgroupname">
        <input type="hidden" name="ovhlocationtype" value="Ovh" id="ovhlocationtype">

        <div class="row" style="margin-top: 30px;">
            <div class="col-md-6">
                <div class="panel panel-default">
                    <div class="panel-heading">{$tplVar['_lang']['accountSetting']} </div>
                    <div class="panel-body">
                        <div class="form-group row">
                            <label class="col-md-2 col-form-label">{$tplVar['_lang']['accountName']} </label>
                            <div class="col-md-10">
                                <select name="ovhservicetype" id="inputModule" class="form-control">
                                    {foreach from=$tplVar["accountName"] key=accountNamekey item=accountNameValue}
                                        <option value="{$accountNameValue}">{$accountNameValue}</option>
                                    {/foreach}
                                </select>
                                <img src="images/loading.gif" id="ovhservicetypeloader" style="display: none;">

                            </div>
                        </div>
                        <div class="form-group row">
                            <label
                                class="col-md-2 col-form-label subsidiaryclass">{$tplVar['_lang']['ovhSubsidiary']}</label>
                            <div class="col-md-10 subsidiaryclass">
                                <select name="ovhsubsidiarytype" class="form-control" id="ovhsubsidiarytype">

                                </select>
                                {* <img src="{$tplVar.urlPath}templates/assets/images/loading.gif"
                                    id="ovhsubsidiarytypeloader" style="display: none;"> *}

                            </div>


                        </div>
                    </div>
                </div>
            </div>
            <div class="col-md-6">
                <div class="panel panel-default">
                    <div class="panel-heading">Hide Opreating System Name to display in order</div>
                    <div class="panel-body">
                        <div class="form-group row">
                            <label class="col-md-2 col-form-label">OS Name : </label>
                            <div class="col-md-10">

                                <select name="hideOS[]" id="hideOS" class="form-control select2" multiple="multiple">

                                   
                                    {foreach from=$tplVar["hideOsName"] key=hideOsNameKey item=hideOsNameValue}
                                        <option value="{$hideOsNameValue}" {if !empty($tplVar["hideOs"]) && in_array($hideOsNameValue,
                                        $tplVar["hideOs"])} selected {/if}>{$hideOsNameValue}</option>
                                    {/foreach}

                                </select>
                                <p> <b><u>By Default List Comes :</u></b>
                                    {foreach from=$tplVar["hideOsName"] key=defaultOsListKey item=defaultOsListValue}
                                        {$defaultOsListValue},
                                    {/foreach}

                                <div class="text-right">
                                    <button type="button" class="btn btn-primary" id="saveHideOs">Save OS</button>
                                </div>
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

        </div>

        <div class="row" style="margin-top: 30px;">
            <div class="col-md-6">
                <div class="panel panel-default">
                    <div class="panel-heading">Group Setting</div>
                    <div class="panel-body">
                        <div class="form-group row">
                            <label for="inputPassword" class="col-md-2 col-form-label">Choose Group Name</label>
                            <div class="col-md-10">
                                <select name="ovhproducttype" id="inputovhgroup" class="form-control">

                                </select>

                                <img src="{$tplVar.urlPath}templates/assets/images/loading.gif"
                                    id="ovhproducttypeloader" style="display: none;">
                            </div>
                        </div>
                        <div class="form-group row">
                            <label for="inputPassword" class="col-md-2 col-form-label">WHMCS Product Group Name</label>
                            <div class="col-md-10">
                                <input type="text" id="ovhgroupnamewhmcs" name="ovhgroupname" value="Rise "
                                    class="form-control">
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="col-md-6">
                <table class="panel panel-default product-data" width="100%" border="0" cellspacing="0" cellpadding="0">
                    <thead>
                        <tr>
                            <th colspan="2" class="panel-heading" style="text-align:center;"><strong>Create Selected
                                    Product From <span class="select-grpname"></span></strong> Group</th>
                        </tr>
                    </thead>

                    <tbody style="height: 174px !important;">
                        <tr id="ovhproducthtml">
                            {* <td>
                                <img src="https://ovh-new.shinedezign.pro/modules/addons/soyoustart/templates/assets/images/loading.gif" id="ovhproducts" style="/* text-align: center; */display: block;margin:0 auto;">
                            </td> *}
                        </tr>

                    </tbody>


                    {* <tbody>
                        <tr>
                            <th colspan="2" class="panel-heading" style="text-align:center;"><strong>Create Selected
                                    Product From <span class="select-grpname"></span></strong> Group</th>
                        </tr>
                        <tr id="ovhproducthtml">
                            <td>
                            <td class="fieldlabel" width="15%">
                        </tr>
                        <tr>
                            <td>
                            <div class="ovhproducts">
                                <img src="{$tplVar.urlPath}templates/assets/images/loading.gif" id="ovhproducts"
                                    style="display: none;">
                            </div>
                            </td>
                        </tr>
                    </tbody> *}
                </table>
            </div>
        </div>

        <div class="btn-container">
            <button type="button" class="btn btn-primary createProduct"> Create Product </button>
            <button type="button" class="btn btn-info" id="hideDepricatedProduct"> Hide Deprecated Products </button>
            <!-- <input type="submit" value="Create Product" class="btn btn-primary createProduct" name="soyouStartproductSetup"> -->
        </div>
    </form>

</div>

{* products *}
<h1>Products</h1>
{if empty($tplVar["products"])}
    <div class="warning"><strong><span class="title">No Such Product Found</span></strong><br></div>
{else}
    {foreach from=$tplVar["products"] key=key item=value }
        <table width="100%" class="form">
            <tbody>
                <tr style="padding: 8px;display: grid;">
                    <td colspan="2" class="fieldarea" style="text-align:center;background:#dddddd;padding:10px;font-size:16px;">
                        <strong>{$key}</strong>
                    </td>
                </tr>
                <tr>
                    <td align="center">
                        <div class="tablebg table-responsive">
                            <table class="datatable filterable table" width="100%" border="0" cellspacing="1" cellpadding="3">
                                <tbody>
                                    <tr>
                                        <th style="width: 5%;">{$tplVar['_lang']['product_id']}</th>
                                        <th>{$tplVar['_lang']['product_name']}</th>
                                        <th style="width: 10%;">{$tplVar['_lang']['clientarea_link']}</th>
                                        <th style="width: 10%;">{$tplVar['_lang']['view_price']}</th>
                                        <th style="width: 15%;">{$tplVar['_lang']['delete_product']}</th>
                                    </tr>
                                    {foreach from=$value item=product}
                                        <tr>
                                            <td class="text-center"><a href="configproducts.php?action=edit&id={$product->id}">{$product->id}</a></td>
                                            <td class="text-center">{$product->name}</td>
                                            <td class="text-center">
                                                <a href="../cart.php?a=add&pid={$product->id}" target="_blank"><input type="button" value="{$tplVar['_lang']['view']}" class="btn">
                                            </td>
                                            <td class="text-center">
                                                <a href="{$tplVar["moduleLink"]}&action=productpricesetting&id={$product->id}" target="_blank"><input type="button" value="{$tplVar['_lang']['view']}" class="btn btn-success"></a>
                                            </td>
                                            <td class="text-center">
                                                {if $product->pricesync} 
                                                    <button class="btn btn-primary enableDisablePriceSync" data-type="enable" data-id="{$product->id}">Enable Price Sync</button>
                                                {else}
                                                    <button class="btn btn-info enableDisablePriceSync" data-type="disable" data-id="{$product->id}"">Disable Price Sync</button>
                                                {/if}

                                                <button class="btn btn-danger delete_product" data-id={$product->id}>{$tplVar['_lang']['delete']}</button>
                                                {* <a href="{$tplVar["moduleLink"]}&action=productsetting&tab=delete_product&id={$product->id}"><input type="button" value="{$tplVar['_lang']['delete']}" name="delete_product" class="btn btn-danger"></a>
                                               *}
                                            </td>
                                        </tr>
                                    {/foreach}
                                </tbody>
                            </table>
                        </div>
                    </td>
                </tr>
            </tbody>
        </table>

    {/foreach}
{/if}

{include file=$tplVar.footer}