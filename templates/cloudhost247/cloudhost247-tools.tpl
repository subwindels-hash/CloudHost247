<main id="main-content" class="ch247-tools">
{if not $ch247Tools.available}
<article class="ch247-tools__empty">
<header><h1>Tools</h1></header>
<p class="alert alert-warning" role="alert">{$ch247Tools.reason|escape}</p>
<p><a class="ch247-button" href="index.php">Return to the client area</a></p>
</article>
{elseif $ch247Tools.view == 'print'}
{include file="cloudhost247-tools-print.tpl"}
{else}
<header class="ch247-tools__hero">
<h1>{if $ch247Tools.view == 'history'}Tool history{elseif $ch247Tools.view == 'favorites'}Favourite tools{elseif $ch247Tools.view == 'reports'}Tool reports{elseif $ch247Tools.view == 'monitors'}Domain monitoring{elseif $ch247Tools.tool} {$ch247Tools.tool.name|escape}{else}Network &amp; developer tools{/if}</h1>
{if $ch247Tools.tool && $ch247Tools.view == 'tool'}<p class="lead">{$ch247Tools.tool.summary|escape}</p>{else}<p class="lead">DNS, IP, network, webmaster, security, domain and developer diagnostics — built into CloudHost247, using the same account, branding and integrations as the rest of the platform.</p>{/if}
<nav class="ch247-tools__nav" aria-label="Tool sections">
<a href="{$ch247Tools.catalog_url|escape:'html'}">All tools</a>
<a href="{$ch247Tools.favorites_url|escape:'html'}">Favourites</a>
<a href="{$ch247Tools.history_url|escape:'html'}">History</a>
<a href="{$ch247Tools.reports_url|escape:'html'}">Reports</a>
<a href="tools.php?view=monitors">Monitoring</a>
</nav>
</header>

{if $ch247Tools.notice}<p class="alert alert-success" role="status">{$ch247Tools.notice|escape}</p>{/if}
{if $ch247Tools.error}<p class="alert alert-danger" role="alert">{$ch247Tools.error|escape}</p>{/if}
{if not $ch247Tools.platform_enabled}<p class="alert alert-warning" role="alert">The tools platform is currently disabled by an administrator.</p>{/if}
{if not $ch247Tools.authenticated and not $ch247Tools.public_access}<p class="alert alert-info" role="alert">Sign in to run tools. <a href="clientarea.php">Sign in</a></p>{/if}

{if $ch247Tools.domain_context}
<section class="ch247-tools__context" aria-label="Domain shortcuts">
<h2>Domain: {$ch247Tools.domain_context.domain|escape}</h2>
<p class="ch247-tools__hint">These shortcuts run against the domain you are viewing. Only domains on your own account are offered in the client area.</p>
<div class="ch247-tools__chips">
{foreach $ch247Tools.domain_context.shortcuts as $shortcut}
<a class="ch247-chip" href="{$shortcut.url|escape:'html'}">{$shortcut.label|escape}</a>
{/foreach}
</div>
</section>
{/if}

