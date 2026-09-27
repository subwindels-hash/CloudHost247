{**********************************************************************
* AmazonLightsail product developed. (2017-09-05)
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
* @author Pawel Kopec <pawelk@modulesgarden.com>
*}

<script type="text/x-template" id="t-mg-passtoogle-{$elementId|strtolower}"
        :component_id="component_id"
        :component_namespace="component_namespace"
        :component_index="component_index"
>
    <div>
        <!-- show password-->
        <span v-show="passwordShow">{$rawObject->getPassword()}</span>
        <span class="lu-icon-sm lu-btn-password-show" style="cursor: pointer;" v-show="passwordShow" @click="passwordShow = !passwordShow"><i class="{$rawObject->getIconOff()} lu-btn--default lu-btn--link"></i></span>
        <!-- hide password-->
        <span v-show="!passwordShow">{$rawObject->getPasswordHidden()}</span>
        <span class="lu-icon-sm lu-btn-default lu-btn-password-hide" style="cursor: pointer;" v-show="!passwordShow" @click="passwordShow = !passwordShow"><i class="{$rawObject->getIconOn()} lu-btn--default lu-btn--link"></i></span>
    </div>
</script>
