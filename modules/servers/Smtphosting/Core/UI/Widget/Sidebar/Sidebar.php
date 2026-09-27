<?php


namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Sidebar;

use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Builder\BaseContainer;

/**
 * Description of Sidebar
 *
 * @author Pawel Kopec <pawelk@modulesgardne.com>
 */
class Sidebar extends BaseContainer
{
    use SidebarTrait;

    protected $href;

    public function __construct($id, $href = null, $order = null)
    {
        $this->href  = $href;
        $this->order = $order;

        parent::__construct($id);
    }

    public function getHref()
    {
        return $this->href;
    }

    public function setHref($href)
    {
        $this->href = $href;
        return $this;
    }

    public function get()
    {
        $children = [];
        foreach ($this->children as $child)
        {
            if (!$child->getOrder())
            {
                $children[] = $child;
                continue;
            }
            $children[$child->getOrder()] = $child;
        }
        ksort($children);
        return $children;
    }

}
