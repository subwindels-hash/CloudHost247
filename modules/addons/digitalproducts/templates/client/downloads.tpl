{* CloudHost247 Digital Products - Client Area Downloads Template *}

<div class="digitalproducts-wrapper">
    {if isset($content)}
        {$content}
    {else}
        <div class="alert alert-info">No download content available.</div>
    {/if}
</div>

<style>
.digitalproducts-wrapper .dp-client-hero {
    background: linear-gradient(135deg, #0f4c81, #2563eb);
    color: #fff;
    border-radius: 10px;
    padding: 26px 28px;
    margin-bottom: 24px;
}
.digitalproducts-wrapper .dp-client-hero h2 { margin-top: 0; }
.digitalproducts-wrapper .dp-download-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(290px, 1fr));
    gap: 18px;
}
.digitalproducts-wrapper .dp-download-card { border-radius: 10px; overflow: hidden; }
.digitalproducts-wrapper .dp-download-card h3 { margin-top: 0; }
.digitalproducts-wrapper .dp-download-meta { margin-top: 12px; }
.digitalproducts-wrapper .dp-download-meta > div { margin-bottom: 12px; }
.digitalproducts-wrapper .dp-download-actions { margin-top: 16px; }
.digitalproducts-wrapper code,
.digitalproducts-wrapper .dp-checksum {
    background: #f7f9fc;
    border: 1px solid #dbe3ef;
    border-radius: 4px;
    color: #1f2937;
    display: inline-block;
    max-width: 100%;
    overflow-wrap: anywhere;
    padding: 2px 6px;
}
@media (min-width: 768px) {
    .digitalproducts-wrapper .text-sm-right { text-align: right; }
}
@media (max-width: 767px) {
    .digitalproducts-wrapper .dp-client-hero { padding: 20px; }
    .digitalproducts-wrapper .dp-download-grid { display: block; }
    .digitalproducts-wrapper .dp-download-card { margin-bottom: 16px; }
    .digitalproducts-wrapper .dp-download-actions .btn,
    .digitalproducts-wrapper .dp-download-actions form { display: block; width: 100%; margin-bottom: 8px; }
}
</style>
