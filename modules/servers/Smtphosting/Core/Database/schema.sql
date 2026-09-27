--
-- `#prefix#Logger`
--
CREATE TABLE IF NOT EXISTS `#prefix#Logger`(
    `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
    `id_ref` int(10) NOT NULL,
    `id_type` VARCHAR(25) NOT NULL,
    `type` VARCHAR(25) NOT NULL,
    `level` VARCHAR(25) NOT NULL,
    `date` DATETIME DEFAULT null,
    `request` TEXT NOT NULL,
    `response` TEXT NOT NULL,
    `before_vars` TEXT NOT NULL,
    `vars` TEXT NOT NULL,
    PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=#charset# DEFAULT COLLATE #collation#;

--
-- `#prefix#ModuleSettings`
--
CREATE TABLE IF NOT EXISTS `#prefix#ModuleSettings`
(
    `setting` VARCHAR(64) NOT NULL UNIQUE,
    `value` TEXT NOT NULL,
    PRIMARY KEY(`setting`)
) ENGINE=InnoDB DEFAULT CHARSET=#charset# DEFAULT COLLATE #collation#;
