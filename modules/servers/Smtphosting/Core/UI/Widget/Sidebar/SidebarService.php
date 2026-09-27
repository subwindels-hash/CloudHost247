<?php


namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Sidebar;

use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\ModuleConstants;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\FileReader\Reader;

/**
 * Description of SidebarService
 *
 * @author Pawel Kopec <pawelk@modulesgardne.com>
 */
class SidebarService
{
    use SidebarTrait;

    protected $id;
    /**
     *
     * @var Sidebar[]
     */
    protected $children = [];

    public function __construct()
    {
        $this->load();
    }

    private function load()
    {
        if (!file_exists(ModuleConstants::getDevConfigDir() . DS . 'sidebars.yml'))
        {
            return;
        }
        $data = Reader::read(ModuleConstants::getDevConfigDir() . DS . 'sidebars.yml');
        foreach ($data->get() as $parent => $sidebars)
        {
            $this->add(new Sidebar($parent));
            foreach ($sidebars as $id => $sidebar)
            {
                $this->getSidebar($parent)->add(new SidebarItem($id, $sidebar['uri'], $sidebar['order']));
            }
        }
    }

    /**
     *
     * @param type $id
     * @return Sidebar
     * @throws \Exception
     */
    public function getSidebar($id)
    {
        if (!isset($this->children[$id]))
        {
            throw new \Exception(sprintf("Sidebar %s does not exist", $id));
        }
        return $this->children[$id];
    }

    public function isEmpty()
    {
        return empty($this->children);
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
