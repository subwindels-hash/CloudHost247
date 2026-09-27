<?php

$_ADDONLANG['addon_name'] = "Módulo de servidor dedicado y VPS de OVH";
$_ADDONLANG['addon_desc'] = "Utilice esta herramienta complementaria para realizar el mantenimiento de sus servidores dedicados y VPS de OVH. Para obtener más información, visite nuestra <a href=\"https://wiki.whmcsglobalservices.com/index.php?title=WHMCS_OVH_Module_Installation_Guide_%26_Documentation\" target=\"__blank\" style=\"color: #4169E1;\">Wiki.</a>";

/* dashboard */

$_ADDONLANG['about'] = "Acerca de";
$_ADDONLANG['version'] = "Versión";
$_ADDONLANG['licenseregname'] = "Nombre del registro de licencia";
$_ADDONLANG['licenseregemail'] = "Correo electrónico de registro de licencia";
$_ADDONLANG['licensevaliddomain'] = "Licencia de dominio válida";
$_ADDONLANG['license'] = "Licencia";
$_ADDONLANG['licensestatus'] = "Estado de la licencia";
$_ADDONLANG['author'] = "Autor";
$_ADDONLANG['productname'] = "nombre del producto";
$_ADDONLANG['lastupdated'] = "Última actualización";
$_ADDONLANG['version_no'] = "V 1.0.0";
$_ADDONLANG['license_registered_name'] = "Nombre registrado";
$_ADDONLANG['licenseemail'] = "Correo electrónico";
$_ADDONLANG['domainname'] = "Dominio válido";
$_ADDONLANG['license_no'] = "Licencia";
$_ADDONLANG['license_status'] = "Inválido";
$_ADDONLANG['authorname'] = "Servicios globales de Whmcs";
$_ADDONLANG['productName'] = "Módulo OVH, VPS y Servidor Dedicado";
$_ADDONLANG['updatedate'] = "21 de octubre de 2024";


/* header */
$_ADDONLANG['home'] = "Hogar";
$_ADDONLANG['keySetup'] = "Ajustes";
$_ADDONLANG['priceSettings'] = "Configuración de precios";
$_ADDONLANG['productsettings'] = "Configuración del producto";
$_ADDONLANG['os'] = "SO";
$_ADDONLANG['imapSetting'] = "Configuración del mapa";
$_ADDONLANG['mailTemplate_header'] = "Plantilla de correo";
$_ADDONLANG['documentation'] = "Documentación";
$_ADDONLANG['logs_header'] = "Registros";
$_ADDONLANG['existingserver_header'] = "Asignar servicio existente";
$_ADDONLANG['settings_header'] = "Configuración de ACL";
$_ADDONLANG['ordermanagement_header'] = "Rastreo de orden";

/* footer */

$_ADDONLANG['site_url'] = "Sitio URL :";
$_ADDONLANG['support_url'] = "URL de soporte:";
$_ADDONLANG['site_right'] = "Derechos de autor @" . date('Y') . " - Whmcs Global Services, Todos los derechos reservados";



