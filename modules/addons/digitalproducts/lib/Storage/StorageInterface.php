<?php
namespace DigitalProducts\Storage;

interface StorageInterface
{
    public function storeUploadedFile($temporaryPath, $productId, $versionId, $originalName, $extension);
    public function absolutePath($storageKey, $legacyPath = null);
    public function available();
    public function root();
    public function isInsideDocumentRoot();
    public function describeSource();
}
