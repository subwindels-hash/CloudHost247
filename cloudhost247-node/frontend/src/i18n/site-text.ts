/** Curated site-owned copy. Do not use this for customer-generated or billing data. */
type SiteText = {
  pricing: string; help: string; signIn: string; headline: string; headlineAccent: string;
  heroDescription: string; domainSearch: string; domainPlaceholder: string; search: string;
  createAccount: string; seePlans: string;
};
const messages: Record<string, SiteText> = {
  en: { pricing: 'Pricing', help: 'Help', signIn: 'Sign In', headline: 'Your idea, online.', headlineAccent: 'All in one place.', heroDescription: 'Register the domain, host the website, deploy the application, run the server and connect the API — with one account, one catalogue and one support relationship.', domainSearch: 'Search for a domain name', domainPlaceholder: 'Find your domain, e.g. example.com', search: 'Search', createAccount: 'Create Account', seePlans: 'See plans' },
  fr: { pricing: 'Tarifs', help: 'Aide', signIn: 'Connexion', headline: 'Votre idée, en ligne.', headlineAccent: 'Tout au même endroit.', heroDescription: 'Enregistrez votre domaine, hébergez votre site, déployez vos applications, gérez vos serveurs et connectez vos API depuis un seul compte et un seul catalogue, avec une seule équipe de support.', domainSearch: 'Rechercher un nom de domaine', domainPlaceholder: 'Trouvez votre domaine, par ex. exemple.com', search: 'Rechercher', createAccount: 'Créer un compte', seePlans: 'Voir les offres' },
  de: { pricing: 'Preise', help: 'Hilfe', signIn: 'Anmelden', headline: 'Ihre Idee, online.', headlineAccent: 'Alles an einem Ort.', heroDescription: 'Registrieren Sie Ihre Domain, hosten Sie Ihre Website, stellen Sie Anwendungen bereit, betreiben Sie Server und verbinden Sie APIs – mit einem Konto, einem Katalog und einem Support-Team.', domainSearch: 'Nach einem Domainnamen suchen', domainPlaceholder: 'Domain finden, z. B. beispiel.com', search: 'Suchen', createAccount: 'Konto erstellen', seePlans: 'Tarife ansehen' },
  es: { pricing: 'Precios', help: 'Ayuda', signIn: 'Iniciar sesión', headline: 'Tu idea, en línea.', headlineAccent: 'Todo en un solo lugar.', heroDescription: 'Registra tu dominio, aloja tu sitio, despliega aplicaciones, ejecuta servidores y conecta API con una sola cuenta, un catálogo y un equipo de soporte.', domainSearch: 'Buscar un nombre de dominio', domainPlaceholder: 'Encuentra tu dominio, p. ej. ejemplo.com', search: 'Buscar', createAccount: 'Crear cuenta', seePlans: 'Ver planes' },
  pt: { pricing: 'Preços', help: 'Ajuda', signIn: 'Entrar', headline: 'Sua ideia, online.', headlineAccent: 'Tudo em um só lugar.', heroDescription: 'Registre seu domínio, hospede seu site, publique aplicações, execute servidores e conecte APIs com uma conta, um catálogo e uma equipe de suporte.', domainSearch: 'Pesquisar um nome de domínio', domainPlaceholder: 'Encontre seu domínio, ex. exemplo.com', search: 'Pesquisar', createAccount: 'Criar conta', seePlans: 'Ver planos' },
  it: { pricing: 'Prezzi', help: 'Aiuto', signIn: 'Accedi', headline: 'La tua idea, online.', headlineAccent: 'Tutto in un unico posto.', heroDescription: 'Registra il dominio, ospita il sito, distribuisci le applicazioni, gestisci i server e collega le API con un solo account, un catalogo e un team di supporto.', domainSearch: 'Cerca un nome di dominio', domainPlaceholder: 'Trova il tuo dominio, es. esempio.com', search: 'Cerca', createAccount: 'Crea account', seePlans: 'Vedi i piani' },
  nl: { pricing: 'Prijzen', help: 'Hulp', signIn: 'Inloggen', headline: 'Uw idee, online.', headlineAccent: 'Alles op één plek.', heroDescription: 'Registreer uw domein, host uw website, implementeer applicaties, beheer servers en koppel API’s met één account, één catalogus en één supportteam.', domainSearch: 'Zoek een domeinnaam', domainPlaceholder: 'Zoek uw domein, bijv. voorbeeld.com', search: 'Zoeken', createAccount: 'Account maken', seePlans: 'Bekijk pakketten' },
  pl: { pricing: 'Cennik', help: 'Pomoc', signIn: 'Zaloguj się', headline: 'Twój pomysł online.', headlineAccent: 'Wszystko w jednym miejscu.', heroDescription: 'Zarejestruj domenę, hostuj stronę, wdrażaj aplikacje, uruchamiaj serwery i łącz interfejsy API za pomocą jednego konta, katalogu i zespołu wsparcia.', domainSearch: 'Szukaj nazwy domeny', domainPlaceholder: 'Znajdź domenę, np. przyklad.com', search: 'Szukaj', createAccount: 'Utwórz konto', seePlans: 'Zobacz plany' },
  ru: { pricing: 'Цены', help: 'Помощь', signIn: 'Войти', headline: 'Ваша идея в сети.', headlineAccent: 'Всё в одном месте.', heroDescription: 'Зарегистрируйте домен, разместите сайт, разверните приложение, запустите сервер и подключите API с одной учётной записью, одним каталогом и одной службой поддержки.', domainSearch: 'Поиск доменного имени', domainPlaceholder: 'Найдите домен, например example.com', search: 'Поиск', createAccount: 'Создать аккаунт', seePlans: 'Посмотреть тарифы' },
  ar: { pricing: 'الأسعار', help: 'المساعدة', signIn: 'تسجيل الدخول', headline: 'فكرتك على الإنترنت.', headlineAccent: 'كل شيء في مكان واحد.', heroDescription: 'سجّل نطاقك واستضف موقعك وانشر تطبيقاتك وشغّل خوادمك واربط واجهات البرمجة من خلال حساب واحد وكتالوج واحد وفريق دعم واحد.', domainSearch: 'البحث عن اسم نطاق', domainPlaceholder: 'ابحث عن نطاقك، مثل example.com', search: 'بحث', createAccount: 'إنشاء حساب', seePlans: 'عرض الباقات' },
  zh: { pricing: '价格', help: '帮助', signIn: '登录', headline: '让您的创意上线。', headlineAccent: '一站式完成。', heroDescription: '注册域名、托管网站、部署应用、运行服务器并连接 API——一个账户、一个目录、一个支持团队。', domainSearch: '搜索域名', domainPlaceholder: '查找您的域名，例如 example.com', search: '搜索', createAccount: '创建账户', seePlans: '查看方案' },
  ja: { pricing: '料金', help: 'ヘルプ', signIn: 'ログイン', headline: 'アイデアをオンラインに。', headlineAccent: 'すべてを一か所で。', heroDescription: 'ドメイン登録、ウェブサイトのホスティング、アプリのデプロイ、サーバー運用、API 接続を、ひとつのアカウントとカタログ、サポート窓口で。', domainSearch: 'ドメイン名を検索', domainPlaceholder: 'ドメインを検索（例：example.com）', search: '検索', createAccount: 'アカウントを作成', seePlans: 'プランを見る' },
  ko: { pricing: '요금', help: '도움말', signIn: '로그인', headline: '아이디어를 온라인으로.', headlineAccent: '모든 것을 한곳에서.', heroDescription: '하나의 계정, 카탈로그와 지원팀으로 도메인을 등록하고 웹사이트를 호스팅하며 애플리케이션과 서버를 배포하고 API를 연결하세요.', domainSearch: '도메인 이름 검색', domainPlaceholder: '도메인 찾기 (예: example.com)', search: '검색', createAccount: '계정 만들기', seePlans: '요금제 보기' },
};
export function siteText(locale: string): SiteText { return messages[locale] ?? messages.en; }

