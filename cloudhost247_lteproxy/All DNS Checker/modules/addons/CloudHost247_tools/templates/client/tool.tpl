{* CloudHost247 Tools - Individual Tool Template *}
<div class="CloudHost247-tool-page">
    <div class="CloudHost247-tools-hero CloudHost247-tool-hero">
        <div class="container">
            <nav aria-label="breadcrumb">
                <ol class="breadcrumb">
                    <li class="breadcrumb-item"><a href="{$base_url}">Tools Platform</a></li>
                    <li class="breadcrumb-item"><a href="{$base_url}&action=category&cat={$tool.category}">{ucfirst($tool.category)} Tools</a></li>
                    <li class="breadcrumb-item active">{$tool.name}</li>
                </ol>
            </nav>
            <h1><i class="fas {$tool.icon}"></i> {$tool.name}</h1>
            <p class="lead">{$tool.desc}</p>
        </div>
    </div>

    <div class="container CloudHost247-tools-container">
        <div class="row">
            <div class="col-md-8">
                <div class="CloudHost247-tool-workspace">
                    <form id="CloudHost247-tool-form" class="CloudHost247-tool-form" data-tool="{$tool.id}">
                        <input type="hidden" name="csrf_token" value="{$csrf_token}">
                        <input type="hidden" name="tool" value="{$tool.id}">
                        <input type="hidden" name="action" value="ajax">

                        {* Tool-specific form fields rendered by JavaScript based on tool ID *}
                        <div id="CloudHost247-tool-fields"></div>

                        <div class="CloudHost247-tool-actions">
                            <button type="submit" class="btn btn-primary btn-lg">
                                <i class="fas fa-cogs"></i> Run Tool
                            </button>
                            <button type="button" class="btn btn-outline-secondary" onclick="CloudHost247ResetTool()">
                                <i class="fas fa-undo"></i> Reset
                            </button>
                        </div>
                    </form>

                    <div id="CloudHost247-tool-loading" class="CloudHost247-loading" style="display:none;">
                        <div class="spinner-border text-primary" role="status">
                            <span class="sr-only">Loading...</span>
                        </div>
                        <p>Processing... Please wait.</p>
                    </div>

                    <div id="CloudHost247-tool-result" class="CloudHost247-tool-result" style="display:none;">
                        <div class="CloudHost247-result-header">
                            <h3><i class="fas fa-check-circle"></i> Result</h3>
                            <button class="btn btn-sm btn-outline-dark" onclick="CloudHost247CopyResult()">
                                <i class="fas fa-copy"></i> Copy
                            </button>
                        </div>
                        <div id="CloudHost247-result-content" class="CloudHost247-result-content"></div>
                    </div>

                    <div id="CloudHost247-tool-error" class="alert alert-danger" style="display:none;"></div>
                </div>
            </div>

            <div class="col-md-4">
                <div class="CloudHost247-tool-sidebar">
                    <div class="card">
                        <div class="card-header">
                            <i class="fas fa-info-circle"></i> About This Tool
                        </div>
                        <div class="card-body">
                            <p>{$tool.desc}</p>
                            <p class="text-muted small">Category: {ucfirst($tool.category)}</p>
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
                                        <li><a href="{$base_url}&action=tool&tool={$rId}"><i class="fas {$rTool.icon}"></i> {$rTool.name}</a></li>
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
    CloudHost247RenderToolForm('{$tool.id}', '{$tool.category}');
});
</script>
