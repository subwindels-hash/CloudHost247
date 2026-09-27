{include file=$tplVar.header}
<div class="addon_inner">
    <h2 class="ad_title">{$tplVar['_lang']['about']}</h2>
    <div class="ad_content_sec">
        <div class="add_version_sec">
            <table width="100%" border="0" cellspacing="0" cellpadding="0" class="ad_on_table">
                <tr>
                    <td>{$tplVar['_lang']['version']}</td>
                    <td align="right">{$tplVar["version"]}</td>
                </tr>
                <tr bgcolor="f3f8fd">
                    <td>{$tplVar['_lang']['licenseregname']}</td>
                    <td align="right">{$tplVar['license']['registeredname']}</td>
                </tr>
                <tr>
                    <td>{$tplVar['_lang']['licenseregemail']}</td>
                    <td align="right">{$tplVar["license"]['email']}</td>
                </tr>
                <tr bgcolor="f3f8fd">
                    <td>{$tplVar['_lang']['licensevaliddomain']}</td>
                    <td align="right">{$tplVar["license"]["validdomain"]}</td>
                </tr>
                <tr>
                    <td>{$tplVar['_lang']['license']} </td>
                    <td align="right">{$tplVar["license_key"]}</td>
                </tr>
                <tr bgcolor="f3f8fd">
                    <td>{$tplVar['_lang']['licensestatus']}</td>
                    <td align="right"><span class="license {if {$tplVar["license"]["status"]} eq "Active"} active {else} invalid{/if}">{$tplVar["license"]["status"]}</span><span id="checkLicense" > <i data-licensekey="{$tplVar['license_key']}" class="fas fa-sync-alt" title="Refresh License" style="cursor: pointer; "></i><span ></td>
                </tr>
                {* <tr bgcolor="f3f8fd">
                    <td>{$tplVar['_lang']['licenshardcheck']}</td>
                    <td align="right"><button class="btn btn-primary" id="checkLicense" data-licensekey="{$tplVar['license_key']}">Refresh License</button></td>
                </tr> *}
                <tr>
                    <td>{$tplVar['_lang']['author']}</td>
                    <td align="right">{$tplVar['_lang']['authorname']}</td>
                </tr>
                <tr bgcolor="f3f8fd">
                    <td>{$tplVar['_lang']['productname']}</td>
                    <td align="right">{$tplVar['_lang']['productName']}</td>
                </tr>
                <tr>
                    <td>{$tplVar['_lang']['lastupdated']}</td>
                    <td align="right">26 Aug 2026</td>
                </tr>
            </table>
        </div>
    </div>
</div>
{include file=$tplVar.footer}