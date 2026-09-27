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

<script type="text/x-template" id="t-mg-ajax-sidebar-{$elementId|strtolower}"
        :component_id="component_id"
        :component_namespace="component_namespace"
        :component_index="component_index"
>
    <div class="lu-block">
        <div class="lu-block__sidebar">
            <div>
                <div class="lu-inner-wrapper-sticky">
                    <div class="lu-widget">
                        <div class="lu-widget__header">
                            <div class="lu-widget__top lu-top">
                                <div class="lu-top__title">{$MGLANG->T($rawObject->getId())}</div>
                            </div>
                        </div>
                        <div class="lu-widget__body">
                            <ul class="lu-nav lu-nav--tabs lu-nav--border-left">
                                <li class="lu-nav__item" v-for="item in items">
                                    <a v-if="item.clickAction.action !== null" :disabled="item.htmlAtributes.disabled" :class="'lu-nav__link ' + item.class + ' mg-ajax-menu-item'" :target="item.htmlAtributes.target ? item.htmlAtributes.target : '_self'" v-on:click="runClickAction($event, item.clickAction)">
                                        <i :class="item.icon"></i> <span class="lu-btn__text">{{ item.title }}</span>
                                    </a>
                                    <a v-else :disabled="item.htmlAtributes.disabled" :class="'lu-nav__link lu-btn lu-btn--default lu-btn--link lu-btn--plain mg-ajax-menu-item'" :target="item.htmlAtributes.target ? item.htmlAtributes.target : '_self'" :href="item.htmlAtributes.href">
                                        <i :class="item.icon"></i> <span class="lu-btn__text">{{ item.title }}</span>
                                    </a>
                                </li>
                            </ul>
                        </div>
                        <div class="lu-preloader-container lu-preloader-container--full-screen lu-preloader-container--overlay" v-show="sidebarLoading">
                            <div class="lu-preloader lu-preloader--sm"></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</script>
