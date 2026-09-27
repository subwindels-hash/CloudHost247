<?php
/**
 * Designer Tools Module
 * Color conversion: RGB, HEX, CMYK, HSV to Pantone
 */

class DesignerTools {
    private $config;
    
    public function __construct($config) {
        $this->config = $config;
    }
    
    /**
     * RGB to Pantone
     */
    public function rgbToPantone($params) {
        $r = (int)($params['r'] ?? 0);
        $g = (int)($params['g'] ?? 0);
        $b = (int)($params['b'] ?? 0);
        
        // Validate range
        $r = max(0, min(255, $r));
        $g = max(0, min(255, $g));
        $b = max(0, min(255, $b));
        
        $hex = sprintf("%02X%02X%02X", $r, $g, $b);
        $closestPantone = $this->findClosestPantone($r, $g, $b);
        
        return [
            'input' => [
                'r' => $r,
                'g' => $g,
                'b' => $b,
            ],
            'hex' => '#' . $hex,
            'closest_pantone' => $closestPantone,
            'color_info' => [
                'rgb' => "rgb({$r}, {$g}, {$b})",
                'hex' => '#' . $hex,
                'hsl' => $this->rgbToHSL($r, $g, $b),
            ]
        ];
    }
    
    /**
     * HEX to Pantone
     */
    public function hexToPantone($params) {
        $hex = $params['hex'] ?? '';
        
        if (empty($hex)) {
            throw new Exception('HEX color code is required');
        }
        
        // Clean hex
        $hex = ltrim(trim($hex), '#');
        
        if (!preg_match('/^[0-9a-fA-F]{6}$/', $hex)) {
            throw new Exception('Invalid HEX color format (use #RRGGBB)');
        }
        
        $r = hexdec(substr($hex, 0, 2));
        $g = hexdec(substr($hex, 2, 2));
        $b = hexdec(substr($hex, 4, 2));
        
        $closestPantone = $this->findClosestPantone($r, $g, $b);
        
        return [
            'input' => '#' . strtoupper($hex),
            'rgb' => [
                'r' => $r,
                'g' => $g,
                'b' => $b,
            ],
            'closest_pantone' => $closestPantone,
            'color_info' => [
                'rgb' => "rgb({$r}, {$g}, {$b})",
                'hsl' => $this->rgbToHSL($r, $g, $b),
            ]
        ];
    }
    
    /**
     * CMYK to Pantone
     */
    public function cmykToPantone($params) {
        $c = (float)($params['c'] ?? 0);
        $m = (float)($params['m'] ?? 0);
        $y = (float)($params['y'] ?? 0);
        $k = (float)($params['k'] ?? 0);
        
        // Validate range 0-100
        $c = max(0, min(100, $c));
        $m = max(0, min(100, $m));
        $y = max(0, min(100, $y));
        $k = max(0, min(100, $k));
        
        // Convert CMYK to RGB
        $r = round(255 * (1 - $c/100) * (1 - $k/100));
        $g = round(255 * (1 - $m/100) * (1 - $k/100));
        $b = round(255 * (1 - $y/100) * (1 - $k/100));
        
        $hex = sprintf("%02X%02X%02X", $r, $g, $b);
        $closestPantone = $this->findClosestPantone($r, $g, $b);
        
        return [
            'input' => [
                'c' => $c,
                'm' => $m,
                'y' => $y,
                'k' => $k,
            ],
            'rgb' => [
                'r' => $r,
                'g' => $g,
                'b' => $b,
            ],
            'hex' => '#' . $hex,
            'closest_pantone' => $closestPantone,
            'color_info' => [
                'rgb' => "rgb({$r}, {$g}, {$b})",
                'hsl' => $this->rgbToHSL($r, $g, $b),
            ]
        ];
    }
    
