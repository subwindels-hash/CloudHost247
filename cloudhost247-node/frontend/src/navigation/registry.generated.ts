/**
 * GENERATED FILE — do not edit.
 *
 * Source: shared/site/registry.json
 * Regenerate: node scripts/site/generate.mjs
 *
 * The desktop mega menus, the mobile drawer, the footer, the sitemap and the link-integrity
 * test all read this one definition, so no two navigation surfaces can disagree and no menu
 * entry can point at a route the app does not serve.
 */
/* eslint-disable */

export interface RegistryLink {
  label: string;
  to: string;
  description: string;
  icon: string;
  badge?: 'NEW' | 'POPULAR' | 'TRENDING' | 'INCLUDED' | 'SALE';
}

export interface RegistryGroup {
  title: string;
  links: RegistryLink[];
}

export interface RegistrySection {
  id: string;
  label: string;
  blurb: string;
  to: string;
  toolsDriven: boolean;
  featured?: { title: string; body: string; to: string; ctaLabel: string };
  groups: RegistryGroup[];
}

export interface RegistryFooterColumn {
  title: string;
  toolsDriven: boolean;
  links: Array<{ label: string; to: string }>;
}

export const REGISTRY_VERSION = '2.0.0';

export const BRAND = {
  "name": "CloudHost247",
  "legalName": "CloudHost247 Isc.",
  "shortName": "CH247",
  "tagline": "Build. Host. Deploy. Scale.",
  "description": "CloudHost247 gives businesses, developers and organizations the infrastructure they need to build and operate online — from domains and websites to cloud servers, applications and deployment platforms."
} as const;

export const UTILITY = {
  "search": {
    "label": "Search",
    "to": "/search"
  },
  "signIn": {
    "label": "Sign In",
    "to": "/login"
  },
  "createAccount": {
    "label": "Create Account",
    "to": "/register"
  },
  "clientArea": {
    "label": "Client Area",
    "to": "/dashboard"
  },
  "cart": {
    "label": "Cart",
    "to": "/cart"
  }
} as const;

