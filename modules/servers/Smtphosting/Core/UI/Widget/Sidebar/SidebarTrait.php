<?php


namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Sidebar;

/**
 * Description of SidebarTrait
 *
 * @author Pawel Kopec <pawelk@modulesgardne.com>
 */
trait SidebarTrait
{
    protected $order;
    protected $children = [];
    /**
     * @var Sidebar
     */
    protected $parent;
    protected $active = false;

    /**
     * Add Sidebar
     * @param \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Sidebar\Sidebar $sidebar
     * @return \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Sidebar\Sidebar
     */
    public function add($sidebar)
    {
        $this->children[$sidebar->getId()] = $sidebar;
        $sidebar->setParent($this);
        return $this;
    }

    public function getChild($id)
    {
        if (!isset($this->children[$id]))
        {
            throw new \Exception(sprintf("Sidebar %s does not exist", $id));
        }
        return $this->children[$id];
    }

    public function hasChildren()
    {
        return !empty($this->children);
    }

    public function childrenDelete($id)
    {
        if (!isset($this->children[$id]))
        {
            throw new \Exception(sprintf("Sidebar children %s does not exist", $id));
        }
        unset ($this->children[$id]);
    }

    /**
     * @return Sidebar[]
     */
    public function getChildren()
    {
        return $this->children;
    }

    public function destroy()
    {
        unset($this->children);
        return $this;
    }

    public function getParent()
    {
        return $this->parent;
    }

    public function setParent($parent)
    {
        $this->parent = $parent;
        return $this;
    }

    public function delete()
    {
        if ($this->id)
        {
            $this->parent->childrenDelete($this->id);
        }
    }

    public function isActive()
    {
        return $this->active === true;
    }

    public function setActive($active)
    {
        $this->active = (boolean)$active;
        return $this;
    }

    public function setOrder($order)
    {
        $this->order = $order;
        return $this;
    }

    public function getOrder()
    {
        return $this->order;
    }
}