    /**
     * HSV to Pantone
     */
    public function hsvToPantone($params) {
        $h = (float)($params['h'] ?? 0);
        $s = (float)($params['s'] ?? 0);
        $v = (float)($params['v'] ?? 0);
        
        // Validate range
        $h = fmod(max(0, $h), 360);
        $s = max(0, min(100, $s));
        $v = max(0, min(100, $v));
        
        // Convert HSV to RGB
        $rgb = $this->hsvToRGB($h, $s, $v);
        $r = $rgb['r'];
        $g = $rgb['g'];
        $b = $rgb['b'];
        
        $hex = sprintf("%02X%02X%02X", $r, $g, $b);
        $closestPantone = $this->findClosestPantone($r, $g, $b);
        
        return [
            'input' => [
                'h' => $h,
                's' => $s,
                'v' => $v,
            ],
            'rgb' => [
                'r' => $r,
                'g' => $g,
                'b' => $b,
            ],
            'hex' => '#' . $hex,
            'closest_pantone' => $closestPantone,
            'color_info' => [
                'rgb' => "rgb({$r}, {$g}, {$b})",
                'cmyk' => $this->rgbToCMYK($r, $g, $b),
            ]
        ];
    }
    
    /**
     * Find closest Pantone match using simple Euclidean distance
     */
    private function findClosestPantone($r, $g, $b) {
        $pantoneColors = $this->getPantoneColors();
        
        $closest = null;
        $minDistance = PHP_FLOAT_MAX;
        
        foreach ($pantoneColors as $pantone) {
            $distance = sqrt(
                pow($r - $pantone['r'], 2) +
                pow($g - $pantone['g'], 2) +
                pow($b - $pantone['b'], 2)
            );
            
            if ($distance < $minDistance) {
                $minDistance = $distance;
                $closest = $pantone;
            }
        }
        
        return [
            'pantone_code' => $closest['code'] ?? 'Unknown',
            'pantone_name' => $closest['name'] ?? 'Unknown',
            'distance' => round($minDistance, 2),
            'match_quality' => $minDistance < 30 ? 'Excellent' : ($minDistance < 60 ? 'Good' : 'Approximate'),
            'pantone_rgb' => [
                'r' => $closest['r'] ?? 0,
                'g' => $closest['g'] ?? 0,
                'b' => $closest['b'] ?? 0,
            ]
        ];
    }
    
    /**
     * RGB to HSL
     */
    private function rgbToHSL($r, $g, $b) {
        $r /= 255;
        $g /= 255;
        $b /= 255;
        
        $max = max($r, $g, $b);
        $min = min($r, $g, $b);
        $l = ($max + $min) / 2;
        
        if ($max === $min) {
            $h = $s = 0;
        } else {
            $d = $max - $min;
            $s = $l > 0.5 ? $d / (2 - $max - $min) : $d / ($max + $min);
            
            switch ($max) {
                case $r: $h = (($g - $b) / $d + ($g < $b ? 6 : 0)) / 6; break;
                case $g: $h = (($b - $r) / $d + 2) / 6; break;
                case $b: $h = (($r - $g) / $d + 4) / 6; break;
            }
        }
        
        return [
            'h' => round($h * 360, 1),
            's' => round($s * 100, 1) . '%',
            'l' => round($l * 100, 1) . '%',
            'css' => "hsl(" . round($h * 360, 1) . ", " . round($s * 100, 1) . "%, " . round($l * 100, 1) . "%)"
        ];
    }
    
    /**
     * RGB to CMYK
     */
    private function rgbToCMYK($r, $g, $b) {
        $r /= 255;
        $g /= 255;
        $b /= 255;
        
        $k = 1 - max($r, $g, $b);
        $c = $k < 1 ? (1 - $r - $k) / (1 - $k) : 0;
        $m = $k < 1 ? (1 - $g - $k) / (1 - $k) : 0;
        $y = $k < 1 ? (1 - $b - $k) / (1 - $k) : 0;
        
        return [
            'c' => round($c * 100, 1),
            'm' => round($m * 100, 1),
            'y' => round($y * 100, 1),
            'k' => round($k * 100, 1),
        ];
    }
    