export const NAV_SECTIONS: RegistrySection[] = [
  {
    "id": "hosting",
    "label": "Hosting",
    "blurb": "Website, application and email hosting with a live product catalogue behind every plan page.",
    "to": "/hosting",
    "toolsDriven": false,
    "featured": {
      "title": "Web hosting",
      "body": "Shared and business hosting for websites of every size, with mailboxes, databases and one-click SSL.",
      "to": "/hosting/web-hosting",
      "ctaLabel": "Compare hosting plans"
    },
    "groups": [
      {
        "title": "Website hosting",
        "links": [
          {
            "label": "Web Hosting",
            "to": "/hosting/web-hosting",
            "description": "Web hosting plans for websites, with current products shown in the live catalogue.",
            "icon": "globe",
            "badge": "POPULAR"
          },
          {
            "label": "Shared Hosting",
            "to": "/hosting/web-hosting",
            "description": "Shared web hosting plans shown in the live product catalogue.",
            "icon": "globe"
          },
          {
            "label": "Business Hosting",
            "to": "/hosting/business",
            "description": "More resources and priority handling for company sites.",
            "icon": "briefcase"
          },
          {
            "label": "cPanel Hosting",
            "to": "/hosting/cpanel",
            "description": "Mailboxes, databases and installs from the panel your team knows.",
            "icon": "control"
          },
          {
            "label": "WordPress Hosting",
            "to": "/hosting/wordpress",
            "description": "WordPress with a managed runtime, cache and staging path.",
            "icon": "wordpress"
          },
          {
            "label": "Reseller Hosting",
            "to": "/hosting/reseller",
            "description": "Run your own hosting brand on our infrastructure.",
            "icon": "users"
          },
          {
            "label": "Windows Hosting",
            "to": "/hosting/windows",
            "description": "ASP.NET, MSSQL and Windows-based website hosting.",
            "icon": "windows"
          },
          {
            "label": "Website Hosting Overview",
            "to": "/hosting",
            "description": "Every hosting line in one comparison of features.",
            "icon": "layers"
          }
        ]
      },
      {
        "title": "Applications & platform hosting",
        "links": [
          {
            "label": "Application Hosting",
            "to": "/platforms/applications",
            "description": "Deploy a managed application on its own isolated stack.",
            "icon": "app"
          },
          {
            "label": "Developer Hosting",
            "to": "/hosting/developer",
            "description": "Runtime-focused hosting built for shipping code.",
            "icon": "code"
          },
          {
            "label": "API Hosting",
            "to": "/hosting/api",
            "description": "Host and expose HTTP APIs with TLS and monitoring.",
            "icon": "api"
          },
          {
            "label": "Email Hosting",
            "to": "/hosting/email",
            "description": "Mailboxes on your own domain, with spam and TLS.",
            "icon": "mail"
          },
          {
            "label": "Control Panels",
            "to": "/hosting/control-panels",
            "description": "The panels we actually provision, and how to reach them.",
            "icon": "control"
          }
        ]
      },
      {
        "title": "Managed for you",
        "links": [
          {
            "label": "Website Migration",
            "to": "/hosting/migration",
            "description": "Move an existing site in with a checked, staged cutover.",
            "icon": "transfer"
          },
          {
            "label": "Managed Services",
            "to": "/cloud/server-management",
            "description": "We operate, patch and monitor the stack for you.",
            "icon": "wrench"
          },
          {
            "label": "Website Design",
            "to": "/websites",
            "description": "Design and build delivered by the CloudHost247 team.",
            "icon": "pen"
          },
          {
            "label": "SSL Certificates",
            "to": "/hosting/ssl",
            "description": "Encrypt every domain you host, including free DV options.",
            "icon": "lock"
          },
          {
            "label": "Backups",
            "to": "/hosting/backups",
            "description": "Scheduled backup jobs with a real, restorable history.",
            "icon": "hard-drive"
          },
          {
            "label": "Security",
            "to": "/hosting/security",
            "description": "Isolation, hardening, patching and abuse control.",
            "icon": "shield"
          }
        ]
      }
    ]
  },
  {
    "id": "cloud",
    "label": "Cloud & Servers",
    "blurb": "Virtual servers, cloud platforms and the infrastructure operations layer behind them.",
    "to": "/cloud",
    "toolsDriven": false,
    "featured": {
      "title": "Cloud hosting plans",
      "body": "Review the cloud server options currently published to the live product catalogue.",
      "to": "/cloud",
      "ctaLabel": "View cloud plans"
    },
    "groups": [
      {
        "title": "Servers",
        "links": [
          {
            "label": "VPS Hosting",
            "to": "/hosting/vps",
            "description": "Virtual private servers with dedicated, guaranteed resources.",
            "icon": "server",
            "badge": "POPULAR"
          },
          {
            "label": "Cloud Hosting",
            "to": "/cloud",
            "description": "Browse published cloud hosting products and their current plan details.",
            "icon": "cloud"
          },
          {
            "label": "Dedicated Servers",
            "to": "/hosting/dedicated",
            "description": "Single-tenant hardware with full root access.",
            "icon": "server-rack"
          },
          {
            "label": "Public Cloud",
            "to": "/cloud/public",
            "description": "Elastic compute you can resize as demand changes.",
            "icon": "cloud"
          },
          {
            "label": "Private Cloud",
            "to": "/cloud/private",
            "description": "Isolated cloud capacity reserved for one tenant.",
            "icon": "cloud-lock"
          },
          {
            "label": "Enterprise Servers",
            "to": "/cloud/enterprise-servers",
            "description": "High-capacity configurations for larger workloads.",
            "icon": "building"
          },
          {
            "label": "Game Servers",
            "to": "/cloud/game-servers",
            "description": "Low-latency hosting for multiplayer game servers.",
            "icon": "gamepad"
          }
        ]
      },
      {
        "title": "Infrastructure",
        "links": [
          {
            "label": "Infrastructure",
            "to": "/cloud/infrastructure",
            "description": "How the CloudHost247 network and regions fit together.",
            "icon": "network"
          },
          {
            "label": "Data Centers",
            "to": "/cloud/data-centers",
            "description": "The facilities our servers are deployed in — when configured.",
            "icon": "data-center"
          },
          {
            "label": "Network",
            "to": "/cloud/network",
            "description": "Routing, addressing and uptime of the delivery network.",
            "icon": "globe"
          },
          {
            "label": "Operating Systems",
            "to": "/cloud/operating-systems",
            "description": "The OS catalogue available at provisioning time.",
            "icon": "os"
          },
          {
            "label": "Server Management",
            "to": "/cloud/server-management",
            "description": "Monitoring, access control, patching and operations.",
            "icon": "wrench"
          }
        ]
      },
      {
        "title": "Operations & protection",
        "links": [
          {
            "label": "Monitoring",
            "to": "/cloud/monitoring",
            "description": "Telemetry and alerts for the resources you run with us.",
            "icon": "activity"
          },
          {
            "label": "Backups",
            "to": "/cloud/backups",
            "description": "Backup jobs, retention and restore from your account.",
            "icon": "hard-drive"
          },
          {
            "label": "Firewalls",
            "to": "/cloud/firewall",
            "description": "Rule-based network filtering attached to your servers.",
            "icon": "firewall"
          },
          {
            "label": "Security",
            "to": "/cloud/security",
            "description": "Platform hardening, isolation and abuse response.",
            "icon": "shield"
          },
          {
            "label": "IP Management",
            "to": "/cloud/ip-management",
            "description": "Reverse DNS, floating addresses and IP assignment.",
            "icon": "ip"
          }
        ]
      }
    ]
  },
  {
    "id": "domains",
    "label": "Domains",
    "blurb": "Search, register, transfer and manage domain names — with the full registrar toolkit.",
    "to": "/domains",
    "toolsDriven": false,
    "featured": {
      "title": "Find your domain",
      "body": "Check availability and pricing across every configured extension, then register it in the same account you host with.",
      "to": "/domains/search",
      "ctaLabel": "Search domains"
    },
    "groups": [
      {
        "title": "Get a domain",
        "links": [
          {
            "label": "Search Domains",
            "to": "/domains/search",
            "description": "Check a name across every configured extension.",
            "icon": "search",
            "badge": "POPULAR"
          },
          {
            "label": "Domain Transfer",
            "to": "/domains/transfer",
            "description": "Move a domain in with an EPP code and status tracking.",
            "icon": "transfer"
          },
          {
            "label": "Domain Extensions",
            "to": "/domains/extensions",
            "description": "The full TLD catalogue with register and renewal prices.",
            "icon": "globe"
          },
          {
            "label": "Bulk Domain Search",
            "to": "/domains/bulk-search",
            "description": "Check a whole list of candidate names at once.",
            "icon": "list"
          },
          {
            "label": "Domain Registration",
            "to": "/domains/search",
            "description": "Register a new name and manage it from day one.",
            "icon": "cart"
          }
        ]
      },
      {
        "title": "Domain management",
        "links": [
          {
            "label": "DNS Management",
            "to": "/dashboard/dns",
            "description": "Zones and records for the domains you host here.",
            "icon": "dns"
          },
          {
            "label": "WHOIS / RDAP Lookup",
            "to": "/domains/whois",
            "description": "Public registration data, with privacy respected.",
            "icon": "user"
          },
          {
            "label": "My Domains",
            "to": "/dashboard/domains",
            "description": "Renewals, auto-renew, locks, contacts and nameservers.",
            "icon": "folder"
          }
        ]
      },
      {
        "title": "Domains as an asset",
        "links": [
          {
            "label": "Domain Auctions",
            "to": "/domains/auctions",
            "description": "Bid on listed names with a recorded auction ledger.",
            "icon": "gavel",
            "badge": "NEW"
          },
          {
            "label": "Domain Appraisal",
            "to": "/domains/appraisal",
            "description": "An estimated market value — never a guaranteed price.",
            "icon": "chart"
          },
          {
            "label": "Domain Broker",
            "to": "/domains/broker",
            "description": "We approach the owner of a name you want to acquire.",
            "icon": "handshake"
          },
          {
            "label": "Domain Club",
            "to": "/domains/club",
            "description": "Membership pricing on eligible registrations and renewals.",
            "icon": "star"
          },
          {
            "label": "Domain Services Overview",
            "to": "/domains",
            "description": "Everything available around a domain name.",
            "icon": "layers"
          }
        ]
      }
    ]
  },
  {
    "id": "platforms",
    "label": "Platforms",
    "blurb": "Applications, databases, containers and deployment workflows configured for CloudHost247 services.",
    "to": "/platforms",
    "toolsDriven": false,
    "featured": {
      "title": "Application marketplace",
      "body": "Browse the applications the platform can actually deploy, then install one onto infrastructure you control.",
      "to": "/apps",
      "ctaLabel": "Browse applications"
    },
    "groups": [
      {
        "title": "Applications",
        "links": [
          {
            "label": "Application Marketplace",
            "to": "/apps",
            "description": "Every application the platform can install for you.",
            "icon": "app",
            "badge": "POPULAR"
          },
          {
            "label": "Application Hosting",
            "to": "/platforms/applications",
            "description": "Managed hosting around a specific application.",
            "icon": "layers"
          },
          {
            "label": "Databases",
            "to": "/platforms/databases",
            "description": "MySQL, PostgreSQL, MariaDB, MongoDB and Redis.",
            "icon": "database"
          },
          {
            "label": "Containers & Docker",
            "to": "/platforms/containers",
            "description": "Run containerised applications with persistent volumes.",
            "icon": "box"
          },
          {
            "label": "PaaS",
            "to": "/platforms/paas",
            "description": "Application deployment and environment management; source builds depend on an enabled panel integration.",
            "icon": "rocket"
          }
        ]
      },
      {
        "title": "Deployment platform",
        "links": [
          {
            "label": "Deployment",
            "to": "/developers/deployment",
            "description": "Track supported application installs and updates, including recorded status and deployment steps.",
            "icon": "git-branch"
          },
          {
            "label": "Application Environments",
            "to": "/developers/environments",
            "description": "Environment variables, volumes and per-app domains.",
            "icon": "terminal"
          },
          {
            "label": "My Applications",
            "to": "/dashboard/apps",
            "description": "Applications you have installed, with logs and backups.",
            "icon": "grid"
          }
        ]
      },
      {
        "title": "Developer platform",
        "links": [
          {
            "label": "Developer Platform",
            "to": "/developers",
            "description": "Runtimes, APIs and tooling for building on CloudHost247.",
            "icon": "code"
          },
          {
            "label": "APIs",
            "to": "/hosting/api",
            "description": "HTTP APIs to automate provisioning and management.",
            "icon": "api"
          },
          {
            "label": "Control Panels",
            "to": "/hosting/control-panels",
            "description": "The panels available on the servers we provision.",
            "icon": "control"
          },
          {
            "label": "Documentation",
            "to": "/docs",
            "description": "Guides, references and how-tos for the platform.",
            "icon": "book"
          }
        ]
      }
    ]
  },
  {
    "id": "developers",
    "label": "Developer / Deployment",
    "blurb": "Runtimes, application deployments, environments and APIs — with availability shown by the live catalogue.",
    "to": "/developers",
    "toolsDriven": false,
    "featured": {
      "title": "Application deployments",
      "body": "Track supported application installs and updates, their recorded steps, and environment configuration. Git-based builds depend on a separately configured control panel.",
      "to": "/developers/deployment",
      "ctaLabel": "See deployment options"
    },
    "groups": [
      {
        "title": "Runtimes",
        "links": [
          {
            "label": "Node.js",
            "to": "/developers/nodejs",
            "description": "Node.js applications with managed process supervision.",
            "icon": "nodejs"
          },
          {
            "label": "PHP",
            "to": "/developers/php",
            "description": "PHP applications, from single files to full frameworks.",
            "icon": "php"
          },
          {
            "label": "Python",
            "to": "/developers/python",
            "description": "Python services and web applications, WSGI or ASGI.",
            "icon": "python"
          },
          {
            "label": "Laravel",
            "to": "/developers/laravel",
            "description": "Laravel deployments with queues, scheduler and storage.",
            "icon": "laravel"
          },
          {
            "label": "Docker",
            "to": "/developers/docker",
            "description": "Build and run container images with managed volumes.",
            "icon": "docker"
          }
        ]
      },
      {
        "title": "Deploy & operate",
        "links": [
          {
            "label": "Application Deployments",
            "to": "/developers/deployment",
            "description": "Track supported application installs, updates, status and step logs.",
            "icon": "git-branch",
            "badge": "POPULAR"
          },
          {
            "label": "PaaS",
            "to": "/platforms/paas",
            "description": "Managed application deployment workflows; Git builds require an enabled control-panel integration.",
            "icon": "rocket"
          },
          {
            "label": "Application Environments",
            "to": "/developers/environments",
            "description": "Variables, secrets, volumes and per-app domains.",
            "icon": "terminal"
          },
          {
            "label": "Server Management",
            "to": "/cloud/server-management",
            "description": "Operate the servers your code runs on.",
            "icon": "wrench"
          },
          {
            "label": "Operating Systems",
            "to": "/cloud/operating-systems",
            "description": "Pick the base image your runtime is built on.",
            "icon": "os"
          }
        ]
      },
      {
        "title": "Build with CloudHost247",
        "links": [
          {
            "label": "API Hosting",
            "to": "/hosting/api",
            "description": "Host HTTP APIs with TLS, auth and rate control.",
            "icon": "api"
          },
          {
            "label": "Developer Hosting",
            "to": "/hosting/developer",
            "description": "Hosting shaped around runtimes rather than panels.",
            "icon": "code"
          },
          {
            "label": "DNS for Developers",
            "to": "/dashboard/dns",
            "description": "Zone management and record types for your services.",
            "icon": "dns"
          },
          {
            "label": "Documentation",
            "to": "/docs",
            "description": "Platform references and integration guides.",
            "icon": "book"
          },
          {
            "label": "Developer Tools",
            "to": "/tools/category/developer",
            "description": "Utilities for encoding, conversion and inspection.",
            "icon": "tools"
          }
        ]
      }
    ]
  },
  {
    "id": "websites",
    "label": "Websites",
    "blurb": "Build a website, launch a store, or have a specialist design and run it for you.",
    "to": "/websites",
    "toolsDriven": false,
    "featured": {
      "title": "Website Builder",
      "body": "Pages, sections, media and publishing — with templates you can start from and edit in the browser.",
      "to": "/websites/builder",
      "ctaLabel": "Open the builder"
    },
    "groups": [
      {
        "title": "Build it",
        "links": [
          {
            "label": "Website Builder",
            "to": "/websites/builder",
            "description": "Templates, pages, sections, media and publishing.",
            "icon": "layout",
            "badge": "INCLUDED"
          },
          {
            "label": "AI Website Builder",
            "to": "/websites/ai-builder",
            "description": "Describe a site and get real pages you can edit.",
            "icon": "sparkle",
            "badge": "NEW"
          },
          {
            "label": "Website Templates",
            "to": "/websites/templates",
            "description": "Start from a layout that is already publishable.",
            "icon": "grid"
          },
          {
            "label": "E-commerce & Stores",
            "to": "/websites/store",
            "description": "Sell physical, digital and service products online.",
            "icon": "cart"
          },
          {
            "label": "Website Design",
            "to": "/websites/design-services",
            "description": "Scoped design and build by the CloudHost247 team.",
            "icon": "pen"
          }
        ]
      },
      {
        "title": "Have it built for you",
        "links": [
          {
            "label": "Website Migration",
            "to": "/hosting/migration",
            "description": "Plan a site transfer and its cutover with the CloudHost247 team.",
            "icon": "transfer"
          },
          {
            "label": "Website Management",
            "to": "/cloud/server-management",
            "description": "Explore available website operations, maintenance and support options.",
            "icon": "wrench"
          },
          {
            "label": "Talk to a specialist",
            "to": "/contact",
            "description": "Describe the project and get a scoped proposal.",
            "icon": "headset"
          }
        ]
      },
      {
        "title": "Run it safely",
        "links": [
          {
            "label": "SSL Certificates",
            "to": "/hosting/ssl",
            "description": "Review the TLS options available for the hosting service you select.",
            "icon": "lock"
          },
          {
            "label": "Backups",
            "to": "/hosting/backups",
            "description": "Scheduled backups with a restorable history.",
            "icon": "hard-drive"
          },
          {
            "label": "Website Hosting",
            "to": "/hosting/web-hosting",
            "description": "The hosting your website actually runs on.",
            "icon": "globe"
          },
          {
            "label": "Domain & DNS",
            "to": "/domains",
            "description": "Connect the domain to the site you just built.",
            "icon": "dns"
          }
        ]
      }
    ]
  },
  {
    "id": "tools",
    "label": "Tools",
    "blurb": "Inspect, troubleshoot and build — with tools that explain their results instead of showing invented data.",
    "to": "/tools",
    "toolsDriven": true,
    "groups": []
  },
  {
    "id": "resources",
    "label": "Resources",
    "blurb": "Guides, documentation, service status and the policies that govern the platform.",
    "to": "/help",
    "toolsDriven": false,
    "groups": [
      {
        "title": "Learn",
        "links": [
          {
            "label": "Documentation",
            "to": "/docs",
            "description": "Platform references, integration and deployment guides.",
            "icon": "book"
          },
          {
            "label": "Knowledge Base",
            "to": "/help",
            "description": "Step-by-step answers to common questions.",
            "icon": "book-open"
          },
          {
            "label": "Blog",
            "to": "/blog",
            "description": "Product notes, engineering posts and announcements.",
            "icon": "news"
          },
          {
            "label": "FAQ",
            "to": "/faq",
            "description": "The questions customers ask before and after signing up.",
            "icon": "help"
          }
        ]
      },
      {
        "title": "Stay informed",
        "links": [
          {
            "label": "Service Status",
            "to": "/status",
            "description": "What the platform can verify about itself right now.",
            "icon": "pulse"
          },
          {
            "label": "Offers",
            "to": "/offers",
            "description": "Current catalogue pricing and promotions.",
            "icon": "tag"
          }
        ]
      },
      {
        "title": "Company",
        "links": [
          {
            "label": "About CloudHost247",
            "to": "/about",
            "description": "Who we are and how we operate the platform.",
            "icon": "building"
          },
          {
            "label": "Security & Compliance",
            "to": "/security",
            "description": "How we protect customer data and infrastructure.",
            "icon": "shield"
          },
          {
            "label": "Infrastructure",
            "to": "/cloud/infrastructure",
            "description": "Regions, facilities and network topology.",
            "icon": "network"
          },
          {
            "label": "Contact",
            "to": "/contact",
            "description": "Sales, support, billing and abuse contacts.",
            "icon": "mail"
          }
        ]
      }
    ]
  },
  {
    "id": "support",
    "label": "Support",
    "blurb": "Get help from the knowledge base, open a ticket, or check what is happening right now.",
    "to": "/help",
    "toolsDriven": false,
    "groups": [
      {
        "title": "Get help",
        "links": [
          {
            "label": "Help Center",
            "to": "/help",
            "description": "Support channels and the fastest route to an answer.",
            "icon": "life-buoy"
          },
          {
            "label": "Knowledge Base",
            "to": "/help",
            "description": "Searchable guides for hosting, domains and servers.",
            "icon": "book-open"
          },
          {
            "label": "Open a Ticket",
            "to": "/support",
            "description": "Reach the support team from your account.",
            "icon": "ticket"
          },
          {
            "label": "FAQ",
            "to": "/faq",
            "description": "Billing, renewal and technical questions answered.",
            "icon": "help"
          },
          {
            "label": "Contact",
            "to": "/contact",
            "description": "Sales, billing, abuse and general enquiries.",
            "icon": "mail"
          }
        ]
      },
      {
        "title": "Your account",
        "links": [
          {
            "label": "Client Area",
            "to": "/dashboard",
            "description": "Services, domains, billing and support in one place.",
            "icon": "user"
          },
          {
            "label": "Billing & Invoices",
            "to": "/invoices",
            "description": "Invoices, payment methods and account credit.",
            "icon": "invoice"
          },
          {
            "label": "My Services",
            "to": "/services",
            "description": "Everything you have active with CloudHost247.",
            "icon": "grid"
          },
          {
            "label": "Service Status",
            "to": "/status",
            "description": "Live checks the platform performs on itself.",
            "icon": "pulse"
          }
        ]
      },
      {
        "title": "Policies & help",
        "links": [
          {
            "label": "Legal & Policy Center",
            "to": "/legal",
            "description": "Every agreement and policy in one index.",
            "icon": "scale"
          },
          {
            "label": "Acceptable Use",
            "to": "/legal/acceptable-use",
            "description": "What may and may not be hosted on the platform.",
            "icon": "shield"
          },
          {
            "label": "Refund Policy",
            "to": "/legal/refund-policy",
            "description": "Cancellation windows and refund eligibility.",
            "icon": "invoice"
          },
          {
            "label": "Cookie Policy",
            "to": "/legal/cookies",
            "description": "The cookies this website sets and why.",
            "icon": "cookie"
          }
        ]
      }
    ]
  }
];