/* consumer setting page */
$_ADDONLANG['tab_generate_api_key'] = "Generar claves API";
$_ADDONLANG['tab_logs'] = "Configuración de registros";
$_ADDONLANG['tab_imap'] = "Notificaciones por correo electrónico";
$_ADDONLANG['tab_priceSettings'] = "Configuración de precios";
$_ADDONLANG['tab_aclSettings'] = "Configuración de ACL";
$_ADDONLANG['tab_general'] = "Configuración general";
$_ADDONLANG['tab_orderformSettings'] = "Configuración del formulario de pedido";
$_ADDONLANG['orderformSettings_note'] = "Configuraciones para el formulario de pedido";
$_ADDONLANG['consumerSetting_page_note'] = "Genere la clave API.";
$_ADDONLANG['imap_notification_note'] = "Marque la opción de notificaciones específicas para dejar de enviar notificaciones por correo electrónico a sus clientes.";
$_ADDONLANG['logs_note'] = "¡OVH configuración de registro del módulo!";
$_ADDONLANG['general_note'] = "¡Configuración general para el módulo OVH!";
$_ADDONLANG['price_setting_note'] = "Aquí puede configurar los márgenes para cada grupo/tipo de producto OVH, esto se utilizará cuando importe/cree productos OVH en su WHMCS desde la pestaña Configuración del producto.";
$_ADDONLANG['product_setting_note'] = "Aquí puede importar/crear productos OVH en su WHMCS, primero seleccione el tipo de producto, luego la cuenta y luego el grupo de productos; solo se importarán/crearán en su WHMCS los productos marcados.";
$_ADDONLANG['product_pricesetting_note'] = "Aquí puede actualizar el precio del producto y el precio de las opciones configurables del producto.";
$_ADDONLANG['acl_setting_note'] = "Aquí puedes gestionar qué característica no deseas mostrar en el área de cliente para un producto específico. ¡VPS y productos dedicados pueden tener configuraciones diferentes!";
$_ADDONLANG['imapsetting_note'] = "Aquí puede gestionar las credenciales de webmail y gamail, que se utilizarán para leer el correo electrónico relacionado con OVH y enviarlo al cliente.";
$_ADDONLANG['addimap_note'] = "Aquí puede agregar las credenciales y también puede probar las conexiones de prueba.";
$_ADDONLANG['existingserver_existing_note'] = "¡Aquí puede asignar un servicio WHMCS existente a un cliente WHMCS con el servidor OVH!";
$_ADDONLANG['existingserver_new_note'] = "creará un servicio/pedido en su WHMCS";
$_ADDONLANG['manageemailtemplates_note'] = "Administre sus plantillas de correo electrónico personalizadas, puede habilitar/deshabilitar y actualizar las plantillas de correo electrónico.";
$_ADDONLANG['serversstatus_note'] = "Aquí puedes ver la lista de todos los servicios de OVH.";
$_ADDONLANG['logs_note'] = "Aquí podrá ver todos los datos de logs relacionados con el módulo de OVH.";
$_ADDONLANG['ordermanagement_note'] = "Aquí puede ver la lista de todos los pedidos de OVH y realizar un seguimiento del estado de cada pedido.";

$_ADDONLANG['choose_account_label'] = "Seleccione la cuenta para fusionar:";
$_ADDONLANG['merge_account_heading'] = "Fusionar y eliminar las credenciales de la cuenta OVH";
$_ADDONLANG['merge_account_note'] = "Esta cuenta ya tiene el servicio o producto importado. Por favor, seleccione la <b>cuenta de la misma ubicación</b> con la que desea fusionarla y luego elimine las credenciales de esta cuenta. Si no existe una cuenta adecuada, primero cree una nueva cuenta.";
$_ADDONLANG['confirmDeleteCredentialbtn'] = "Fusionar y eliminar";

$_ADDONLANG['enable_disbale_log'] = "¡Activar/desactivar el registro del módulo OVH!";



$_ADDONLANG['generate_api_key'] = "Generar claves API";
$_ADDONLANG['choose_company'] = "Elija empresa";
$_ADDONLANG['soyoustart'] = "Así que empiezas";
$_ADDONLANG['ovh'] = "Ovh";
$_ADDONLANG['kimsufi'] = "kimsufi";
$_ADDONLANG['server_location'] = "Ubicación del servidor";
$_ADDONLANG['get_secret_key_desc1'] = "Haga clic para crear su primera";
$_ADDONLANG['get_secret_key_desc2'] = "Aplicación";
$_ADDONLANG['get_secret_key_desc3'] = "Obtendrá la clave secreta y de aplicación.";
$_ADDONLANG['europe'] = "Europa";
$_ADDONLANG['canada'] = "Canadá";
$_ADDONLANG['us'] = "NOSOTROS";
$_ADDONLANG['singapore'] = "Singapur";
$_ADDONLANG['world'] = "Mundo";
$_ADDONLANG['application_key'] = "Clave de aplicación";
$_ADDONLANG['application_key_placeholder'] = "Ingrese la clave de la aplicación";
$_ADDONLANG['secret_key'] = "Llave secreta";
$_ADDONLANG['secret_key_placeholder'] = "Ingrese la clave secreta";
$_ADDONLANG['user_name'] = "Nombre de usuario/ID de correo electrónico";
$_ADDONLANG['user_name_placeholder'] = "Introduzca su nombre de usuario";
$_ADDONLANG['btn_generate_key'] = "Generar clave";
$_ADDONLANG['account_user'] = "Usuario de cuenta";
$_ADDONLANG['location'] = "Ubicación";
$_ADDONLANG['status'] = "Estado";
$_ADDONLANG['application_key'] = "Clave de aplicación";
$_ADDONLANG['action'] = "Acción";
$_ADDONLANG['method'] = "Método";
$_ADDONLANG['expiry_date'] = "Fecha de caducidad";
$_ADDONLANG['your_ovh_credentials'] = "Tus credenciales de OVH";
$_ADDONLANG['consumer_key'] = "Clave del consumidor";
$_ADDONLANG['close'] = "Cerca";