/** Shared labels for the public pricing section. Product data remains owned by the catalogue. */
const pricingText: Record<string, { title: string; eyebrow: string; choose: string; categories: string }> = {
  en: { title: 'Choose the plan that fits what you are building', eyebrow: 'Plans & prices', choose: 'Choose plan', categories: 'Plan categories' },
  fr: { title: 'Choisissez l’offre adaptée à votre projet', eyebrow: 'Offres et tarifs', choose: 'Choisir cette offre', categories: 'Catégories d’offres' },
  de: { title: 'Wählen Sie den passenden Tarif für Ihr Projekt', eyebrow: 'Tarife und Preise', choose: 'Tarif wählen', categories: 'Tarifkategorien' },
  es: { title: 'Elige el plan que se adapte a tu proyecto', eyebrow: 'Planes y precios', choose: 'Elegir plan', categories: 'Categorías de planes' },
  pt: { title: 'Escolha o plano ideal para seu projeto', eyebrow: 'Planos e preços', choose: 'Escolher plano', categories: 'Categorias de planos' },
  it: { title: 'Scegli il piano adatto al tuo progetto', eyebrow: 'Piani e prezzi', choose: 'Scegli piano', categories: 'Categorie di piani' },
  nl: { title: 'Kies het pakket dat bij uw project past', eyebrow: 'Pakketten en prijzen', choose: 'Kies pakket', categories: 'Pakketcategorieën' },
  pl: { title: 'Wybierz plan odpowiedni dla Twojego projektu', eyebrow: 'Plany i ceny', choose: 'Wybierz plan', categories: 'Kategorie planów' },
  ru: { title: 'Выберите подходящий тариф для вашего проекта', eyebrow: 'Тарифы и цены', choose: 'Выбрать тариф', categories: 'Категории тарифов' },
  ar: { title: 'اختر الباقة المناسبة لمشروعك', eyebrow: 'الباقات والأسعار', choose: 'اختر الباقة', categories: 'فئات الباقات' },
  zh: { title: '选择适合您项目的方案', eyebrow: '方案与价格', choose: '选择方案', categories: '方案类别' },
  ja: { title: 'プロジェクトに合ったプランを選択', eyebrow: 'プランと料金', choose: 'プランを選択', categories: 'プランのカテゴリ' },
  ko: { title: '프로젝트에 맞는 요금제를 선택하세요', eyebrow: '요금제 및 가격', choose: '요금제 선택', categories: '요금제 카테고리' },
};
export function sitePricingText(locale: string) { return pricingText[locale] ?? pricingText.en; }

