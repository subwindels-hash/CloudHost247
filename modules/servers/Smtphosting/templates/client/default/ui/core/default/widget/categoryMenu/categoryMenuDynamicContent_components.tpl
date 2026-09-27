
{**********************************************************************
* AmazonLightsail product developed. (2017-09-18)
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

<template id="category-menu-empty-menu-cont"
          :component_id="component_id"
          :component_namespace="component_namespace"
          :component_index="component_index"
>
    <div class="content-overlay" style="min-height: 200px;">
        <div class="lu-widget">
            <div class="lu-widget__body" style="min-height: 200px;">
                <div class="lu-preloader-container lu-preloader-container--full-screen lu-preloader-container--overlay" v-show="contentLoading">
                    <div class="lu-preloader lu-preloader--sm"></div>
                </div>
            </div>
        </div>
    </div>
</template>                                    