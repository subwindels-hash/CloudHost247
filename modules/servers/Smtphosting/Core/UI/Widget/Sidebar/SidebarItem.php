<?php


namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Sidebar;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Builder\BaseContainer;

/**
 * Description of Sidebar
 *
 * @author Pawel Kopec <pawelk@modulesgardne.com>
 */
class SidebarItem extends BaseContainer
{
    use SidebarTrait;

    public function __construct($id, $href = null, $order = null)
    {
        if ($href)
        {
            $this->setHref($href);
        }

        $this->order = $order;
        parent::__construct($id);
    }

    public function getId()
    {
        return $this->id;
    }

    public function setId($id = null)
    {
        $this->id = $id;

        return $this;
    }

    public function getHref()
    {
        return $this->htmlAttributes['href'];
    }

    public function setHref($href)
    {
        $this->htmlAttributes['href'] = $href;

        return $this;
    }

    public function setTarget($target)
    {
        $this->htmlAttributes['target'] = $target;

        return $this;
    }

    public function setHtml($html)
    {
        $this->html = $html;

        return $this;
    }


}