/* Price Settings */
$_ADDONLANG['price_setting_heading'] = "Configuración de precios";
$_ADDONLANG['server_name'] = "Nombre del servidor";
$_ADDONLANG['server_type'] = "Tipo de servidor";
$_ADDONLANG['product_margin'] = "Margen del producto (%)";
$_ADDONLANG['additional_ip_margin'] = "Precio de IP adicional";
$_ADDONLANG['setup_fees_margin'] = "Margen de tarifas de instalación (%)";
$_ADDONLANG['payment_method'] = "Método de pago OVH";
$_ADDONLANG['edit'] = "Editar";
$_ADDONLANG['delete'] = "Borrar";
$_ADDONLANG['no_record_found'] = "ningún record fue encontrado";
$_ADDONLANG['edit_price_margin'] = "Editar margen de precio";
$_ADDONLANG['add_price_margin'] = "Agregar margen de precio";
$_ADDONLANG['config_option_snapshot_margin'] = "Margen de instantánea(%)";
$_ADDONLANG['config_option_auto_backup_margin'] = "Margen de copia de seguridad automática (%)";
$_ADDONLANG['config_option_backup_margin'] = "Margen de respaldo (%)";
$_ADDONLANG['config_option_additional_disk_margin'] = "Margen de disco adicional (%)";
$_ADDONLANG['confi_option_backup_space_margin'] = "Margen de espacio de respaldo (%)";
$_ADDONLANG['config_option_cpanel_soft_margin'] = "Margen del software del panel de control (%)";
$_ADDONLANG['config_option_image_margin'] = "Margen de imagen del sistema operativo (%)";
$_ADDONLANG['config_option_data_center_location_margin'] = "Margen de ubicación del centro de datos (%)";
$_ADDONLANG['config_option_public_network_margin'] = "Margen de la red pública (%)";
$_ADDONLANG['config_option_private_network_margin'] = "Margen de red privada (%)";
$_ADDONLANG['config_option_storage'] = "Margen de IP adicionales (%)";
$_ADDONLANG['config_option_plesk'] = "Margen Plesk(%)";
$_ADDONLANG['back'] = "Atrás";
$_ADDONLANG['support_payment_methods'] = "OVH sólo admite métodos de pago mediante PayPal, cuenta bancaria, tarjeta de crédito y cuenta ovh";

/* os setting page */
$_ADDONLANG['window'] = "ventanas";
$_ADDONLANG['sqlserver'] = "Servidor SQL";
$_ADDONLANG['ubuntu'] = "ubuntu";
$_ADDONLANG['centos'] = "centos";
$_ADDONLANG['debian'] = "Debian";
$_ADDONLANG['plesk'] = "Por favor";
$_ADDONLANG['cloudlinux'] = "NubeLinux";
$_ADDONLANG['gentoo'] = "Gentoo";
$_ADDONLANG['slackware'] = "Slackware";
$_ADDONLANG['archlinux'] = "ArchLinux";
$_ADDONLANG['freebsd'] = "FreeBSD";
$_ADDONLANG['fedora'] = "sombrero";
$_ADDONLANG['smartos'] = "sistema operativo inteligente";
$_ADDONLANG['opensuse'] = "OpenSuse";
$_ADDONLANG['directadmin'] = "Administrador directo";
$_ADDONLANG['cpanel'] = "panel c";
$_ADDONLANG['coreos'] = "CoreOS";
$_ADDONLANG['ispconfig3'] = "IspConfig";
$_ADDONLANG['vmwareesxi'] = "Vmware Esxi";
$_ADDONLANG['xenserver'] = "Citrix XenServer";
$_ADDONLANG['proxmox'] = "VPS Proxmox";
$_ADDONLANG['solusvm'] = "SolusVM";
$_ADDONLANG['ovh'] = "Ovh";

$_ADDONLANG['template_name'] = "Nombre de la plantilla";
$_ADDONLANG['OSname'] = "Nombre del sistema operativo";
$_ADDONLANG['productsetupbutton'] = "Guardar configuración";
$_ADDONLANG['creatededicatedOSbutton'] = "Crear opción de configuración del sistema operativo";



