{* HostX Tools - Dashboard Template *}
<div class="hostx-tools-dashboard">
    <div class="hostx-tools-hero">
        <div class="container">
            <h1><i class="fas fa-tools"></i> Online Tools Platform</h1>
            <p class="lead">Professional DNS, IP, Developer, Security & Productivity tools for webmasters</p>
            <div class="hostx-search-box">
                <input type="text" id="hostx-tool-search" class="form-control" placeholder="Search tools... (e.g. DNS, IP, SSL)" autocomplete="off">
                <i class="fas fa-search"></i>
            </div>
        </div>
    </div>

    <div class="container hostx-tools-container">
        <div class="row" id="hostx-categories-grid">
            {foreach from=$categories key=catKey item=catTools}
            <div class="col-md-4 col-sm-6 hostx-category-card" data-category="{$catKey}">
                <div class="hostx-card">
                    <div class="hostx-card-header hostx-cat-{$catKey}">
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
                        <span class="hostx-tool-count">{count($catTools)} tools</span>
                    </div>
                    <div class="hostx-card-body">
                        <ul class="hostx-tool-list">
                            {foreach from=$catTools key=toolId item=tool}
                            <li class="hostx-tool-item" data-tool="{$toolId}" data-name="{strtolower($tool.name)}">
                                <a href="{$base_url}&action=tool&tool={$toolId}">
                                    <i class="fas {$tool.icon}"></i> {$tool.name}
                                </a>
                                <small class="hostx-tool-desc">{$tool.desc}</small>
                            </li>
                            {/foreach}
                        </ul>
                        <a href="{$base_url}&action=category&cat={$catKey}" class="btn btn-sm btn-outline-primary hostx-view-all">
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
    var searchInput = document.getElementById('hostx-tool-search');
    if (searchInput) {
        searchInput.addEventListener('input', function() {
            var query = this.value.toLowerCase();
            var items = document.querySelectorAll('.hostx-tool-item');
            var cards = document.querySelectorAll('.hostx-category-card');

            items.forEach(function(item) {
                var name = item.getAttribute('data-name') || '';
                if (name.indexOf(query) !== -1) {
                    item.style.display = '';
                } else {
                    item.style.display = 'none';
                }
            });

            cards.forEach(function(card) {
                var visible = card.querySelectorAll('.hostx-tool-item:not([style*="none"])');
                card.style.display = visible.length > 0 ? '' : 'none';
            });
        });
    }
});
</script>