export const FOOTER_COLUMNS: RegistryFooterColumn[] = [
  {
    "title": "Products",
    "toolsDriven": false,
    "links": [
      {
        "label": "Web Hosting",
        "to": "/hosting/web-hosting"
      },
      {
        "label": "Shared Hosting",
        "to": "/hosting/web-hosting"
      },
      {
        "label": "Business Hosting",
        "to": "/hosting/business"
      },
      {
        "label": "WordPress Hosting",
        "to": "/hosting/wordpress"
      },
      {
        "label": "Reseller Hosting",
        "to": "/hosting/reseller"
      },
      {
        "label": "VPS Hosting",
        "to": "/hosting/vps"
      },
      {
        "label": "Cloud Hosting",
        "to": "/cloud"
      },
      {
        "label": "Dedicated Servers",
        "to": "/hosting/dedicated"
      },
      {
        "label": "Windows Hosting",
        "to": "/hosting/windows"
      },
      {
        "label": "Email Hosting",
        "to": "/hosting/email"
      },
      {
        "label": "SSL Certificates",
        "to": "/hosting/ssl"
      },
      {
        "label": "Backups",
        "to": "/hosting/backups"
      },
      {
        "label": "Website Migration",
        "to": "/hosting/migration"
      }
    ]
  },
  {
    "title": "Cloud & Infrastructure",
    "toolsDriven": false,
    "links": [
      {
        "label": "Public Cloud",
        "to": "/cloud/public"
      },
      {
        "label": "Private Cloud",
        "to": "/cloud/private"
      },
      {
        "label": "VPS Hosting",
        "to": "/hosting/vps"
      },
      {
        "label": "Enterprise Servers",
        "to": "/cloud/enterprise-servers"
      },
      {
        "label": "Game Servers",
        "to": "/cloud/game-servers"
      },
      {
        "label": "Server Management",
        "to": "/cloud/server-management"
      },
      {
        "label": "Data Centers",
        "to": "/cloud/data-centers"
      },
      {
        "label": "Network",
        "to": "/cloud/network"
      },
      {
        "label": "Operating Systems",
        "to": "/cloud/operating-systems"
      },
      {
        "label": "Control Panels",
        "to": "/hosting/control-panels"
      },
      {
        "label": "Monitoring",
        "to": "/cloud/monitoring"
      },
      {
        "label": "Firewalls",
        "to": "/cloud/firewall"
      }
    ]
  },
  {
    "title": "Domains",
    "toolsDriven": false,
    "links": [
      {
        "label": "Domain Search",
        "to": "/domains/search"
      },
      {
        "label": "Register a Domain",
        "to": "/domains/search"
      },
      {
        "label": "Transfer a Domain",
        "to": "/domains/transfer"
      },
      {
        "label": "Domain Extensions",
        "to": "/domains/extensions"
      },
      {
        "label": "WHOIS / RDAP",
        "to": "/domains/whois"
      },
      {
        "label": "DNS Management",
        "to": "/dashboard/dns"
      },
      {
        "label": "Bulk Domain Search",
        "to": "/domains/bulk-search"
      },
      {
        "label": "Domain Auctions",
        "to": "/domains/auctions"
      },
      {
        "label": "Domain Appraisal",
        "to": "/domains/appraisal"
      },
      {
        "label": "Domain Broker",
        "to": "/domains/broker"
      },
      {
        "label": "Domain Club",
        "to": "/domains/club"
      }
    ]
  },
  {
    "title": "Platforms & Developers",
    "toolsDriven": false,
    "links": [
      {
        "label": "Application Marketplace",
        "to": "/apps"
      },
      {
        "label": "Databases",
        "to": "/platforms/databases"
      },
      {
        "label": "Containers & Docker",
        "to": "/platforms/containers"
      },
      {
        "label": "PaaS",
        "to": "/platforms/paas"
      },
      {
        "label": "Deployment",
        "to": "/developers/deployment"
      },
      {
        "label": "Developer Platform",
        "to": "/developers"
      },
      {
        "label": "API Hosting",
        "to": "/hosting/api"
      },
      {
        "label": "Node.js",
        "to": "/developers/nodejs"
      },
      {
        "label": "PHP",
        "to": "/developers/php"
      },
      {
        "label": "Python",
        "to": "/developers/python"
      },
      {
        "label": "Laravel",
        "to": "/developers/laravel"
      }
    ]
  },
  {
    "title": "Tools",
    "toolsDriven": true,
    "links": [
      {
        "label": "All Tools",
        "to": "/tools"
      },
      {
        "label": "DNS & Domains Tools",
        "to": "/tools/category/dns-domains"
      },
      {
        "label": "IP & Network Tools",
        "to": "/tools/category/ip-network"
      },
      {
        "label": "Security Tools",
        "to": "/tools/category/security"
      },
      {
        "label": "SSL Tools",
        "to": "/tools/category/ssl"
      },
      {
        "label": "Email Tools",
        "to": "/tools/category/email"
      },
      {
        "label": "Website Tools",
        "to": "/tools/category/website"
      },
      {
        "label": "Developer Tools",
        "to": "/tools/category/developer"
      },
      {
        "label": "Calculators Tools",
        "to": "/tools/category/calculators"
      },
      {
        "label": "Utilities Tools",
        "to": "/tools/category/utilities"
      },
      {
        "label": "MRZ Generator / MRZ Tools",
        "to": "/tools/mrz-generator"
      }
    ]
  },
  {
    "title": "Websites",
    "toolsDriven": false,
    "links": [
      {
        "label": "Website Builder",
        "to": "/websites/builder"
      },
      {
        "label": "AI Website Builder",
        "to": "/websites/ai-builder"
      },
      {
        "label": "Website Templates",
        "to": "/websites/templates"
      },
      {
        "label": "E-commerce & Stores",
        "to": "/websites/store"
      },
      {
        "label": "Website Design",
        "to": "/websites/design-services"
      }
    ]
  },
  {
    "title": "Company",
    "toolsDriven": false,
    "links": [
      {
        "label": "About CloudHost247",
        "to": "/about"
      },
      {
        "label": "Contact",
        "to": "/contact"
      },
      {
        "label": "Blog",
        "to": "/blog"
      },
      {
        "label": "Security & Compliance",
        "to": "/security"
      },
      {
        "label": "Infrastructure",
        "to": "/cloud/infrastructure"
      },
      {
        "label": "Offers",
        "to": "/offers"
      },
      {
        "label": "Sitemap",
        "to": "/sitemap"
      }
    ]
  },
  {
    "title": "Support",
    "toolsDriven": false,
    "links": [
      {
        "label": "Help Center",
        "to": "/help"
      },
      {
        "label": "Knowledge Base",
        "to": "/help"
      },
      {
        "label": "FAQ",
        "to": "/faq"
      },
      {
        "label": "Open a Ticket",
        "to": "/support"
      },
      {
        "label": "Service Status",
        "to": "/status"
      },
      {
        "label": "Client Area",
        "to": "/dashboard"
      },
      {
        "label": "Billing & Invoices",
        "to": "/invoices"
      },
      {
        "label": "Documentation",
        "to": "/docs"
      }
    ]
  },
  {
    "title": "Legal",
    "toolsDriven": false,
    "links": [
      {
        "label": "Legal & Policy Center",
        "to": "/legal"
      },
      {
        "label": "Terms of Service",
        "to": "/legal/terms"
      },
      {
        "label": "Privacy Policy",
        "to": "/legal/privacy-policy"
      },
      {
        "label": "Cookie Policy",
        "to": "/legal/cookies"
      },
      {
        "label": "Acceptable Use Policy",
        "to": "/legal/acceptable-use"
      },
      {
        "label": "Refund Policy",
        "to": "/legal/refund-policy"
      },
      {
        "label": "Backup Policy",
        "to": "/legal/backup-policy"
      },
      {
        "label": "Fair Usage Policy",
        "to": "/legal/fair-usage"
      },
      {
        "label": "Trademark Policy",
        "to": "/legal/trademark"
      },
      {
        "label": "Domain Registration Agreement",
        "to": "/legal/domain-agreement"
      },
      {
        "label": "Domain Brokerage Terms",
        "to": "/legal/domain-brokerage-terms"
      },
      {
        "label": "Domain Renewal Policy",
        "to": "/legal/domain-renewal-policy"
      },
      {
        "label": "Cybercrime & Abuse Policy",
        "to": "/legal/cybercrime-policy"
      },
      {
        "label": "Data Deletion",
        "to": "/legal/data-deletion"
      },
      {
        "label": "Data Protection Standards",
        "to": "/legal/data-protection-standards"
      },
      {
        "label": "Privacy Notice & Consent",
        "to": "/legal/privacy-notice-and-consent"
      },
      {
        "label": "Domain Registration Addendum",
        "to": "/legal/domain-registration-addendum"
      },
      {
        "label": "Legal Notice",
        "to": "/legal/legal-notice"
      }
    ]
  }
];