{* ------------------------------------------------------------------ *}
{* Catalogue                                                          *}
{* ------------------------------------------------------------------ *}
{if $ch247Tools.view == 'catalog'}
<form class="ch247-tools__search" method="get" action="tools.php">
<div class="ch247-tools__searchrow">
<input type="search" name="q" value="{$ch247Tools.catalog.filters.q|escape}" placeholder="Search tools (dns, mx, whois, ssl, json, ping…)" aria-label="Search tools">
<button class="ch247-button" type="submit">Search</button>
</div>
{if $ch247Tools.catalog.filters.category}<input type="hidden" name="category" value="{$ch247Tools.catalog.filters.category|escape}">{/if}
</form>
<div class="ch247-tools__chips" role="navigation" aria-label="Categories">
<a class="ch247-chip {if not $ch247Tools.catalog.filters.category}ch247-chip--active{/if}" href="tools.php">All ({$ch247Tools.catalog.total|escape} shown)</a>
{foreach $ch247Tools.catalog.categories as $category}
<a class="ch247-chip {if $ch247Tools.catalog.filters.category == $category.id}ch247-chip--active{/if}" href="tools.php?category={$category.id|escape:'url'}">{$category.name|escape} ({$category.count|escape})</a>
{/foreach}
</div>
{if $ch247Tools.catalog.items}
<div class="ch247-grid ch247-tools__grid">
{foreach $ch247Tools.catalog.items as $item}
<article class="ch247-card ch247-tool-card">
<header>
<h2><a href="{$item.url|escape:'html'}">{$item.name|escape}</a></h2>
<span class="ch247-badge ch247-badge--{$item.status.tone|escape}">{$item.status.label|escape}</span>
</header>
<p>{$item.summary|escape}</p>
{if $item.status.state != 'ACTIVE'}<p class="ch247-tools__hint">{$item.status.detail|escape}</p>{/if}
<footer>
<span class="ch247-tools__hint">{$item.category|escape} · {$item.rate_tier|escape}{if $item.requires_auth} · sign-in required{/if}{if $item.client_only} · runs in your browser{/if}</span>
<a class="ch247-button ch247-button--ghost" href="{$item.url|escape:'html'}">Open</a>
</footer>
</article>
{/foreach}
</div>
{else}
<p>No tool matches that search or filter. <a href="tools.php">Show all tools</a>.</p>
{/if}
{/if}

{* ------------------------------------------------------------------ *}
{* Single tool                                                        *}
{* ------------------------------------------------------------------ *}
{if $ch247Tools.view == 'tool' && $ch247Tools.tool}
<article class="ch247-tools__tool">
<header class="ch247-tools__toolhead">
<div>
<h2>{$ch247Tools.tool.name|escape}</h2>
<p>{$ch247Tools.tool.description|escape}</p>
</div>
<div class="ch247-tools__toolmeta">
<span class="ch247-badge ch247-badge--{$ch247Tools.tool.status_detail.tone|escape}">{$ch247Tools.tool.status_detail.label|escape}</span>
{if $ch247Tools.authenticated}
<form method="post" action="tools.php" class="ch247-inline-form">
<input type="hidden" name="token" value="{$ch247Tools.csrf|escape}">
<input type="hidden" name="tool" value="{$ch247Tools.slug|escape}">
<input type="hidden" name="action" value="{if $ch247Tools.tool.favorite}unfavorite{else}favorite{/if}">
<button class="ch247-button ch247-button--ghost" type="submit">{if $ch247Tools.tool.favorite}Remove from favourites{else}Add to favourites{/if}</button>
</form>
{/if}
</div>
</header>
{if $ch247Tools.tool.status_detail.state != 'ACTIVE'}<p class="alert alert-warning" role="alert">{$ch247Tools.tool.status_detail.detail|escape}</p>{/if}
{if $ch247Tools.tool.client_only}<p class="alert alert-info">This tool runs entirely in your browser. Nothing is submitted to the server.</p>{/if}
<form class="ch247-tools__form" method="post" action="tools.php">
<input type="hidden" name="token" value="{$ch247Tools.csrf|escape}">
<input type="hidden" name="tool" value="{$ch247Tools.slug|escape}">
<input type="hidden" name="run_tool" value="1">
<div class="ch247-tools__fields">
{foreach $ch247Tools.fields as $field}
<div class="ch247-field ch247-field--{$field.type|escape}">
<label for="ch247-field-{$field.name|escape}">{$field.label|escape}{if $field.required} <span aria-hidden="true">*</span>{/if}</label>
{if $field.type == 'textarea'}
<textarea id="ch247-field-{$field.name|escape}" name="fields[{$field.name|escape}]" rows="{if $field.rows}{$field.rows|escape}{else}5{/if}"{if $field.maxlength} maxlength="{$field.maxlength|escape}"{/if}{if $field.required} required{/if}>{$field.value|escape}</textarea>
{elseif $field.type == 'select'}
<select id="ch247-field-{$field.name|escape}" name="fields[{$field.name|escape}]"{if $field.required} required{/if}>
{foreach $field.options as $optionValue => $optionLabel}
<option value="{$optionValue|escape}"{if $field.value == $optionValue} selected{/if}>{$optionLabel|escape}</option>
{/foreach}
</select>
{elseif $field.type == 'multiselect'}
<select id="ch247-field-{$field.name|escape}" name="fields[{$field.name|escape}][]" multiple size="{if $field.size}{$field.size|escape}{else}5{/if}">
{foreach $field.options as $optionValue => $optionLabel}
<option value="{$optionValue|escape}">{$optionLabel|escape}</option>
{/foreach}
</select>
{elseif $field.type == 'checkbox'}
<input type="checkbox" id="ch247-field-{$field.name|escape}" name="fields[{$field.name|escape}]" value="1"{if $field.default} checked{/if}>
{elseif $field.type == 'number'}
<input type="number" id="ch247-field-{$field.name|escape}" name="fields[{$field.name|escape}]" value="{$field.value|escape}"{if $field.min} min="{$field.min|escape}"{/if}{if $field.max} max="{$field.max|escape}"{/if}{if $field.step} step="{$field.step|escape}"{/if}{if $field.required} required{/if}>
{elseif $field.type == 'password'}
<input type="password" id="ch247-field-{$field.name|escape}" name="fields[{$field.name|escape}]" value="" autocomplete="new-password"{if $field.required} required{/if}>
{elseif $field.type == 'json'}
<textarea id="ch247-field-{$field.name|escape}" name="fields[{$field.name|escape}]" rows="8"{if $field.maxlength} maxlength="{$field.maxlength|escape}"{/if}{if $field.required} required{/if}>{$field.value|escape}</textarea>
{else}
<input type="text" id="ch247-field-{$field.name|escape}" name="fields[{$field.name|escape}]" value="{$field.value|escape}"{if $field.placeholder} placeholder="{$field.placeholder|escape}"{/if}{if $field.maxlength} maxlength="{$field.maxlength|escape}"{/if}{if $field.required} required{/if}{if $field.sensitive} autocomplete="off" spellcheck="false"{/if}>
{/if}
{if $field.help}<p class="ch247-tools__hint">{$field.help|escape}</p>{/if}
{if $field.sensitive}<p class="ch247-tools__hint">Used for this request only. Never stored, logged, cached or attached to a report.</p>{/if}
{if $field.dynamic and not $field.options}<p class="ch247-tools__hint">No options are registered yet.</p>{/if}
</div>
{/foreach}
</div>
<div class="ch247-tools__actions">
<button class="ch247-button" type="submit">Run</button>
<button class="ch247-button ch247-button--ghost" type="reset">Reset</button>
</div>
</form>

