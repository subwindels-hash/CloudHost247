{if $error}
    <div style="margin: 1rem 0 1rem 0;">
        <span class="red-error-text">{$error}</span>
    </div>
    <b>Hi</b>
{else}
<b>Hi</b>
    <div id="customFieldsWidget" class="mgWidget mgWidget__panel mgWidget__widget">
        <div class="mgWidget__header">
            <div class="mgWidget__top">
                <div class="mgWidget__title">
                    <b>{$lang->T('customFields')}</b>
                    <b>Hi</b>
                </div>
            </div>
            <div class="alert-caution">
                <div class="alert-caution-text">{$lang->T('customFieldsAlert')}</div>
            </div>
        </div>
        <div class="mgWidget__body-content config-option-box">
            <div class="mgWidget__body-row">
                {foreach from=$customFields item=field}
                    <div class="col-md-6 p-r-4x config-option text-left">
                        <b>{$field['fieldname']}</b>
                    </div>
                {/foreach}
                {if count($customFields) % 2 !== 0}
                    <div class="col-md-6 p-r-4x config-option text-left">
                    </div>
                {/if}
            </div>
            <div class="col-md-12 confirm-row">
                <a href="javascript:;" class="mgButton-open" id="customFieldsOpener">
                    <b class="mgButton__icon"><span>&#43</span></b>
                    <span class="mgButton__text"><b>{$lang->T('createCustomFields')}</b></span>
                </a>
            </div>
        </div>
    </div>
    </div>
    <!-- Modal -->
    <div class="modal fade" id="customFieldsModal" tabindex="-1" role="dialog" aria-labelledby="mgLabel"
         aria-hidden="true">
        <div class="modal-dialog" role="document">
            <div class="modal-content">
                <div class="modal-header">
                    <div class="modal-top">
                        <span class="modal-title" id="exampleModalLabel">{$lang->T('customFields')}</span>
                    </div>
                    <div class="modal-toolbar">
                        <button type="button" class="close" data-dismiss="modal" aria-label="Close">
                            <span aria-hidden="true">&times;</span>
                        </button>
                    </div>
                </div>
                <div class="modal-body">
                    <form id="addCustomFieldsForm">
                        {foreach from=$customFields item=field}
                            <div class="modal-form-check modal-m-b-2x">
                                <label>
                                    <span class="modal-form-text" style="width: 200px;">{$field['fieldname']}</span>
                                    <label class="switch option-switch">
                                        <input type="checkbox" id="{$field['fieldname']}CustomFieldSwitch" checked>
                                        <span class="slider round"></span>
                                    </label>
                                </label>
                            </div>
                        {/foreach}
                    </form>
                </div>
                <div class="modal-footer">
                    <a href="javascript:;" class="btn mg-btn modalButton__success" id="customFieldsAccept">
                    <span class="mgButton__text">
                        <b>{$lang->T('customFieldsModalButtonCreate')}</b>
                        <div class="mg-loader" hidden></div>
                    </span>
                    </a>
                    <button type="button" class="btn mg-btn modalButton__cancel"
                            data-dismiss="modal">{$lang->T('customFieldsModalButtonCancel')}</button>
                </div>
            </div>
        </div>
    </div>
{/if}

<script>
    var whmcsProductId = {$whmcsProductId};
    var succesLangCustomFields = "{$lang->T('customFieldsCreateSuccess')}";
</script>

<script src="{$jsDir}/toast.js"></script>
<script src="{$jsDir}/customFields.js"></script>

<style>
    @import "{$cssDir}/toast.css";
    @import "{$cssDir}/mg_styles.css";
</style>