export const TOOLS_CATEGORIES = [
  {
    "slug": "dns-domains",
    "label": "DNS & Domains",
    "icon": "dns",
    "desc": "Lookups, propagation and zone diagnostics."
  },
  {
    "slug": "ip-network",
    "label": "IP & Network",
    "icon": "network",
    "desc": "Addresses, subnets, reachability and routing checks."
  },
  {
    "slug": "security",
    "label": "Security",
    "icon": "shield",
    "desc": "Hashing, verification and safe inspection."
  },
  {
    "slug": "ssl",
    "label": "SSL",
    "icon": "lock",
    "desc": "Certificate, chain and TLS inspection."
  },
  {
    "slug": "email",
    "label": "Email",
    "icon": "mail",
    "desc": "MX, SPF, DKIM and DMARC checks."
  },
  {
    "slug": "website",
    "label": "Website",
    "icon": "globe",
    "desc": "Headers, redirects, links and page checks."
  },
  {
    "slug": "developer",
    "label": "Developer",
    "icon": "code",
    "desc": "Encoding, conversion and inspection tools."
  },
  {
    "slug": "calculators",
    "label": "Calculators",
    "icon": "chart",
    "desc": "Subnet, time and conversion calculators."
  },
  {
    "slug": "utilities",
    "label": "Utilities",
    "icon": "wrench",
    "desc": "Everyday generators and converters."
  }
];

