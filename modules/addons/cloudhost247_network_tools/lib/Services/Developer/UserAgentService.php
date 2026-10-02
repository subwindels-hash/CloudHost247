<?php
namespace CloudHost247\NetworkTools\Services\Developer;

use CloudHost247\NetworkTools\Core\Result\ToolResult;
use CloudHost247\NetworkTools\Services\Service;

/** User agent checker (docs section 50). Shows only what the browser sent. */
final class UserAgentService extends Service
{
    protected function execute()
    {
        $userAgent = isset($_SERVER['HTTP_USER_AGENT']) ? substr((string) $_SERVER['HTTP_USER_AGENT'], 0, 1024) : '';
        $interpretation = $this->interpret($userAgent);
        return ToolResult::success(array(
            'user_agent' => $userAgent,
            'interpretation' => $interpretation,
            'headers' => array(
                'accept' => isset($_SERVER['HTTP_ACCEPT']) ? substr((string) $_SERVER['HTTP_ACCEPT'], 0, 512) : '',
                'accept_language' => isset($_SERVER['HTTP_ACCEPT_LANGUAGE']) ? substr((string) $_SERVER['HTTP_ACCEPT_LANGUAGE'], 0, 256) : '',
                'accept_encoding' => isset($_SERVER['HTTP_ACCEPT_ENCODING']) ? substr((string) $_SERVER['HTTP_ACCEPT_ENCODING'], 0, 128) : '',
                'dnt' => isset($_SERVER['HTTP_DNT']) ? substr((string) $_SERVER['HTTP_DNT'], 0, 8) : '',
                'sec_ch_ua' => isset($_SERVER['HTTP_SEC_CH_UA']) ? substr((string) $_SERVER['HTTP_SEC_CH_UA'], 0, 256) : '',
                'sec_ch_ua_platform' => isset($_SERVER['HTTP_SEC_CH_UA_PLATFORM']) ? substr((string) $_SERVER['HTTP_SEC_CH_UA_PLATFORM'], 0, 128) : '',
                'sec_ch_ua_mobile' => isset($_SERVER['HTTP_SEC_CH_UA_MOBILE']) ? substr((string) $_SERVER['HTTP_SEC_CH_UA_MOBILE'], 0, 8) : '',
            ),
            'summary' => $interpretation['browser'] !== '' ? 'Detected: ' . $interpretation['browser'] . ' on ' . $interpretation['platform'] . '.' : 'The browser did not send a recognisable user agent.',
            'privacy' => 'Everything here is what your own browser sent with this request. It is not a fingerprint, and any value in it can be changed by the client or by a privacy extension.',
        ));
    }

    private function interpret($userAgent)
    {
        $browser = '';
        $version = '';
        $platform = '';
        $mobile = preg_match('/Mobile|Android|iPhone|iPad/i', $userAgent) === 1;
        $patterns = array(
            'Edge' => '/Edg(?:e|A|iOS)?\/([\d.]+)/',
            'Opera' => '/OPR\/([\d.]+)/',
            'Samsung Internet' => '/SamsungBrowser\/([\d.]+)/',
            'Firefox' => '/Firefox\/([\d.]+)/',
            'Chrome' => '/Chrome\/([\d.]+)/',
            'Safari' => '/Version\/([\d.]+).*Safari/',
            'Internet Explorer' => '/MSIE ([\d.]+)/',
        );
        foreach ($patterns as $name => $pattern) {
            if (preg_match($pattern, $userAgent, $matches)) {
                $browser = $name;
                $version = $matches[1];
                break;
            }
        }
        foreach (array('Windows' => '/Windows NT/', 'macOS' => '/Macintosh/', 'Android' => '/Android/', 'iOS' => '/iPhone|iPad|iPod/', 'Linux' => '/Linux/') as $name => $pattern) {
            if (preg_match($pattern, $userAgent)) {
                $platform = $name;
                break;
            }
        }
        return array(
            'browser' => $browser,
            'version' => $version,
            'platform' => $platform === '' ? 'unknown platform' : $platform,
            'mobile' => $mobile,
            'confidence' => $browser === '' ? 'Unknown' : 'Likely',
            'note' => $browser === '' ? 'No known browser token was found in the string.' : 'Detection is a token match against the string the browser sent; privacy tools and extensions deliberately falsify it.',
        );
    }
}
