<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Interfaces;

/**
 * FormDataProviderInterface Interface
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
interface FormDataProviderInterface
{

    public function create();

    public function read();

    public function update();

    public function delete();

    public function getValueById($id);
}
