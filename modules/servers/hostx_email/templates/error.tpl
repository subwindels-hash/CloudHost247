{*
    hostx_email - safe error view.

    Shown when the client-area controller could not render. No diagnostics are
    exposed: the correlation id lets support find the (redacted) log entry.
*}
<div class="alert alert-warning" role="alert">
    <p>{$message|escape}</p>
    {if $correlationId}
        <p class="small text-muted">Reference: <code>{$correlationId|escape}</code></p>
    {/if}
</div>
