{* CloudHost247 Tools - Dashboard Template *}
<div class="CloudHost247-tools-dashboard">
    <div class="CloudHost247-tools-hero">
        <div class="container">
            <h1><i class="fas fa-tools"></i> Online Tools Platform</h1>
            <p class="lead">Professional DNS, IP, Developer, Security & Productivity tools for webmasters</p>
            <div class="CloudHost247-search-box">
                <input type="text" id="CloudHost247-tool-search" class="form-control" placeholder="Search tools... (e.g. DNS, IP, SSL)" autocomplete="off">
                <i class="fas fa-search"></i>
            </div>
        </div>
    </div>

    <div class="container CloudHost247-tools-container">
        <div class="row" id="CloudHost247-categories-grid">
            {foreach from=$categories key=catKey item=catTools}
            <div class="col-md-4 col-sm-6 CloudHost247-category-card" data-category="{$catKey}">
                <div class="CloudHost247-card">
                    <div class="CloudHost247-card-header CloudHost247-cat-{$catKey}">
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
                            {ucfirst($catKey)} Tools
                        </h3>
                        <span class="CloudHost247-tool-count">{count($catTools)} tools</span>
                    </div>
                    <div class="CloudHost247-card-body">
                        <ul class="CloudHost247-tool-list">
                            {foreach from=$catTools key=toolId item=tool}
                            <li class="CloudHost247-tool-item" data-tool="{$toolId}" data-name="{strtolower($tool.name)}">
                                <a href="{$base_url}&action=tool&tool={$toolId}">
                                    <i class="fas {$tool.icon}"></i> {$tool.name}
                                </a>
                                <small class="CloudHost247-tool-desc">{$tool.desc}</small>
                            </li>
                            {/foreach}
                        </ul>
                        <a href="{$base_url}&action=category&cat={$catKey}" class="btn btn-sm btn-outline-primary CloudHost247-view-all">
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
    var searchInput = document.getElementById('CloudHost247-tool-search');
    if (searchInput) {
        searchInput.addEventListener('input', function() {
            var query = this.value.toLowerCase();
            var items = document.querySelectorAll('.CloudHost247-tool-item');
            var cards = document.querySelectorAll('.CloudHost247-category-card');

            items.forEach(function(item) {
                var name = item.getAttribute('data-name') || '';
                if (name.indexOf(query) !== -1) {
                    item.style.display = '';
                } else {
                    item.style.display = 'none';
                }
            });

            cards.forEach(function(card) {
                var visible = card.querySelectorAll('.CloudHost247-tool-item:not([style*="none"])');
                card.style.display = visible.length > 0 ? '' : 'none';
            });
        });
    }
});
</script>
