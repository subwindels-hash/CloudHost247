{**********************************************************************
* AmazonLightsail product developed. (2017-08-24)
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

<div id="{$mainContainer->getVueInstanceName()}" class="vue-app-main-container">
    <div class="lu-row"><i v-show="pageLoading" class="page_processing"></i></div>

    {foreach from=$elements key=nameElement item=dataElement}
        {$dataElement->getHtml()}
    {/foreach}

    <div id="allDropDown"></div>
    <div class="lu-preloader-container lu-preloader-container--full-screen lu-preloader-container--overlay" v-show="pagePreLoader">
        <div class="lu-preloader lu-preloader--lg"></div>
    </div>
</div>

<div id="loadedTemplates"></div>
<script>
    $('body').append('<div style="height: 0px;width: 0px;" id="layers"><div class="lu-app"><div class="lu-app-main"><div class="lu-app-main__body"><div id="{$mainContainer->getVueInstanceName()}_modal" class="vue-app-main-modal-container"></div></div></div></div></div>');
</script>