/* imap setting */
$_ADDONLANG['addimapsetting'] = "Agregar configuración de mapa";
$_ADDONLANG['webmail_imaps'] = "Imágenes de correo web";
$_ADDONLANG['accountuser'] = "Usuario de cuenta";
$_ADDONLANG['username'] = "Nombre de usuario";
$_ADDONLANG['incomingmailservername'] = "Nombre del servidor de correo entrante";
$_ADDONLANG['portnumber'] = "Número de puerto";
$_ADDONLANG['ssltype'] = "Tipo SSl";
$_ADDONLANG['status'] = "Estado";
$_ADDONLANG['language'] = "Idioma";
$_ADDONLANG['gmails'] = "Gmail";
$_ADDONLANG['email'] = "Correo electrónico";
$_ADDONLANG['appsecretkey'] = "Clave secreta de la aplicación";
$_ADDONLANG['taketoken'] = "Tomar ficha";
$_ADDONLANG['back'] = "Atrás";
$_ADDONLANG['webmail'] = "correo web";
$_ADDONLANG['gmail'] = "Gmail";
$_ADDONLANG['appClientID'] = "ID de cliente de la aplicación";
$_ADDONLANG['appSecretkey'] = "Clave secreta de la aplicación";
$_ADDONLANG['automationsettings'] = "Configuración de automatización";
$_ADDONLANG['automationsettingstext'] = "Cree el siguiente trabajo cron usando PHP";
$_ADDONLANG['console_developers_google'] = "Cree un proyecto en su cuenta de Google haciendo clic en este enlace y copie y pegue el ID de cliente y la clave secreta a continuación.";
$_ADDONLANG['accountuser_addimap'] = "Usuario de cuenta";
$_ADDONLANG['incomingmailservername_addimap'] = "Nombre del servidor de correo entrante";
$_ADDONLANG['portnumber_addimap'] = "Número de puerto";
$_ADDONLANG['ssltype_addimap'] = "Tipo SSL";
$_ADDONLANG['username_addimap'] = "Nombre de usuario";
$_ADDONLANG['password_addimap'] = "Contraseña";
$_ADDONLANG['language_addimap'] = "Idioma";
$_ADDONLANG['notification_heading'] = "Configuración de notificaciones IMAP";


/* existing server */ 
$_ADDONLANG['existingserver'] = "Servicio existente";
$_ADDONLANG['existing'] = "Existente";
$_ADDONLANG['new'] = "Nuevo";
$_ADDONLANG['client'] = "Cliente WHMCS";
$_ADDONLANG['product'] = "Producto WHMCS";
$_ADDONLANG['serverLocation'] = "Ubicación del servidor OVH";
$_ADDONLANG['serverProvider'] = "Proveedor de servidor OVH";
$_ADDONLANG['Account-Number'] = "Usuario de cuenta OVH";
$_ADDONLANG['OVHServername'] = "Nombre del servidor OVH";
$_ADDONLANG['OVHCustomHostName'] = "Nombre de host personalizado de OVH";
$_ADDONLANG['paymentMethod'] = "Método de pago OVH";
$_ADDONLANG['createInvoice'] = "Crear factura";
$_ADDONLANG['sendEmail'] = "Enviar correo electrónico";
$_ADDONLANG['billingCycle'] = "Ciclo de facturación";
$_ADDONLANG['OVHServernamePlaceholder'] = "Introduzca el nombre del servidor OVH";
$_ADDONLANG['OVHCustomHostNamePlaceholder'] = "Introduzca el nombre de host personalizado de OVH";



/* manage wmail templates page */

$_ADDONLANG['mailTemplate'] = "Plantilla de correo";
$_ADDONLANG['managetemplates'] = "Administre sus plantillas de correo electrónico personalizadas";
$_ADDONLANG['emailtemplate'] = "Plantilla de correo electrónico";
$_ADDONLANG['status'] = "Estado";
$_ADDONLANG['disable'] = "Desactivar";
$_ADDONLANG['actions'] = "Comportamiento";
$_ADDONLANG['notemplate'] = "Sin plantilla";
$_ADDONLANG['disableddelctemp'] = "Plantilla seleccionada deshabilitada:";
$_ADDONLANG['templatedesired'] = "Ingrese el texto deseado en el área de texto a continuación para su plantilla";
$_ADDONLANG['subject'] = "Sujeto";
$_ADDONLANG['availabletemplate'] = "Variables de plantilla disponibles";


/*server status page */

$_ADDONLANG['serversstatus'] = "El estado del servidor";

$_ADDONLANG['clientName'] = "nombre del cliente";
$_ADDONLANG['hostname'] = "Nombre de host personalizado";
$_ADDONLANG['server'] = "Nombre del servidor OVH";
$_ADDONLANG['serviceRenewDate'] = "Fecha de renovación del servicio WHMCS";
$_ADDONLANG['serverRenewDate'] = "Fecha de renovación del servidor OVH";
$_ADDONLANG['serviceStatus'] = "Estado del servicio";
$_ADDONLANG['serverType'] = "Tipo de servidor";
$_ADDONLANG['serverStatus'] = "El estado del servidor";
$_ADDONLANG['OVHAccount'] = "Cuenta OVH";
$_ADDONLANG['action'] = "Acción";


