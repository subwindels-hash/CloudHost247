{if $error}
    <div style="margin: 1rem 0 1rem 0;">
        <span class="red-error-text">{$error}</span>
    </div>
{else}
    <div id="optionsWidget" class="mgWidget mgWidget__panel mgWidget__widget">
        <div class="mgWidget__header">
            <div class="mgWidget__top">
                <div class="mgWidget__title">
                    <b>{$lang->T('configurableOptions')}</b>
                </div>
            </div>
            <div class="alert-caution">
                <div class="alert-caution-text">{$lang->T('configurableOptionsAlert')}</div>
            </div>
        </div>
        <div class="mgWidget__body">
            <div class="mgWidget__body-content config-option-box">
                <div class="mgWidget__body-row">
                    {foreach from=$configOptions item=option}
                        <div class="col-md-6 p-r-4x config-option text-left">
                            <b>{$option['optionname']}</b>
                        </div>
                    {/foreach}
                    {if count($configOptions) % 2 !== 0}
                        <div class="col-md-6 p-r-4x config-option text-left">
                        </div>
                    {/if}
                </div>
                <div class="col-md-12 confirm-row">
                    <a href="javascript:;" class="mgButton-open" id="configOptionsOpener">
                        <b class="mgButton__icon"><span>&#43</span></b>
                        <span class="mgButton__text"><b>{$lang->T('createConfigurableOptions')}</b></span>
                    </a>
                </div>
            </div>
        </div>
    </div>
    <!-- Modal -->
    <div class="modal fade" id="configOptions" tabindex="-1" role="dialog" aria-labelledby="mgLabel"
         aria-hidden="true">
        <div class="modal-dialog" role="document">
            <div class="modal-content">
                <div class="modal-header">
                    <div class="modal-top">
                        <span class="modal-title" id="exampleModalLabel">{$lang->T('configurableOptions')}</span>
                    </div>
                    <div class="modal-toolbar">
                        <button type="button" class="close" data-dismiss="modal" aria-label="Close">
                            <span aria-hidden="true">&times;</span>
                        </button>
                    </div>
                </div>
                <div class="modal-body">
                    <form id="addOptionsForm">
                        {foreach from=$configOptions item=option}
                            <div class="modal-form-check modal-m-b-2x">
                                <label>
                                    {assign var=optionArray value="|"|explode:$option['optionname']}
                                    <span class="modal-form-text">{$option['optionname']}</span>
                                    <label class="switch option-switch">
                                        <input type="checkbox" id="{$optionArray[0]}OptionSwitch" checked>
                                        <span class="slider round"></span>
                                    </label>
                                </label>
                            </div>
                        {/foreach}
                    </form>
                </div>
                <div class="modal-footer">
                    <a href="javascript:;" class="btn mg-btn modalButton__success" id="configOptionsAccept">
                    <span class="mgButton__text">
                        <b>{$lang->T('configurableOptionsModalButtonCreate')}</b>
                        <div class="mg-loader" hidden></div>
                    </span>
                    </a>
                    <button type="button" class="btn mg-btn modalButton__cancel"
                            data-dismiss="modal">{$lang->T('configurableOptionsModalButtonCancel')}</button>
                </div>
            </div>
        </div>
    </div>
{/if}

<script>
    var whmcsProductId = {$whmcsProductId};
    var succesLangConfigOptions = "{$lang->T('configOptionsCreateSuccess')}";
</script>
<script src="{$jsDir}/toast.js"></script>
<script src="{$jsDir}/configOptions.js"></script>

<style>
    @import "{$cssDir}/toast.css";
    @import "{$cssDir}/mg_styles.css";
</style>