/** Primary navigation titles, keyed independently of routes and generated menu data. */
const navigationText: Record<string, Record<string, string>> = {
  en: { hosting: 'Hosting', cloud: 'Cloud & Servers', domains: 'Domains', platforms: 'Platforms', tools: 'Tools', resources: 'Resources', company: 'Company' },
  fr: { hosting: 'Hébergement', cloud: 'Cloud et serveurs', domains: 'Domaines', platforms: 'Plateformes', tools: 'Outils', resources: 'Ressources', company: 'Entreprise' },
  de: { hosting: 'Hosting', cloud: 'Cloud und Server', domains: 'Domains', platforms: 'Plattformen', tools: 'Tools', resources: 'Ressourcen', company: 'Unternehmen' },
  es: { hosting: 'Alojamiento', cloud: 'Nube y servidores', domains: 'Dominios', platforms: 'Plataformas', tools: 'Herramientas', resources: 'Recursos', company: 'Empresa' },
  pt: { hosting: 'Hospedagem', cloud: 'Nuvem e servidores', domains: 'Domínios', platforms: 'Plataformas', tools: 'Ferramentas', resources: 'Recursos', company: 'Empresa' },
  it: { hosting: 'Hosting', cloud: 'Cloud e server', domains: 'Domini', platforms: 'Piattaforme', tools: 'Strumenti', resources: 'Risorse', company: 'Azienda' },
  nl: { hosting: 'Hosting', cloud: 'Cloud en servers', domains: 'Domeinen', platforms: 'Platformen', tools: 'Tools', resources: 'Bronnen', company: 'Bedrijf' },
  pl: { hosting: 'Hosting', cloud: 'Chmura i serwery', domains: 'Domeny', platforms: 'Platformy', tools: 'Narzędzia', resources: 'Zasoby', company: 'Firma' },
  ru: { hosting: 'Хостинг', cloud: 'Облако и серверы', domains: 'Домены', platforms: 'Платформы', tools: 'Инструменты', resources: 'Ресурсы', company: 'Компания' },
  ar: { hosting: 'الاستضافة', cloud: 'السحابة والخوادم', domains: 'النطاقات', platforms: 'المنصات', tools: 'الأدوات', resources: 'الموارد', company: 'الشركة' },
  zh: { hosting: '托管', cloud: '云与服务器', domains: '域名', platforms: '平台', tools: '工具', resources: '资源', company: '公司' },
  ja: { hosting: 'ホスティング', cloud: 'クラウドとサーバー', domains: 'ドメイン', platforms: 'プラットフォーム', tools: 'ツール', resources: 'リソース', company: '会社情報' },
  ko: { hosting: '호스팅', cloud: '클라우드 및 서버', domains: '도메인', platforms: '플랫폼', tools: '도구', resources: '리소스', company: '회사' },
};
export function navigationLabel(locale: string, section: string, fallback: string): string {
  return (navigationText[locale] ?? navigationText.en)[section] ?? fallback;
}