/* product setting page */

$_ADDONLANG['productSettingHeading'] = "Configuración del producto Soyoustart/OVH/Kimsufi";
$_ADDONLANG['productType'] = "tipo de producto";
$_ADDONLANG['productTypeDedicated'] = "Dedicada";
$_ADDONLANG['productTypeVps'] = "VPS";
$_ADDONLANG['productTypeECO'] = "ECO Dedicado";
$_ADDONLANG['accountSetting'] = "Configuración de cuenta";
$_ADDONLANG['accountName'] = "OVH Nombre de la cuenta";
$_ADDONLANG['ovhSubsidiary'] = "OVH Filial";
$_ADDONLANG['product_id'] = "ID del Producto";
$_ADDONLANG['product_name'] = "nombre del producto";
$_ADDONLANG['product_price'] = "Precio del producto";
$_ADDONLANG['clientarea_link'] = "Enlace al área de clientes";
$_ADDONLANG['view_price'] = "Ver precio";
$_ADDONLANG['delete_product'] = "Acción";
$_ADDONLANG['view'] = "Vista";
$_ADDONLANG['delete'] = "Borrar";
$_ADDONLANG['cart_link'] = "Enlace al carrito";
$_ADDONLANG['monthly'] = "Mensual";
$_ADDONLANG['annually'] = "Anualmente";
$_ADDONLANG['biennially'] = "cada dos años";
$_ADDONLANG['configoptionh1'] = "Opciones de configuración";
$_ADDONLANG['option'] = "Opciones";
$_ADDONLANG['osHideHeading'] = "Ocultar el nombre del sistema operativo para mostrarlo en orden";
$_ADDONLANG['osName'] = "Nombre del sistema operativo:";
$_ADDONLANG['hideOsBtn'] = "Ocultar sistema operativo";
$_ADDONLANG['groupHeading'] = "Configuración de grupo";



/* Logs Page */
$_ADDONLANG['logs'] = "Registros de inicio de sesión";
$_ADDONLANG['logsdate'] = "Fecha";
$_ADDONLANG['action'] = "Acción";
$_ADDONLANG['response'] = "Respuesta";
$_ADDONLANG['request'] = "Pedido";
$_ADDONLANG['logsmessage'] = "Mensaje";
$_ADDONLANG['no_record_found'] = "ningún record fue encontrado";
$_ADDONLANG['cronlogs'] = "Registros cron";
$_ADDONLANG['cronlogsdate'] = "Fecha";
// $_ADDONLANG['user_name_email_id'] = "User Name/Email Id";
$_ADDONLANG['user_name_email_id'] = "Usuario de cuenta";
$_ADDONLANG['language'] = "Idioma";
$_ADDONLANG['mailtemplate'] = "Plantilla de correo";
$_ADDONLANG['cronlogsmessage'] = "Mensaje";
$_ADDONLANG['log_type'] = "Tipo de registros";
$_ADDONLANG['log'] = "Registros";


/* settings page */
$_ADDONLANG['settings'] = "Configuración de desactivación de funciones";
$_ADDONLANG['sync_product'] = "Sincronización de productos";
$_ADDONLANG['product_setting'] = "Configuración del producto";
$_ADDONLANG['product'] = "WHMCS Productos";
$_ADDONLANG['acl_settings'] = "Configuración de ACL";
$_ADDONLANG['setting_back'] = "Atrás";
$_ADDONLANG['setting_product_name'] = "nombre del producto";
$_ADDONLANG['setting_action'] = "Acción";



/* order manangement page */

$_ADDONLANG['main_heading'] = "Seguimiento de pedidos";
$_ADDONLANG['orderdate'] = "Fecha de orden";
$_ADDONLANG['order_th_serviceId'] = "ID de servicio WHMCS";
$_ADDONLANG['order_th_orderId'] = "ID de pedido WHMCS";
$_ADDONLANG['order_th_OvhId'] = "Número de pedido de OVH";
$_ADDONLANG['whmcs_order_th_Status'] = "Estado del servicio del producto WHMCS";
$_ADDONLANG['order_th_Order_Status'] = "Estado del servidor OVH";
$_ADDONLANG['order_th_clientName'] = "nombre del cliente";
$_ADDONLANG['order_th_productName'] = "Nombre del servicio del producto";

