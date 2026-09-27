<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Helper;

trait HtmlElements
{
    protected $class = [];
    protected $name = null;
    protected $id = null;
    protected $scriptHtml = null;
    protected $index = null;

    public function setName($name = null)
    {
        if (is_string($name))
        {
            $this->name = $name;
        }

        return $this;
    }

    public function addClass($class = null)
    {
        if (is_string($class))
        {
            $this->class[] = $class;
        }

        return $this;
    }

    public function removeClass($class = null)
    {
        if (is_string($class) && in_array($this->class, $class))
        {
            $this->class = array_map(function (&$cl) use ($class) {
                if ($cl === $class)
                {
                    unset($cl);
                }
            }, $this->class);
        }

        return $this;
    }

    public function replaceClass($class = null, $replacement = null)
    {
        if (is_string($class) && trim($class) !== '' && in_array($class, $this->class)
            && is_string($replacement) && trim($replacement) !== '')
        {

            $keys = array_keys($this->class, $class, true);
            foreach ($keys as $key)
            {
                unset($this->class[$key]);
            }

            $this->class[] = $replacement;
        }

        return $this;
    }

    public function replaceClasses($classes)
    {
        if (is_array($classes))
        {
            $this->class = $classes;
        }

        return $this;
    }

    public function getClasses()
    {
        return implode(' ', $this->class);
    }

    public function hasClass($class)
    {
        if (is_string($class) && in_array($this->class, $class))
        {
            return true;
        }

        return false;
    }

    public function setId($id = null)
    {
        if (is_string($id) || is_int($id))
        {
            $this->id = $id;
        }

        return $this;
    }

    public function setScriptHtml($scriptHtml = null)
    {
        if (is_string($scriptHtml))
        {
            $this->scriptHtml = $scriptHtml;
        }

        return $this;
    }

    protected function generateRandomId()
    {
        $stringGen = new Helper\RandomStringGenerator();
        $this->id  = $stringGen->genRandomString('mgContElem');

        return $this;
    }

    protected function generateRandomName()
    {
        if ($this->id)
        {
            $this->name = $this->id;

            return $this;
        }

        $stringGen  = new Helper\RandomStringGenerator();
        $this->name = $stringGen->genRandomString('mgContElem');

        return $this;
    }

    public function getName()
    {
        if (!$this->name)
        {
            $this->generateRandomName();
        }

        return $this->name;
    }

    public function getId()
    {
        if (!$this->id)
        {
            $this->generateRandomId();
        }

        return $this->id;
    }

    public function getRawClasses()
    {
        return $this->class;
    }

    public function getScriptHtml()
    {
        return $this->scriptHtml;
    }

    protected function prepareDefaultHtmlElements()
    {
        if (!$this->id)
        {
            $this->generateRandomId();
        }

        if (!$this->name)
        {
            $this->generateRandomName();
        }

        return $this;
    }

    public function initIds($id = null)
    {
        if (is_string($id) || is_int($id))
        {
            $this->id    = $id;
            $this->name  = $id;
            $this->title = $id;
        }

        return $this;
    }

    public function isIdEqual($id)
    {
        return $this->id === $id;
    }

    public function getIndex()
    {
        return $this->index ?: $this->id;
    }

    public function setIndex($index)
    {
        $this->index = $index ?: $this->id;

        return $this;
    }
}
