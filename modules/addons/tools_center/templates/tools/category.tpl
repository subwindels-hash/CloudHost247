{* Tools Center - Category Page Template *}

<div class="tools-center-container">
    <!-- Breadcrumb -->
    <nav class="tc-breadcrumb">
        <a href="index.php?m=tools_center"><i class="fa fa-home"></i> Tools Center</a>
        <i class="fa fa-angle-right"></i>
        <span>{if isset($toolCategories[$currentCategory])}{$toolCategories[$currentCategory].name}{else}Tools{/if}</span>
    </nav>

    {if isset($toolCategories[$currentCategory])}
    {$cat = $toolCategories[$currentCategory]}
    
    <div class="tc-category-header">
        <div class="tc-category-icon-large">
            <i class="fa {$cat.icon}"></i>
        </div>
        <div class="tc-category-info">
            <h1>{$cat.name} Tools</h1>
            <p>{$cat.description}</p>
        </div>
    </div>

    <div class="tc-tools-grid">
        {foreach from=$cat.tools item=tool}
        <div class="tc-tool-card" onclick="openTool('{$currentCategory}', '{$tool.action}')">
            <div class="tc-tool-card-icon">
                <i class="fa {$cat.icon}"></i>
            </div>
            <h4>{$tool.name}</h4>
            <p>{$tool.desc}</p>
            <span class="tc-tool-link">Use Tool <i class="fa fa-arrow-right"></i></span>
        </div>
        {/foreach}
    </div>
    {else}
    <div class="tc-alert tc-alert-warning">
        <i class="fa fa-exclamation-triangle"></i> Category not found.
        <a href="index.php?m=tools_center">Return to dashboard</a>
    </div>
    {/if}
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