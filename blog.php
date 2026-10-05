<?php
/**
 * CloudHost247 — Blog. Articles come from the platform content API; only
 * published articles are ever served, and bodies are escaped before render.
 */

declare(strict_types=1);

require_once __DIR__ . '/php/bootstrap.php';

$slug = isset($_GET['article']) ? trim((string) $_GET['article']) : '';

/* Single article view. */
if ($slug !== '') {
    $article = ch247_article($slug);
    if ($article === null) {
        http_response_code(404);
        echo ch247_page([
            'title' => 'Article Not Found | CloudHost247',
            'description' => 'The article you requested does not exist or is not published.',
            'canonical' => 'blog.php',
            'noindex' => true,
            'active' => 'resources',
            'crumbs' => [['index.php', 'Home'], ['blog.php', 'Blog'], [null, 'Not Found']],
        ], ch247_page_head([['index.php', 'Home'], ['blog.php', 'Blog'], [null, 'Not Found']], 'Article not found', 'This article does not exist, or has not been published.')
            . '<section class="section"><div class="container">'
            . ch247_notice('Browse the <a href="blog.php">blog</a> for everything currently published.')
            . '</div></section>');
        return;
    }

    $title = ch247_e($article['title'] ?? 'Article');
    $date = !empty($article['publishedAt']) ? ch247_e(substr((string) $article['publishedAt'], 0, 10)) : '';
    $author = ch247_e($article['author'] ?? CH247_BRAND . ' Team');
    $category = ch247_e($article['category'] ?? '');
    $jsonld = [
        '@context' => 'https://schema.org',
        '@type' => 'Article',
        'headline' => (string) ($article['title'] ?? ''),
        'author' => ['@type' => 'Organization', 'name' => (string) ($article['author'] ?? CH247_BRAND)],
        'publisher' => ['@type' => 'Organization', 'name' => CH247_BRAND],
        'datePublished' => (string) ($article['publishedAt'] ?? ''),
    ];

    echo ch247_page([
        'title' => ($article['title'] ?? 'Article') . ' | CloudHost247 Blog',
        'description' => (string) ($article['summary'] ?? ''),
        'canonical' => 'blog.php?article=' . rawurlencode($slug),
        'type' => 'article',
        'active' => 'resources',
        'crumbs' => [['index.php', 'Home'], ['blog.php', 'Blog'], [null, $article['title'] ?? 'Article']],
        'jsonld' => $jsonld,
    ], ch247_page_head([['index.php', 'Home'], ['blog.php', 'Blog'], [null, $article['title'] ?? 'Article']], (string) ($article['title'] ?? 'Article'), (string) ($article['summary'] ?? ''))
        . '<section class="section"><div class="container" style="max-width:880px">'
        . '<p class="hint">' . ($category !== '' ? '<span class="badge">' . $category . '</span> &nbsp;' : '') . ($date !== '' ? 'Published ' . $date . ' · ' : '') . 'By ' . $author . '</p>'
        . '<article class="card" style="padding:28px"><div class="legal-prose">' . ch247_md_lite((string) ($article['body'] ?? '')) . '</div></article>'
        . '<p class="mt-2"><a href="blog.php">&larr; All posts</a></p>'
        . '</div></section>');
    return;
}

/* List view with optional search. */
$query = isset($_GET['q']) ? trim((string) $_GET['q']) : '';
$articles = ch247_articles('blog', $query);

$searchNote = '';
if ($query !== '' && is_array($articles)) {
    $searchNote = '<p class="hint" style="margin-bottom:18px">' . count($articles) . ' result' . (count($articles) === 1 ? '' : 's') . ' for &ldquo;' . ch247_e($query) . '&rdquo; — <a href="blog.php">clear search</a></p>';
}

$content = ch247_page_head(
    [['index.php', 'Home'], [null, 'Blog']],
    'The CloudHost247 Blog',
    'Insights on cloud, hosting, security and running websites professionally — published when we have something worth saying.'
) . '
    <section class="section">
      <div class="container">
        <form class="domain-search" method="get" action="blog.php">
          <h2>Search posts</h2>
          <p class="muted">Company news and technical articles from the CloudHost247 team.</p>
          <div class="domain-form">
            <label class="visually-hidden" for="blog-q">Search the blog</label>
            <input id="blog-q" type="search" name="q" value="' . ch247_e($query) . '" placeholder="e.g. platform, security">
            <button class="btn btn--primary" type="submit">Search</button>
          </div>
        </form>
        <div class="mt-2">' . $searchNote . ch247_article_cards($articles, 'blog') . '</div>
      </div>
    </section>';

echo ch247_page([
    'title' => 'Blog — Cloud, Hosting & Security Insights | CloudHost247',
    'description' => 'The CloudHost247 blog: cloud, hosting, security and platform news — written by our team, published when worth reading.',
    'canonical' => 'blog.php',
    'active' => 'resources',
    'crumbs' => [['index.php', 'Home'], [null, 'Blog']],
], $content);
