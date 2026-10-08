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

export const REGISTRY_VERSION = '2.1.0';

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
    "blurb": "Website, application and email hosting — every plan page backed by the live product catalogue.",
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
        "title": "Web hosting",
        "links": [
          {
            "label": "Web Hosting",
            "to": "/hosting/web-hosting",
            "description": "Hosting plans for websites, priced from the live catalogue.",
            "icon": "globe",
            "badge": "POPULAR"
          },
          {
            "label": "Business Hosting",
            "to": "/hosting/business",
            "description": "More resources and priority handling for company sites.",
            "icon": "briefcase"
          },
          {
            "label": "WordPress Hosting",
            "to": "/hosting/wordpress",
            "description": "WordPress with a managed runtime, cache and staging path.",
            "icon": "wordpress"
          },
          {
            "label": "cPanel Hosting",
            "to": "/hosting/cpanel",
            "description": "Mailboxes, databases and installs from the panel your team knows.",
            "icon": "control"
          },
          {
            "label": "PHP Hosting",
            "to": "/developers/php",
            "description": "Tuned PHP runtimes with the extensions your application needs.",
            "icon": "code"
          },
          {
            "label": "Python Hosting",
            "to": "/developers/python",
            "description": "Python application hosting with virtual environments.",
            "icon": "code"
          },
          {
            "label": "Node.js Hosting",
            "to": "/developers/nodejs",
            "description": "Node.js services with process management and zero-downtime restarts.",
            "icon": "code"
          },
          {
            "label": "Laravel Hosting",
            "to": "/developers/laravel",
            "description": "Laravel hosting with queues, scheduler and release-based deploys.",
            "icon": "code"
          },
          {
            "label": "Windows Hosting",
            "to": "/hosting/windows",
            "description": "ASP.NET, MSSQL and Windows-based website hosting.",
            "icon": "windows"
          },
          {
            "label": "Reseller Hosting",
            "to": "/hosting/reseller",
            "description": "Run your own hosting brand on our infrastructure.",
            "icon": "users"
          }
        ]
      },
      {
        "title": "Specialized hosting",
        "links": [
          {
            "label": "Email Hosting",
            "to": "/hosting/email",
            "description": "Mailboxes on your own domain, with spam filtering and webmail.",
            "icon": "mail"
          },
          {
            "label": "Developer Hosting",
            "to": "/hosting/developer",
            "description": "Git, staging and application tooling alongside the runtime.",
            "icon": "code"
          },
          {
            "label": "Docker Hosting",
            "to": "/developers/docker",
            "description": "Run containers and compose stacks on managed compute.",
            "icon": "container"
          },
          {
            "label": "Game Servers",
            "to": "/cloud/game-servers",
            "description": "Low-latency game server hosting with your choice of control panel.",
            "icon": "gamepad"
          },
          {
            "label": "Managed Services",
            "to": "/cloud/managed-services",
            "description": "We operate the platform so your team ships instead of patching.",
            "icon": "shield-check"
          },
          {
            "label": "Website Design",
            "to": "/websites",
            "description": "Launch a new site or have one built and run for you.",
            "icon": "palette"
          },
          {
            "label": "SSL Certificates",
            "to": "/hosting/ssl",
            "description": "Certificates issued and renewed automatically for every domain you host.",
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
      "title": "VPS & cloud servers",
      "body": "Provision compute in minutes, choose your operating system, and manage it from the client area.",
      "to": "/hosting/vps",
      "ctaLabel": "Explore cloud and servers"
    },
    "groups": [
      {
        "title": "Cloud",
        "links": [
          {
            "label": "Public Cloud",
            "to": "/cloud/public",
            "description": "Elastic compute from a shared public cloud footprint.",
            "icon": "cloud"
          },
          {
            "label": "Private Cloud",
            "to": "/cloud/private",
            "description": "Dedicated resources isolated to your organisation.",
            "icon": "shield"
          },
          {
            "label": "Cloud Hosting",
            "to": "/cloud",
            "description": "Cloud hosting overview with the live product catalogue.",
            "icon": "cloud"
          },
          {
            "label": "Enterprise Servers",
            "to": "/cloud/enterprise-servers",
            "description": "High-specification servers with contractual service levels.",
            "icon": "building"
          }
        ]
      },
      {
        "title": "Servers",
        "links": [
          {
            "label": "Dedicated Servers",
            "to": "/hosting/dedicated",
            "description": "Bare metal servers, provisioned and managed end to end.",
            "icon": "server"
          },
          {
            "label": "VPS Hosting",
            "to": "/hosting/vps",
            "description": "Virtual servers with a choice of operating system and panel.",
            "icon": "server"
          },
          {
            "label": "Server Management",
            "to": "/cloud/server-management",
            "description": "Patching, hardening and day-to-day server operations.",
            "icon": "settings"
          },
          {
            "label": "Data Centers",
            "to": "/cloud/data-centers",
            "description": "The facilities our compute runs in and what they provide.",
            "icon": "building"
          },
          {
            "label": "Network",
            "to": "/cloud/network",
            "description": "Transit, peering and the addressing behind our services.",
            "icon": "network"
          },
          {
            "label": "Firewall",
            "to": "/cloud/firewall",
            "description": "Network filtering and firewall management for your servers.",
            "icon": "shield"
          },
          {
            "label": "Monitoring",
            "to": "/cloud/monitoring",
            "description": "Availability and resource monitoring with alerting.",
            "icon": "activity"
          },
          {
            "label": "Backups",
            "to": "/cloud/backups",
            "description": "Scheduled backups with restore points you control.",
            "icon": "storage"
          },
          {
            "label": "Migration",
            "to": "/hosting/migration",
            "description": "We move your existing websites, mail and data across.",
            "icon": "transfer"
          },
          {
            "label": "IP Management",
            "to": "/cloud/ip-management",
            "description": "Reverse DNS, IP allocation and address planning for your servers.",
            "icon": "network"
          }
        ]
      }
    ]
  },
  {
    "id": "domains",
    "label": "Domains",
    "blurb": "Search, register, transfer and manage domain names — with the full registrar and DNS toolkit.",
    "to": "/domains",
    "toolsDriven": false,
    "featured": {
      "title": "Find your domain",
      "body": "Check availability across every extension we carry and register it in the same checkout as your hosting.",
      "to": "/domains/search",
      "ctaLabel": "Search domains"
    },
    "groups": [
      {
        "title": "Domains",
        "links": [
          {
            "label": "Domain Registration",
            "to": "/domains/search",
            "description": "Register a new domain name and manage it from the client area.",
            "icon": "search",
            "badge": "POPULAR"
          },
          {
            "label": "Domain Search",
            "to": "/domains/bulk-search",
            "description": "Check availability for one name or a whole list at once.",
            "icon": "search"
          },
          {
            "label": "Domain Management",
            "to": "/dashboard/domains",
            "description": "Nameservers, contacts, renewal dates and auto-renew settings.",
            "icon": "settings"
          },
          {
            "label": "DNS Management",
            "to": "/dashboard/dns",
            "description": "Edit zone records, TTLs and DNSSEC from one screen.",
            "icon": "dns"
          },
          {
            "label": "Domain Renewal",
            "to": "/legal/domain-renewal-policy",
            "description": "How renewal, auto-renew and deletion windows work.",
            "icon": "refresh"
          }
        ]
      },
      {
        "title": "DNS",
        "links": [
          {
            "label": "DNS Lookup",
            "to": "/tools/dns-lookup",
            "description": "Query A, AAAA, CNAME, MX, NS, TXT, SOA, SRV and CAA records.",
            "icon": "search"
          },
          {
            "label": "DNS Propagation",
            "to": "/tools/dns-propagation",
            "description": "Ask the same question of many public resolvers at once.",
            "icon": "globe"
          },
          {
            "label": "DNS Health",
            "to": "/tools/dns-health",
            "description": "Delegation, mail authentication and DNSSEC checks in one report.",
            "icon": "activity"
          },
          {
            "label": "DNS Security",
            "to": "/tools/category/security",
            "description": "DNS and domain security tools from the CloudHost247 catalogue.",
            "icon": "shield"
          },
          {
            "label": "DNSSEC",
            "to": "/tools/dnskey-lookup",
            "description": "Inspect DNSKEY and DS records for a signed zone.",
            "icon": "key"
          }
        ]
      }
    ]
  },
  {
    "id": "platforms",
    "label": "Platforms",
    "blurb": "Applications, containers, runtimes, control panels and operating systems — all configured for CloudHost247 servers.",
    "to": "/platforms",
    "toolsDriven": false,
    "featured": {
      "title": "Application platform",
      "body": "Deploy common applications, databases and containers without building the runtime yourself.",
      "to": "/apps",
      "ctaLabel": "Browse applications"
    },
    "groups": [
      {
        "title": "Application platforms",
        "links": [
          {
            "label": "Applications",
            "to": "/apps",
            "description": "Deploy supported applications from a maintained catalogue.",
            "icon": "app"
          },
          {
            "label": "Deployment",
            "to": "/developers/deployment",
            "description": "Release applications with environments and rollback.",
            "icon": "rocket"
          },
          {
            "label": "PaaS",
            "to": "/platforms/paas",
            "description": "Push code and let the platform build and run it.",
            "icon": "layers"
          },
          {
            "label": "Docker",
            "to": "/developers/docker",
            "description": "Containers, images and compose stacks on managed compute.",
            "icon": "container"
          },
          {
            "label": "Node.js",
            "to": "/developers/nodejs",
            "description": "Node.js runtimes with process management and restarts.",
            "icon": "code"
          },
          {
            "label": "PHP",
            "to": "/developers/php",
            "description": "PHP runtimes with per-site version and extension control.",
            "icon": "code"
          },
          {
            "label": "Python",
            "to": "/developers/python",
            "description": "Python applications with virtual environments and workers.",
            "icon": "code"
          },
          {
            "label": "Laravel",
            "to": "/developers/laravel",
            "description": "Laravel with queues, scheduler and release deploys.",
            "icon": "code"
          },
          {
            "label": "Developer Hosting",
            "to": "/hosting/developer",
            "description": "Git, staging and CI-friendly hosting for development teams.",
            "icon": "terminal"
          },
          {
            "label": "API Hosting",
            "to": "/hosting/api",
            "description": "Run HTTP APIs with managed runtimes, TLS and request logging.",
            "icon": "terminal"
          }
        ]
      },
      {
        "title": "Control panels",
        "links": [
          {
            "label": "Control Panels",
            "to": "/hosting/control-panels",
            "description": "Install a supported panel on your server during provisioning.",
            "icon": "control"
          },
          {
            "label": "cPanel & WHM",
            "to": "/hosting/cpanel",
            "description": "The industry-standard hosting panel, licensed and managed.",
            "icon": "control"
          }
        ]
      },
      {
        "title": "Operating systems",
        "links": [
          {
            "label": "Operating Systems",
            "to": "/cloud/operating-systems",
            "description": "Every Linux image we provision, with version and lifecycle status.",
            "icon": "os"
          }
        ]
      }
    ]
  },
  {
    "id": "tools",
    "label": "Tools",
    "blurb": "Inspect, troubleshoot and build — every result reports what was actually queried and what it cannot tell you.",
    "to": "/tools",
    "toolsDriven": true,
    "groups": []
  },
  {
    "id": "resources",
    "label": "Resources",
    "blurb": "Guides, documentation, service status and the knowledge you need to run on CloudHost247.",
    "to": "/docs",
    "toolsDriven": false,
    "featured": {
      "title": "Documentation",
      "body": "Setup guides, API references and operational how-tos for every CloudHost247 service.",
      "to": "/docs",
      "ctaLabel": "Read the documentation"
    },
    "groups": [
      {
        "title": "Documentation & help",
        "links": [
          {
            "label": "Documentation",
            "to": "/docs",
            "description": "Setup guides and references for every service we run.",
            "icon": "book"
          },
          {
            "label": "Help Center",
            "to": "/help",
            "description": "Start here when something is not working as expected.",
            "icon": "help"
          },
          {
            "label": "FAQs",
            "to": "/faq",
            "description": "The questions we are asked most, answered plainly.",
            "icon": "help"
          },
          {
            "label": "Open a Ticket",
            "to": "/support",
            "description": "Reach a human. Tickets are answered by the team that runs the platform.",
            "icon": "mail"
          }
        ]
      },
      {
        "title": "Stay informed",
        "links": [
          {
            "label": "Blog",
            "to": "/blog",
            "description": "Product news, engineering notes and platform changes.",
            "icon": "news"
          },
          {
            "label": "Status",
            "to": "/status",
            "description": "Live service status and incident history.",
            "icon": "activity"
          },
          {
            "label": "Offers",
            "to": "/offers",
            "description": "Current promotions and discounted plans.",
            "icon": "tag"
          }
        ]
      },
      {
        "title": "Infrastructure",
        "links": [
          {
            "label": "Infrastructure",
            "to": "/cloud/infrastructure",
            "description": "How the CloudHost247 platform is put together.",
            "icon": "building"
          },
          {
            "label": "Network",
            "to": "/cloud/network",
            "description": "Transit, peering and addressing.",
            "icon": "network"
          },
          {
            "label": "Data Centers",
            "to": "/cloud/data-centers",
            "description": "Where our compute physically runs.",
            "icon": "building"
          },
          {
            "label": "Operating Systems",
            "to": "/cloud/operating-systems",
            "description": "Supported images, versions and lifecycle status.",
            "icon": "os"
          }
        ]
      }
    ]
  },
  {
    "id": "company",
    "label": "Company",
    "blurb": "Who runs CloudHost247, how we secure the platform, and the terms we operate under.",
    "to": "/about",
    "toolsDriven": false,
    "featured": {
      "title": "Talk to CloudHost247",
      "body": "Sales, migrations, partnerships and technical questions — reach the team directly.",
      "to": "/contact",
      "ctaLabel": "Contact us"
    },
    "groups": [
      {
        "title": "Company",
        "links": [
          {
            "label": "About",
            "to": "/about",
            "description": "Who we are and how we operate the platform.",
            "icon": "users"
          },
          {
            "label": "Contact",
            "to": "/contact",
            "description": "Sales, support and partnership enquiries.",
            "icon": "mail"
          },
          {
            "label": "Security",
            "to": "/security",
            "description": "How we secure the platform and handle security reports.",
            "icon": "shield"
          },
          {
            "label": "Compliance",
            "to": "/legal/data-protection-standards",
            "description": "Our data protection standards and compliance position.",
            "icon": "check"
          }
        ]
      },
      {
        "title": "Legal & trust",
        "links": [
          {
            "label": "Legal & Policy Center",
            "to": "/legal",
            "description": "Every policy, agreement and notice in one place.",
            "icon": "file"
          },
          {
            "label": "Terms of Service",
            "to": "/legal/terms",
            "description": "The terms that govern your use of our services.",
            "icon": "file"
          },
          {
            "label": "Privacy Policy",
            "to": "/legal/privacy-policy",
            "description": "What we collect, why, and how long we keep it.",
            "icon": "shield"
          },
          {
            "label": "Cookie Policy",
            "to": "/legal/cookies",
            "description": "Cookies we set, what they do and how to control them.",
            "icon": "cookie"
          },
          {
            "label": "Trademark Policy",
            "to": "/legal/trademark",
            "description": "Brand, copyright and takedown procedures.",
            "icon": "file"
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
        "label": "Business Hosting",
        "to": "/hosting/business"
      },
      {
        "label": "WordPress Hosting",
        "to": "/hosting/wordpress"
      },
      {
        "label": "VPS Hosting",
        "to": "/hosting/vps"
      },
      {
        "label": "Dedicated Servers",
        "to": "/hosting/dedicated"
      },
      {
        "label": "Cloud Hosting",
        "to": "/cloud"
      },
      {
        "label": "Email Hosting",
        "to": "/hosting/email"
      },
      {
        "label": "Domain Registration",
        "to": "/domains/search"
      }
    ]
  },
  {
    "title": "Cloud & Servers",
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
        "label": "VPS",
        "to": "/hosting/vps"
      },
      {
        "label": "Enterprise Servers",
        "to": "/cloud/enterprise-servers"
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
        "label": "Firewall",
        "to": "/cloud/firewall"
      },
      {
        "label": "Monitoring",
        "to": "/cloud/monitoring"
      },
      {
        "label": "Backups",
        "to": "/cloud/backups"
      }
    ]
  },
  {
    "title": "Domains",
    "toolsDriven": false,
    "links": [
      {
        "label": "Domain Search",
        "to": "/domains/bulk-search"
      },
      {
        "label": "Domain Registration",
        "to": "/domains/search"
      },
      {
        "label": "DNS Management",
        "to": "/dashboard/dns"
      },
      {
        "label": "Domain Renewal",
        "to": "/legal/domain-renewal-policy"
      }
    ]
  },
  {
    "title": "Developers",
    "toolsDriven": false,
    "links": [
      {
        "label": "Developer Hosting",
        "to": "/hosting/developer"
      },
      {
        "label": "Applications",
        "to": "/apps"
      },
      {
        "label": "Deployment",
        "to": "/developers/deployment"
      },
      {
        "label": "PaaS",
        "to": "/platforms/paas"
      },
      {
        "label": "Docker",
        "to": "/developers/docker"
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
      },
      {
        "label": "API Hosting",
        "to": "/hosting/api"
      }
    ]
  },
  {
    "title": "Tools",
    "toolsDriven": true,
    "links": [
      {
        "label": "DNS Tools",
        "to": "/tools/category/dns-domains"
      },
      {
        "label": "IP Tools",
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
        "label": "Developer Tools",
        "to": "/tools/category/developer"
      },
      {
        "label": "Website Tools",
        "to": "/tools/category/website"
      },
      {
        "label": "Calculators",
        "to": "/tools/category/calculators"
      },
      {
        "label": "Utilities",
        "to": "/tools/category/utilities"
      },
      {
        "label": "All Tools",
        "to": "/tools"
      },
      {
        "label": "Compliance & Document Tools",
        "to": "/tools/compliance-documents"
      },
      {
        "label": "MRZ Generator",
        "to": "/tools/mrz-generator"
      }
    ]
  },
  {
    "title": "Resources",
    "toolsDriven": false,
    "links": [
      {
        "label": "Documentation",
        "to": "/docs"
      },
      {
        "label": "Help Center",
        "to": "/help"
      },
      {
        "label": "FAQs",
        "to": "/faq"
      },
      {
        "label": "Blog",
        "to": "/blog"
      },
      {
        "label": "Network",
        "to": "/cloud/network"
      },
      {
        "label": "Data Centers",
        "to": "/cloud/data-centers"
      },
      {
        "label": "Status",
        "to": "/status"
      }
    ]
  },
  {
    "title": "Company",
    "toolsDriven": false,
    "links": [
      {
        "label": "About",
        "to": "/about"
      },
      {
        "label": "Contact",
        "to": "/contact"
      },
      {
        "label": "Security",
        "to": "/security"
      },
      {
        "label": "Compliance",
        "to": "/legal/data-protection-standards"
      }
    ]
  },
  {
    "title": "Legal",
    "toolsDriven": false,
    "links": [
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
        "label": "Acceptable Use",
        "to": "/legal/acceptable-use"
      },
      {
        "label": "Refund Policy",
        "to": "/legal/refund-policy"
      },
      {
        "label": "Domain Agreement",
        "to": "/legal/domain-agreement"
      },
      {
        "label": "Domain Brokerage",
        "to": "/legal/domain-brokerage-terms"
      },
      {
        "label": "Data Protection",
        "to": "/legal/data-protection-standards"
      },
      {
        "label": "Legal Notice",
        "to": "/legal/legal-notice"
      },
      {
        "label": "Trademark Policy",
        "to": "/legal/trademark"
      },
      {
        "label": "All Policies",
        "to": "/legal"
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
    "source": "docs/policies/Terms & Conditions.pdf",
    "description": "The Terms & Conditions that govern access to and use of CloudHost247 websites, products and services, and your responsibilities as an account holder."
  },
  {
    "slug": "privacy-policy",
    "spa": "/legal/privacy-policy",
    "php": "privacy-policy.php",
    "title": "Privacy Policy",
    "source": "docs/policies/Privacy Policy.pdf",
    "description": "How CloudHost247 Isc collects, uses, shares and protects personal information, how long it is kept, and the rights you have over your own data."
  },
  {
    "slug": "cookies",
    "spa": "/legal/cookies",
    "php": "cookie-policy.php",
    "title": "Cookie Policy",
    "source": "docs/policies/Cookie Policy.pdf",
    "description": "How CloudHost247 Isc uses cookies and similar tracking technologies, which categories are set, and how to control them in your browser."
  },
  {
    "slug": "acceptable-use",
    "spa": "/legal/acceptable-use",
    "php": "acceptable-use-policy.php",
    "title": "Acceptable Use Policy",
    "source": "templates/cloudhost247/includes/legal/acceptableusepolicy.tpl",
    "description": "The rules for using CloudHost247 systems and network: what may be hosted, what is prohibited, and how breaches of the policy are enforced."
  },
  {
    "slug": "refund-policy",
    "spa": "/legal/refund-policy",
    "php": "refund-policy.php",
    "title": "Refund & Cancellation Policy",
    "source": "docs/policies/Refund Policy.pdf",
    "description": "When refunds are issued, how cancellations are processed, and the timelines that apply to CloudHost247 hosting, domain and related services."
  },
  {
    "slug": "backup-policy",
    "spa": "/legal/backup-policy",
    "php": "backup-policy.php",
    "title": "Backup Policy",
    "source": "docs/policies/Backup Policy.pdf",
    "description": "What CloudHost247 backs up, how long copies are retained, and how customers restore website files, databases, configurations and email."
  },
  {
    "slug": "fair-usage",
    "spa": "/legal/fair-usage",
    "php": "fair-usage-policy.php",
    "title": "Fair Usage Policy",
    "source": "docs/policies/Fair Usage Policy.pdf",
    "description": "How fair usage applies to shared, reseller and WordPress hosting, including plans advertised with unlimited disk space or bandwidth."
  },
  {
    "slug": "trademark",
    "spa": "/legal/trademark",
    "php": "trademark-policy.php",
    "title": "Trademark & Copyright Policy",
    "source": "docs/policies/Trademark & Copyright Infringement Policy.pdf",
    "description": "How CloudHost247 Isc reviews trademark and copyright infringement claims, and how domain name disputes are handled alongside them."
  },
  {
    "slug": "domain-agreement",
    "spa": "/legal/domain-agreement",
    "php": "domain-agreement.php",
    "title": "Domain Registration Agreement",
    "source": "docs/policies/Domain Name Registration Agreement.pdf",
    "description": "The agreement between you and CloudHost247 ISC as the sponsoring registrar or reseller for every domain name registered through us."
  },
  {
    "slug": "domain-brokerage-terms",
    "spa": "/legal/domain-brokerage-terms",
    "php": "domain-brokerage-terms.php",
    "title": "Domain Brokerage Terms",
    "source": "domain-brokerage-terms.php",
    "description": "What a CloudHost247 domain brokerage engagement covers: acquisition attempts, confidentiality, and what happens when a domain cannot be acquired."
  },
  {
    "slug": "domain-renewal-policy",
    "spa": "/legal/domain-renewal-policy",
    "php": "domain-renewal-policy.php",
    "title": "Domain Renewal & Deletion Policy",
    "source": "docs/policies/Domain Name Auto-Renewal and Deletion Policy.pdf",
    "description": "How domain auto-renewal works, when a domain is deleted for non-payment, and the grace and redemption periods that follow deletion."
  },
  {
    "slug": "domain-registration-addendum",
    "spa": "/legal/domain-registration-addendum",
    "php": "domainregistrationaddendum.php",
    "title": "Domain Registration Addendum",
    "source": "docs/policies/Domain Registration Addendum.pdf",
    "description": "TLD-specific terms that apply on top of the main Domain Registration Agreement, for each registry CloudHost247 Isc registers through."
  },
  {
    "slug": "cybercrime-policy",
    "spa": "/legal/cybercrime-policy",
    "php": "cybercrime-policy.php",
    "title": "Cybercrime & Abuse Policy",
    "source": "docs/policies/Cybercrime Detection Policy.pdf",
    "description": "The measures CloudHost247 Isc uses to detect and respond when a domain registered or hosted here is used for illegal or malicious activity."
  },
  {
    "slug": "data-deletion",
    "spa": "/legal/data-deletion",
    "php": "data-deletion.php",
    "title": "Data Deletion Policy",
    "source": "docs/policies/Data Deletion Instructions.pdf",
    "description": "Step-by-step instructions for requesting deletion of your personal data from CloudHost247 Isc, and the retention duties that still apply."
  },
  {
    "slug": "data-protection-standards",
    "spa": "/legal/data-protection-standards",
    "php": "data-protection-standards.php",
    "title": "Data Protection Standards",
    "source": "docs/policies/Data Protection Standards.pdf",
    "description": "The principles, technical measures and internal responsibilities CloudHost247 Isc follows to protect customer, partner and employee data."
  },
  {
    "slug": "privacy-notice-and-consent",
    "spa": "/legal/privacy-notice-and-consent",
    "php": "data-privacy-notice-and-consent-form.php",
    "title": "Data Privacy Notice & Consent",
    "source": "docs/policies/Data Privacy Notice and Consent Form.pdf",
    "description": "The privacy notice and consent form CloudHost247 Isc uses for prospective employees under the Nigeria Data Protection Act 2023."
  },
  {
    "slug": "legal-notice",
    "spa": "/legal/legal-notice",
    "php": "legal-notice.php",
    "title": "Legal Notice",
    "source": "docs/policies/Legal Notice.pdf",
    "description": "The rights, obligations and restrictions that apply when you access CloudHost247 Isc websites, services and associated platforms."
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
  "/cloud/managed-services",
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
  "/tools",
  "/docs",
  "/about",
  "/hosting/web-hosting",
  "/hosting/business",
  "/hosting/wordpress",
  "/hosting/cpanel",
  "/developers/php",
  "/developers/python",
  "/developers/nodejs",
  "/developers/laravel",
  "/hosting/windows",
  "/hosting/reseller",
  "/hosting/email",
  "/hosting/developer",
  "/developers/docker",
  "/cloud/game-servers",
  "/cloud/managed-services",
  "/websites",
  "/hosting/ssl",
  "/cloud/public",
  "/cloud/private",
  "/cloud",
  "/cloud/enterprise-servers",
  "/hosting/dedicated",
  "/hosting/vps",
  "/cloud/server-management",
  "/cloud/data-centers",
  "/cloud/network",
  "/cloud/firewall",
  "/cloud/monitoring",
  "/cloud/backups",
  "/hosting/migration",
  "/cloud/ip-management",
  "/domains/search",
  "/domains/bulk-search",
  "/dashboard/domains",
  "/dashboard/dns",
  "/legal/domain-renewal-policy",
  "/tools/dns-lookup",
  "/tools/dns-propagation",
  "/tools/dns-health",
  "/tools/category/security",
  "/tools/dnskey-lookup",
  "/apps",
  "/developers/deployment",
  "/platforms/paas",
  "/hosting/api",
  "/hosting/control-panels",
  "/cloud/operating-systems",
  "/docs",
  "/help",
  "/faq",
  "/support",
  "/blog",
  "/status",
  "/offers",
  "/cloud/infrastructure",
  "/about",
  "/contact",
  "/security",
  "/legal/data-protection-standards",
  "/legal",
  "/legal/terms",
  "/legal/privacy-policy",
  "/legal/cookies",
  "/legal/trademark"
];
