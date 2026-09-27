{**********************************************************************
* AmazonLightsail product developed. (2017-10-06)
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

<div class="lu-col-md-12">
    <div class="box light">
        <div class="box-title">
            <div class="caption">
                {if $rawObject->getIcon()}<i class="{$rawObject->getIcon()}"></i>{/if}
                <span class="caption-subject bold font-red-thunderbird uppercase">
                    {if $rawObject->isRawTitle()}{$rawObject->getRawTitle()}{elseif $rawObject->getTitle()}{$MGLANG->T($rawObject->getTitle())}{/if}
                </span>
            </div>
            <div class="rc-actions lu-pull-right" style="display: inline-flex;">
                {$rawObject->insertSearchForm()}
            </div>
        </div>
        <div class="box-body">
            <div class="lu-row">
                <div class="lu-col-md-12">
                    <form id="{$rawObject->getId()}" mgformtype="{$rawObject->getFormType()}" id="{$elementId}">
                        {foreach from=$rawObject->getSections() item=section}
                            {$section->getHtml()}
                        {/foreach}


                        {foreach from=$rawObject->getFields() item=field }
                            {$field->getHtml()}
                        {/foreach}

                        <div class="lu-col-md-12 ui-form-submit">
                            {$rawObject->getSubmitHtml()}
                        </div>
                    </form>
                </div>
            </div>
        </div>
    </div>
</div>
             
