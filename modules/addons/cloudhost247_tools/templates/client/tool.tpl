{* CloudHost247 Tools - Individual Tool Template *}
<div class="cloudhost247-tool-page">
    <div class="cloudhost247-tools-hero cloudhost247-tool-hero">
        <div class="container">
            <nav aria-label="breadcrumb">
                <ol class="breadcrumb">
                    <li class="breadcrumb-item"><a href="{$base_url|escape}">Tools Platform</a></li>
                    <li class="breadcrumb-item"><a href="{$base_url|escape}&action=category&cat={$tool.category|escape}">{ucfirst($tool.category)|escape} Tools</a></li>
                    <li class="breadcrumb-item active">{$tool.name|escape}</li>
                </ol>
            </nav>
            <h1><i class="fas {$tool.icon|escape}"></i> {$tool.name|escape}</h1>
            <p class="lead">{$tool.desc|escape}</p>
        </div>
    </div>

    <div class="container cloudhost247-tools-container">
        <div class="row">
            <div class="col-md-8">
                <div class="cloudhost247-tool-workspace">
                    <form id="cloudhost247-tool-form" class="cloudhost247-tool-form" data-tool="{$tool.id|escape}">
                        <input type="hidden" name="csrf_token" value="{$csrf_token|escape}">
                        <input type="hidden" name="tool" value="{$tool.id|escape}">
                        <input type="hidden" name="action" value="ajax">

                        {* Tool-specific form fields rendered by JavaScript based on tool ID *}
                        <div id="cloudhost247-tool-fields"></div>

                        <div class="cloudhost247-tool-actions">
                            <button type="submit" class="btn btn-primary btn-lg">
                                <i class="fas fa-cogs"></i> Run Tool
                            </button>
                            <button type="button" class="btn btn-outline-secondary" onclick="cloudhost247ResetTool()">
                                <i class="fas fa-undo"></i> Reset
                            </button>
                        </div>
                    </form>

                    <div id="cloudhost247-tool-loading" class="cloudhost247-loading" style="display:none;">
                        <div class="spinner-border text-primary" role="status">
                            <span class="sr-only">Loading...</span>
                        </div>
                        <p>Processing... Please wait.</p>
                    </div>

                    <div id="cloudhost247-tool-result" class="cloudhost247-tool-result" style="display:none;">
                        <div class="cloudhost247-result-header">
                            <h3><i class="fas fa-check-circle"></i> Result</h3>
                            <button class="btn btn-sm btn-outline-dark" onclick="cloudhost247CopyResult()">
                                <i class="fas fa-copy"></i> Copy
                            </button>
                        </div>
                        <div id="cloudhost247-result-content" class="cloudhost247-result-content"></div>
                    </div>

                    <div id="cloudhost247-tool-error" class="alert alert-danger" style="display:none;"></div>
                </div>
            </div>

            <div class="col-md-4">
                <div class="cloudhost247-tool-sidebar">
                    <div class="card">
                        <div class="card-header">
                            <i class="fas fa-info-circle"></i> About This Tool
                        </div>
                        <div class="card-body">
                            <p>{$tool.desc|escape}</p>
                            <p class="text-muted small">Category: {ucfirst($tool.category)|escape}</p>
                        </div>
                    </div>

                    <div class="card mt-3">
                        <div class="card-header">
                            <i class="fas fa-list"></i> Related Tools
                        </div>
                        <div class="card-body">
                            <ul class="list-unstyled mb-0">
                                {* Get related tools from same category (limited to 5) *}
                                {assign var="relatedCount" value=0}
                                {foreach from=$categories[$tool.category] key=rId item=rTool}
                                    {if $rId != $tool.id && $relatedCount < 5}
                                        <li><a href="{$base_url|escape}&action=tool&tool={$rId|escape}"><i class="fas {$rTool.icon|escape}"></i> {$rTool.name|escape}</a></li>
                                        {assign var="relatedCount" value=$relatedCount+1}
                                    {/if}
                                {/foreach}
                            </ul>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>

<script>
document.addEventListener('DOMContentLoaded', function() {
    cloudhost247RenderToolForm('{$tool.id|escape}', '{$tool.category|escape}');
});
</script>
