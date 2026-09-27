<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Http;

use Symfony\Component\HttpFoundation\Request as SymfonyRequest;

/**
 * Description of Request
 *
 * @author Rafał Ossowski <rafal.os@modulesgarden.com>
 */
class Request extends SymfonyRequest
{
    /**
     * @return Request
     */
    public static function build()
    {
        $return = Request::createFromGlobals();

        return $return;
    }

    public function getAll()
    {
        return [
            'attributes' => $this->attributes->all(),
            'query'      => $this->query->all(),
            'request'    => $this->request->all()
        ];
    }

    public function getSession($key = null, $default = null)
    {
        if ($key === null)
        {
            return $_SESSION;
        }
        else
        {
            if (isset($_SESSION[$key]) === true)
            {
                return $_SESSION[$key];
            }
            else
            {
                return $default;
            }
        }
    }

    public function getSessionId()
    {
        return session_id();
    }

    public function closeSession()
    {
        session_write_close();

        return $this;
    }

    public function addSession($key = null, $value = null)
    {
        if (is_array($key))
        {
            $temp = &$_SESSION;
            foreach ($key as $k)
            {
                if (is_null($k))
                {
                    $temp = &$temp[];
                }
                else
                {
                    $temp = &$temp[$k];
                }
            }
            $temp = $value;
            unset($temp);
        }
        elseif ($key != null)
        {
            $_SESSION[$key] = $value;
        }
        else
        {
            $_SESSION[] = $value;
        }
    }

    public function removeSession($key = null)
    {
        if (is_array($key))
        {
            $firstElement = $key[0];
            $dot          = dot(\WHMCS\Session::get($firstElement));
            unset($key[0]);
            $dot->delete([implode('.', $key)]);
            \WHMCS\Session::set($firstElement, $dot->all());
        }
        elseif ($key != null)
        {
            unset($_SESSION[$key]);
        }
        else
        {
            unset($_SESSION);
        }
    }
}
