{if $table.rows}
<section class="ch247-tools__tableblock">
<h4>{$table.label|escape} <small>({$table.count})</small></h4>
<div class="ch247-table-wrap" tabindex="0">
<table class="ch247-table">
<thead><tr>{foreach $table.columns as $column}<th scope="col">{$column.label|escape}</th>{/foreach}</tr></thead>
<tbody>
{foreach $table.rows as $cells}
<tr>{foreach $cells as $cell}<td data-label="{$cell.label|escape}">{if $cell.is_status}<span class="ch247-badge ch247-badge--{$cell.tone|escape}">{$cell.value|escape}</span>{else}{$cell.value|escape|nl2br}{/if}</td>{/foreach}</tr>
{/foreach}
</tbody>
</table>
</div>
</section>
{/if}
