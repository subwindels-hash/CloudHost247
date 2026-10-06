<?php
namespace CloudHost247\Theme;

/** Generated presentation metadata only. Execution always belongs to the Node tools service. */
final class ToolsSite
{
    public static function catalog()
    {
        static $data;
        if ($data === null) {
            $data = json_decode(file_get_contents(dirname(__DIR__) . '/resources/tools.json'), true);
            if (!is_array($data) || !isset($data['tools'], $data['categories'])) { throw new \RuntimeException('Tools registry unavailable.'); }
        }
        return $data;
    }

    public static function resolve($path)
    {
        $catalog = self::catalog();
        if ($path === '/tools' || $path === '/tools/') {
            return array('path'=>'/tools','name'=>'CloudHost247 Tools','summary'=>'Powerful DNS, domain, IP, network, security, email and developer tools for websites, servers and infrastructure.');
        }
        foreach ($catalog['categories'] as $slug => $label) {
            if ($path === '/tools/category/' . $slug) { return array('path'=>$path,'name'=>$label . ' Tools','summary'=>'Explore CloudHost247 ' . strtolower($label) . ' tools with clear results and explicit limitations.'); }
        }
        foreach ($catalog['tools'] as $tool) {
            if ($path === $tool['path'] || in_array($path, $tool['legacyPaths'], true)) { return $tool; }
        }
        return null;
    }
}
