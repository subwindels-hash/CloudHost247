<script type="text/x-template" id="t-dt-ajax-field-{$elementId|strtolower}">
    <i v-if="loading_state" class="lu-btn__icon lu-preloader lu-preloader--sm"></i>
    <span v-else v-html="data.ajaxData"></span>
</script>
