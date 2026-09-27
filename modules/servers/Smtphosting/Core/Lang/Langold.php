<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Lang;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\ModuleConstants;

class Lang
{
    /**
     * @var string
     */
    private $dir;

    private $isDebug;

    /**
     * @var Array
     */
    private $langs = [];

    /**
     * @var type
     */
    private $currentLang;

    /**
     * @var bool
     */
    private $fillLangFile = true;

    /**
     * @var array
     */
    public $context = [];

    /**
     * @var array
     */
    private $staggedContext = [];

    /**
     * @var array
     */
    private $missingLangs = [];

    private $langReplacements = [];

    private static $instance;

    /**
     * @param string $dir
     * @param string $lang
     */
    protected function __construct(string $dir = null, string $lang = null)
    {
        $this->setDir($dir);

//        $this->isDebug = (bool)(int)sl('configurationAddon')->getConfigValue('debug', false);
//        $this->isDebug = true;
        if (!$lang)
        {
            $lang = $this->getLang();
        }

        if ($lang)
        {
            $this->setLang($lang);
        }
    }

    protected function __clone()
    {
    }

    public static function getInstance(string $dir = null, string $lang = null): Lang
    {

        if (!isset(self::$instance))
        {
            self::$instance = new static($dir = null, $lang = null);
        }
        return self::$instance;

    }

    public function setDir(string $dir = null): Lang
    {
        if ($dir !== null && $dir !== "")
        {
            $this->dir = $dir;
        }
        else
        {
            $this->dir = ModuleConstants::getLangsDir();
        }

        return $this;
    }

    public function setLang(string $lang = 'english'): Lang
    {
        if ($lang)
        {
            $this->loadLang($lang);
        }
        else
        {
            $this->loadLang('english');
        }

        return $this;
    }


    public function getMissingLangs(): array
    {
        return $this->missingLangs;
    }

    public function getLang(): string
    {
        $language = '';
        if (isset($_SESSION['Language']))
        { // GET LANG FROM SESSION
            $language = strtolower($_SESSION['Language']);
            if (!$this->checkIfLangFileExists($language))
            {
                $language = '';
            }
        }

        if (!$language && isset($_SESSION['uid']))
        {
            $language = $this->getLangByUserId($_SESSION['uid']);
            if (!$this->checkIfLangFileExists($language))
            {
                $language = '';
            }
        }

        if (!$language)
        {
            $language = $this->getDefaultConfigLang();
            if (!$this->checkIfLangFileExists($language))
            {
                $language = '';
            }
        }

        if (!$language)
        {
            $language = 'english';
        }

        return strtolower($language);
    }

    protected function getLangByUserId(int $uid = null)
    {
        if ($uid)
        {
            try
            {
                $cModle = new \WHMCS\User\Client();
                $res    = $cModle->where('id', $uid)->first(['language'])->toArray();

                return $res['language'];
            }
            catch (\Exception $exc)
            {
                return false;
            }
        }

        return false;
    }

    protected function getDefaultConfigLang()
    {
        try
        {
            $cModle = new \WHMCS\Config\Setting();
            $res    = $cModle->where('setting', 'Language')->first(['value'])->toArray();

            return $res['value'];
        }
        catch (\Exception $exc)
        {
            return false;
        }
    }

    protected function checkIfLangFileExists(string $langName = null): bool
    {
        if (is_string($langName))
        {
            $file = $this->dir . DIRECTORY_SEPARATOR . strtolower($langName) . '.php';
            if (file_exists($file))
            {
                return true;
            }
        }

        return false;
    }

    public function getAvaiable(): array
    {
        $langArray = [];
        $handle    = opendir($this->dir);

        while (false !== ($entry = readdir($handle)))
        {
            [$lang, $ext] = explode('.', $entry);
            if ($lang && isset($ext) && strtolower($ext) == 'php')
            {
                $langArray[] = $lang;
            }
        }

        return $langArray;
    }

    public function loadLang(string $lang): void
    {
        $file = $this->dir . DIRECTORY_SEPARATOR . $lang . '.php';
        if (file_exists($file))
        {
            include $file;
            $this->langs       = array_merge($this->langs, $_LANG);
            $this->currentLang = $lang;
        }
    }

    public function setContext(): void
    {
        $this->context = [];
        foreach (func_get_args() as $name)
        {
            $this->context[] = $name;
        }
    }

    public function addToContext(): void
    {
        foreach (func_get_args() as $name)
        {
            $this->context[] = $name;
        }
    }

    public function stagCurrentContext(string $stagName): void
    {
        $this->staggedContext[$stagName] = $this->context;
    }

    public function unstagContext(string $stagName): void
    {
        if (isset($this->staggedContext[$stagName]))
        {
            $this->context = $this->staggedContext[$stagName];
            unset($this->staggedContext[$stagName]);
        }
    }

