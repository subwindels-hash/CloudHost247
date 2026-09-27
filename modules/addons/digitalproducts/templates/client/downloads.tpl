{* Digital Products - Client Area Downloads Template *}

<div class="digitalproducts-wrapper">
    <div class="page-header">
        <h2><i class="fa fa-download"></i> My Downloads</h2>
    </div>

    <p class="text-muted">Manage your purchased digital products, download files and view license keys.</p>

    {if isset($content)}
        {$content}
    {else}
        <div class="alert alert-info">
            <p>No download content available.</p>
        </div>
    {/if}
</div>

<style>
.digitalproducts-wrapper .badge-info {
    background-color: #5bc0de;
    color: #fff;
}
.digitalproducts-wrapper code {
    background: #f5f5f5;
    border: 1px solid #ddd;
    padding: 2px 6px;
    border-radius: 3px;
    font-size: 12px;
}
.digitalproducts-wrapper .table > tbody > tr.active > td {
    background-color: #f9f9f9;
    border-top: none;
}
</style>
