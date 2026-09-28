{* CloudHost247 Tools - Dashboard Template *}
<div class="cloudhost247-tools-dashboard">
    <div class="cloudhost247-tools-hero">
        <div class="container">
            <h1><i class="fas fa-tools"></i> Online Tools Platform</h1>
            <p class="lead">Professional DNS, IP, Developer, Security & Productivity tools for webmasters</p>
            <div class="cloudhost247-search-box">
                <input type="text" id="cloudhost247-tool-search" class="form-control" placeholder="Search tools... (e.g. DNS, IP, SSL)" autocomplete="off">
                <i class="fas fa-search"></i>
            </div>
        </div>
    </div>

    <div class="container cloudhost247-tools-container">
        <div class="row" id="cloudhost247-categories-grid">
            {foreach from=$categories key=catKey item=catTools}
            <div class="col-md-4 col-sm-6 cloudhost247-category-card" data-category="{$catKey|escape}">
                <div class="cloudhost247-card">
                    <div class="cloudhost247-card-header cloudhost247-cat-{$catKey|escape}">
                        <h3>
                            {if $catKey == 'dns'}<i class="fas fa-server"></i>{/if}
                            {if $catKey == 'ip'}<i class="fas fa-network-wired"></i>{/if}
                            {if $catKey == 'developer'}<i class="fas fa-code"></i>{/if}
                            {if $catKey == 'designer'}<i class="fas fa-palette"></i>{/if}
                            {if $catKey == 'webmaster'}<i class="fas fa-globe"></i>{/if}
                            {if $catKey == 'network'}<i class="fas fa-ethernet"></i>{/if}
                            {if $catKey == 'security'}<i class="fas fa-shield-alt"></i>{/if}
                            {if $catKey == 'productivity'}<i class="fas fa-magic"></i>{/if}
                            {if $catKey == 'gaming'}<i class="fas fa-gamepad"></i>{/if}
                            {ucfirst($catKey)|escape} Tools
                        </h3>
                        <span class="cloudhost247-tool-count">{count($catTools)} tools</span>
                    </div>
                    <div class="cloudhost247-card-body">
                        <ul class="cloudhost247-tool-list">
                            {foreach from=$catTools key=toolId item=tool}
                            <li class="cloudhost247-tool-item" data-tool="{$toolId|escape}" data-name="{strtolower($tool.name)|escape}">
                                <a href="{$base_url|escape}&action=tool&tool={$toolId|escape}">
                                    <i class="fas {$tool.icon|escape}"></i> {$tool.name|escape}
                                </a>
                                <small class="cloudhost247-tool-desc">{$tool.desc|escape}</small>
                            </li>
                            {/foreach}
                        </ul>
                        <a href="{$base_url|escape}&action=category&cat={$catKey|escape}" class="btn btn-sm btn-outline-primary cloudhost247-view-all">
                            View All <i class="fas fa-arrow-right"></i>
                        </a>
                    </div>
                </div>
            </div>
            {/foreach}
        </div>
    </div>
</div>

<script>
document.addEventListener('DOMContentLoaded', function() {
    var searchInput = document.getElementById('cloudhost247-tool-search');
    if (searchInput) {
        searchInput.addEventListener('input', function() {
            var query = this.value.toLowerCase();
            var items = document.querySelectorAll('.cloudhost247-tool-item');
            var cards = document.querySelectorAll('.cloudhost247-category-card');

            items.forEach(function(item) {
                var name = item.getAttribute('data-name') || '';
                if (name.indexOf(query) !== -1) {
                    item.style.display = '';
                } else {
                    item.style.display = 'none';
                }
            });

            cards.forEach(function(card) {
                var visible = card.querySelectorAll('.cloudhost247-tool-item:not([style*="none"])');
                card.style.display = visible.length > 0 ? '' : 'none';
            });
        });
    }
});
</script>
