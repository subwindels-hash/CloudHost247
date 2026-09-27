<?php
/**
 * Gaming Tools Module
 * Minecraft formatting and color codes
 */

class GamingTools {
    private $config;
    
    public function __construct($config) {
        $this->config = $config;
    }
    
    /**
     * Minecraft Color Codes
     */
    public function minecraftColorCodes($params) {
        $colors = [
            ['code' => '0', 'name' => 'Black', 'hex' => '#000000', 'color' => 'Black'],
            ['code' => '1', 'name' => 'Dark Blue', 'hex' => '#0000AA', 'color' => 'Dark Blue'],
            ['code' => '2', 'name' => 'Dark Green', 'hex' => '#00AA00', 'color' => 'Dark Green'],
            ['code' => '3', 'name' => 'Dark Aqua', 'hex' => '#00AAAA', 'color' => 'Dark Aqua'],
            ['code' => '4', 'name' => 'Dark Red', 'hex' => '#AA0000', 'color' => 'Dark Red'],
            ['code' => '5', 'name' => 'Dark Purple', 'hex' => '#AA00AA', 'color' => 'Dark Purple'],
            ['code' => '6', 'name' => 'Gold', 'hex' => '#FFAA00', 'color' => 'Gold'],
            ['code' => '7', 'name' => 'Gray', 'hex' => '#AAAAAA', 'color' => 'Gray'],
            ['code' => '8', 'name' => 'Dark Gray', 'hex' => '#555555', 'color' => 'Dark Gray'],
            ['code' => '9', 'name' => 'Blue', 'hex' => '#5555FF', 'color' => 'Blue'],
            ['code' => 'a', 'name' => 'Green', 'hex' => '#55FF55', 'color' => 'Green'],
            ['code' => 'b', 'name' => 'Aqua', 'hex' => '#55FFFF', 'color' => 'Aqua'],
            ['code' => 'c', 'name' => 'Red', 'hex' => '#FF5555', 'color' => 'Red'],
            ['code' => 'd', 'name' => 'Light Purple', 'hex' => '#FF55FF', 'color' => 'Light Purple'],
            ['code' => 'e', 'name' => 'Yellow', 'hex' => '#FFFF55', 'color' => 'Yellow'],
            ['code' => 'f', 'name' => 'White', 'hex' => '#FFFFFF', 'color' => 'White'],
        ];
        
        $text = $params['text'] ?? 'Hello World';
        $preview = $params['preview'] ?? '';
        
        // Generate preview
        $previewHtml = '';
        if (!empty($preview)) {
            $previewHtml = $this->formatMinecraftText($preview);
        }
        
        return [
            'color_codes' => $colors,
            'usage' => 'Use § followed by the code (e.g., §c for red)',
            'example' => '§cRed §aGreen §bBlue',
            'java_edition' => 'Use § symbol before the code',
            'bedrock_edition' => 'Use § symbol before the code',
            'text_to_preview' => $text,
            'preview_html' => $previewHtml,
            'total_colors' => count($colors),
        ];
    }
    
    /**
     * Minecraft Format Codes
     */
    public function minecraftFormatCodes($params) {
        $formats = [
            ['code' => 'k', 'name' => 'Obfuscated', 'description' => 'Randomly changes characters'],
            ['code' => 'l', 'name' => 'Bold', 'description' => 'Makes text bold'],
            ['code' => 'm', 'name' => 'Strikethrough', 'description' => 'Strikethrough text'],
            ['code' => 'n', 'name' => 'Underline', 'description' => 'Underlines text'],
            ['code' => 'o', 'name' => 'Italic', 'description' => 'Makes text italic'],
            ['code' => 'r', 'name' => 'Reset', 'description' => 'Resets all formatting'],
        ];
        
        $text = $params['text'] ?? 'Sample Text';
        $formatCombination = $params['format'] ?? '';
        
        // Generate example with formats
        $example = '§lBold §oItalic §nUnderline §mStrikethrough §rReset';
        
        // Combined preview
        $combined = '';
        if (!empty($formatCombination)) {
            $combined = $this->formatMinecraftText('§' . $formatCombination . $text);
        }
        
        return [
            'format_codes' => $formats,
            'usage' => 'Use § followed by the format code',
            'example' => $example,
            'combinations' => [
                'bold_red' => '§l§cBold Red Text',
                'italic_green' => '§o§aItalic Green Text',
                'bold_underline' => '§l§nBold Underlined Text',
            ],
            'preview_text' => $text,
            'combined_preview' => $combined,
            'total_formats' => count($formats),
            'note' => 'Format codes can be combined with color codes',
        ];
    }
    
    /**
     * Format Minecraft text to HTML preview
     */
    private function formatMinecraftText($text) {
        $text = htmlspecialchars($text, ENT_QUOTES);
        
        $colors = [
            '0' => '#000000', '1' => '#0000AA', '2' => '#00AA00', '3' => '#00AAAA',
            '4' => '#AA0000', '5' => '#AA00AA', '6' => '#FFAA00', '7' => '#AAAAAA',
            '8' => '#555555', '9' => '#5555FF', 'a' => '#55FF55', 'b' => '#55FFFF',
            'c' => '#FF5555', 'd' => '#FF55FF', 'e' => '#FFFF55', 'f' => '#FFFFFF',
        ];
        
        $formats = [
            'k' => '', // obfuscated - can't render in HTML
            'l' => 'font-weight:bold;',
            'm' => 'text-decoration:line-through;',
            'n' => 'text-decoration:underline;',
            'o' => 'font-style:italic;',
            'r' => '', // reset
        ];
        
        $html = '<span style="color:#FFFFFF;">';
        $i = 0;
        $currentColor = '#FFFFFF';
        $currentStyle = '';
        
        while ($i < strlen($text)) {
            if ($text[$i] === '§' && $i + 1 < strlen($text)) {
                $code = strtolower($text[$i + 1]);
                
                if (isset($colors[$code])) {
                    $currentColor = $colors[$code];
                    $html .= '</span><span style="color:' . $currentColor . ';' . $currentStyle . '">';
                } elseif (isset($formats[$code])) {
                    if ($code === 'r') {
                        $currentColor = '#FFFFFF';
                        $currentStyle = '';
                        $html .= '</span><span style="color:' . $currentColor . ';">';
                    } else {
                        $currentStyle .= $formats[$code];
                        $html .= '</span><span style="color:' . $currentColor . ';' . $currentStyle . '">';
                    }
                }
                
                $i += 2;
            } else {
                $html .= $text[$i];
                $i++;
            }
        }
        
        $html .= '</span>';
        
        return $html;
    }
}