export const LEGAL_INDEX = [
  {
    "slug": "terms",
    "spa": "/legal/terms",
    "php": "terms-of-service.php",
    "title": "Terms of Service",
    "source": "docs/policies/Terms & Conditions.pdf"
  },
  {
    "slug": "privacy-policy",
    "spa": "/legal/privacy-policy",
    "php": "privacy-policy.php",
    "title": "Privacy Policy",
    "source": "docs/policies/Privacy Policy.pdf"
  },
  {
    "slug": "cookies",
    "spa": "/legal/cookies",
    "php": "cookie-policy.php",
    "title": "Cookie Policy",
    "source": "docs/policies/Cookie Policy.pdf"
  },
  {
    "slug": "acceptable-use",
    "spa": "/legal/acceptable-use",
    "php": "acceptable-use-policy.php",
    "title": "Acceptable Use Policy",
    "source": "templates/cloudhost247/includes/legal/acceptableusepolicy.tpl"
  },
  {
    "slug": "refund-policy",
    "spa": "/legal/refund-policy",
    "php": "refund-policy.php",
    "title": "Refund & Cancellation Policy",
    "source": "docs/policies/Refund Policy.pdf"
  },
  {
    "slug": "backup-policy",
    "spa": "/legal/backup-policy",
    "php": "backup-policy.php",
    "title": "Backup Policy",
    "source": "docs/policies/Backup Policy.pdf"
  },
  {
    "slug": "fair-usage",
    "spa": "/legal/fair-usage",
    "php": "fair-usage-policy.php",
    "title": "Fair Usage Policy",
    "source": "docs/policies/Fair Usage Policy.pdf"
  },
  {
    "slug": "trademark",
    "spa": "/legal/trademark",
    "php": "trademark-policy.php",
    "title": "Trademark & Copyright Policy",
    "source": "docs/policies/Trademark & Copyright Infringement Policy.pdf"
  },
  {
    "slug": "domain-agreement",
    "spa": "/legal/domain-agreement",
    "php": "domain-agreement.php",
    "title": "Domain Registration Agreement",
    "source": "docs/policies/Domain Name Registration Agreement.pdf"
  },
  {
    "slug": "domain-brokerage-terms",
    "spa": "/legal/domain-brokerage-terms",
    "php": "domain-brokerage-terms.php",
    "title": "Domain Brokerage Terms",
    "source": "domain-brokerage-terms.php"
  },
  {
    "slug": "domain-renewal-policy",
    "spa": "/legal/domain-renewal-policy",
    "php": "domain-renewal-policy.php",
    "title": "Domain Renewal & Deletion Policy",
    "source": "docs/policies/Domain Name Auto-Renewal and Deletion Policy.pdf"
  },
  {
    "slug": "domain-registration-addendum",
    "spa": "/legal/domain-registration-addendum",
    "php": "domainregistrationaddendum.php",
    "title": "Domain Registration Addendum",
    "source": "docs/policies/Domain Registration Addendum.pdf"
  },
  {
    "slug": "cybercrime-policy",
    "spa": "/legal/cybercrime-policy",
    "php": "cybercrime-policy.php",
    "title": "Cybercrime & Abuse Policy",
    "source": "docs/policies/Cybercrime Detection Policy.pdf"
  },
  {
    "slug": "data-deletion",
    "spa": "/legal/data-deletion",
    "php": "data-deletion.php",
    "title": "Data Deletion Policy",
    "source": "docs/policies/Data Deletion Instructions.pdf"
  },
  {
    "slug": "data-protection-standards",
    "spa": "/legal/data-protection-standards",
    "php": "data-protection-standards.php",
    "title": "Data Protection Standards",
    "source": "docs/policies/Data Protection Standards.pdf"
  },
  {
    "slug": "privacy-notice-and-consent",
    "spa": "/legal/privacy-notice-and-consent",
    "php": "data-privacy-notice-and-consent-form.php",
    "title": "Data Privacy Notice & Consent",
    "source": "docs/policies/Data Privacy Notice and Consent Form.pdf"
  },
  {
    "slug": "legal-notice",
    "spa": "/legal/legal-notice",
    "php": "legal-notice.php",
    "title": "Legal Notice",
    "source": "docs/policies/Legal Notice.pdf"
  }
];

