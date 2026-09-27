<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits;

/**
 * Description related functions
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
trait Description
{
    protected $description = 'description';
    protected $raw = false;
    protected $allowHtmlTags = false;

    public function setDescription($description)
    {
        $this->description = $description;

        return $this;
    }

    public function getDescription()
    {
        return $this->description;
    }

    public function isRaw()
    {
        return $this->raw;
    }

    public function setRaw($raw)
    {
        $this->raw = (bool)$raw;

        return $this;
    }

    public function allowHtmlTags()
    {
        $this->allowHtmlTags = true;

        return $this;
    }

    public function disallowHtmlTags()
    {
        $this->allowHtmlTags = false;

        return $this;
    }

    public function isHtmlTagsAllowed()
    {
        return $this->allowHtmlTags;
    }
}