{if $ch247Tools.run}
<section class="ch247-tools__result" aria-live="polite">
<header class="ch247-tools__resulthead">
<h3>{if $ch247Tools.run.ok}Result{else}Could not complete{/if}</h3>
<span class="ch247-badge ch247-badge--{if $ch247Tools.run.ok}success{else}danger{/if}">{$ch247Tools.run.code|escape}</span>
</header>
<p class="ch247-tools__message">{$ch247Tools.run.message|escape}</p>
{if $ch247Tools.run.warnings}
<ul class="ch247-tools__warnings" role="note">
{foreach $ch247Tools.run.warnings as $warning}<li>{$warning|escape}</li>{/foreach}
</ul>
{/if}
{if $ch247Tools.run.rows}
<dl class="ch247-tools__rows">
{foreach $ch247Tools.run.rows as $row}
<div class="ch247-tools__row"><dt>{$row.label|escape}</dt><dd{if $row.is_status} class="ch247-badge ch247-badge--{$row.tone|escape}"{/if}>{if $row.is_code}<code>{$row.value|escape}</code>{else}{$row.value|escape|nl2br}{/if}</dd></div>
{/foreach}
</dl>
{/if}
{foreach $ch247Tools.run.sections as $section}
<section class="ch247-tools__section">
<h4>{$section.label|escape}</h4>
<dl class="ch247-tools__rows">
{foreach $section.rows as $row}
<div class="ch247-tools__row"><dt>{$row.label|escape}</dt><dd{if $row.is_status} class="ch247-badge ch247-badge--{$row.tone|escape}"{/if}>{$row.value|escape|nl2br}</dd></div>
{/foreach}
</dl>
{foreach $section.tables as $table}{include file="cloudhost247-tools-table.tpl" table=$table}{/foreach}
</section>
{/foreach}
{foreach $ch247Tools.run.tables as $table}{include file="cloudhost247-tools-table.tpl" table=$table}{/foreach}
{foreach $ch247Tools.run.notices as $noticeBlock}
<details class="ch247-tools__notice"><summary>{$noticeBlock.label|escape}</summary><pre>{$noticeBlock.text|escape}</pre></details>
{/foreach}
<details class="ch247-tools__raw"><summary>Exact result data (JSON)</summary><pre>{$ch247Tools.run.json|escape}</pre></details>
<footer class="ch247-tools__resultfoot">
<p class="ch247-tools__hint">Generated {$ch247Tools.run.generated_at|escape}{if $ch247Tools.run.meta.cached} · served from cache{/if}. Copy the JSON above for a complete machine-readable copy.</p>
<div class="ch247-tools__chips">
{foreach $ch247Tools.run.export as $export}
<a class="ch247-chip" href="{$export.url|escape:'html'}" rel="nofollow">{$export.label|escape}</a>
{/foreach}
</div>
{if $ch247Tools.authenticated and $ch247Tools.run.ok}
<form method="post" action="tools.php" class="ch247-inline-form">
<input type="hidden" name="token" value="{$ch247Tools.csrf|escape}">
<input type="hidden" name="tool" value="{$ch247Tools.slug|escape}">
<input type="hidden" name="action" value="save-report">
{foreach $ch247Tools.run_input as $inputName => $inputValue}
<input type="hidden" name="fields[{$inputName|escape}]" value="{$inputValue|escape}">
{/foreach}
<button class="ch247-button" type="submit">Save as report</button>
</form>
{/if}
</footer>
</section>
{/if}
<p class="ch247-tools__hint">{$ch247Tools.tool.explanation|escape}</p>
</article>
{/if}

