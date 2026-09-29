#!/usr/bin/env python3
"""Phase 6 manifest catalog generator.

Writes cloudhost247-node/manifests/<slug>/manifest.yaml for every catalog application from the
structured definitions below so the catalog stays consistent (same field shapes, same style)
instead of 45 hand-typed files drifting apart. Rerun after editing definitions.

This is a build-time authoring tool; the runtime importer reads the YAML, never this script.
"""
import os
import yaml

ROOT = os.path.join(os.path.dirname(__file__), '..', 'cloudhost247-node', 'manifests')

APPS = [
    # --- Automation ------------------------------------------------------------------------------
    dict(id='n8n', name='n8n', category='automation', featured=True, popularity=980,
         description='Fair-code workflow automation with 400+ integrations and native AI capabilities.',
         long_description='n8n is a source-available workflow automation tool that lets you connect anything to everything. Build complex automations visually with branching, merging, loops, and custom JavaScript or Python code nodes. Includes 400+ pre-built integrations, AI agent workflows, and a REST API for pipeline-as-code. Your workflows, credentials, and execution history live on your own server.',
         website='https://n8n.io', repository='https://github.com/n8n-io/n8n', documentation='https://docs.n8n.io',
         license='Sustainable Use License',
         cpu=2, memory=4096, storage=20480, rec_cpu=2, rec_mem=4096, rec_storage=40960,
         hosting=['docker', 'vps', 'dedicated', 'kubernetes'],
         env_required=[dict(key='N8N_ENCRYPTION_KEY', description='Key that encrypts saved credentials', secret=True, generate='random_32')],
         env_optional=[dict(key='N8N_HOST', defaultFromDomain=True), dict(key='N8N_EDITOR_BASE_URL', defaultFromUrl=True), dict(key='TZ', default='UTC'), dict(key='N8N_DIAGNOSTICS_ENABLED', default='false')],
         services={'app': dict(image='n8nio/n8n', port=5678, volumes=['/home/node/.n8n'])},
         healthcheck=dict(type='http', path='/', port=5678),
         versions=[dict(version='1.98.0', image='n8nio/n8n:1.98.0', stable=True)]),

    dict(id='node-red', name='Node-RED', category='automation', popularity=640,
         description='Low-code programming for event-driven applications, built on Node.js.',
         website='https://nodered.org', repository='https://github.com/node-red/node-red',
         documentation='https://nodered.org/docs', license='Apache-2.0',
         cpu=1, memory=1024, storage=10240, rec_cpu=1, rec_mem=2048, rec_storage=20480,
         hosting=['docker', 'vps', 'dedicated'],
         services={'app': dict(image='nodered/node-red', port=1880, volumes=['/data'])},
         env_optional=[dict(key='TZ', default='UTC')],
         healthcheck=dict(type='http', path='/', port=1880),
         versions=[dict(version='4.1.0', image='nodered/node-red:4.1.0', stable=True)]),

    # --- AI ---------------------------------------------------------------------------------------
    dict(id='ollama', name='Ollama', category='ai', popularity=870,
         description='Run large language models like Llama, Mistral, and Gemma locally on your own GPU.',
         long_description='Ollama bundles model weights, inference runtime, and a clean REST API into one service. Pull models with `ollama pull llama3`, then talk to them over OpenAI-compatible HTTP from any application. Model files are stored in a named volume so they survive redeploys.',
         website='https://ollama.com', repository='https://github.com/ollama/ollama', documentation='https://github.com/ollama/ollama/blob/main/docs/api.md',
         license='MIT',
         cpu=4, memory=8192, storage=102400, rec_cpu=8, rec_mem=32768, rec_storage=204800,
         gpu=True, hosting=['docker', 'vps', 'dedicated'],
         services={'app': dict(image='ollama/ollama', port=11434, volumes=['/root/.ollama'])},
         env_optional=[dict(key='OLLAMA_KEEP_ALIVE', default='5m')],
         healthcheck=dict(type='http', path='/api/version', port=11434),
         versions=[dict(version='0.5.7', image='ollama/ollama:0.5.7', stable=True)]),

    dict(id='open-webui', name='Open WebUI', category='ai', popularity=760,
         description='Self-hosted AI interface for Ollama and OpenAI-compatible APIs with users and RBAC.',
         website='https://openwebui.com', repository='https://github.com/open-webui/open-webui',
         documentation='https://docs.openwebui.com', license='BSD-3-Clause',
         cpu=2, memory=2048, storage=10240, rec_cpu=2, rec_mem=4096, rec_storage=20480,
         hosting=['docker', 'vps', 'dedicated'],
         env_required=[dict(key='OLLAMA_BASE_URL', description='URL of your Ollama instance, e.g. http://ollama:11434', default='http://ollama:11434')],
         services={'app': dict(image='ghcr.io/open-webui/open-webui', port=8080, volumes=['/app/backend/data'])},
         healthcheck=dict(type='http', path='/health', port=8080),
         versions=[dict(version='0.5.12', image='ghcr.io/open-webui/open-webui:0.5.12', stable=True)]),

    # --- Analytics --------------------------------------------------------------------------------
    dict(id='matomo', name='Matomo', category='analytics', popularity=700,
         description='Google Analytics alternative that gives you full data ownership and privacy compliance.',
         website='https://matomo.org', repository='https://github.com/matomo-org/matomo',
         documentation='https://matomo.org/docs', license='GPL-3.0',
         cpu=1, memory=1024, storage=10240, rec_cpu=2, rec_mem=2048, rec_storage=20480,
         hosting=['docker', 'vps', 'dedicated'],
         env_required=[dict(key='MATOMO_DATABASE_PASSWORD', secret=True, generate='random_32')],
         services={
             'app': dict(image='matomo', port=80, volumes=['/var/www/html'], depends_on=['db']),
             'db': dict(image='mariadb:11', internal=True, database='mariadb', volumes=['/var/lib/mysql']),
         },
         healthcheck=dict(type='http', path='/index.php', port=80),
         versions=[dict(version='5.2.0', image='matomo:5.2.0-apache', stable=True)]),

    dict(id='umami', name='Umami', category='analytics', popularity=580,
         description='Simple, fast, privacy-focused web analytics without cookies or personal data collection.',
         website='https://umami.is', repository='https://github.com/umami-software/umami',
         documentation='https://umami.is/docs', license='MIT',
         cpu=1, memory=1024, storage=10240, rec_cpu=1, rec_mem=2048, rec_storage=20480,
         hosting=['docker', 'vps', 'dedicated'],
         services={
             'app': dict(image='ghcr.io/umami-software/umami', port=3000, depends_on=['db'],
                         environment={'DATABASE_URL': 'postgres://__DB_USER__:__DB_PASSWORD__@db:5432/__DB_NAME__'}),
             'db': dict(image='postgres:17-alpine', internal=True, database='postgres', volumes=['/var/lib/postgresql/data']),
         },
         healthcheck=dict(type='http', path='/api/heartbeat', port=3000),
         versions=[dict(version='2.15.1', image='ghcr.io/umami-software/umami:postgresql-v2.15.1', stable=True)]),

    dict(id='plausible', name='Plausible Analytics', category='analytics', popularity=540,
         description='Lightweight and open-source web analytics, cookie-free and GDPR compliant.',
         website='https://plausible.io', repository='https://github.com/plausible/analytics',
         documentation='https://plausible.io/docs/self-hosting', license='AGPL-3.0',
         cpu=2, memory=2048, storage=20480, rec_cpu=2, rec_mem=4096, rec_storage=40960,
         hosting=['docker', 'vps', 'dedicated'],
         env_required=[dict(key='SECRET_KEY_BASE', secret=True, generate='random_32')],
         services={
             'app': dict(image='plausible/analytics', port=8000, depends_on=['db', 'clickhouse'],
                         environment={
                             'BASE_URL': '__URL__',
                             'DATABASE_URL': 'postgres://__DB_USER__:__DB_PASSWORD__@db:5432/__DB_NAME__',
                             'CLICKHOUSE_DATABASE': 'plausible_events_db',
                             'CLICKHOUSE_USER': 'plausible_events_user',
                             'DISABLE_REGISTRATION': 'true',
                         }),
             'db': dict(image='postgres:17-alpine', internal=True, database='postgres', volumes=['/var/lib/postgresql/data']),
             'clickhouse': dict(image='clickhouse/clickhouse-server:24-alpine', internal=True, volumes=['/var/lib/clickhouse']),
         },
         healthcheck=dict(type='http', path='/api/health', port=8000),
         versions=[dict(version='2.1.5', image='plausible/analytics:v2.1.5', stable=True)]),

    # --- Business ---------------------------------------------------------------------------------
    dict(id='odoo', name='Odoo', category='business', popularity=660,
         description='All-in-one business software: CRM, accounting, inventory, manufacturing, and e-commerce.',
         website='https://odoo.com', repository='https://github.com/odoo/odoo', documentation='https://www.odoo.com/documentation',
         license='LGPL-3.0',
         cpu=2, memory=4096, storage=51200, rec_cpu=4, rec_mem=8192, rec_storage=102400,
         hosting=['docker', 'vps', 'dedicated'],
         services={
             'app': dict(image='odoo', port=8069, volumes=['/var/lib/odoo', '/mnt/extra-addons'], depends_on=['db']),
             'db': dict(image='postgres:17-alpine', internal=True, database='postgres', volumes=['/var/lib/postgresql/data']),
         },
         env_optional=[dict(key='HOST', defaultFromDomain=True)],
         healthcheck=dict(type='http', path='/', port=8069),
         versions=[dict(version='18.0', image='odoo:18.0', stable=True)]),

    # --- CMS --------------------------------------------------------------------------------------
    dict(id='wordpress', name='WordPress', category='cms', featured=True, popularity=1000,
         description='The world\u2019s most popular publishing platform — deploy on Docker or cPanel hosting.',
         long_description='WordPress powers over 40% of the web. CloudHost247 deploys it two ways: as an isolated Docker Compose stack (WordPress + MariaDB behind Traefik with automatic SSL) on VPS/dedicated hosting, or as a fully provisioned cPanel account with database, core files, and wp-config generated via the WHM/UAPI integration. You pick the plan; the platform picks the right deployment engine.',
         website='https://wordpress.org', repository='https://github.com/WordPress/WordPress',
         documentation='https://wordpress.org/documentation', license='GPL-2.0',
         cpu=1, memory=1024, storage=10240, rec_cpu=2, rec_mem=2048, rec_storage=40960,
         hosting=['docker', 'vps', 'dedicated', 'cpanel', 'kubernetes'], cpanel_installer='wordpress',
         env_optional=[dict(key='WORDPRESS_CONFIG_EXTRA', default="define('WP_HOME', 'https://'.(isset($_SERVER['HTTP_HOST']) ? $_SERVER['HTTP_HOST'] : '')); define('WP_SITEURL', WP_HOME);")],
         services={
             'app': dict(image='wordpress', port=80, volumes=['/var/www/html'], depends_on=['db']),
             'db': dict(image='mariadb:11', internal=True, database='mariadb', volumes=['/var/lib/mysql']),
         },
         healthcheck=dict(type='http', path='/wp-login.php', port=80),
         versions=[dict(version='6.7', image='wordpress:6.7-apache', stable=True)]),

    dict(id='ghost', name='Ghost', category='cms', popularity=620,
         description='Modern publishing platform for professional blogs and newsletters with built-in memberships.',
         website='https://ghost.org', repository='https://github.com/TryGhost/Ghost', documentation='https://ghost.org/docs',
         license='MIT',
         cpu=1, memory=1024, storage=10240, rec_cpu=2, rec_mem=2048, rec_storage=20480,
         hosting=['docker', 'vps', 'dedicated'],
         services={
             'app': dict(image='ghost', port=2368, volumes=['/var/lib/ghost/content'], depends_on=['db']),
             'db': dict(image='mysql:8', internal=True, database='mysql', volumes=['/var/lib/mysql']),
         },
         healthcheck=dict(type='http', path='/', port=2368),
         versions=[dict(version='5.104', image='ghost:5.104-alpine', stable=True)]),

    # --- Communication ----------------------------------------------------------------------------
    dict(id='rocketchat', name='Rocket.Chat', category='communication', popularity=600,
         description='Open-source team chat with channels, video calls, and unlimited message history.',
         website='https://rocket.chat', repository='https://github.com/RocketChat/Rocket.Chat',
         documentation='https://rocket.chat/docs', license='MIT',
         cpu=2, memory=4096, storage=30720, rec_cpu=4, rec_mem=8192, rec_storage=61440,
         hosting=['docker', 'vps', 'dedicated'],
         services={
             'app': dict(image='rocketchat/rocket.chat', port=3000, volumes=['/app/uploads'], depends_on=['db']),
             'db': dict(image='mongo:8', internal=True, database='mongodb', command='mongod --oplogSize 128 --replSet rs0 --bind_ip_all'),
         },
         healthcheck=dict(type='http', path='/api/info', port=3000),
         versions=[dict(version='7.2.0', image='rocketchat/rocket.chat:7.2.0', stable=True)]),

    dict(id='roundcube', name='Roundcube', category='communication', popularity=480,
         description='Browser-based multilingual IMAP webmail client with full MIME and LDAP support.',
         website='https://roundcube.net', repository='https://github.com/roundcube/roundcubemail',
         documentation='https://roundcube.net/download', license='GPL-3.0',
         cpu=1, memory=512, storage=10240, rec_cpu=1, rec_mem=1024, rec_storage=20480,
         hosting=['docker', 'vps', 'dedicated'],
         services={
             'app': dict(image='roundcube/roundcubemail', port=80, volumes=['/var/www/html'], depends_on=['db']),
             'db': dict(image='mariadb:11', internal=True, database='mariadb', volumes=['/var/lib/mysql']),
         },
         healthcheck=dict(type='http', path='/', port=80),
         versions=[dict(version='1.6.9', image='roundcube/roundcubemail:1.6.9-apache', stable=True)]),

    # --- CRM --------------------------------------------------------------------------------------
    dict(id='espocrm', name='EspoCRM', category='crm', popularity=430,
         description='Open-source CRM with a clean interface, workflows, and full data ownership.',
         website='https://espocrm.com', repository='https://github.com/espocrm/espocrm',
         documentation='https://docs.espocrm.com', license='AGPL-3.0',
         cpu=1, memory=1024, storage=20480, rec_cpu=2, rec_mem=2048, rec_storage=40960,
         hosting=['docker', 'vps', 'dedicated'],
         services={
             'app': dict(image='espocrm/espocrm', port=8080, volumes=['/var/www/html'], depends_on=['db']),
             'db': dict(image='mariadb:11', internal=True, database='mariadb', volumes=['/var/lib/mysql']),
         },
         healthcheck=dict(type='http', path='/api/v1/App/user', port=8080),
         versions=[dict(version='9.0', image='espocrm/espocrm:9.0-apache', stable=True)]),

    # --- Database ---------------------------------------------------------------------------------
    dict(id='postgresql', name='PostgreSQL', category='database', featured=True, popularity=920,
         description='The world\u2019s most advanced open-source relational database, as a dedicated instance.',
         long_description='A dedicated PostgreSQL 17 instance with generated credentials, an isolated named volume for the data directory, and automated backups. Reachable by your other installations on the same private network, or exposed with a domain of its own through the platform proxy. pgAdmin and Adminer are both in the marketplace to manage it.',
         website='https://postgresql.org', repository='https://github.com/postgres/postgres',
         documentation='https://www.postgresql.org/docs', license='PostgreSQL',
         cpu=1, memory=1024, storage=20480, rec_cpu=2, rec_mem=4096, rec_storage=102400,
         hosting=['docker', 'vps', 'dedicated'],
         services={'app': dict(image='postgres', port=5432, volumes=['/var/lib/postgresql/data'])},
         healthcheck=dict(type='command', command=['pg_isready', '-U', 'postgres']),
         versions=[dict(version='17', image='postgres:17-alpine', stable=True), dict(version='16', image='postgres:16-alpine')]),

    dict(id='mariadb', name='MariaDB', category='database', popularity=720,
         description='Enhanced, community-developed drop-in replacement for MySQL.',
         website='https://mariadb.org', repository='https://github.com/MariaDB/server',
         documentation='https://mariadb.com/kb/en/documentation', license='GPL-2.0',
         cpu=1, memory=1024, storage=20480, rec_cpu=2, rec_mem=4096, rec_storage=102400,
         hosting=['docker', 'vps', 'dedicated'],
         services={'app': dict(image='mariadb', port=3306, volumes=['/var/lib/mysql'])},
         healthcheck=dict(type='command', command=['healthcheck.sh', '--connect', '--innodb_initialized']),
         versions=[dict(version='11.7', image='mariadb:11.7', stable=True)]),

    dict(id='mysql', name='MySQL', category='database', popularity=780,
         description='The world\u2019s most popular open-source database, trusted for web applications of every scale.',
         website='https://mysql.com', repository='https://github.com/mysql/mysql-server',
         documentation='https://dev.mysql.com/doc', license='GPL-2.0',
         cpu=1, memory=1024, storage=20480, rec_cpu=2, rec_mem=4096, rec_storage=102400,
         hosting=['docker', 'vps', 'dedicated'],
         services={'app': dict(image='mysql', port=3306, volumes=['/var/lib/mysql'])},
         healthcheck=dict(type='command', command=['mysqladmin', 'ping', '-h', 'localhost']),
         versions=[dict(version='8.4', image='mysql:8.4', stable=True)]),

    dict(id='mongodb', name='MongoDB', category='database', popularity=690,
         description='Document database built for modern applications with flexible schemas and scaling.',
         website='https://mongodb.com', repository='https://github.com/mongodb/mongo',
         documentation='https://www.mongodb.com/docs', license='SSPL-1.0',
         cpu=1, memory=2048, storage=20480, rec_cpu=2, rec_mem=4096, rec_storage=102400,
         hosting=['docker', 'vps', 'dedicated'],
         services={'app': dict(image='mongo', port=27017, volumes=['/data/db'])},
         healthcheck=dict(type='command', command=['mongosh', '--quiet', '--eval', 'db.adminCommand("ping").ok']),
         versions=[dict(version='8.0', image='mongo:8.0', stable=True)]),

    dict(id='redis', name='Redis', category='database', popularity=850,
         description='In-memory data store for caching, queues, session storage, and pub/sub.',
         website='https://redis.io', repository='https://github.com/redis/redis',
         documentation='https://redis.io/docs/latest', license='RSALv2/SSPL-1.0',
         cpu=1, memory=1024, storage=10240, rec_cpu=1, rec_mem=2048, rec_storage=20480,
         hosting=['docker', 'vps', 'dedicated'],
         services={'app': dict(image='redis', port=6379, volumes=['/data'], command='redis-server --appendonly yes')},
         healthcheck=dict(type='command', command=['redis-cli', 'ping']),
         versions=[dict(version='7.4', image='redis:7.4-alpine', stable=True)]),

    dict(id='adminer', name='Adminer', category='database', popularity=520,
         description='Lightweight database management UI for MySQL, PostgreSQL, SQLite, and MongoDB.',
         website='https://adminer.org', repository='https://github.com/vrana/adminer',
         documentation='https://adminer.org', license='Apache-2.0/GPL-2.0',
         cpu=1, memory=256, storage=2560, rec_cpu=1, rec_mem=512, rec_storage=5120,
         hosting=['docker', 'vps', 'dedicated'],
         env_optional=[dict(key='ADMINER_DESIGN', default='pepa-linha-dark')],
         services={'app': dict(image='adminer', port=8080)},
         healthcheck=dict(type='http', path='/', port=8080),
         versions=[dict(version='4.8.1', image='adminer:4.8.1', stable=True)]),

    dict(id='phpmyadmin', name='phpMyAdmin', category='database', popularity=740,
         description='Classic web interface for MySQL and MariaDB administration.',
         website='https://phpmyadmin.net', repository='https://github.com/phpmyadmin/phpmyadmin',
         documentation='https://docs.phpmyadmin.net', license='GPL-2.0',
         cpu=1, memory=256, storage=2560, rec_cpu=1, rec_mem=512, rec_storage=5120,
         hosting=['docker', 'vps', 'dedicated'],
         env_required=[dict(key='PMA_HOST', description='Hostname of your MySQL/MariaDB installation', default='db')],
         services={'app': dict(image='phpmyadmin', port=80)},
         healthcheck=dict(type='http', path='/', port=80),
         versions=[dict(version='5.2.1', image='phpmyadmin:5.2.1-apache', stable=True)]),

    # --- Developer tools --------------------------------------------------------------------------
    dict(id='gitea', name='Gitea', category='developer-tools', featured=True, popularity=830,
         description='Painless self-hosted Git service with issues, pull requests, and built-in CI.',
         website='https://gitea.com', repository='https://github.com/go-gitea/gitea',
         documentation='https://docs.gitea.com', license='MIT',
         cpu=1, memory=1024, storage=20480, rec_cpu=2, rec_mem=2048, rec_storage=102400,
         hosting=['docker', 'vps', 'dedicated', 'kubernetes'],
         services={
             'app': dict(image='gitea/gitea', port=3000, volumes=['/data'], depends_on=['db']),
             'db': dict(image='postgres:17-alpine', internal=True, database='postgres', volumes=['/var/lib/postgresql/data']),
         },
         env_optional=[dict(key='GITEA__server__ROOT_URL', defaultFromUrl=True), dict(key='GITEA__server__DOMAIN', defaultFromDomain=True)],
         healthcheck=dict(type='http', path='/api/healthz', port=3000),
         versions=[dict(version='1.24.0', image='gitea/gitea:1.24.0', stable=True)]),

    dict(id='code-server', name='code-server', category='developer-tools', popularity=610,
         description='VS Code in the browser, running on your own server with your own hardware.',
         website='https://coder.com', repository='https://github.com/coder/code-server',
         documentation='https://coder.com/docs/code-server/latest', license='MIT',
         cpu=2, memory=2048, storage=20480, rec_cpu=4, rec_mem=8192, rec_storage=81920,
         hosting=['docker', 'vps', 'dedicated'],
         env_required=[dict(key='PASSWORD', description='Login password for the web editor', secret=True, generate='random_32')],
         services={'app': dict(image='codercom/code-server', port=8080, volumes=['/home/coder'])},
         healthcheck=dict(type='http', path='/healthz', port=8080),
         versions=[dict(version='4.95.0', image='codercom/code-server:4.95.0', stable=True)]),

    # --- Documents --------------------------------------------------------------------------------
    dict(id='bookstack', name='BookStack', category='documents', popularity=530,
         description='Platform for organising and storing information in books, chapters, and pages.',
         website='https://bookstackapp.com', repository='https://github.com/BookStackApp/BookStack',
         documentation='https://www.bookstackapp.com/docs', license='MIT',
         cpu=1, memory=1024, storage=20480, rec_cpu=1, rec_mem=2048, rec_storage=40960,
         hosting=['docker', 'vps', 'dedicated'],
         services={
             'app': dict(image='lscr.io/linuxserver/bookstack', port=80, volumes=['/config'], depends_on=['db']),
             'db': dict(image='mariadb:11', internal=True, database='mariadb', volumes=['/var/lib/mysql']),
         },
         env_optional=[dict(key='APP_URL', defaultFromUrl=True)],
         healthcheck=dict(type='http', path='/', port=80),
         versions=[dict(version='24.12', image='lscr.io/linuxserver/bookstack:24.12.1-ls', stable=True)]),

    dict(id='paperless-ngx', name='Paperless-ngx', category='documents', popularity=710,
         description='Scan, OCR, index, and archive all your physical documents, fully searchable.',
         website='https://docs.paperless-ngx.com', repository='https://github.com/paperless-ngx/paperless-ngx',
         documentation='https://docs.paperless-ngx.com', license='GPL-3.0',
         cpu=2, memory=2048, storage=51200, rec_cpu=2, rec_mem=4096, rec_storage=102400,
         hosting=['docker', 'vps', 'dedicated'],
         env_required=[dict(key='PAPERLESS_SECRET_KEY', secret=True, generate='random_32')],
         services={
             'app': dict(image='paperlessngx/paperless-ngx', port=8000,
                         volumes=['/usr/src/paperless/data', '/usr/src/paperless/media', '/usr/src/paperless/export'],
                         depends_on=['db', 'broker']),
             'db': dict(image='postgres:17-alpine', internal=True, database='postgres', volumes=['/var/lib/postgresql/data']),
             'broker': dict(image='redis:7-alpine', internal=True, database='redis', volumes=['/data']),
         },
         healthcheck=dict(type='http', path='/accounts/login/', port=8000),
         versions=[dict(version='2.14.0', image='paperlessngx/paperless-ngx:2.14.0', stable=True)]),

    # --- E-commerce -------------------------------------------------------------------------------
    dict(id='prestashop', name='PrestaShop', category='e-commerce', popularity=560,
         description='Open-source e-commerce platform with 300+ features and a thriving module ecosystem.',
         website='https://prestashop.com', repository='https://github.com/PrestaShop/PrestaShop',
         documentation='https://devdocs.prestashop-project.org', license='OSL-3.0',
         cpu=2, memory=2048, storage=30720, rec_cpu=2, rec_mem=4096, rec_storage=81920,
         hosting=['docker', 'vps', 'dedicated'],
         services={
             'app': dict(image='prestashop/prestashop', port=80, volumes=['/var/www/html'], depends_on=['db']),
             'db': dict(image='mysql:8', internal=True, database='mysql', volumes=['/var/lib/mysql']),
         },
         healthcheck=dict(type='http', path='/', port=80),
         versions=[dict(version='9.0', image='prestashop/prestashop:9.0-apache', stable=True)]),

    # --- Education --------------------------------------------------------------------------------
    dict(id='moodle', name='Moodle', category='education', popularity=590,
         description='The world\u2019s most popular learning management system for online courses.',
         website='https://moodle.org', repository='https://github.com/moodle/moodle',
         documentation='https://docs.moodle.org', license='GPL-3.0',
         cpu=2, memory=2048, storage=40960, rec_cpu=2, rec_mem=4096, rec_storage=81920,
         hosting=['docker', 'vps', 'dedicated'],
         services={
             'app': dict(image='bitnami/moodle', port=8080, volumes=['/bitnami/moodle', '/bitnami/apache'], depends_on=['db']),
             'db': dict(image='mariadb:11', internal=True, database='mariadb', volumes=['/var/lib/mysql']),
         },
         env_optional=[dict(key='MOODLE_SITE_URL', defaultFromUrl=True)],
         healthcheck=dict(type='http', path='/login/index.php', port=8080),
         versions=[dict(version='4.5', image='bitnami/moodle:4.5.2', stable=True)]),

    # --- Finance ----------------------------------------------------------------------------------
    dict(id='firefly-iii', name='Firefly III', category='finance', popularity=520,
         description='A free and open-source personal finance manager with budgets and reports.',
         website='https://firefly-iii.org', repository='https://github.com/firefly-iii/firefly-iii',
         documentation='https://docs.firefly-iii.org', license='AGPL-3.0',
         cpu=1, memory=1024, storage=10240, rec_cpu=1, rec_mem=2048, rec_storage=20480,
         hosting=['docker', 'vps', 'dedicated'],
         env_required=[dict(key='APP_KEY', description='Laravel application key (base64:...)', secret=True, generate='random_32')],
         services={
             'app': dict(image='fireflyiii/core', port=8080, volumes=['/var/www/html/storage/upload'], depends_on=['db']),
             'db': dict(image='mariadb:11', internal=True, database='mariadb', volumes=['/var/lib/mysql']),
         },
         env_optional=[dict(key='APP_URL', defaultFromUrl=True)],
         healthcheck=dict(type='http', path='/health', port=8080),
         versions=[dict(version='6.1.24', image='fireflyiii/core:version-6.1.24', stable=True)]),

    dict(id='akaunting', name='Akaunting', category='finance', popularity=400,
         description='Free and online accounting software for small businesses and freelancers.',
         website='https://akaunting.com', repository='https://github.com/akaunting/akaunting',
         documentation='https://akaunting.com/docs', license='GPL-3.0',
         cpu=1, memory=1024, storage=20480, rec_cpu=2, rec_mem=2048, rec_storage=40960,
         hosting=['docker', 'vps', 'dedicated'],
         services={
             'app': dict(image='akaunting/akaunting', port=80, volumes=['/var/www/html'], depends_on=['db']),
             'db': dict(image='mariadb:11', internal=True, database='mariadb', volumes=['/var/lib/mysql']),
         },
         healthcheck=dict(type='http', path='/', port=80),
         versions=[dict(version='3.1', image='akaunting/akaunting:3.1.9', stable=True)]),

    # --- Home automation -------------------------------------------------------------------------
    dict(id='home-assistant', name='Home Assistant', category='home-automation', featured=True, popularity=900,
         description='Open-source home automation hub that puts local control and privacy first.',
         long_description='Home Assistant connects thousands of smart home devices — Zigbee, Z-Wave, Matter, MQTT, and everything in between — into one local, private hub with powerful automations, dashboards, and voice control. Works fully offline; no cloud dependency.',
         website='https://home-assistant.io', repository='https://github.com/home-assistant/core',
         documentation='https://www.home-assistant.io/docs', license='Apache-2.0',
         cpu=2, memory=2048, storage=20480, rec_cpu=2, rec_mem=4096, rec_storage=40960,
         hosting=['docker', 'vps', 'dedicated'],
         services={'app': dict(image='homeassistant/home-assistant', port=8123, volumes=['/config'])},
         healthcheck=dict(type='http', path='/api/', port=8123),
         versions=[dict(version='2025.1', image='homeassistant/home-assistant:2025.1', stable=True)]),

    # --- Media ------------------------------------------------------------------------------------
    dict(id='immich', name='Immich', category='media', featured=True, popularity=950,
         description='High-performance self-hosted photo and video backup solution with mobile apps.',
         long_description='Immich is a self-hosted backup solution for your photos and videos from mobile devices, with facial recognition, object detection, albums, shared links, and a timeline UI that feels like the commercial services you are leaving. Includes the machine-learning service for on-device-style search.',
         website='https://immich.app', repository='https://github.com/immich-app/immich',
         documentation='https://immich.app/docs/overview/introduction', license='AGPL-3.0',
         cpu=2, memory=4096, storage=102400, rec_cpu=4, rec_mem=8192, rec_storage=512000,
         hosting=['docker', 'vps', 'dedicated'],
         services={
             'app': dict(image='ghcr.io/immich-app/immich-server', port=2283,
                         volumes=['/usr/src/app/upload'], depends_on=['db', 'redis', 'ml']),
             'db': dict(image='postgres:17-alpine', internal=True, database='postgres', volumes=['/var/lib/postgresql/data']),
             'redis': dict(image='redis:7-alpine', internal=True, database='redis'),
             'ml': dict(image='ghcr.io/immich-app/immich-machine-learning', internal=True, volumes=['/cache']),
         },
         env_required=[dict(key='IMMICH_MACHINE_LEARNING_URL', default='http://ml:3003')],
         healthcheck=dict(type='http', path='/api/server-info/ping', port=2283),
         versions=[dict(version='1.124.0', image='ghcr.io/immich-app/immich-server:v1.124.0', stable=True)]),

    dict(id='jellyfin', name='Jellyfin', category='media', popularity=880,
         description='Free software media system that puts you in control of your media library.',
         website='https://jellyfin.org', repository='https://github.com/jellyfin/jellyfin',
         documentation='https://jellyfin.org/docs', license='GPL-2.0',
         cpu=2, memory=2048, storage=102400, rec_cpu=4, rec_mem=8192, rec_storage=512000,
         hosting=['docker', 'vps', 'dedicated'],
         services={'app': dict(image='jellyfin/jellyfin', port=8096, volumes=['/config', '/media'])},
         healthcheck=dict(type='http', path='/health', port=8096),
         versions=[dict(version='10.10.0', image='jellyfin/jellyfin:10.10.0', stable=True)]),

    dict(id='navidrome', name='Navidrome', category='media', popularity=640,
         description='Modern music collection server and streamer with Subsonic API compatibility.',
         website='https://navidrome.org', repository='https://github.com/navidrome/navidrome',
         documentation='https://www.navidrome.org/docs', license='GPL-3.0',
         cpu=1, memory=512, storage=51200, rec_cpu=1, rec_mem=1024, rec_storage=256000,
         hosting=['docker', 'vps', 'dedicated'],
         services={'app': dict(image='deluan/navidrome', port=4533, volumes=['/data', '/music'])},
         env_optional=[dict(key='ND_BASEURL', default='')],
         healthcheck=dict(type='http', path='/ping', port=4533),
         versions=[dict(version='0.54.0', image='deluan/navidrome:0.54.0', stable=True)]),

    dict(id='photoprism', name='PhotoPrism', category='media', popularity=700,
         description='AI-powered photos app for the decentralized web — browse, organize, and share.',
         website='https://photoprism.app', repository='https://github.com/photoprism/photoprism',
         documentation='https://docs.photoprism.app', license='AGPL-3.0',
         cpu=2, memory=4096, storage=102400, rec_cpu=4, rec_mem=8192, rec_storage=512000,
         hosting=['docker', 'vps', 'dedicated'],
         env_required=[dict(key='PHOTOPRISM_ADMIN_PASSWORD', description='Initial admin password', secret=True, generate='random_32')],
         services={'app': dict(image='photoprism/photoprism', port=2342,
                               volumes=['/photoprism/originals', '/photoprism/storage'])},
         env_optional=[dict(key='PHOTOPRISM_SITE_URL', defaultFromUrl=True)],
         healthcheck=dict(type='http', path='/api/v1/status', port=2342),
         versions=[dict(version='241128', image='photoprism/photoprism:241128', stable=True)]),

    # --- Monitoring -------------------------------------------------------------------------------
    dict(id='grafana', name='Grafana', category='monitoring', featured=True, popularity=890,
         description='The open observability platform for dashboards, alerting, and analytics.',
         website='https://grafana.com', repository='https://github.com/grafana/grafana',
         documentation='https://grafana.com/docs/grafana/latest', license='AGPL-3.0',
         cpu=1, memory=1024, storage=10240, rec_cpu=2, rec_mem=2048, rec_storage=20480,
         hosting=['docker', 'vps', 'dedicated', 'kubernetes'],
         env_required=[dict(key='GF_SECURITY_ADMIN_PASSWORD', description='Admin login password', secret=True, generate='random_32')],
         services={'app': dict(image='grafana/grafana', port=3000, volumes=['/var/lib/grafana'])},
         env_optional=[dict(key='GF_SERVER_ROOT_URL', defaultFromUrl=True), dict(key='GF_USERS_ALLOW_SIGN_UP', default='false')],
         healthcheck=dict(type='http', path='/api/health', port=3000),
         versions=[dict(version='11.5.0', image='grafana/grafana:11.5.0', stable=True)]),

    dict(id='prometheus', name='Prometheus', category='monitoring', popularity=800,
         description='Open-source systems monitoring and alerting toolkit with a powerful query language.',
         website='https://prometheus.io', repository='https://github.com/prometheus/prometheus',
         documentation='https://prometheus.io/docs', license='Apache-2.0',
         cpu=1, memory=2048, storage=51200, rec_cpu=2, rec_mem=4096, rec_storage=102400,
         hosting=['docker', 'vps', 'dedicated', 'kubernetes'],
         services={'app': dict(image='prom/prometheus', port=9090, volumes=['/prometheus'])},
         healthcheck=dict(type='http', path='/-/healthy', port=9090),
         versions=[dict(version='3.1.0', image='prom/prometheus:v3.1.0', stable=True)]),

    dict(id='uptime-kuma', name='Uptime Kuma', category='monitoring', featured=True, popularity=930,
         description='Fancy self-hosted monitoring tool with status pages and 90+ notification providers.',
         website='https://github.com/louislam/uptime-kuma', repository='https://github.com/louislam/uptime-kuma',
         documentation='https://github.com/louislam/uptime-kuma/wiki', license='MIT',
         cpu=1, memory=512, storage=5120, rec_cpu=1, rec_mem=1024, rec_storage=20480,
         hosting=['docker', 'vps', 'dedicated'],
         services={'app': dict(image='louislam/uptime-kuma', port=3001, volumes=['/app/data'])},
         healthcheck=dict(type='http', path='/', port=3001),
         versions=[dict(version='1.23.15', image='louislam/uptime-kuma:1.23.15', stable=True)]),

    dict(id='netdata', name='Netdata', category='monitoring', popularity=690,
         description='Real-time, per-second infrastructure monitoring with zero configuration.',
         website='https://netdata.cloud', repository='https://github.com/netdata/netdata',
         documentation='https://learn.netdata.cloud', license='GPL-3.0',
         cpu=1, memory=1024, storage=20480, rec_cpu=1, rec_mem=2048, rec_storage=40960,
         hosting=['docker', 'vps', 'dedicated'],
         services={'app': dict(image='netdata/netdata', port=19999,
                               volumes=['/var/lib/netdata', '/etc/netdata'],
                               capabilities=['SYS_PTRACE'])},
         healthcheck=dict(type='http', path='/api/v1/info', port=19999),
         versions=[dict(version='2.2', image='netdata/netdata:v2.2', stable=True)]),

    # --- Networking -------------------------------------------------------------------------------
    dict(id='pi-hole', name='Pi-hole', category='networking', popularity=860,
         description='Network-level ad and tracker blocking DNS server for your whole network.',
         website='https://pi-hole.net', repository='https://github.com/pi-hole/pi-hole',
         documentation='https://docs.pi-hole.net', license='EUPL-1.2',
         cpu=1, memory=512, storage=5120, rec_cpu=1, rec_mem=1024, rec_storage=10240,
         hosting=['docker', 'vps', 'dedicated'],
         env_required=[dict(key='WEBPASSWORD', description='Admin web UI password', secret=True, generate='random_32')],
         services={'app': dict(image='pihole/pihole', port=80, volumes=['/etc/pihole'])},
         env_optional=[dict(key='TZ', default='UTC')],
         healthcheck=dict(type='http', path='/admin/login.php', port=80),
         versions=[dict(version='2024.07', image='pihole/pihole:2024.07.0', stable=True)]),

    dict(id='adguard-home', name='AdGuard Home', category='networking', popularity=780,
         description='Network-wide ad and tracker blocking with DHCP and encrypted DNS support.',
         website='https://adguard.com/adguard-home.html', repository='https://github.com/AdguardTeam/AdGuardHome',
         documentation='https://github.com/AdguardTeam/AdGuardHome/wiki', license='GPL-3.0',
         cpu=1, memory=512, storage=5120, rec_cpu=1, rec_mem=1024, rec_storage=10240,
         hosting=['docker', 'vps', 'dedicated'],
         services={'app': dict(image='adguard/adguardhome', port=3000, volumes=['/opt/adguardhome/conf', '/opt/adguardhome/work'])},
         healthcheck=dict(type='http', path='/', port=3000),
         versions=[dict(version='0.107.54', image='adguard/adguardhome:v0.107.54', stable=True)]),

    dict(id='wireguard-easy', name='WireGuard Easy', category='networking', popularity=810,
         description='The easiest way to install and manage WireGuard VPN on your server.',
         website='https://wg-easy.github.io', repository='https://github.com/wg-easy/wg-easy',
         documentation='https://github.com/wg-easy/wg-easy', license='CC-BY-NC-SA-4.0',
         cpu=1, memory=512, storage=5120, rec_cpu=1, rec_mem=1024, rec_storage=10240,
         hosting=['docker', 'vps', 'dedicated'],
         env_optional=[dict(key='WG_HOST', defaultFromDomain=True)],
         services={'app': dict(image='ghcr.io/wg-easy/wg-easy', port=51821, volumes=['/etc/wireguard'],
                               capabilities=['NET_ADMIN'])},
         healthcheck=dict(type='http', path='/', port=51821),
         versions=[dict(version='14', image='ghcr.io/wg-easy/wg-easy:14', stable=True)]),

    # --- Productivity -----------------------------------------------------------------------------
    dict(id='focalboard', name='Focalboard', category='productivity', popularity=470,
         description='Open-source project management tool that mirrors Trello and Notion workflows.',
         website='https://focalboard.com', repository='https://github.com/mattermost/focalboard',
         documentation='https://www.focalboard.com/docs', license='MIT/AGPL-3.0',
         cpu=1, memory=1024, storage=10240, rec_cpu=1, rec_mem=2048, rec_storage=20480,
         hosting=['docker', 'vps', 'dedicated'],
         services={'app': dict(image='mattermost/focalboard', port=8000, volumes=['/data'])},
         healthcheck=dict(type='http', path='/', port=8000),
         versions=[dict(version='7.11', image='mattermost/focalboard:7.11.4', stable=True)]),

    # --- Project management -----------------------------------------------------------------------
    dict(id='vikunja', name='Vikunja', category='project-management', popularity=510,
         description='The to-do app to organize your life — lists, kanban, gantt, and teams.',
         website='https://vikunja.io', repository='https://code.vikunja.io/vikunja',
         documentation='https://vikunja.io/docs', license='AGPL-3.0',
         cpu=1, memory=512, storage=10240, rec_cpu=1, rec_mem=1024, rec_storage=20480,
         hosting=['docker', 'vps', 'dedicated'],
         services={
             'app': dict(image='vikunja/frontend', port=80, depends_on=['api']),
             'api': dict(image='vikunja/api', port=3456, volumes=['/app/vikunja/files'], depends_on=['db']),
             'db': dict(image='postgres:17-alpine', internal=True, database='postgres', volumes=['/var/lib/postgresql/data']),
         },
         env_optional=[dict(key='VIKUNJA_SERVICE_PUBLICURL', defaultFromUrl=True)],
         healthcheck=dict(type='http', path='/api/v1/info', port=3456, service='api'),
         versions=[dict(version='0.24.0', image='vikunja/api:0.24.0', stable=True)]),

    dict(id='openproject', name='OpenProject', category='project-management', popularity=650,
         description='Leading open-source project management software with agile and classic teams in mind.',
         website='https://openproject.org', repository='https://github.com/opf/openproject',
         documentation='https://www.openproject.org/docs', license='GPL-3.0',
         cpu=2, memory=4096, storage=30720, rec_cpu=2, rec_mem=8192, rec_storage=61440,
         hosting=['docker', 'vps', 'dedicated'],
         env_required=[dict(key='SECRET_KEY_BASE', secret=True, generate='random_32')],
         services={'app': dict(image='openproject/openproject', port=80, volumes=['/var/openproject/assets'])},
         env_optional=[dict(key='OPENPROJECT_HOST__NAME', defaultFromDomain=True)],
         healthcheck=dict(type='http', path='/health_checks/default', port=80),
         versions=[dict(version='15.0', image='openproject/openproject:15.0', stable=True)]),

    # --- Security ---------------------------------------------------------------------------------
    dict(id='vaultwarden', name='Vaultwarden', category='security', featured=True, popularity=910,
         description='Unofficial Bitwarden-compatible server — password manager for your whole team.',
         long_description='Vaultwarden is a lightweight, self-hosted Bitwarden-compatible password server. Works with all official Bitwarden apps and browser extensions. End-to-end encrypted vaults, secure sharing, TOTP codes, and attachments — your passwords never leave infrastructure you control.',
         website='https://github.com/dani-garcia/vaultwarden', repository='https://github.com/dani-garcia/vaultwarden',
         documentation='https://github.com/dani-garcia/vaultwarden/wiki', license='AGPL-3.0',
         cpu=1, memory=256, storage=2560, rec_cpu=1, rec_mem=512, rec_storage=10240,
         hosting=['docker', 'vps', 'dedicated'],
         env_required=[dict(key='ADMIN_TOKEN', description='Token for the admin panel (argon2 hash recommended in production)', secret=True, generate='random_32')],
         services={'app': dict(image='vaultwarden/server', port=80, volumes=['/data'])},
         env_optional=[dict(key='DOMAIN', defaultFromUrl=True), dict(key='SIGNUPS_ALLOWED', default='true')],
         healthcheck=dict(type='http', path='/alive', port=80),
         versions=[dict(version='1.33.0', image='vaultwarden/server:1.33.0', stable=True)]),

    dict(id='keycloak', name='Keycloak', category='security', popularity=790,
         description='Open-source identity and access management with SSO, SAML, and social login.',
         website='https://keycloak.org', repository='https://github.com/keycloak/keycloak',
         documentation='https://www.keycloak.org/documentation', license='Apache-2.0',
         cpu=2, memory=2048, storage=20480, rec_cpu=2, rec_mem=4096, rec_storage=40960,
         hosting=['docker', 'vps', 'dedicated', 'kubernetes'],
         services={
             'app': dict(image='quay.io/keycloak/keycloak', port=8080,
                         command='start-dev', volumes=['/opt/keycloak/data'], depends_on=['db']),
             'db': dict(image='postgres:17-alpine', internal=True, database='postgres', volumes=['/var/lib/postgresql/data']),
         },
         env_required=[dict(key='KC_BOOTSTRAP_ADMIN_PASSWORD', secret=True, generate='random_32')],
         env_optional=[dict(key='KC_HOSTNAME', defaultFromDomain=True), dict(key='KC_PROXY_HEADERS', default='xforwarded')],
         healthcheck=dict(type='http', path='/health/ready', port=8080),
         versions=[dict(version='26.1', image='quay.io/keycloak/keycloak:26.1.0', stable=True)]),

    # --- Storage ----------------------------------------------------------------------------------
    dict(id='nextcloud', name='Nextcloud', category='storage', featured=True, popularity=960,
         description='Self-hosted file sync and share platform with calendars, contacts, and collaboration.',
         long_description='Nextcloud is a fully open-source content collaboration platform: files, calendars, contacts, mail, chat, and office editing in one place, on your own servers. Access from web, desktop clients, and mobile apps. This deployment includes Redis for file locking and a dedicated MariaDB database.',
         website='https://nextcloud.com', repository='https://github.com/nextcloud/server',
         documentation='https://docs.nextcloud.com', license='AGPL-3.0',
         cpu=2, memory=2048, storage=102400, rec_cpu=2, rec_mem=4096, rec_storage=512000,
         hosting=['docker', 'vps', 'dedicated'],
         services={
             'app': dict(image='nextcloud', port=80, volumes=['/var/www/html'], depends_on=['db', 'redis']),
             'db': dict(image='mariadb:11', internal=True, database='mariadb', volumes=['/var/lib/mysql']),
             'redis': dict(image='redis:7-alpine', internal=True, database='redis'),
         },
         env_optional=[dict(key='NEXTCLOUD_TRUSTED_DOMAINS', defaultFromDomain=True), dict(key='REDIS_HOST', default='redis')],
         healthcheck=dict(type='http', path='/status.php', port=80),
         versions=[dict(version='31.0', image='nextcloud:31.0-apache', stable=True)]),

    dict(id='minio', name='MinIO', category='storage', popularity=730,
         description='S3-compatible high-performance object storage for your own private cloud.',
         website='https://min.io', repository='https://github.com/minio/minio',
         documentation='https://min.io/docs/minio/container/index.html', license='AGPL-3.0',
         cpu=1, memory=1024, storage=102400, rec_cpu=2, rec_mem=4096, rec_storage=512000,
         hosting=['docker', 'vps', 'dedicated', 'kubernetes'],
         env_required=[dict(key='MINIO_ROOT_USER', default='ch247admin'), dict(key='MINIO_ROOT_PASSWORD', secret=True, generate='random_32')],
         services={'app': dict(image='minio/minio', port=9000, command='server /data --console-address ":9001"',
                               volumes=['/data'])},
         healthcheck=dict(type='http', path='/minio/health/live', port=9000),
         versions=[dict(version='2025.1', image='minio/minio:RELEASE.2025-01-20T14-49-07Z', stable=True)]),

    dict(id='filebrowser', name='File Browser', category='storage', popularity=590,
         description='Web file manager providing a clean UI over your files on any volume.',
         website='https://filebrowser.org', repository='https://github.com/filebrowser/filebrowser',
         documentation='https://filebrowser.org', license='Apache-2.0',
         cpu=1, memory=256, storage=10240, rec_cpu=1, rec_mem=512, rec_storage=51200,
         hosting=['docker', 'vps', 'dedicated'],
         services={'app': dict(image='filebrowser/filebrowser', port=80, volumes=['/srv', '/database', '/config'])},
         healthcheck=dict(type='http', path='/health', port=80),
         versions=[dict(version='2.32.0', image='filebrowser/filebrowser:v2.32.0', stable=True)]),

    # --- System administration --------------------------------------------------------------------
    dict(id='portainer', name='Portainer', category='system-administration', popularity=920,
         description='Lightweight container management UI for Docker environments.',
         website='https://portainer.io', repository='https://github.com/portainer/portainer',
         documentation='https://docs.portainer.io', license='Zlib',
         cpu=1, memory=512, storage=5120, rec_cpu=1, rec_mem=1024, rec_storage=10240,
         hosting=['docker', 'vps', 'dedicated'],
         services={'app': dict(image='portainer/portainer-ce', port=9000, volumes=['/data'])},
         healthcheck=dict(type='http', path='/', port=9000),
         versions=[dict(version='2.21.0', image='portainer/portainer-ce:2.21.4', stable=True)]),

    dict(id='dockge', name='Dockge', category='system-administration', popularity=660,
         description='Fancy, easy-to-use docker compose stack management with a live log view.',
         website='https://dockge.kuma.pet', repository='https://github.com/louislam/dockge',
         documentation='https://github.com/louislam/dockge/wiki', license='MIT',
         cpu=1, memory=512, storage=10240, rec_cpu=1, rec_mem=1024, rec_storage=20480,
         hosting=['docker', 'vps', 'dedicated'],
         services={'app': dict(image='louislam/dockge', port=5001, volumes=['/data'])},
         healthcheck=dict(type='http', path='/', port=5001),
         versions=[dict(version='1.4.2', image='louislam/dockge:1.4.2', stable=True)]),

    # --- Web hosting / infrastructure ------------------------------------------------------------
    dict(id='traefik', name='Traefik', category='infrastructure', popularity=850,
         description='Cloud-native reverse proxy and load balancer — the platform\u2019s routing layer.',
         long_description='Traefik is the reverse proxy CloudHost247 itself places in front of Docker-hosted applications: automatic service discovery via Docker labels, Let\u2019s Encrypt certificate issuance and renewal, and HTTP→HTTPS redirection. Deploying your own instance gives you an independent proxy for custom stacks.',
         website='https://traefik.io', repository='https://github.com/traefik/traefik',
         documentation='https://doc.traefik.io/traefik', license='MIT',
         cpu=1, memory=512, storage=5120, rec_cpu=1, rec_mem=1024, rec_storage=10240,
         hosting=['docker', 'vps', 'dedicated', 'kubernetes'],
         services={'app': dict(image='traefik', port=8080,
                               command='--providers.docker --entrypoints.web.address=:80 --entrypoints.websecure.address=:443 --api.dashboard=true',
                               volumes=['/etc/traefik'])},
         healthcheck=dict(type='http', path='/ping', port=8080),
         versions=[dict(version='3.3', image='traefik:v3.3', stable=True)]),

    dict(id='docker-registry', name='Docker Registry', category='infrastructure', popularity=560,
         description='Private OCI/Docker image registry for your own builds and deployments.',
         website='https://distribution.github.io/distribution', repository='https://github.com/distribution/distribution',
         documentation='https://distribution.github.io/distribution/about', license='Apache-2.0',
         cpu=1, memory=512, storage=102400, rec_cpu=1, rec_mem=1024, rec_storage=512000,
         hosting=['docker', 'vps', 'dedicated'],
         env_required=[dict(key='REGISTRY_STORAGE_DELETE_ENABLED', default='true')],
         services={'app': dict(image='registry', port=5000, volumes=['/var/lib/registry'])},
         healthcheck=dict(type='http', path='/v2/', port=5000),
         versions=[dict(version='2.8.3', image='registry:2.8.3', stable=True)]),
]


