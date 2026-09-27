{**********************************************************************
* AmazonLightsail product developed. (2017-10-30)
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

<div class="control-group {$style.classes}">
    <div class="lu-row">
        {if $rawObject->isRawTitle() || $rawObject->getTitle()}
            <div class="lu-col-md-{$rawObject->getLabelWidth()}">
                <label class="control-label">
                    {if $rawObject->isRawTitle()}{$rawObject->getRawTitle()}{elseif $rawObject->getTitle()}{$MGLANG->T($rawObject->getTitle())}{/if}
                </label>
            </div>
        {/if}

        <div class="lu-col-md-{$rawObject->getWidth()}">
            <select
                    class="lu-form-control"
                    name="{$rawObject->getName()}"
                    {if $rawObject->isDisabled()}disabled="disabled"{/if}
                    {if $rawObject->isMultiple()}data-options="removeButton:true; resotreOnBackspace:true; dragAndDrop:true; maxItems: null;" multiple="multiple"{/if}
            >
                {$rawObject->getAvailableValues()}
                {foreach from=$rawObject->getAvailableValues() key=opValue item=option}
                    <option value="{$opValue}" {if $opValue == $rawObject->getValue()}selected{/if}>
                        {$MGLANG->T($option)}
                    </option>
                {/foreach}
            </select>
        </div>
    </div>

    {if $rawObject->getDescription()}
        <div class="lu-row">
            <div class="lu-col-md-offset-{$rawObject->getLabelWidth()} lu-col-md-{$rawObject->getWidth()}">
                <span class="lu-help-block">
                    {$MGLANG->T($rawObject->getDescription())}
                </span>
            </div>
        </div>
    {/if}
</div>
