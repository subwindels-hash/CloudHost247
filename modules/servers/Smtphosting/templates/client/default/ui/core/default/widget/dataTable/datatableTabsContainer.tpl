{**********************************************************************
* Multibrand product developed. (2017-07-21)
*
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

<div class="row-fluid">
    <div class="box light" id="{$elementId}">
        <div class="box-title tabbable-line">
            {***CONTAINER*HEADER*TITLE***********************************************************}
            <div class="caption">
                <i class="fa fa-cogs font-red-thunderbird"></i>
                <span class="caption-subject bold font-red-thunderbird uppercase">
                    {$MGLANG->T('title')}
                </span>
            </div>

            {if $customTplVars.topLine}
                <ul class="nav nav-tabs">
                    {foreach from=$customTplVars.topLine key=tplKey item=tplValue}
                        <li {if $tplKey === 'Nowy'} class="active" {/if}><a data-toggle="tab" href="#contTab{$tplValue->getId()}">{$MGLANG->T($tplValue->getId())}</a></li>
                    {/foreach}
                </ul>
            {/if}
            {***CONTAINER*HEADER*TABS************************************************************}
            <div class="rc-actions pull-right" style="display: inline-flex;">

            </div>
            {***DATATABLES*BODY*****************************************************************}
            <div class="row">
                <div class="lu-col-md-12">
                    <div class="box-body">
                        <div class="lu-tab-content">
                            {foreach from=$customTplVars.topLine key=tplKey item=tplValue}
                                <div id="contTab{$tplValue->getId()}" class="lu-tab-pane {if $tplKey === 'Nowy'} active {/if}">
                                    {$tplValue->getHtml()}
                                </div>
                            {/foreach}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>

