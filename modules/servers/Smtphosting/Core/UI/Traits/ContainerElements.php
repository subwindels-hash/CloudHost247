<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits;

use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\DependencyInjection\DependencyInjection;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\ServiceLocator;

/**
 * Container Elements related functions
 * Base Container Trait
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
trait ContainerElements
{
    /**
     * a default container name for all elements in UI components
     * @var type string
     */
    protected $defaultContainer = 'elements';

    /* 
     * a list of allowed containers, it this way in order to prevent 
     * an accidental overwrite other variables
     */
    protected $elementsContainers = ['elements'];

    /**
     * an array of elements for every UI component
     * @var type array
     */
    protected $elements = [];


    /**
     * Adds new element to the container
     *
     * @param object|null $element
     * @param string|null $containerName
     * @return $this
     */
    public function addElement($element = null, $containerName = null)
    {
        if ($element === null)
        {
            return $this;
        }

        $element = $this->prepareElementInstance($element);

        $this->checkElementItemContext();

        $this->addElementToContainer($element, $containerName);

//          TODO - Sławek where are you!
//        if (!$element->wasInitialized() && $this->getRequestValue('ajax') == 1)
//        {
//            $element->runInitContentProcess();
//        }

        return $this;
    }


    /**
     * if $element is a string it will be converted to object
     *
     * @param object|string $element
     * @return object mixed
     */
    protected function prepareElementInstance($element)
    {
        if (is_string($element))
        {
            $element = DependencyInjection::create($element);
        }

        $element->setIndex(ServiceLocator::call('request')->get('index'));

        return $element;
    }

    /**
     * check if should load vue assets for ajax calls
     */
    protected function checkElementItemContext()
    {
        if ($this->isIdEqual($this->getRequestValue('loadData')))
        {
            self::$findItemContext = true;
        }
    }

    /**
     * do not use this function directly, addElement function is the only proper way
     */
    protected function addElementToContainer($element, $containerName = null)
    {
        /**
         * unique element id
         */
        $id = $element->getId();

        $container = $this->getElementContainerName($containerName);
        if (!$container)
        {
            return null;
        }

        if (!isset($this->{$container}[$id]))
        {
            $this->{$container}[$id] = $element;

            $this->registerMainContainerAdditions($this->{$container}[$id]);
        }
    }

    /**
     * Generates ajax and vue indication for $element object in the main container
     *
     * @param $element
     */
    protected function registerMainContainerAdditions(&$element)
    {
        if ($this->mainContainer === null)
        {
            return $this;
        }

        $element->setMainContainer($this->mainContainer);

        if ($element instanceof \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Interfaces\AjaxElementInterface)
        {
            $this->mainContainer->addAjaxElement($element);
        }

        if ($element->isVueComponent() && $element->isVueRegistrationAllowed())
        {
            $this->mainContainer->addVueComponent($element);
        }
    }

    /**
     * determines property name where the element will be added
     * @param type $containerName
     * @return type null|string
     */
    public function getElementContainerName($containerName = null)
    {
        /**
         * if not set use default container
         */
        if ($containerName === null)
        {
            return $this->defaultContainer;
        }

        /**
         * if invalid value provided
         */
        if (!$containerName || !is_string($containerName) || $containerName === '')
        {
            return null;
        }

        /**
         * container does not exists, or is not on the allowed list
         */
        if (!property_exists($this, $containerName) || !in_array($containerName, $this->elementsContainers))
        {
            return null;
        }

        /**
         * container is not an array
         */
        if (!is_array($this->{$containerName}))
        {
            return null;
        }

        return $containerName;
    }

    /**
     * States that the property should be treated as container from now on
     *
     * @param string|null $containerName
     * @return $this
     */
    public function addNewElementsContainer($containerName = null)
    {
        if (!is_string($containerName) || $containerName === '')
        {
            return $this;
        }

        if (!in_array($containerName, $this->elementsContainers) && property_exists($this, $containerName))
        {
            $this->elementsContainers[] = $containerName;
        }

        return $this;
    }

    /**
     * Returns all elements from the container $containerName
     *
     * @param string|null $containerName
     * @return array|type
     */
    public function getElements($containerName = null)
    {
        if (!$containerName)
        {
            return $this->elements;
        }

        if (in_array($containerName, $this->elementsContainers) && property_exists($this, $containerName))
        {
            return $this->{$containerName};
        }

        return [];
    }

    /**
     * Determines if container $containerName has any elements
     *
     * @param string|null $containerName
     * @return bool
     */
    public function elementsExists($containerName = null)
    {
        if (!$containerName)
        {
            return count($this->elements) > 0;
        }

        if (in_array($containerName, $this->elementsContainers) && property_exists($this, $containerName))
        {
            return count($this->{$containerName}) > 0;
        }

        return false;
    }

    /**
     * Returns an element object if exists in specified container or null otherwise
     *
     * @param string $id
     * @param string|null $containerName
     * @return object|null
     */
    public function getElementById($id, $containerName = null)
    {
        if (!$containerName)
        {
            return $this->elements[$id];
        }

        if (in_array($containerName, $this->elementsContainers) && property_exists($this, $containerName))
        {
            return $this->{$containerName}[$id];
        }

        return null;
    }

    /**
     * Returns an HTML of element object if exists in specified container or empty string otherwise
     * This is used for inserting elements HTML code directly to Smarty templates
     *
     * @param string $id
     * @param string|null $containerName
     * @return string
     */
    public function insertElementById($id, $containerName = null)
    {
        if (isset($this->elements[$id]) && !$containerName)
        {
            return $this->elements[$id]->getHtml();
        }

        if (in_array($containerName, $this->elementsContainers) && property_exists($this, $containerName))
        {
            return $this->{$containerName}[$id]->getHtml();
        }

        return '';
    }

    /**
     * Returns a list of available container names for $this object
     *
     * @return array
     */
    public function getElementsContainers()
    {
        return $this->elementsContainers;
    }

    /**
     * determines if container exists
     *
     * @param string|null $containerName
     * @return bool
     */
    public function elementContainerExists($containerName = null)
    {
        if (is_string($containerName) && trim($containerName) !== '' && isset($this->elementsContainers[$containerName]))
        {
            return true;
        }

        return false;
    }
}
