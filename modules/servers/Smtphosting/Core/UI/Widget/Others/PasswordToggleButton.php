<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Others;

use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Builder\BaseContainer;

/**
 * Description of PasswordHiddenButton
 *
 * @author Pawel Kopec <pawelk@modulesgardne.com>
 */
class PasswordToggleButton extends BaseContainer
{
    protected $iconOn = 'lu-zmdi lu-zmdi-eye';
    protected $iconOff = 'lu-zmdi lu-zmdi-eye-off';
    private $password;

    protected $vueComponent = true;
    protected $defaultVueComponentName = 'mg-passtoogle';

    public function getIconOn()
    {
        return $this->iconOn;
    }

    public function getIconOff()
    {
        return $this->iconOff;
    }

    public function setIconOn($iconOn)
    {
        $this->iconOn = $iconOn;
        return $this;
    }

    public function setIconOff($iconOff)
    {
        $this->iconOff = $iconOff;
        return $this;
    }

    public function getPassword()
    {
        return $this->password;
    }

    public function setPassword($password)
    {
        $this->password = $password;
        return $this;
    }

    public function getPasswordHidden()
    {
        return str_repeat('*', strlen($this->getPassword()));
    }
}