def manifest_for(app):
    services = {}
    for name, svc in app.get('services', {}).items():
        entry = dict(
            image=svc.get('image'),
            internal=svc.get('internal', False),
        )
        if svc.get('port') is not None:
            entry['port'] = svc['port']
        if 'command' in svc:
            entry['command'] = svc['command']
        if 'capabilities' in svc:
            entry['capabilities'] = svc['capabilities']
        if svc.get('volumes'):
            entry['volumes'] = svc['volumes']
        if svc.get('depends_on'):
            entry['dependsOn'] = svc['depends_on']
        if svc.get('environment'):
            entry['environment'] = svc['environment']
        if svc.get('database'):
            entry['database'] = svc['database']
        services[name] = entry

    requirements = dict(cpu=app['cpu'], memory=app['memory'], storage=app['storage'])
    if app.get('rec_cpu'):
        requirements['recommended'] = dict(cpu=app['rec_cpu'], memory=app['rec_mem'], storage=app['rec_storage'])
    if app.get('gpu'):
        requirements['gpu'] = True

    env_required = []
    for e in app.get('env_required', []):
        entry = dict(key=e['key'])
        if 'description' in e:
            entry['description'] = e['description']
        if e.get('secret'):
            entry['secret'] = True
        if e.get('generate'):
            entry['generate'] = e['generate']
        if 'default' in e:
            entry['default'] = e['default']
        env_required.append(entry)

    env_optional = []
    for e in app.get('env_optional', []):
        entry = dict(key=e['key'])
        if 'defaultFromDomain' in e:
            entry['defaultFromDomain'] = e['defaultFromDomain']
        elif 'defaultFromUrl' in e:
            entry['defaultFromUrl'] = e['defaultFromUrl']
        elif 'default' in e:
            entry['default'] = e['default']
        env_optional.append(entry)

    versions = []
    for v in app['versions']:
        entry = dict(version=v['version'], image=v['image'])
        if v.get('stable'):
            entry['stable'] = True
        if 'release_notes' in v:
            entry['releaseNotes'] = v['release_notes']
        versions.append(entry)

    healthcheck = dict(app['healthcheck']) if app.get('healthcheck') else None

    doc = dict(
        id=app['id'],
        name=app['name'],
        category=app['category'],
        description=app['description'],
        website=app.get('website'),
        repository=app.get('repository'),
        documentation=app.get('documentation'),
        license=app.get('license'),
        featured=app.get('featured', False),
        popularity=app.get('popularity', 0),
        deployment=dict(engine='docker-compose', **({'cpanelInstaller': app['cpanel_installer']} if app.get('cpanel_installer') else {})),
        supportedHostingTypes=app.get('hosting', ['docker']),
        requirements=requirements,
        services=services,
        environment=dict(required=env_required, optional=env_optional),
        domain=dict(enabled=True, primaryRequired=False),
        **({'healthcheck': healthcheck} if healthcheck else {}),
        ssl=dict(enabled=True),
        backup=dict(enabled=True, includes=['volumes', 'database'] if any(s.get('database') for s in app.get('services', {}).values()) else ['volumes']),
        update=dict(strategy='pull-and-recreate'),
        versions=versions,
    )
    if app.get('long_description'):
        doc['longDescription'] = app['long_description']

    # Drop null top-level optional fields
    for key in ['website', 'repository', 'documentation', 'license']:
        if doc[key] is None:
            del doc[key]

    return doc


def main():
    count = 0
    for app in APPS:
        directory = os.path.join(ROOT, app['id'])
        os.makedirs(directory, exist_ok=True)
        doc = manifest_for(app)
        path = os.path.join(directory, 'manifest.yaml')
        with open(path, 'w') as handle:
            yaml.safe_dump(doc, handle, sort_keys=False, allow_unicode=True, default_flow_style=False, width=110)
        count += 1
    print(f'wrote {count} manifests to {os.path.normpath(ROOT)}')


if __name__ == '__main__':
    main()