{* ------------------------------------------------------------------ *}
{* History                                                            *}
{* ------------------------------------------------------------------ *}
{if $ch247Tools.view == 'history'}
{if not $ch247Tools.authenticated}
<p class="alert alert-info">Sign in to keep a history of the tools you run. Nothing was recorded for this visit.</p>
{elseif $ch247Tools.history}
<table class="ch247-table">
<caption>Your most recent tool runs. Sensitive inputs are never recorded; a tool that only handles secrets appears with no target.</caption>
<thead><tr><th>Tool</th><th>Target</th><th>Result</th><th>When</th></tr></thead>
<tbody>
{foreach $ch247Tools.history as $entry}
<tr><td>{if $entry.url}<a href="{$entry.url|escape:'html'}">{$entry.tool_name|escape}</a>{else}{$entry.tool_name|escape}{/if}</td><td>{if $entry.target}{$entry.target|escape}{else}—{/if}</td><td><span class="ch247-badge ch247-badge--{if $entry.ok}success{else}danger{/if}">{$entry.result_code|escape}</span><br><small>{$entry.summary|escape}</small></td><td>{$entry.created_at|escape}</td></tr>
{/foreach}
</tbody>
</table>
<form method="post" action="tools.php" class="ch247-inline-form">
<input type="hidden" name="token" value="{$ch247Tools.csrf|escape}">
<input type="hidden" name="action" value="clear-history">
<button class="ch247-button ch247-button--ghost" type="submit">Clear my history</button>
</form>
{else}
<p>No tool runs recorded yet.</p>
{/if}
{/if}

{* ------------------------------------------------------------------ *}
{* Favourites                                                         *}
{* ------------------------------------------------------------------ *}
{if $ch247Tools.view == 'favorites'}
{if not $ch247Tools.authenticated}
<p class="alert alert-info">Sign in to save favourite tools.</p>
{elseif $ch247Tools.favorites}
<div class="ch247-grid ch247-tools__grid">
{foreach $ch247Tools.favorites as $favorite}
<article class="ch247-card"><h3><a href="{$favorite.url|escape:'html'}">{$favorite.name|escape}</a></h3><p>{$favorite.summary|escape}</p></article>
{/foreach}
</div>
{else}
<p>No favourites yet. Open a tool and choose “Add to favourites”.</p>
{/if}
{/if}

