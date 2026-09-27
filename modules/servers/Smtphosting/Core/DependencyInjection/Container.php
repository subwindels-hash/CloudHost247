<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\DependencyInjection;

use Illuminate\Contracts\Container\Container as ContainerContract;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Helper\WhmcsVersionComparator;

class Container extends \Illuminate\Container\Container
{
    protected static $instance = null;

    public static function getInstance()
    {
        if (is_null(self::$instance))
        {
            self::$instance = new static;
        }

        return static::$instance;
    }

    public static function setInstance(ContainerContract $container = null)
    {
        self::$instance = $container;
    }

    /**
     * @param $parameters
     * @param array $primitives
     * @return array
     */
    protected function getDependencies($parameters, array $primitives = [])
    {
        $dependencies = [];
        foreach ($parameters as $parameter)
        {
            if ($parameter->isOptional())
            {
                break;
            }

            $dependency = $parameter->getClass();
            // If the class is null, it means the dependency is a string or some other
            // primitive type which we can not resolve since it is not a class and
            // we will just bomb out with an error since we have no-where to go.
            if (array_key_exists($parameter->name, $primitives))
            {
                $dependencies[] = $primitives[$parameter->name];
            }
            elseif (is_null($dependency))
            {
                $dependencies[] = $this->resolveNonClass($parameter);
            }
            else
            {
                $dependencies[] = $this->resolveClass($parameter);
            }
        }
        return (array)$dependencies;
    }

    /**
     * Set null value as default parameter when cannot find default value
     * @param ReflectionParameter $parameter
     * @return null
     */
    protected function resolveNonClass(\ReflectionParameter $parameter)
    {
        if ($parameter->isDefaultValueAvailable())
        {
            return $parameter->getDefaultValue();
        }

        return null;
    }

    /* --------------------------------------- WHMCS 8 --------------------------------------- */
    /**
     * Resolve the given type from the container.
     *
     * @param string $abstract
     * @param array $parameters
     * @return mixed
     *
     * @throws \Illuminate\Contracts\Container\BindingResolutionException
     */
    public function make($abstract, array $parameters = [])
    {
        /* If $abstract contains namespace without slash at the begging, we need to add it */
        $explodedAbstract = explode('\\', $abstract);
        if ($explodedAbstract[0] == 'ModulesGarden' && count($explodedAbstract) > 1)
        {
            $abstract = '\\' . $abstract;
        }

        /* This function executes a different code, depending on the version of the container - WHMCS 8 has a much newer version */
        $version8OrHigher = (new WhmcsVersionComparator)->isWVersionHigherOrEqual('8.0.0');
//        if(strpos($abstract, 'smarty') !== false){
//            var_dump($abstract);
//            exit;
//        }
        if ($version8OrHigher)
        {
            return $this->resolve($abstract, $parameters);
        }

        $abstract = $this->getAlias($this->normalize($abstract));
        if (isset($this->instances[$abstract]))
        {
            return $this->instances[$abstract];
        }

        $concrete = $this->getConcrete($abstract);
        if ($this->isBuildable($concrete, $abstract))
        {
            $object = $this->build($concrete, $parameters);
        }
        else
        {
            $object = $this->make($concrete, $parameters);
        }

        foreach ($this->getExtenders($abstract) as $extender)
        {
            $object = $extender($object, $this);
        }

        if ($this->isShared($abstract))
        {
            $this->instances[$abstract] = $object;
        }

        $this->fireResolvingCallbacks($abstract, $object);
        $this->resolved[$abstract] = true;

        return $object;
    }

    /**
     * Resolve all of the dependencies from the ReflectionParameters.
     *
     * @param array $dependencies
     * @return array
     *
     * @throws \Illuminate\Contracts\Container\BindingResolutionException
     */
    protected function resolveDependencies(array $dependencies)
    {
        $results = [];
        foreach ($dependencies as $dependency)
        {
            if ($dependency->isOptional())
            {
                break;
            }

            if ($this->hasParameterOverride($dependency))
            {
                $results[] = $this->getParameterOverride($dependency);

                continue;
            }

            $result = is_null($dependency->getClass())
                ? $this->resolvePrimitive($dependency)
                : $this->resolveClass($dependency);

            if ($dependency->isVariadic())
            {
                $results = array_merge($results, $result);
            }
            else
            {
                $results[] = $result;
            }
        }

        return $results;
    }

    /**
     * Resolve a non-class hinted primitive dependency.
     *
     * @param \ReflectionParameter $parameter
     * @return mixed
     *
     * @throws \Illuminate\Contracts\Container\BindingResolutionException
     */
    protected function resolvePrimitive(\ReflectionParameter $parameter)
    {
        if (!is_null($concrete = $this->getContextualConcrete('$' . $parameter->name)))
        {
            return $concrete instanceof \Closure ? $concrete($this) : $concrete;
        }

        if ($parameter->isDefaultValueAvailable())
        {
            return $parameter->getDefaultValue();
        }

        if ($parameter->hasType())
        {
            $returnEmptyType = [];
            switch (strtolower($parameter->getType()->getName()))
            {
                case 'string':
                    $returnEmptyType = '';
                    break;
                case 'array':
                    $returnEmptyType = [];
                    break;
                default:
                    return null;
            }

            return $returnEmptyType;
        }

        return null;
    }
}
