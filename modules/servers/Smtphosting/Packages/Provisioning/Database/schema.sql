--
-- `#prefix#ProductSettings`
--
CREATE TABLE IF NOT EXISTS `#prefix#ProductSettings`
(
    `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
    `pid` int(10) unsigned NOT NULL,
    `setting` VARCHAR(255) NOT NULL,
    `value` TEXT NOT NULL,
    PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=#charset# DEFAULT COLLATE #collation#;


CREATE TABLE IF NOT EXISTS `#prefix#Cache`
(
    `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
    `key` VARCHAR(255) NOT NULL UNIQUE,
    `value` text(255) NOT NULL,
    `expiration` DATE NOT NULL,
    PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=#charset# DEFAULT COLLATE #collation#;