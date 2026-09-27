{* CloudHost247 Tools - Category Template *}
<div class="CloudHost247-tools-category">
    <div class="CloudHost247-tools-hero CloudHost247-cat-hero">
        <div class="container">
            <nav aria-label="breadcrumb">
                <ol class="breadcrumb">
                    <li class="breadcrumb-item"><a href="{$base_url}">Tools Platform</a></li>
                    <li class="breadcrumb-item active">{$category_label} Tools</li>
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
            "></i> {$category_label} Tools</h1>
            <p class="lead">{count($tools)} tools available in this category</p>
        </div>
    </div>

    <div class="container CloudHost247-tools-container">
        <div class="row CloudHost247-category-tools">
            {foreach from=$tools key=toolId item=tool}
            <div class="col-md-4 col-sm-6">
                <div class="CloudHost247-tool-card">
                    <div class="CloudHost247-tool-icon">
                        <i class="fas {$tool.icon}"></i>
                    </div>
                    <h4>{$tool.name}</h4>
                    <p>{$tool.desc}</p>
                    <a href="{$base_url}&action=tool&tool={$toolId}" class="btn btn-primary btn-block">
                        <i class="fas fa-play"></i> Use Tool
                    </a>
                </div>
            </div>
            {/foreach}
        </div>
    </div>
</div>
