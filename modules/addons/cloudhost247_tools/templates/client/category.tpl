{* CloudHost247 Tools - Category Template *}
<div class="cloudhost247-tools-category">
    <div class="cloudhost247-tools-hero cloudhost247-cat-hero">
        <div class="container">
            <nav aria-label="breadcrumb">
                <ol class="breadcrumb">
                    <li class="breadcrumb-item"><a href="{$base_url|escape}">Tools Platform</a></li>
                    <li class="breadcrumb-item active">{$category_label|escape} Tools</li>
                </ol>
            </nav>
            <h1><i class="fas 
                {if $category == 'dns'}fa-server{/if}
                {if $category == 'ip'}fa-network-wired{/if}
                {if $category == 'developer'}fa-code{/if}
                {if $category == 'designer'}fa-palette{/if}
                {if $category == 'webmaster'}fa-globe{/if}
                {if $category == 'network'}fa-ethernet{/if}
                {if $category == 'security'}fa-shield-alt{/if}
                {if $category == 'productivity'}fa-magic{/if}
                {if $category == 'gaming'}fa-gamepad{/if}
            "></i> {$category_label|escape} Tools</h1>
            <p class="lead">{count($tools)} tools available in this category</p>
        </div>
    </div>

    <div class="container cloudhost247-tools-container">
        <div class="row cloudhost247-category-tools">
            {foreach from=$tools key=toolId item=tool}
            <div class="col-md-4 col-sm-6">
                <div class="cloudhost247-tool-card">
                    <div class="cloudhost247-tool-icon">
                        <i class="fas {$tool.icon|escape}"></i>
                    </div>
                    <h4>{$tool.name|escape}</h4>
                    <p>{$tool.desc|escape}</p>
                    <a href="{$base_url|escape}&action=tool&tool={$toolId|escape}" class="btn btn-primary btn-block">
                        <i class="fas fa-play"></i> Use Tool
                    </a>
                </div>
            </div>
            {/foreach}
        </div>
    </div>
</div>