    /**
     * HSV to RGB
     */
    private function hsvToRGB($h, $s, $v) {
        $s /= 100;
        $v /= 100;
        
        $c = $v * $s;
        $x = $c * (1 - abs(fmod($h / 60, 2) - 1));
        $m = $v - $c;
        
        if ($h < 60) {
            $r = $c; $g = $x; $b = 0;
        } elseif ($h < 120) {
            $r = $x; $g = $c; $b = 0;
        } elseif ($h < 180) {
            $r = 0; $g = $c; $b = $x;
        } elseif ($h < 240) {
            $r = 0; $g = $x; $b = $c;
        } elseif ($h < 300) {
            $r = $x; $g = 0; $b = $c;
        } else {
            $r = $c; $g = 0; $b = $x;
        }
        
        return [
            'r' => round(($r + $m) * 255),
            'g' => round(($g + $m) * 255),
            'b' => round(($b + $m) * 255),
        ];
    }
    
    /**
     * Get common Pantone colors (simplified subset)
     */
    private function getPantoneColors() {
        return [
            ['code' => 'PANTONE 185 C', 'name' => 'Red', 'r' => 228, 'g' => 0, 'b' => 43],
            ['code' => 'PANTONE 286 C', 'name' => 'Blue', 'r' => 0, 'g' => 51, 'b' => 160],
            ['code' => 'PANTONE 354 C', 'name' => 'Green', 'r' => 0, 'g' => 150, 'b' => 57],
            ['code' => 'PANTONE 109 C', 'name' => 'Yellow', 'r' => 255, 'g' => 209, 'b' => 0],
            ['code' => 'PANTONE 151 C', 'name' => 'Orange', 'r' => 255, 'g' => 130, 'b' => 0],
            ['code' => 'PANTONE 2603 C', 'name' => 'Purple', 'r' => 100, 'g' => 0, 'b' => 145],
            ['code' => 'PANTONE Black C', 'name' => 'Black', 'r' => 45, 'g' => 41, 'b' => 38],
            ['code' => 'PANTONE White', 'name' => 'White', 'r' => 255, 'g' => 255, 'b' => 255],
            ['code' => 'PANTONE Cool Gray 1 C', 'name' => 'Light Gray', 'r' => 217, 'g' => 217, 'b' => 214],
            ['code' => 'PANTONE 2925 C', 'name' => 'Light Blue', 'r' => 0, 'g' => 155, 'b' => 223],
            ['code' => 'PANTONE 375 C', 'name' => 'Lime Green', 'r' => 120, 'g' => 214, 'b' => 0],
            ['code' => 'PANTONE 212 C', 'name' => 'Pink', 'r' => 255, 'g' => 105, 'b' => 180],
            ['code' => 'PANTONE 130 C', 'name' => 'Gold', 'r' => 255, 'g' => 198, 'b' => 88],
            ['code' => 'PANTONE 477 C', 'name' => 'Brown', 'r' => 112, 'g' => 82, 'b' => 56],
            ['code' => 'PANTONE 311 C', 'name' => 'Cyan', 'r' => 0, 'g' => 179, 'b' => 190],
            ['code' => 'PANTONE 348 C', 'name' => 'Dark Green', 'r' => 0, 'g' => 130, 'b' => 80],
            ['code' => 'PANTONE 268 C', 'name' => 'Violet', 'r' => 109, 'g' => 52, 'b' => 144],
            ['code' => 'PANTONE 1787 C', 'name' => 'Hot Pink', 'r' => 255, 'g' => 78, 'b' => 146],
            ['code' => 'PANTONE 3005 C', 'name' => 'Royal Blue', 'r' => 0, 'g' => 100, 'b' => 177],
            ['code' => 'PANTONE 116 C', 'name' => 'Bright Yellow', 'r' => 255, 'g' => 205, 'b' => 0],
            ['code' => 'PANTONE 174 C', 'name' => 'Brick Red', 'r' => 167, 'g' => 46, 'b' => 56],
            ['code' => 'PANTONE 7485 C', 'name' => 'Mint', 'r' => 167, 'g' => 224, 'b' => 181],
            ['code' => 'PANTONE 2716 C', 'name' => 'Lavender', 'r' => 140, 'g' => 130, 'b' => 200],
            ['code' => 'PANTONE 7527 C', 'name' => 'Beige', 'r' => 210, 'g' => 194, 'b' => 173],
            ['code' => 'PANTONE 2965 C', 'name' => 'Navy', 'r' => 0, 'g' => 63, 'b' => 114],
            ['code' => 'PANTONE 7413 C', 'name' => 'Peach', 'r' => 242, 'g' => 145, 'b' => 105],
            ['code' => 'PANTONE 7737 C', 'name' => 'Forest Green', 'r' => 0, 'g' => 109, 'b' => 65],
            ['code' => 'PANTONE 806 C', 'name' => 'Neon Pink', 'r' => 255, 'g' => 0, 'b' => 147],
            ['code' => 'PANTONE 803 C', 'name' => 'Neon Yellow', 'r' => 216, 'g' => 255, 'b' => 0],
            ['code' => 'PANTONE 802 C', 'name' => 'Neon Green', 'r' => 57, 'g' => 255, 'b' => 20],
            ['code' => 'PANTONE 7549 C', 'name' => 'Tangerine', 'r' => 255, 'g' => 158, 'b' => 27],
            ['code' => 'PANTONE 7451 C', 'name' => 'Sky Blue', 'r' => 137, 'g' => 196, 'b' => 244],
            ['code' => 'PANTONE 5185 C', 'name' => 'Plum', 'r' => 118, 'g' => 54, 'b' => 99],
            ['code' => 'PANTONE 7500 C', 'name' => 'Cream', 'r' => 229, 'g' => 225, 'b' => 210],
            ['code' => 'PANTONE 4975 C', 'name' => 'Chocolate', 'r' => 89, 'g' => 45, 'b' => 34],
            ['code' => 'PANTONE 628 C', 'name' => 'Aqua', 'r' => 154, 'g' => 215, 'b' => 219],
            ['code' => 'PANTONE 7489 C', 'name' => 'Sea Green', 'r' => 0, 'g' => 147, 'b' => 126],
            ['code' => 'PANTONE 7436 C', 'name' => 'Rose', 'r' => 227, 'g' => 140, 'b' => 160],
            ['code' => 'PANTONE 7401 C', 'name' => 'Mustard', 'r' => 214, 'g' => 176, 'b' => 54],
            ['code' => 'PANTONE 7457 C', 'name' => 'Periwinkle', 'r' => 180, 'g' => 188, 'b' => 222],
            ['code' => 'PANTONE 7698 C', 'name' => 'Teal', 'r' => 0, 'g' => 128, 'b' => 128],
            ['code' => 'PANTONE 7435 C', 'name' => 'Coral', 'r' => 255, 'g' => 127, 'b' => 80],
            ['code' => 'PANTONE 7495 C', 'name' => 'Olive', 'r' => 128, 'g' => 128, 'b' => 0],
            ['code' => 'PANTONE 7601 C', 'name' => 'Salmon', 'r' => 250, 'g' => 128, 'b' => 114],
            ['code' => 'PANTONE 7545 C', 'name' => 'Slate', 'r' => 112, 'g' => 128, 'b' => 144],
            ['code' => 'PANTONE 7644 C', 'name' => 'Maroon', 'r' => 128, 'g' => 0, 'b' => 0],
            ['code' => 'PANTONE 7488 C', 'name' => 'Emerald', 'r' => 80, 'g' => 200, 'b' => 120],
            ['code' => 'PANTONE 7547 C', 'name' => 'Charcoal', 'r' => 54, 'g' => 69, 'b' => 79],
        ];
    }
}