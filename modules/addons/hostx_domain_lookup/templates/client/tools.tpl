{* HostX Tools - Client Area Main Page *}
{* Tools listing page *}

<div class="hostx-tools-container">
    <div class="hostx-tools-hero">
        <div class="hostx-tools-hero-content">
            <h1><i class="fa fa-wrench"></i> HostX Tools</h1>
            <p class="hostx-tools-subtitle">Professional networking tools for domain analysis, IP intelligence, and DNS diagnostics.</p>
        </div>
    </div>
    
    <div class="hostx-tools-grid">
        {foreach from=$tools item=tool}
        <div class="hostx-tool-card" data-tool="{$tool.id}">
            <div class="hostx-tool-card-icon">
                <i class="{$tool.icon}"></i>
            </div>
            <div class="hostx-tool-card-content">
                <h3>{$tool.name}</h3>
                <p>{$tool.description}</p>
                <a href="{$tool.url}" class="btn btn-primary btn-sm">
                    <i class="fa fa-arrow-right"></i> Open Tool
                </a>
            </div>
        </div>
        {foreachelse}
        <div class="hostx-tools-empty">
            <i class="fa fa-info-circle"></i>
            <p>No tools are currently enabled. Please contact the administrator.</p>
        </div>
        {/foreach}
    </div>
    
    <div class="hostx-tools-footer">
        <p><small>Powered by HostX Tools v{$version|default:'1.0.0'} &bull; Results are cached for optimal performance</small></p>
    </div>
</div>
