{**********************************************************************
* AmazonLightsail product developed. (2017-11-16)
* *
*
*  CREATED BY MODULESGARDEN       ->       http://modulesgarden.com
*  CONTACT                        ->       contact@modulesgarden.com
*
*
* This software is furnished under a license and may be used and copied
* only  in  accordance  with  the  terms  of such  license and with the
* inclusion of the above copyright notice.  This software  or any other
* copies thereof may not be provided or otherwise made available to any
* other person.  No title to and  ownership of the  software is  hereby
* transferred.
*
*
**********************************************************************}

{**
* @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
*}

<div class="lu-modal show lu-modal--{$rawObject->getModalSize()}" id="confirmationModal" namespace="{$rawObject->getNamespace()}" index="{$rawObject->getId()}">
    <div class="lu-modal__dialog">
        <div class="lu-modal__content" id="mgModalContainer">
            <div class="lu-modal__top lu-top">
                <div class="lu-top__title lu-type-6">
                    <span class="lu-text-faded lu-font-weight-normal">
                        {if $rawObject->isRawTitle()}{$rawObject->getRawTitle()}{elseif $rawObject->getTitle()}{$MGLANG->T('modal', $rawObject->getTitle())}{/if}
                    </span>
                </div>
                <div class="lu-top__toolbar">
                    <button class="lu-btn lu-btn--xs lu-btn--default lu-btn--icon lu-btn--link lu-btn--plain closeModal" data-dismiss="lu-modal" aria-label="Close" @click='closeModal($event)'>
                        <i class="lu-btn__icon lu-zmdi lu-zmdi-close"></i>
                    </button>
                </div>
            </div>
            {assign var="editForms" value=$rawObject->getForms()}
            {assign var="editForm" value=$editForms|array_pop}
            <div class="lu-modal__nav">
                <ul class="lu-nav lu-nav--md lu-nav--h lu-nav--tabs">
                    {assign var="sectArrKeys" value=$editForm->getSections()|array_keys}
                    {foreach from=$editForm->getSections() key=sectionID  item=section }
                        <li class="lu-nav__item {if $sectArrKeys[0] == $sectionID}is-active{/if}">
                            <a class="lu-nav__link" data-toggle="lu-tab" href="#modalTab{$sectionID}">
                                <span class="lu-nav__link-text">{$section->getName()}</span>
                            </a>
                        </li>
                    {/foreach}
                </ul>
            </div>
            <div class="lu-modal__body">
                {if $editForm->haveInternalAlertMessage()}
                    <div class="lu-alert {if $editForm->getInternalAlertSize() !== ''}lu-alert--{$editForm->getInternalAlertSize()}{/if} lu-alert--{$editForm->getInternalAlertMessageType()} lu-alert--faded modal-alert-top">
                        <div class="lu-alert__body">
                            {if $editForm->isInternalAlertMessageRaw()|unescape:'html'}{$editForm->getInternalAlertMessage()}{else}{$MGLANG->T($editForm->getInternalAlertMessage())|unescape:'html'}{/if}
                        </div>
                    </div>
                {/if}
                {if $editForm->getConfirmMessage()}
                    {if $editForm->isTranslateConfirmMessage()}
                        {$MGLANG->T($editForm->getConfirmMessage())|unescape:'html'}
                    {else}
                        {$editForm->getConfirmMessage()|unescape:'html'}
                    {/if}
                {/if}
                <form id="{$editForm->getId()}" namespace="{$editForm->getNamespace()}" index="{$editForm->getId()}" mgformtype="{$editForm->getFormType()}">
                    {foreach from=$editForm->getFields() item=field }
                        {$field->getHtml()}
                    {/foreach}
                    <div class="lu-tab-content">
                        {assign var="sectArrKeys" value=$editForm->getSections()|array_keys}
                        {foreach from=$editForm->getSections() key=sectionID  item=section }
                            <div class="lu-tab-pane {if $sectArrKeys[0] == $sectionID}is-active{/if}" id="modalTab{$sectionID}">
                                <div class="lu-list-group lu-list-group--simple lu-list-group--p-h-0x list-group--collapse lu-m-b-0x">
                                    <div class="lu-row">
                                        {$section->getHtml()}
                                    </div>
                                </div>
                            </div>
                        {/foreach}
                    </div>
                </form>
            </div>
            <div class="lu-modal__actions">
                {foreach from=$rawObject->getActionButtons() item=actionButton}
                    {$actionButton->getHtml()}
                {/foreach}
            </div>
            {if ($isDebug eq true AND (count($MGLANG->getMissingLangs()) != 0))}{literal}
                <div class="lu-modal__actions">
                <div class="lu-row">
            {/literal}{foreach from=$MGLANG->getMissingLangs() key=varible item=value}{literal}
                <div class="lu-col-md-12"><b>{/literal}{$varible}{literal}</b> = '{/literal}{$value}{literal}';</div>
            {/literal}{/foreach}{literal}
                </div>
                </div>
            {/literal}{/if}
        </div>
    </div>
</div>