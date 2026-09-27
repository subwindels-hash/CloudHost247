<script type="text/x-template" id="t-ds-copy-on-click-{$elementId|strtolower}">
    <span @click="copyTextToClipboard" class="mg-copy-component-span"><input id="cp_txt_{$elementId}" class="mg-copy-component-field" type="text" v-bind:value="text_to_copy"> {literal} {{text_to_copy}}{/literal}
        <i data-title="{$MGLANG->controlerContextTranslate('ClickToCopyText')}" data-toggle="lu-tooltip" class="lu-i-c-2x lu-zmdi lu-zmdi-help-outline lu-form-tooltip-helper"></i>
   </span>
</script>
