{* Tools Center - Main Dashboard Template *}

<div class="tools-center-container">
    <!-- Hero Section -->
    <div class="tc-hero">
        <div class="tc-hero-content">
            <h1><i class="fa fa-wrench"></i> Tools Center</h1>
            <p class="tc-lead">All-in-One Tools Marketplace - 60+ professional tools for developers, network engineers, and webmasters</p>
            <div class="tc-stats-bar">
                <span class="tc-stat"><i class="fa fa-tools"></i> 60+ Tools</span>
                <span class="tc-stat"><i class="fa fa-server"></i> 10 Categories</span>
                <span class="tc-stat"><i class="fa fa-bolt"></i> Instant Results</span>
            </div>
        </div>
    </div>

    <!-- Category Grid -->
    <div class="tc-categories">
        {foreach from=$toolCategories key=catKey item=cat}
        <div class="tc-category-card" data-category="{$catKey}">
            <div class="tc-category-icon">
                <i class="fa {$cat.icon}"></i>
            </div>
            <h3>{$cat.name}</h3>
            <p>{$cat.description}</p>
            <div class="tc-tool-count">{count($cat.tools)} tools</div>
            <a href="index.php?m=tools_center&cat={$catKey}" class="btn btn-primary btn-sm">
                <i class="fa fa-arrow-right"></i> Open Tools
            </a>
        </div>
        {/foreach}
    </div>

    <!-- Popular Tools Section -->
    <div class="tc-section">
        <h2><i class="fa fa-fire"></i> Popular Tools</h2>
        <div class="tc-quick-tools">
            {foreach from=$toolCategories key=catKey item=cat}
                {foreach from=$cat.tools item=tool name=toolLoop}
                    {if $smarty.foreach.toolLoop.index < 2}
                    <div class="tc-quick-tool" onclick="openTool('{$catKey}', '{$tool.action}')">
                        <div class="tc-tool-icon"><i class="fa {$cat.icon}"></i></div>
                        <div class="tc-tool-info">
                            <h4>{$tool.name}</h4>
                            <p>{$tool.desc}</p>
                        </div>
                        <i class="fa fa-chevron-right tc-arrow"></i>
                    </div>
                    {/if}
                {/foreach}
            {/foreach}
        </div>
    </div>

    <!-- All Tools Accordion -->
    <div class="tc-section">
        <h2><i class="fa fa-list"></i> All Tools</h2>
        <div class="tc-accordion" id="toolsAccordion">
            {foreach from=$toolCategories key=catKey item=cat}
            <div class="tc-accordion-item">
                <div class="tc-accordion-header" data-toggle="collapse" data-target="#collapse{$catKey}">
                    <i class="fa {$cat.icon}"></i>
                    <span>{$cat.name}</span>
                    <span class="tc-badge">{count($cat.tools)}</span>
                    <i class="fa fa-chevron-down tc-chevron"></i>
                </div>
                <div id="collapse{$catKey}" class="tc-accordion-body collapse">
                    <div class="tc-tools-list">
                        {foreach from=$cat.tools item=tool}
                        <div class="tc-tool-item" onclick="openTool('{$catKey}', '{$tool.action}')">
                            <span class="tc-tool-name">{$tool.name}</span>
                            <span class="tc-tool-desc">{$tool.desc}</span>
                        </div>
                        {/foreach}
                    </div>
                </div>
            </div>
            {/foreach}
        </div>
    </div>
</div>

<!-- Tool Modal -->
<div id="toolModal" class="tc-modal">
    <div class="tc-modal-content">
        <div class="tc-modal-header">
            <h3 id="modalTitle">Tool Name</h3>
            <button class="tc-close" onclick="closeToolModal()">&times;</button>
        </div>
        <div class="tc-modal-body" id="modalBody">
            <!-- Tool form and results will be loaded here -->
        </div>
    </div>
</div>