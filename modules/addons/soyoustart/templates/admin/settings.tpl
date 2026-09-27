{include file=$tplVar.header}

<div class="innerContent">
    <div class="tab0box" id="tab0box">
        <div id="tab_content">
            <h1>{$tplVar['_lang']['product_setting']}</h1>

            <div class="alert alert-secondary" role="alert"> {$tplVar['_lang']['acl_setting_note']}</div>

            <div class="tabbox2">
                <div id="tab_content">
                    <form method="post" enctype="multipart/form-data">

                        <div class="tabbox2" id="tabbox2"
                            style="width: 100%; border-top-width: 1px; border-top-color: rgb(210, 210, 210);">
                            <table id="" class="datatable" width="100%" border="0" cellspacing="1" cellpadding="3">
                                <thead>
                                    <tr>
                                        <th style="width: 36%">{$tplVar['_lang']['setting_product_name']}</th>
                                        <th style="width: 54%">{$tplVar['_lang']['settings']}</th>
                                        <th style="width: 12%">{$tplVar['_lang']['setting_action']}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {foreach from=$tplVar['products'] key=id item=value}
                                        <tr>
                                            <td class="text-center">{$value->name}</td>

                                            <td>
                                                <select name="productSettings[{$value->id}_{$value->name}][]"
                                                    class="form-control select2" multiple="multiple">
                                                    {foreach from=$tplVar["productSettings"] key=$key item=$productSetting}
                                                        {if isset($value->settings)}
                                                            <option value="{$key}" {if $key|in_array:$value->settings}selected{/if}> {$productSetting}</option>
                                                        {else}
                                                            <option value="{$key}"> {$productSetting}</option>
                                                        {/if}

                                                    {/foreach}

                                                </select>
                                            </td>

                                            <td class="text-center">

                                                &nbsp;<a
                                                    href="{$tplVar.moduleLink}&amp;action=settings&amp;tab=delete&amp;id={$value->id}_{$value->name}" onclick="return confirm('Are you sure want to delete?');"><i class="fa fa-trash" style="color: red;"></i>
                                            </td>
                                        </tr>
                                    {/foreach}
                                </tbody>
                            </table>
                        </div>
                        <div align="center"><input type="submit" class="btn btn-info" name="productsave" id="submit" value="Save Changes"></div>
                    </form>
                </div>
            </div>
        </div>
    </div>
</div>

{include file=$tplVar.footer}