{* ------------------------------------------------------------------ *}
{* Reports                                                            *}
{* ------------------------------------------------------------------ *}
{if $ch247Tools.view == 'reports'}
{if not $ch247Tools.authenticated}
<p class="alert alert-info">Sign in to save and download reports.</p>
{elseif $ch247Tools.reports}
<table class="ch247-table">
<caption>Saved results, with the tool, target and time. Download or delete a report below.</caption>
<thead><tr><th>Report</th><th>Tool</th><th>Status</th><th>Saved</th><th>Actions</th></tr></thead>
<tbody>
{foreach $ch247Tools.reports as $report}
<tr>
<td>{$report.title|escape}</td>
<td>{$report.tool_slug|escape}</td>
<td>{$report.result_code|escape}</td>
<td>{$report.created_at|escape}</td>
<td>
<a class="ch247-chip" href="tools.php?view=reports&amp;download={$report.id|escape}">Download JSON</a>
<form method="post" action="tools.php" class="ch247-inline-form">
<input type="hidden" name="token" value="{$ch247Tools.csrf|escape}">
<input type="hidden" name="action" value="delete-report">
<input type="hidden" name="report_id" value="{$report.id|escape}">
<button class="ch247-button ch247-button--ghost" type="submit">Delete</button>
</form>
</td>
</tr>
{/foreach}
</tbody>
</table>
{else}
<p>No reports saved yet. Run a tool and choose “Save as report”.</p>
{/if}
{/if}

{* ------------------------------------------------------------------ *}
{* Monitors                                                           *}
{* ------------------------------------------------------------------ *}
{if $ch247Tools.view == 'monitors'}
{if not $ch247Tools.authenticated}
<p class="alert alert-info">Sign in to create domain monitors.</p>
{elseif $ch247Tools.monitors}
{if $ch247Tools.monitors.warnings}
<ul class="ch247-tools__warnings">{foreach $ch247Tools.monitors.warnings as $warning}<li>{$warning|escape}</li>{/foreach}</ul>
{/if}
{foreach $ch247Tools.monitors.tables as $table}{include file="cloudhost247-tools-table.tpl" table=$table}{/foreach}
<details class="ch247-tools__raw"><summary>Create or delete a monitor</summary>
<form class="ch247-tools__form" method="post" action="tools.php">
<input type="hidden" name="token" value="{$ch247Tools.csrf|escape}">
<input type="hidden" name="tool" value="diagnostics/monitors">
<input type="hidden" name="run_tool" value="1">
<div class="ch247-tools__fields">
<div class="ch247-field"><label for="ch247-monitor-action">Action</label>
<select id="ch247-monitor-action" name="fields[action]"><option value="create">Create a monitor</option><option value="delete">Delete a monitor</option><option value="list">List my monitors</option></select></div>
<div class="ch247-field"><label for="ch247-monitor-type">Monitor type</label>
<select id="ch247-monitor-type" name="fields[monitor_type]"><option value="dns_change">DNS record change</option><option value="ssl_expiry">SSL certificate expiry</option><option value="email_config">Email authentication configuration</option></select></div>
<div class="ch247-field"><label for="ch247-monitor-target">Target</label><input id="ch247-monitor-target" type="text" name="fields[target]" placeholder="example.com or &quot;example.com A&quot;"></div>
<div class="ch247-field"><label for="ch247-monitor-expected">Expected value (optional)</label><input id="ch247-monitor-expected" type="text" name="fields[expected]"></div>
<div class="ch247-field"><label for="ch247-monitor-id">Monitor ID (for delete)</label><input id="ch247-monitor-id" type="number" name="fields[monitor_id]" min="1"></div>
<div class="ch247-field"><label for="ch247-monitor-interval">Check every (hours)</label><input id="ch247-monitor-interval" type="number" name="fields[interval_hours]" min="1" max="168" value="6"></div>
</div>
<button class="ch247-button" type="submit">Apply</button>
</form>
</details>
{/if}
{/if}
{/if}
</main>
