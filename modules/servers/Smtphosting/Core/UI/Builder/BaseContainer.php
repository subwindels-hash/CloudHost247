<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Builder;

/**
 * Base Container element. Every UI element should extend this.
 *
 * @author inbs
 */
class BaseContainer extends Context
{
    protected $data = [];

    /**
     * @param array $data
     * @return $this
     */
    public function setData($data = [])
    {
        $this->data = $data;
        $this->updateData();

        return $this;
    }

    public function getData()
    {
        return $this->data;
    }

    protected function updateData()
    {
        foreach ($this->data as $key => $value)
        {
            if (property_exists($this, $key))
            {
                $this->$key = $value;
            }
        }
        $this->data = [];

        return $this;
    }
}
