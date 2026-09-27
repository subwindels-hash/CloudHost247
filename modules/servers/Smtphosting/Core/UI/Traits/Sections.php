<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Helpers\ContainerElementsConstants;

/**
 * Form Sections Elements related functions
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
trait Sections
{
    protected $sections = [];

    public function addSection($section)
    {
        $this->initSectionsContainer();

        $this->addElement($section, ContainerElementsConstants::SECTIONS);

        return $this;
    }

    public function getSection($id)
    {
        return $this->sections[$id];
    }

    public function getSections()
    {
        return $this->sections;
    }

    protected function initSectionsContainer()
    {
        if (!$this->elementContainerExists(ContainerElementsConstants::SECTIONS))
        {
            $this->addNewElementsContainer(ContainerElementsConstants::SECTIONS);
        }
    }

    public function validateSections($request)
    {
        foreach ($this->sections as $section)
        {
            $section->validateFields($request);
            $section->validateSections($request);
            if ($section->getValidationErrors())
            {
                $this->validationErrors = array_merge($this->validationErrors, $section->getValidationErrors());
            }
        }

        return $this;
    }
}