    /**
     * Get Translated Lang
     *
     * @return string
     * @author Michal Czech <michael@modulesgarden.com>
     */
    public function translate(): string
    {
        $lang = $this->langs;

        $history = [];

        foreach ($this->context as $name)
        {
            if (isset($lang[$name]))
            {
                $lang = $lang[$name];
            }
            $history[] = $name;
        }

        $returnLangArray = false;

        foreach (func_get_args() as $find)
        {
            $find      = trim($find);
            $history[] = $find;
            if (isset($lang[$find]))
            {
                if (is_array($lang[$find]))
                {
                    $lang = $lang[$find];
                }
                else
                {
                    $this->replaceConstantVars($lang[$find]);

                    return htmlentities($lang[$find]);
                }
            }
            else
            {
                if ($this->fillLangFile)
                {
                    $returnLangArray = true;
                }
                else
                {
                    return htmlentities($find);
                }
            }
        }

        if ($returnLangArray)
        {
            $this->addMissingLang($history, $returnLangArray);
            return $this->parserMissingLang($history);
        }

        if (is_array($lang) && $this->fillLangFile)
        {
            $this->addMissingLang($history);
            return $this->parserMissingLang($history);
        }

        return htmlentities($find);
    }

    /**
     * Alias for translate method
     * @return type mixed
     */
    public function tr()
    {
        return call_user_func_array([$this, 'translate'], func_get_args());
    }

    /**
     * Deprecated
     * @return type mixed
     */
    public function T()
    {
        return call_user_func_array([$this, 'translate'], func_get_args());
    }

    /**
     * Get Translated Absolute Lang
     *
     * @return string
     */
    public function absoluteTranslate()
    {
        $lang = $this->langs;

        $returnLangArray = false;

        foreach (func_get_args() as $find)
        {
            $find      = trim($find);
            $history[] = $find;
            if (isset($lang[$find]))
            {
                if (is_array($lang[$find]))
                {
                    $lang = $lang[$find];
                }
                else
                {
                    $this->replaceConstantVars($lang[$find]);

                    return htmlentities($lang[$find]);
                }
            }
            else
            {
                if ($this->fillLangFile)
                {
                    $returnLangArray = true;
                }
                else
                {
                    return htmlentities($find);
                }
            }
        }

        if ($returnLangArray)
        {
            $this->addMissingLang($history);
            return $this->parserMissingLang($history);
        }

        return htmlentities($lang);
    }

    /**
     * Alias for absoluteTranslate method
     * @return type mixed
     */
    public function abtr()
    {
        return call_user_func_array([$this, 'absoluteTranslate'], func_get_args());
    }

    /**
     * Deprecated
     * @return type mixed
     */
    public function absoluteT()
    {
        return call_user_func_array([$this, 'absoluteTranslate'], func_get_args());
    }

    /**
     * Get Translated Lang From Main Controler Context
     *
     * @return string
     * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
     */
    public function controlerContextTranslate()
    {
        $tempContext      = $this->context;
        $controlerContext = array_slice($tempContext, 0, 2);

        $this->context = $controlerContext;
        $args          = func_get_args();

        $last    = end($args);
        $lastKey = key($args);
        unset($args[$lastKey]);

        foreach ($args as $cont)
        {
            $this->context[] = $cont;
        }

        $result = $this->T($last);

        $this->context = $tempContext;

        return $result;
    }

    /**
     * Alias for absoluteTranslate method
     * @return type mixed
     */
    public function cctr()
    {
        return call_user_func_array([$this, 'controlerContextTranslate'], func_get_args());
    }

    /**
     * Deprecated
     * @return type mixed
     */
    public function controlerContextT()
    {
        return call_user_func_array([$this, 'controlerContextTranslate'], func_get_args());
    }

    /**
     * @param array $history
     * @return string
     */
    protected function parserMissingLang($history)
    {
        if ($this->isDebug)
        {
            return '$' . "_LANG['" . implode("']['", $history) . "']";
        }

        return end($history);
    }

    /**
     *
     * @param array $history
     * @param bool $returnLangArray
     */
    protected function addMissingLang(array $history, bool $returnLangArray = false): void
    {
        if ($returnLangArray)
        {
            $this->missingLangs['$' . "_LANG['" . implode("']['", $history) . "']"] = ucfirst(end($history));
        }
        else
        {
            $this->missingLangs['$' . "_LANG['" . implode("']['", $history) . "']"] = implode(" ", array_slice($history, -3, 3, true));
        }
    }

    /**
     *
     * @param string $key
     * @param string $value
     * @return $this
     */
    public function addReplacementConstant(string $key, string $value): Lang
    {
        $this->langReplacements[$key] = $value;

        return $this;
    }

    protected function replaceConstantVars(&$langString)
    {
        if (count($this->langReplacements) === 0)
        {
            return false;
        }

        foreach ($this->langReplacements as $key => $value)
        {
            if (stripos($langString, ':' . $key . ':') !== false)
            {
                $langString = str_replace(':' . $key . ':', $value, $langString);

                //to do:
                //unset($this->langReplacements[$key]);
            }
        }
    }
}