export const SITEMAP_POLICY = {
  "exclude": [
    "/login",
    "/register",
    "/forgot-password",
    "/reset-password",
    "/verify-email",
    "/dashboard",
    "/admin",
    "/account",
    "/billing",
    "/invoices",
    "/cart",
    "/checkout",
    "/inbox",
    "/search",
    "/api/",
    "/support",
    "/services",
    "/marketing",
    "/servers/new",
    "/websites/builder",
    "/websites/ai-builder",
    "/websites/store",
    "/websites/experts",
    "/websites/templates",
    "/websites/design-services",
    "/tools/history",
    "/tools/favorites",
    "/tools/reports",
    "/tools/monitors"
  ],
  "excludePhp": [
    "admin/",
    "modules/",
    "crons/",
    "errors/",
    "cart.php",
    "clientarea.php",
    "register.php",
    "pwreset.php",
    "logout.php",
    "submitticket.php",
    "supporttickets.php",
    "viewticket.php",
    "site-search.php",
    "service-error.php",
    "cloudhost247-marketing-track.php",
    "cloudhost247-sample.php",
    "cloudhost247-vps-sample.php",
    "all-element-cloudhost247.php",
    "future-element.php",
    "tables.php",
    "tools/data/",
    "tools/admin/",
    "tools/api.php"
  ],
  "priorities": {
    "/": 1,
    "/hosting": 0.9,
    "/cloud": 0.9,
    "/domains": 0.9,
    "/platforms": 0.8,
    "/developers": 0.8,
    "/websites": 0.8,
    "/tools": 0.8
  },
  "defaultPriority": 0.6
};

