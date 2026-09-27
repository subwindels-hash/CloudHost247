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
* @author Artur Pilch <artur.pi@modulesgarden.com>
*}

<script type="text/x-template" id="t-mg-details-widget-{$elementId|strtolower}"
        :component_id="component_id"
        :component_namespace="component_namespace"
        :component_index="component_index"
>
    <div class="lu-row lu-row--eq-height">
        <div class="lu-col-lg-12">
            <div class="lu-widget">
                <div class="lu-widget__header">
                    <div class="lu-widget__top lu-top">
                        <div class="lu-top__title">{literal}{{ title }}{/literal}</div>
                    </div>
                </div>
                <div class="lu-widget__body">
                    <div class="lu-widget__content" v-if="data.length > 0">
                        <ul class="lu-list lu-list--info" v-for="detail in data">
                            <li class="lu-list__item">
                                <span class="lu-list__item-title" v-html="detail.key">{literal}{{ detail.key }}{/literal}</span>
                                <span class="lu-list__value" v-html="detail.value">{literal}{{ detail.value }}{/literal}</span>
                            </li>

                        </ul>
                    </div>
                    <div v-else style="padding: 15px; text-align: center; border-top: 1px solid #e9ebf0;">
                        {$MGLANG->absoluteT('noDataAvalible')}
                    </div>
                </div>
                <div class="lu-preloader-container lu-preloader-container--full-screen lu-preloader-container--overlay" v-show="loading_state">
                    <div class="lu-preloader lu-preloader--sm"></div>
                </div>
            </div>
        </div>
    </div>

</script>
