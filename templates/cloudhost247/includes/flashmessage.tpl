{* One flash message, rendered as a Bootstrap alert the design system already styles.

   `get_flash_message()` is the platform helper the vendor themes use, so this partial keeps
   the same contract while dropping the `textcenter` argument the vendor version accepted:
   an alert that spans the width of a form reads better left-aligned. *}
{if $message = get_flash_message()}
    <div class="alert alert-{if $message.type == "error"}danger{elseif $message.type == 'success'}success{elseif $message.type == 'warning'}warning{else}info{/if}" role="alert">
        {$message.text}
    </div>
{/if}