/** Every route pattern the SPA router declares, parsed from App.tsx at generation time. */
export const SPA_ROUTE_PATTERNS: string[] = [
  "/",
  "/account",
  "/account/assistant",
  "/account/dns",
  "/account/domain-brokerage",
  "/account/domains",
  "/account/services",
  "/account/services/:id",
  "/account/services/:id/backups",
  "/account/services/:id/billing",
  "/account/services/:id/dns",
  "/account/services/:id/firewall",
  "/account/services/:id/monitoring",
  "/account/services/:id/overview",
  "/account/services/:id/ssl",
  "/account/ssl",
  "/admin",
  "/admin/ai-command",
  "/admin/ai-support",
  "/admin/applications/:id",
  "/admin/apps",
  "/admin/apps/:id",
  "/admin/audit",
  "/admin/audit-logs",
  "/admin/cloudflare",
  "/admin/cloudflare/:tab",
  "/admin/control-panels",
  "/admin/control-panels/:id",
  "/admin/customers/:id",
  "/admin/deployments",
  "/admin/deployments/:id",
  "/admin/dns",
  "/admin/domain-services",
  "/admin/expert-services",
  "/admin/infrastructure",
  "/admin/infrastructure/availability",
  "/admin/infrastructure/control-panels",
  "/admin/infrastructure/images",
  "/admin/infrastructure/logs",
  "/admin/infrastructure/operating-systems",
  "/admin/infrastructure/operating-systems/:slug/versions",
  "/admin/infrastructure/providers",
  "/admin/infrastructure/provisioning",
  "/admin/infrastructure/provisioning/:id",
  "/admin/integrations/cloudflare",
  "/admin/invoices",
  "/admin/invoices/:id",
  "/admin/ledger",
  "/admin/licenses",
  "/admin/marketing-services",
  "/admin/monitoring",
  "/admin/online-store",
  "/admin/platform-plans",
  "/admin/platform-services",
  "/admin/revenue-guardian",
  "/admin/revenue-guardian/activity",
  "/admin/revenue-guardian/assignments",
  "/admin/revenue-guardian/automation",
  "/admin/revenue-guardian/automation/runs",
  "/admin/revenue-guardian/customer-health",
  "/admin/revenue-guardian/customers/:id",
  "/admin/revenue-guardian/email-logs",
  "/admin/revenue-guardian/expiring-services",
  "/admin/revenue-guardian/follow-ups",
  "/admin/revenue-guardian/forecast",
  "/admin/revenue-guardian/high-value",
  "/admin/revenue-guardian/kanban",
  "/admin/revenue-guardian/module-health",
  "/admin/revenue-guardian/my-work",
  "/admin/revenue-guardian/orders",
  "/admin/revenue-guardian/pre-suspension",
  "/admin/revenue-guardian/pre-termination",
  "/admin/revenue-guardian/promises",
  "/admin/revenue-guardian/recovery",
  "/admin/revenue-guardian/recovery/:id",
  "/admin/revenue-guardian/renewal-rescue",
  "/admin/revenue-guardian/renewals",
  "/admin/revenue-guardian/reports",
  "/admin/revenue-guardian/revenue-at-risk",
  "/admin/revenue-guardian/risk-analysis",
  "/admin/revenue-guardian/settings",
  "/admin/revenue-guardian/staff-performance",
  "/admin/servers",
  "/admin/servers/:id",
  "/admin/settings",
  "/admin/settings/tools/mrz",
  "/admin/ssl",
  "/admin/tickets",
  "/admin/tickets/:id",
  "/admin/tools",
  "/admin/tools/mrz",
  "/admin/unified-inbox",
  "/admin/website-builder",
  "/apps",
  "/apps/:slug",
  "/billing",
  "/cart",
  "/checkout",
  "/contact",
  "/dashboard",
  "/dashboard/apps",
  "/dashboard/apps/:id",
  "/dashboard/apps/:id/backups",
  "/dashboard/apps/:id/domains",
  "/dashboard/apps/:id/logs",
  "/dashboard/apps/:id/settings",
  "/dashboard/deployments/:id",
  "/dashboard/dns",
  "/dashboard/domains",
  "/dashboard/notifications",
  "/dashboard/servers",
  "/dashboard/servers/:id",
  "/dashboard/servers/:id/logs",
  "/dashboard/ssl",
  "/docs",
  "/docs/:slug",
  "/domains",
  "/domains/:domain/health",
  "/domains/appraisal",
  "/domains/auctions",
  "/domains/auctions/:id",
  "/domains/broker",
  "/domains/bulk-search",
  "/domains/club",
  "/domains/extensions",
  "/domains/search",
  "/domains/transfer",
  "/domains/whois",
  "/faq",
  "/forgot-password",
  "/hosting/control-panels",
  "/hosting/control-panels/:slug",
  "/invoices",
  "/invoices/:id",
  "/legal",
  "/login",
  "/marketing",
  "/marketing/analytics",
  "/marketing/digital",
  "/marketing/digital/:id",
  "/marketing/inbox",
  "/marketing/inbox/:conversationId",
  "/marketing/logo-maker",
  "/marketing/logo-maker/:projectId",
  "/marketing/seo",
  "/register",
  "/reset-password",
  "/servers/new",
  "/services",
  "/services/cloudflare",
  "/services/cloudflare/:id",
  "/services/cloudflare/:id/:tab",
  "/sitemap",
  "/sites/:slug/*",
  "/store/:slug",
  "/support",
  "/support/:id",
  "/tools",
  "/tools/*",
  "/tools/category/:category",
  "/tools/document",
  "/tools/document/mrz",
  "/tools/document/mrz-parser",
  "/tools/favorites",
  "/tools/history",
  "/tools/monitors",
  "/tools/mrz-generator",
  "/tools/mrz-parser",
  "/tools/reports",
  "/verify-email",
  "/websites",
  "/websites/ai-builder",
  "/websites/ai-builder/:projectId",
  "/websites/builder",
  "/websites/builder/:siteId",
  "/websites/design-services",
  "/websites/experts",
  "/websites/experts/:id",
  "/websites/experts/new",
  "/websites/store",
  "/websites/store/:storeId",
  "/websites/templates"
];

/**
 * Every marketing route this build publishes. The router maps these to one page component; the
 * page content itself is imported lazily by that component, so the application shell does not
 * carry a quarter of a megabyte of product copy on a cold start.
 */
export const MARKETING_ROUTES: string[] = [
  "/about",
  "/blog",
  "/cloud",
  "/cloud/backups",
  "/cloud/data-centers",
  "/cloud/enterprise-servers",
  "/cloud/firewall",
  "/cloud/game-servers",
  "/cloud/infrastructure",
  "/cloud/ip-management",
  "/cloud/monitoring",
  "/cloud/network",
  "/cloud/operating-systems",
  "/cloud/private",
  "/cloud/public",
  "/cloud/security",
  "/cloud/server-management",
  "/developers",
  "/developers/deployment",
  "/developers/docker",
  "/developers/environments",
  "/developers/laravel",
  "/developers/nodejs",
  "/developers/php",
  "/developers/python",
  "/docs",
  "/help",
  "/hosting",
  "/hosting/api",
  "/hosting/backups",
  "/hosting/business",
  "/hosting/cpanel",
  "/hosting/dedicated",
  "/hosting/developer",
  "/hosting/email",
  "/hosting/migration",
  "/hosting/reseller",
  "/hosting/security",
  "/hosting/ssl",
  "/hosting/vps",
  "/hosting/web-hosting",
  "/hosting/windows",
  "/hosting/wordpress",
  "/offers",
  "/platforms",
  "/platforms/applications",
  "/platforms/containers",
  "/platforms/databases",
  "/platforms/paas",
  "/pricing",
  "/search",
  "/security",
  "/status",
  "/websites"
];

/** Public documentation routes built from the same published-doc list as the Docs index. */
export const PUBLIC_DOC_ROUTES: string[] = [
  "/docs/api-billing",
  "/docs/api-catalog",
  "/docs/api-commerce",
  "/docs/api-customer-app",
  "/docs/api-payments",
  "/docs/cpanel-deployment",
  "/docs/domain-brokerage",
  "/docs/domain-services-architecture",
  "/docs/mrz-developer-tool",
  "/docs/passkey",
  "/docs/platform-services-architecture",
  "/docs/server-agent",
  "/docs/server-provisioning"
];

/** Public tool routes taken from the live tool catalogue; account-only tools are excluded. */
export const PUBLIC_TOOL_ROUTES: string[] = [
  "/tools/developer/email-header",
  "/tools/developer/encoding",
  "/tools/developer/http-headers",
  "/tools/developer/json",
  "/tools/developer/server-os",
  "/tools/developer/url",
  "/tools/developer/user-agent",
  "/tools/dns/bimi",
  "/tools/dns/dkim",
  "/tools/dns/dmarc",
  "/tools/dns/dmarc-generator",
  "/tools/dns/dnskey",
  "/tools/dns/ds",
  "/tools/dns/health",
  "/tools/dns/lookup",
  "/tools/dns/mx",
  "/tools/dns/propagation",
  "/tools/dns/reverse",
  "/tools/dns/spf",
  "/tools/domain/punycode",
  "/tools/domain/search",
  "/tools/ip/converters",
  "/tools/ip/domain-to-ip",
  "/tools/ip/ip-to-hostname",
  "/tools/ip/isp",
  "/tools/ip/lookup",
  "/tools/ip/my-ip",
  "/tools/ip/whois",
  "/tools/mrz-generator",
  "/tools/network/asn",
  "/tools/network/mac-generator",
  "/tools/network/mac-lookup",
  "/tools/network/speed-test",
  "/tools/network/subnet-calculator",
  "/tools/productivity/colors",
  "/tools/productivity/invisible-character",
  "/tools/productivity/lorem-ipsum",
  "/tools/productivity/notepad",
  "/tools/productivity/qr",
  "/tools/productivity/qr-scanner",
  "/tools/productivity/reverse-image",
  "/tools/productivity/runic",
  "/tools/productivity/small-text",
  "/tools/productivity/time-card",
  "/tools/productivity/wifi-qr",
  "/tools/productivity/word-counter",
  "/tools/security/ip-blacklist",
  "/tools/security/password",
  "/tools/security/ssl",
  "/tools/webmaster/open-graph",
  "/tools/webmaster/robots-generator",
  "/tools/webmaster/serp-simulator"
];

/** Every route the registry publishes, in menu order — the sitemap and audits read this. */
export const REGISTRY_ROUTES: string[] = [
  "/",
  "/hosting",
  "/cloud",
  "/domains",
  "/platforms",
  "/developers",
  "/websites",
  "/tools",
  "/help",
  "/help",
  "/hosting/web-hosting",
  "/hosting/business",
  "/hosting/cpanel",
  "/hosting/wordpress",
  "/hosting/reseller",
  "/hosting/windows",
  "/hosting",
  "/platforms/applications",
  "/hosting/developer",
  "/hosting/api",
  "/hosting/email",
  "/hosting/control-panels",
  "/hosting/migration",
  "/cloud/server-management",
  "/websites",
  "/hosting/ssl",
  "/hosting/backups",
  "/hosting/security",
  "/hosting/vps",
  "/cloud",
  "/hosting/dedicated",
  "/cloud/public",
  "/cloud/private",
  "/cloud/enterprise-servers",
  "/cloud/game-servers",
  "/cloud/infrastructure",
  "/cloud/data-centers",
  "/cloud/network",
  "/cloud/operating-systems",
  "/cloud/monitoring",
  "/cloud/backups",
  "/cloud/firewall",
  "/cloud/security",
  "/cloud/ip-management",
  "/domains/search",
  "/domains/transfer",
  "/domains/extensions",
  "/domains/bulk-search",
  "/dashboard/dns",
  "/domains/whois",
  "/dashboard/domains",
  "/domains/auctions",
  "/domains/appraisal",
  "/domains/broker",
  "/domains/club",
  "/domains",
  "/apps",
  "/platforms/databases",
  "/platforms/containers",
  "/platforms/paas",
  "/developers/deployment",
  "/developers/environments",
  "/dashboard/apps",
  "/developers",
  "/docs",
  "/developers/nodejs",
  "/developers/php",
  "/developers/python",
  "/developers/laravel",
  "/developers/docker",
  "/tools/category/developer",
  "/websites/builder",
  "/websites/ai-builder",
  "/websites/templates",
  "/websites/store",
  "/websites/design-services",
  "/contact",
  "/help",
  "/blog",
  "/faq",
  "/status",
  "/offers",
  "/about",
  "/security",
  "/support",
  "/dashboard",
  "/invoices",
  "/services",
  "/legal",
  "/legal/acceptable-use",
  "/legal/refund-policy",
  "/legal/cookies"
];
