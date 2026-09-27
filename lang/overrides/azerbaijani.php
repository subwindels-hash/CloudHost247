<?php
if (!defined("WHMCS"))
    die("This file cannot be accessed directly");
/* Header Variables */
$_LANG = json_decode('{
  "aboutPageTitle": "Bizim haqqımızda",
  "aboutPageFooterTagLine": "İşiniz üçün ən yaxşı idarə olunan <b> Cloud Hosting </b> təcrübəsini seçin!",
  "aboutPageGetStartButton": "İndi başlayın",
  "aboutPageSubTitle": "Etiam condimentum metus rhoncus pharetra tempor.",
  "aboutPageSubTitleP": "Sonuncu Google Chrome yeniləmələri, veb saytınız https deyilsə, (e.ə. SSL sertifikatı yoxdursa), indi ziyarətçiləri URLdə \"Təhlükəsiz deyil\" mesajı göstərir.",
  "aboutPageOurStoryTitle": "<span> Loream </span> adekvat elit, bu günə qədər mülayim bir vəziyyət yaradır. laboratoriya və işləmək, daha çox. qışqırtma məşqləri ullamco və host cillum dolore eu fugiat.",
  "aboutPageOurStorySee": "<span> BİZİMİN </span> Öyküsü",
  "aboutPageOurStorySeeP": "Bir məqalə oxucunun layout baxdığınız zaman bir səhifənin oxunaqlı məzmunu ilə diqqət çəkməyəcəyi uzun müddətdir. Lorem İpsumun istifadə etdiyi nöqtə daha az və ya az normaldır",
  "aboutPageMeetUs": "Metus rhoncus pharetra haqqında",
  "aboutPageMeetUsP": "Lorem Ipsum basitçe baskı ve yazma ve endüstrinin köşe yazısıdır. Lorem Ipsum, 1500-cü illərdən etibarən bilinməyən bir printerin tipik bir nümunə kitabını götürdüyü və nümunə nümunəsi kitabı hazırlamaq üçün pişirdiği zaman, sənayenin standartı <span> dummy mətni olmuşdur. </Span>",
  "aboutPageMeetUsLi1": "Diqqətlə zəmanət verin, dəbdəbəli paltar, luctus felis.",
  "aboutPageMeetUsLi2": "Nunc eu odio mollis, düstur ləğv, luctus neque.",
  "aboutPageMeetUsLi3": "Fəxri fərdlərdən biri.",
  "aboutPagewhychoose": "Niyə bizi seçir?",
  "aboutPagewhychooseP": "İndiki vaxtda iqtisadi cəhətdən sağlam xidmətlərin interaktiv şəkildə yenidən müəyyənləşdirilməsi",
  "aboutPagewhychoose1": "Keyfiyyət və etibarlılıq",
  "aboutPagewhychoose2": "Sizin ehtiyaclarınız üçün doğru SSL sertifikatını əldə etməklə başlayın. Listelenen üç növ host və veb arasından seçim edin.",
  "aboutPagewhychoose3": "24/7 Dəstək",
  "aboutPagewhychoose4": "Sizin ehtiyaclarınız üçün doğru SSL sertifikatını əldə etməklə başlayın. Listelenen üç növ host və veb arasından seçim edin.",
  "aboutPagewhychoose5": "20 Gün Garantisi",
  "aboutPagewhychoose6": "Sizin ehtiyaclarınız üçün doğru SSL sertifikatını əldə etməklə başlayın. Listelenen üç növ host və veb arasından seçim edin.",
  "aboutPageWeTakeCareHead": "Yükseltmeler, <span> Bakım </span> ve <span> Təhlükəsizlik </span> ile ilgileniyoruz",
  "aboutPageWeTakeCareHeadP": "Veb saytınız https olmadıqda (yəni SSL sertifikatı olmadıqda) son Google Chrome yeniləmələri artıq URLdə Təhlükəsiz mesajını göstərir. Əgər təhlükəsiz deyilsə, ziyarətçilər məlumat almağa, satın almağa və ya hətta imzalamağa qadağa qoyma ehtimalı daha çoxdur. <Span> Google, SEO səylərinə təsir göstərən axtarış nəticələr səhifəsində (SERP) trafik və gəlir eyni zamanda. </span>",
  "aboutPageAwardWiningHead": "<Span> 24/7 dəstək </span> qələbə qazanan mükafat",
  "aboutPageAwardWiningHeadP": "Veb saytınız https olmadıqda (yəni SSL sertifikatı olmadıqda) son Google Chrome yeniləmələri artıq URL də Təhlükəsiz mesajını göstərir. Əgər təhlükəsiz deyilsə, ziyarətçilər məlumat almağa, satın almağa və ya hətta imzalamağa qadağa qoyma ehtimalı daha çoxdur. <Span> Google, SEO səylərinə təsir göstərən axtarış nəticələr səhifəsində (SERP) trafik və gəlir eyni zamanda. </span>",
  "aboutPageAwardWiningHeadLi1": "Diqqətlə zəmanət verin, dəbdəbəli paltar, luctus felis.",
  "aboutPageAwardWiningHeadLi2": "Nunc eu odio mollis, düstur ləğv, luctus neque.",
  "aboutPageAwardWiningHeadLi3": "Fəxri fərdlərdən biri.",
  "aboutPageWebsiteRateHead": "Host veb səhifəsi Rating",
  "aboutPageWebsiteRateNumber": "4.5",
  "aboutPageWebsiteRateReview": "28 məntəqədə 200 baxışdan ibarətdir",
  "aboutPageTeamHead": "Hər bir böyük xidmət arxasında, <span> Böyük insanlar </span>",
  "aboutPageTeamHeadMember1Name": "John Packet",
  "aboutPageTeamHeadMember1Position": "CEO & CO təsisçisi",
  "aboutPageTeamHeadMember2Name": "Mike Schillig",
  "aboutPageTeamHeadMember2Position": "Head Developer",
  "aboutPageTeamHeadMember3Name": "Lizy Dabars",
  "aboutPageTeamHeadMember3Position": "Menecer",
  "aboutPageTeamHeadMember4Name": "Ann Lecar",
  "aboutPageTeamHeadMember4Position": "CEO",
  "aboutPageTeamHeadMember5Name": "John Packet",
  "aboutPageTeamHeadMember5Position": "CEO & CO təsisçisi",
  "aboutPageTeamHeadMember6Name": "Mike Schillig",
  "aboutPageTeamHeadMember6Position": "Head Developer",
  "aboutPageTeamHeadMember7Name": "Lizy Dabars",
  "aboutPageTeamHeadMember7Position": "Menecer",
  "aboutPageTeamHeadMember8Name": "Ann Lecar",
  "aboutPageTeamHeadMember8Position": "CEO",
  "aboutPageFaqHead": "Tez-tez soruşulan <span> Suallar </span>",
  "aboutPageFaqAccord1Head": "SSL Sertifikatı nədir?",
  "aboutPageFaqAccord1Body": "Əksinə, klişe, yüksək həyat tərzi, terry richardson ad squid.",
  "aboutPageFaqAccord2Head": "SSL-nin faydası nədir?",
  "aboutPageFaqAccord2Body": "Bəli, Weebly site qurucusu ilə yaradılmış bütün saytlar mobil üçün optimize edilmişdir.",
  "aboutPageFaqAccord3Head": "SSL bütün veb brauzerlərdə işləyirmi?",
  "aboutPageFaqAccord3Body": "Bəli, Weebly site qurucusu ilə yaradılmış bütün saytlar mobil üçün optimize edilmişdir.",
  "aboutPageFaqAccord4Head": "Bir SSL üçün necə müraciət edə bilərəm?",
  "aboutPageFaqAccord4Body": "Bəli, Weebly site qurucusu ilə yaradılmış bütün saytlar mobil üçün optimize edilmişdir.",
  "aboutPageFaqAccord5Head": "Sertifikat İmzalama Təqdimatı (CSR) necə tərtib edirəm?",
  "aboutPageFaqAccord5Body": "Bəli, Weebly site qurucusu ilə yaradılmış bütün saytlar mobil üçün optimize edilmişdir.",
  "sslPageMainTitle": "SSL Sertifikatları",
  "sslPageSubHeadTitle": "SSL təhlükəsizliyi ilə istifadəçilərinizin onlayn məlumatlarını qoruyun",
  "sslPageHeadLi1": "Rock-bərk təhlükəsizlik",
  "sslPageHeadLi1Span": "30 günlük pul geri təminatı",
  "sslPageHeadLi2": "Comodo Secure Mühür",
  "sslPageHeadLi2Span": "Müştəri güvənini artırın",
  "sslPageViewPlanStartH6": "Başlanğıcdan",
  "sslPageViewPlanStartH5": "<span> $ </span> 13.99 <sup> USD / mo </sup>",
  "sslPageViewPlanButtonText": "Planı baxın",
  "sslPageHowSsl": "Sitenize SSL necə təsir göstərir?",
  "sslPageHowSslP": "Bir SSL şəhadətnaməsi istifadəçi adı, şifrəniz, kredit kartı nömrələri daxil olmaqla məlumatların təhlükəsiz şəkildə saxlanılması vasitəsilə təhlükəsiz bir tunel yaradır.",
  "sslPageHowSslLi1": "Kiçik yaşıl kilid",
  "sslPageHowSslLi2": "Kiçik yaşıl kilid",
  "sslPageHowSslLi3": "Etibarlı SSL sertifikatı alın",
  "sslPageHowSslLi4": "Etibarlı SSL sertifikatı alın",
  "sslPageHowSslLi5": "Limitsiz serverləri qoruyur",
  "sslPageHowSslLi6": "Limitsiz serverləri qoruyur",
  "sslPageHowSslLi7": "Bütün əsaslarla uyğun gəlir",
  "sslPageHowSslLi8": "Bütün əsaslarla uyğun gəlir",
  "sslPageEasyStepHead": "Dörd asan addımda SSL Sertifikatı",
  "sslPageEasyStepHeadP": "Bir SSL sertifikatı aldıqdan sonra onu aktivləşdirmək lazımdır.",
  "sslPageEasyStepBox1Span": "1",
  "sslPageEasyStepBox1H5": "Satın alın",
  "sslPageEasyStepBox1P": "Sizin ehtiyaclarınız üçün doğru SSL sertifikatını əldə etməklə başlayın. Siyahıda üç növdən birini seçin.",
  "sslPageEasyStepBox2Span": "2",
  "sslPageEasyStepBox2H5": "Aktivləşdirin",
  "sslPageEasyStepBox2P": "Dərhal Hesabınız Panelindən SSL sertifikatınızı aktivləşdirə bilərsiniz.",
  "sslPageEasyStepBox3Span": "3",
  "sslPageEasyStepBox3H5": "Quraşdırın",
  "sslPageEasyStepBox3P": "SSL sertifikatınızın bir dəfə təsdiqlənməsinə dair təlimatlar alacaqsınız.",
  "sslPageEasyStepBox4Span": "4",
  "sslPageEasyStepBox4H5": "İdarə et",
  "sslPageEasyStepBox4P": "Paneldə SSL sertifikatlarını (yeniləşdirmə və yenidən yazma daxil olmaqla) idarə edə bilərsiniz.",
  "sslPageEffectSiteH4": "Google-un son dəyişiklikləri Sizi necə təsir edir?",
  "sslPageEffectSiteP": "Sonuncu Google Chrome yeniləmələri, veb saytınız https deyilsə, (e.ə. SSL sertifikatı yoxdursa), indi ziyarətçiləri URLdə \"Təhlükəsiz deyil\" mesajı göstərir. Təhlükəsiz deyilsə, ziyarətçilər məlumat almağa, satın almağa və ya hətta e-poçt siyahısına yazılmaqdan çəkinməyə daha çox güman edirlər.",
  "sslPageEffectSitePSpan": "Google, SEO səylərinizi, trafik və gəlirinizi eyni zamanda təsir edən axtarış nəticələr səhifəsində (SERP) aşağıda SSL sertifikatı olmadan veb saytları sıralayacaq.",
  "sslPageFaqHead": "Tez-tez soruşulan <span> Suallar </span>",
  "sslPageFaqAccord1Head": "SSL Sertifikatı nədir?",
  "sslPageFaqAccord1Body": "Əksinə, klişe, yüksək həyat tərzi, terry richardson ad squid.",
  "sslPageFaqAccord2Head": "SSL-nin faydası nədir?",
  "sslPageFaqAccord2Body": "Bəli, Weebly site qurucusu ilə yaradılmış bütün saytlar mobil üçün optimize edilmişdir.",
  "sslPageFaqAccord3Head": "SSL bütün veb brauzerlərdə işləyirmi?",
  "sslPageFaqAccord3Body": "Bəli, Weebly site qurucusu ilə yaradılmış bütün saytlar mobil üçün optimize edilmişdir.",
  "sslPageFaqAccord4Head": "Bir SSL üçün necə müraciət edə bilərəm?",
  "sslPageFaqAccord4Body": "Bəli, Weebly site qurucusu ilə yaradılmış bütün saytlar mobil üçün optimize edilmişdir.",
  "sslPageFaqAccord5Head": "Sertifikat İmzalama Təqdimatı (CSR) necə tərtib edirəm?",
  "sslPageFaqAccord5Body": "Bəli, Weebly site qurucusu ilə yaradılmış bütün saytlar mobil üçün optimize edilmişdir.",
  "sslPageGetStartButton": "İndi başlayın",
  "sslPageFooterTagLine": "İşiniz üçün ən yaxşı idarə olunan <b> Cloud Hosting </b> təcrübəsini seçin!"
}',true);
$_LANG['headerphone'] = '+1(929)8002575';

$_LANG['headerallproduct'] = 'Bütün Məhsullar';

$_LANG['headerdomains'] = 'Domains';

$_LANG['headerdomain'] = 'Domain';

$_LANG['headerregisterdomain'] = 'Bir Domain Qeydiyyatın';

$_LANG['headertransferdomain'] = 'Bir Domain Aktar';

$_LANG['headervpsssd'] = 'VPS SSD';

$_LANG['headervpspubliccloud'] = 'VPS İctimai Bulud';

$_LANG['headervpsprivatecloud'] = 'VPS Şəxsi Cloud';

$_LANG['headerenterpriseserver'] = 'Enterprise Servers';

$_LANG['headerdeveloperfriendly'] = 'Geliştirici dostu';

$_LANG['headergaming'] = 'Oyun serverləri';

$_LANG['headerhosting'] = 'Hosting';

$_LANG['headerhostings'] = 'Hosting';

$_LANG['headerhostingtext'] = "Hostinq, sitenizi internetdə görünməsini təmin edir. Hər bir ehtiyac üçün sürətli, etibarlı planlar təklif edirik - əsas blogdan yüksək güclü saytlara qədər. Designer? İnkişaf etdirici? Sizi də əhatə etdiniz.";

$_LANG['headerhostingserver'] = 'Hosting Serverlər';

$_LANG['headerservers'] = 'Serverlər';

$_LANG['headerserverstext'] = 'Nəzarətə nəzarət edin və ya tamamilə xüsusi xüsusi server seçin. Plesk və cPanel kök girişi, unikal IP, avtomatlaşdırılmış yeniliklər, ehtiyat və təhlükəsizlik ilə geniş miqyaslı hosting aparır.';

$_LANG['headerwebhosting'] = 'Web Hosting';

$_LANG['headercpanelhosting'] = 'cPanel Hosting';

$_LANG['headerpleskhosting'] = 'Plesk Hosting';

$_LANG['headerwindowhosting'] = 'Windows Hosting';

$_LANG['headerwordpresshosting'] = 'Wordpress Hosting';

$_LANG['headercom'] = 'ilə';

$_LANG['headercomtext'] = 'Stildən asla çıxmayacaq <b> domain </b> alın.';

$_LANG['headerregister'] = 'Qeydiyyatdan keçin';

$_LANG['headerdomaintext'] = 'Yeni domainləri axtarın və başqasının etməzdən əvvəl adınızı qeyd edin. .COM domenləri yalnız $ 9.95 / yr təşkil edir və işiniz kimi unikal bir PULSUZ Şəxsi Qeydiyyat, 400 + TLD daxildir.';

$_LANG['headerlearnmore'] = 'Daha ətraflı';

$_LANG['headerdedicatedservers'] = 'Dedicated Servers';

$_LANG['headervpsservers'] = 'VPS Servers';

$_LANG['headersupport'] = 'Dəstək';

$_LANG['headersupporttext'] = 'Biz bir çox məhsula qürurla dəstək veririk və suallara cavab verməyə və müştərilərin gücləndirilməsinə çalışırıq. Professional texniki yardım günün 24 saatı olmaqla həmişə mövcuddur. Müştərilər biletlər, giriş forumları və məlumat bazaları yarada, suallar oxumaq və təlimat videolarını izləyə bilərlər.';

$_LANG['headeropensupportticket'] = "A Support Ticket'i açın";

$_LANG['headercontactus'] = 'Bizimlə əlaqə saxlayın';

$_LANG['headerknowledgebase'] = 'Bilik bazası';

$_LANG['headerwebsite'] = 'Veb səhifə';

$_LANG['headerwebsitetext'] = 'Hər hansı bir müasir biznes üçün veb-sayt vacibdir. Yerli və ya ağız sözü ilə satarsanız belə, müştəriləriniz İnternetdə sizi axtarır - yalnız saatlarınızı yoxlamaq üçün. Burada lazım olan hər şeyi tapın.';

$_LANG['headerdesignnewwebsite'] = 'Yeni bir veb sayt hazırlayın';

$_LANG['headercustomchanges'] = 'Vebdə Xüsusi dəyişikliklər lazımdır';

$_LANG['headerelements'] = 'Elementlər';

$_LANG['headerpricetables'] = 'Qiymət Tabloları';

$_LANG['headerhomepage'] = 'Əsas səhifə';

$_LANG['headerbanners'] = 'Bannerlər';

$_LANG['headerpagenotfound'] = 'Səhifə tapılmadı';

$_LANG['headercomingsoon'] = 'Tezliklə';

$_LANG['headerdomainsearch'] = 'Domain Axtarış';

$_LANG['headerwas'] = 'oldu';



/* Home Page */

$_LANG['homebig'] = 'BIG';

$_LANG['homesummersale'] = 'YAZ SATIŞ';

$_LANG['homesharedhostingfrm'] = 'Paylaşılan Hostinq';

$_LANG['homeonly'] = 'yalnız';

$_LANG['homemonth'] = 'ay';

$_LANG['hometrusbusiness'] = 'Qlobal Xidmət, Yerli Əlaqələr üçün Müəssisələr tərəfindən etibar';

$_LANG['homeyears'] = 'İllər';

$_LANG['homeunlimitedws'] = 'Limitsiz Veb Space';

$_LANG['homefreedomain'] = 'Pulsuz Domain';

$_LANG['homeunlimitedbandwidth'] = 'Limitsiz Bandwidth';

$_LANG['homeunlimitedemail'] = 'Limitsiz E-poçt';

$_LANG['homegetstarted'] = 'İndi başlayın';

$_LANG['homeourproducts'] = 'Məhsullarımız';

$_LANG['homeourproductstext'] = 'Üstün Performans Tam Ölçeklenebilirliğe cavab verir';

$_LANG['homevpshosting'] = 'VPS Hosting';

$_LANG['homevpshostingtext'] = 'Bizim serverlərimiz və infrastrukturumuz, xidmət hücumlarının inkar edilməsinə qarşı qorunur (DDoS)';

$_LANG['homevirtualserver'] = 'Virtul Server';

$_LANG['homevirtualservertext'] = 'RPN İnternet şəbəkə interfeysindən ayrılmış və fiziki olaraq ayrılmış xüsusi bir şəbəkə funksiyasıdır.';

$_LANG['homewebhostcert'] = 'Bizim Dedibox® serverlərimiz VMWare Ready® sertifikatlaşdırılmışdır';

$_LANG['homesharehost'] = 'Paylaşılan Hostinq';

$_LANG['homesharehosttext'] = 'Demək olar ki, bütün Dedibox ® standart olaraq IP və uzaq virtual media üzərində hardware KVM ilə gəlir.';

$_LANG['homewordpresshosting'] = 'Wordpress Hosting';

$_LANG['homewordpresshostingtext'] = 'Dedibox serverlərinin əksəriyyəti etibarlılıq və performans təmin edən RAID-ni dəstəkləyir';

$_LANG['homecloudhosting'] = 'Cloud Hosting';

$_LANG['homecloudhostingtext'] = 'Texniki yardımımız həftədə 7 gün 24 saat, bilet və telefon, Fransız, ingilis və alman dilində mövcuddur';

$_LANG['homehostxwebhost'] = 'HostX Web Hosting';

$_LANG['homehostxwebhosttext'] = "Növbəti server, sayt, app, platform və ya blogunuz üçün mükəmməl bir hosting planı var - hamısı mükafat qazanan 24/7 dəstəyiniz tərəfindən dəstəklənir.";

$_LANG['homestartup'] = "linux hosting";

$_LANG['homesplan2'] = "vps hosting";

$_LANG['homesplan3'] = "xüsusi server";

$_LANG['homestartfrom'] = "Dan başlayaraq";

$_LANG['homemo'] = "Mo";

$_LANG['homenoofsites'] = "<b> 1 </b> saytından başlayır";

$_LANG['homesiteenvironment'] = "mühit / site";

$_LANG['homevisitmonth'] = "səfərlər / ay";

$_LANG['homebandwidth'] = "bant";

$_LANG['homecdnandssl'] = "<b> CDN & SSl </b> daxil edildi";

$_LANG['homemigrations'] = "<b> Migrations </b> pulsuzdur";

$_LANG['homepagepreform'] = "<b> Səhifə Performansı </b> pulsuz";

$_LANG['homepowerfultools'] = "Güclü <b> alətlər </b> mövcuddur";

$_LANG['homeannualprepay'] = "İllik ödəmə ilə 2 ay pulsuz olsun";

$_LANG['homeordernow'] = "SİFARİŞ SİFARİŞ";

$_LANG['homecustomplan'] = "MÜŞAHİDƏ PLANI";

$_LANG['homecustomplantext'] = "Öz gereksinimlerinize uyğun hosting planınızı özelleştirin";

$_LANG['homehighperform'] = "<b> Yüksək </b> performans";

$_LANG['homeriskfree'] = "60 gün ərzində risksizdir";

$_LANG['homehighredundanc'] = "<b> Yüksək mövcudluq </b> / artıqlıq";

$_LANG['homeonboarding'] = "<b> Yönetilen </b> onboarding";

$_LANG['homefastrepons'] = "<b> Ən sürətli dəstək </b> cavab";

$_LANG['homecallus'] = "Çağırın";

$_LANG['hometalksalep'] = "bir satış mütəxəssisi ilə danışmaq";

$_LANG['homehostsolution4you'] = "Sizin üçün bir Hosting Solution var";

$_LANG['homechooseplatform'] = "Bir platform seçin";

$_LANG['homehackersecur'] = "HACKER-FREE SECURITY";

$_LANG['homehackersecurtext'] = "Bizim serverlərimiz və infrastrukturumuz, xidmət hücumlarının inkar edilməsinə qarşı qorunur (DDoS)";

$_LANG['homeblazingspeed'] = "HƏYATI HIZLAR";

$_LANG['homeblazingspeedtext'] = "RPN İnternet şəbəkə interfeysindən ayrılmış və fiziki olaraq ayrılmış xüsusi bir şəbəkə funksiyasıdır";

$_LANG['homenightlybackup'] = "GÜCLÜ BACKUPS";

$_LANG['homenightlybackuptext'] = "Bizim Dedibox® serverlərimiz VMWare Ready® sertifikatlaşdırılmışdır";

$_LANG['homeglobalavailty'] = "GLOBAL BƏYANNAMƏSİ";

$_LANG['homeglobalavailtytext'] = "Demək olar ki, bütün Dedibox ® standart olaraq IP və uzaq virtual media üzərində hardware KVM ilə gəlir";

$_LANG['homereimaginedsetp'] = "SFTP yenidən reallaşdırıldı";

$_LANG['homereimaginedsetptext'] = "Dedibox serverlərinin əksəriyyəti etibarlılıq və performans təmin edən RAID-ni dəstəkləyir";

$_LANG['hometunedwordpress'] = "WORDPRESS ÜÇÜN TUNED";

$_LANG['hometunedwordpresstext'] = "Texniki yardımımız həftədə 7 gün 24 saat, bilet və telefon, Fransız, ingilis və alman dilində mövcuddur";

$_LANG['hometestimonials'] = "Təqdimatlar";

$_LANG['hometestimhead'] = "Müştərilərimizin məhsulları və xidmətləri haqqında nə dediklərini öyrənin";

$_LANG['hometestimname'] = "Natalie Smith";

$_LANG['hometestimtext'] = "Lorem Ipsum sadəcə çap və yazma sənayesinin dummy mətnidir. Lorem Ipsum, 1500-cü illərdən bəri sənaye standart qabarit mətn olmuşdur, bilinməyən bir printer növü bir mətbəx aldı və bir tip nümunə kitab etmək üçün pişmiş zaman";

$_LANG['homededicatenvrmnt'] = "<b> mühit </b> həsr olunmuşdur";

/*Footer*/

$_LANG['footerchoosebest'] = "İşiniz üçün ən yaxşı idarə olunan <b> Cloud Hosting </b> təcrübəsini seçin!";

$_LANG['footeraboutus'] = "BİZİM HAQQIMIZDA";

$_LANG['footeraboutustext'] = "Cloud Hosting, dünyanın hər tərəfindəki fərdi və kiçik müəssisələrə üstün, etibarlı və etibarlı Web Hosting təklif edir";

$_LANG['footergettouch'] = "ƏLAQƏDƏ OLMAQ";

$_LANG['footercontactinfo'] = "Əlaqə məlumatı";

$_LANG['footer24support'] = "24/7 Dəstək";

$_LANG['footeremail'] = "E-poçt";

$_LANG['footerfollowus'] = "Bizi izlə";

$_LANG['footerusefullinks'] = "Faydalı Linklər";

$_LANG['footerlinuxservers'] = "Linux Servers";

$_LANG['footerprivacypolicy'] = "Gizlilik Siyasəti";

$_LANG['footerclose'] = "Yaxın";

$_LANG['footertitle'] = "Başlıq";

$_LANG['footersubmit'] = "təqdim";



/*Domain*/

$_LANG['domainregister'] = "DOMAIN qeydə alın";

$_LANG['domainfindideal'] = "Ideal Domain Adınızı tapın";

$_LANG['domainsecureyourdmn'] = "Domeninizi qeydiyyatdan keçərək domeninizi təhlükəsiz edin!";

$_LANG['domainsearch'] = "Axtarış";

$_LANG['domainyr'] = "yr";

$_LANG['domainchecktld'] = "Aşağıdakı bütün TLD'lerimizi nəzərdən keçirin";

$_LANG['domainchecktldtext'] = "Sizin biznes səhifənizin başlanğıcına başlamağınız üçün TLD-nin siyahısını təqdim edin!";

$_LANG['domaingtldcctld'] = "GTLDs & CCTLDs";

$_LANG['domainfreeemail'] = "2 E-poçt hesabı pulsuzdur";

$_LANG['domainprice'] = "Qiymət";

$_LANG['domainyear'] = "İl";

$_LANG['domainrenewalprice'] = "Yeniləmə Qiyməti";

$_LANG['domainowndomain'] = "Artıq <b> mükəmməl domen adınızın sahibi? </b> <br> Bunun üçün bir veb sayt yaradın!";

$_LANG['domainowndomaintext'] = "İşiniz üçün unikal bir sayt yaratmaq istəyirsiniz? <br> Dünya ilə rəqabət etmək üçün veb saytınızı qurmağa kömək edirik";

$_LANG['domainclickstart'] = "Başlamaq üçün basın";

$_LANG['domainsimplesteps'] = "Üç Sadə Adımda Online alın";

$_LANG['domainchoosename'] = "Bir domen adını seçin";

$_LANG['domainchoosenametext'] = ".Com, .in və çox mores kimi genişlənmə uzadılmasını geniş formada seçin";

$_LANG['domainselecthostplan'] = "Bir hosting planı seçin";

$_LANG['domainselecthostplantext'] = "Biz bazarda ən əlverişli qiymətlərlə ən yaxşı hosting təklif edirik";

$_LANG['domainsetupwebsite'] = "Veb sayt qurun";

$_LANG['domainsetupwebsitetext'] = "Böyük məlumat bazasından vebinizi necə quracağınızı öyrənin";

$_LANG['domaincallus'] = "CALL US";

$_LANG['domaintollfree'] = "Toll Free";

$_LANG['domainchatwith'] = "Bizimlə əlaqə saxlayın";

$_LANG['domainexperts'] = "DOMAIN EXPERTS";

$_LANG['domaingetemailaddress'] = "Şəxsi e-poçt ünvanınızı alın: <br> İşinizə güvən";

$_LANG['domaingetemailtext'] = "Yourname@example.com kimi bir proffessional e-poçt ünvanından istifadə edərək, doğru mesajı müştərilərinizə və perspektivlərinizə göndərin. Alanınıza xüsusi e-poçt ünvanları əlavə etmək asandır və şirkətinizə etibarlılıq yaradır. E-poçt seçimlərimizi nəzərdən keçirin";

$_LANG['domainregister'] = "ÇOX SORULAN";

$_LANG['domainfrequentlyask'] = "SORU & CAVABLAR!";

$_LANG['domainquesanss'] = "QUESTION & ANSWERS!";

$_LANG['domainque1'] = "Hansı Web Hosting Planı lazımdır?";

$_LANG['domainque2'] = "Necə xüsusi bir hosting ala bilərəm?";

$_LANG['domainque3'] = "bir hosting alıb, indi nə edim?";

$_LANG['domainque4'] = "İnternet səhifələrini serverə necə ötürə bilərəm?";

$_LANG['domainqueans'] = "Bəzi hallarda, işə yararsız vəziyyətdədir, işə yarayır, işə yarayır və işə yarayır. Təxminən bir neçə aydan sonra bu işə başlamışdır. Müəllif hüquqlarının pozulması halında istənilən şəxsin hüquqlarını pozur.";

$_LANG['domaincustomersay'] = "<b> Müştərilərimiz </b> nə deməkdir?";

$_LANG['domaincustomername'] = "ZAFER TUNCA";

$_LANG['domaincustomername2'] = "ATAKAN OZOLMEZ";

$_LANG['domaincustomername3'] = "TUGCE YILMAZ";

$_LANG['domaincustomername4'] = "ELIF ERDURAN";

$_LANG['domaincustomerdata'] = "Kurucu Ortak, Rixos <br> Medya";

$_LANG['domaincustomerdata2'] = "Proqram meneceri Ontan Group";

$_LANG['domaincustomerdata3'] = "Proqram meneceri <br> Haber 3";

$_LANG['domaincustomerdata4'] = "Venus - Ajans proqram meneceri";

$_LANG['domaincustomereview'] = "WordPress, dünyanın ən məşhur sayt və blog idarə vasitə ilə veb saytınızı və ya blogunuzu yaradın. Istifadə etmək asandır və sizə azadlığı verir ...";



/*cPanel Hosting Page*/

$_LANG['cpanelwebhosting'] = "Ən yaxşı <span> Cpanel </ span> Web Hosting";

$_LANG['cpanelessyinstall'] = "Ekspert İstifadəçilər üçün Orta Dəqiqədə Quraşdırın";

$_LANG['cpanelessyinstalltext'] = "Erkən müəssisədən, biz sizi əhatə etdiniz. 14 gün pulsuz olaraq başlayın. İllik ödəniş sizə iki ay pulsuz gəlir!";

$_LANG['cpanelPricing'] = "Qiymətləndirmə";

$_LANG['cpanelourfeature'] = "Bizim xüsusiyyətimiz";

$_LANG['cpanelwhychoose'] = "Niyə bizi seçir?";

$_LANG['cpanelwhychoosehd'] = "Sadə və şəffaf qiymətlər";

$_LANG['cpanelwhychoosetext'] = "Erkən müəssisədən, biz sizi əhatə etdiniz. 14 gün pulsuz olaraq başlayın. İllik ödəniş iki ay pulsuz qazanır!";

$_LANG['cpanelserverlocation'] = "Server Yerləşmə";

$_LANG['cpanelcountry1'] = "UK";

$_LANG['cpanelrussian'] = "Russian";

$_LANG['cpanelspanish'] = "Spanish";

$_LANG['cpanelsave25'] = "save 25%";

$_LANG['cpanelperfectstart'] = "Online bir varlığı artırmaq üçün mükəmməl başlanğıc nöqtəsi";

$_LANG['cpanelpersonal'] = "Şəxsi";

$_LANG['cpanelpermonth'] = "Aylıq";

$_LANG['productmonthly'] = "Aylıq";

$_LANG['productquarterly'] = "Üç aylıq";

$_LANG['productsemiannually'] = "Yarım il";

$_LANG['productannually'] = "Hər il";

$_LANG['cpanelvat'] = "Bütün qiymətlər ƏDV-ni% 20-də <b> xüsusiyyətləri müqayisə </b> istisna edir";

$_LANG['cpanelovercharge'] = "Yep, çünki Cib telefonu Overage Xərcləri kimi, <br> Bant genişliyi SUCK daha çox!";

$_LANG['cpanelmorefeature'] = "Bizim hosting daha çox xüsusiyyət verir";

$_LANG['cpanelmorefeaturetext'] = "Bir biznesin çəkilməsi çətin ola bilər, belə ki, hər bir domen adı ilə PULSUZ səhmdar şəkillər və PULSUZ e-poçt ilə PULSUZ veb sayt qurucusu təklif etməyə kömək etməkdir.";

$_LANG['cpanelfreename'] = "Pulsuz Domain Name";

$_LANG['cpanelfreenametext'] = "Bütün planlarımız ən azı bir pulsuz .co.uk domenini əhatə edir, buna görə də yeni biznes səhifənizi online əldə etmək üçün lazım olan hər şeyi əldə edir, zaten hosting paketinizin qiymətinə daxildir";

$_LANG['cpanelfreepersonalised'] = "Pulsuz Kişiselleştirilmiş e-poçt";

$_LANG['cpanelfreepersonalisedtext'] = "İşletmenize bir bakış açısı kazandırmak üçün etki alanınızla eşleşen bir e-poçt ünvanı yaradın. Birdən çox tələb olsanız, əlavə poçt qutuları satın almaq çox asandır";

$_LANG['cpanelfreeencreypt'] = "Pulsuz SSL-i şifreləyin";

$_LANG['cpanelfreeencreypttext'] = "Barındırma paketinizin altında idarə olunan bütün saytlar üçün şifrələnmək üçün pulsuz SSL sertifikatı";

$_LANG['cpanelfreebackup'] = "Pulsuz Həftəlik Yedəkləmə";

$_LANG['cpanelfreebackuptext'] = "Hər şey yanlış gedirsə, həmişə veb saytınızın bir nüsxəsini aldığınızdan əmin olun. 5 GB-dan başlayaraq yalnız £ 15 / ildən başlayaraq, £ 375 / il üçün 200GB-a qədər gedən ödəmə müddətində nə qədər məkanı seçin";

$_LANG['cpanelfreemigration'] = "Pulsuz Site Miqrasiya";

$_LANG['cpanelfreemigrationtext'] = "Mütəxəssislər, hər hansı mövcud paylaşılan web hosting hesabını köçürəcək, sorunsuz və pulsuzdir";

$_LANG['cpaneloneclickhosting'] = "One-Click WordPress hosting";

$_LANG['cpaneloneclickhostingtext'] = "WordPress, Joomla, Drupal və 200-dən çox web tətbiqini quraşdırın. Tez quraşdırma və qabaqcıl texniki bilik tələb olunur";

$_LANG['cpanelchallengin'] = "Bir biznesin çəkilməsi çətin ola bilər, belə ki, PULSUZ veb sayt qurucusu təklif etməyə kömək etmək üçün <br> PULSUZ səhm şəkillərinə və hər bir domen adı ilə PULSUZ elektron poçta";

$_LANG['cpanelinfratechno'] = "İnfrastruktur və Texnologiya";

$_LANG['cpanelfreeclickintalls'] = "70+ pulsuz bir klik quraşdırır";

$_LANG['cpanelsslcertificate'] = "SSL Sertifikatı";

$_LANG['cpanelultrahosting'] = "Ultra sürətli bulud hosting";

$_LANG['cpanelcloudsimplicity'] = "Buludun üstünlükləri + Paylaşılan Hostinqin sadəliyi";

$_LANG['cpaneldualprocess'] = "Dual 2.40GHz Xeon İşlemci";

$_LANG['cpanelram'] = "RAM";

$_LANG['cpanelSupport'] = "Support";

$_LANG['cpanelraidos'] = "RAID 1 OS Drive";

$_LANG['cpanelcacheddrive'] = "Cached Customer Drive";

$_LANG['cpanelapache'] = "Apache";

$_LANG['cpanelphpversion'] = "PHP 5.3x, 5.4x, Perl, Python";

$_LANG['cpanelfreednsmanage'] = "Free DNS Management";

$_LANG['cpanelmysql'] = "MySQL";

$_LANG['cpanelrubyrail'] = "Ruby On Rails";

$_LANG['cpanelantiprotect'] = "Anti Spam & Virus Protection";

$_LANG['cpanelsecureftp'] = "Secure FTP Access";

$_LANG['cpanelleechprotect'] = "Hotlink & Leech Protection";

$_LANG['cpanelphpmyadmin'] = "phpMyAdmin Access";

$_LANG['cpanelemailaddress'] = "Online eMail Address Book";

$_LANG['cpanelvarnishcach'] = "Now with Varnish Caching";

$_LANG['cpanelreliablepower'] = "Reliable Power";

$_LANG['cpaneluninterrup'] = "Designed for Uninterrupted <br>Operations";

$_LANG['cpanelnetworksecurity'] = "Network & Security";

$_LANG['cpanelmustability'] = "Maximum Uptime & <br>Stability";

$_LANG['cpanelhvacprotection'] = "HVAC Protection";

$_LANG['cpanelresilience'] = "Bütün səviyyələrdə möhkəmlik və zənginlik";

$_LANG['cpanelinstallapp'] = "populyar tətbiqləri saniyələrlə yükləyin";

$_LANG['cpanelinstallapptext'] = "WordPress, joomla! Və Drupal kimi populyar bolginq və kontent idarəetmə sistemləri daxil olmaqla, 70-dən çox pulsuz bir klik quraşdırmadan seçin; osCommerce, OpenCart və PrestaShop kimi e-ticarət həlləri; phpBB, Open Web Analytics və Moodle daxil olmaqla, digər məşhur proqram adları çox müxtəlif. Bütün bunlar və daha çox bizim Home Pro və Business Pro paketləri ilə standart olaraq mövcuddur";

$_LANG['cpaneloneclickapp'] = "BİRİNCİ TIKLAYINIZ";

$_LANG['cpanelsitesecure'] = "Sitenizi bir ilə təhlükəsiz saxlayın";

$_LANG['cpanelfreessl'] = "pulsuz SSL sertifikatı";

$_LANG['cpanelfreessltext'] = "SSL sertifikatı istifadəçi adları, şifrələr, kredit kartı nömrələri və daha çox məlumatları təhlükəsiz keçə bilən təhlükəsiz bir tunel yaradır";

$_LANG['cpanelgetout'] = "Çıxın";

$_LANG['cpanelyoulove'] = "Suport biz sevəcəyini bilirik";

$_LANG['cpanelyoulovetext'] = "Bizim bilikli dəstək mütəxəssislərimiz getdikdən sağ çıxmağa kömək edirlər. Pulsuz site köçürmələri, dostluq konsyerj köməkçiləri və 24x7 davam edən dəstəyi ilə sizə ehtiyac duyduğunuz zaman sizə lazım olan bütün kömək lazımdır";

$_LANG['cpanelactivebackup'] = "Zənglərin aktivləşdirilməsi üçün zəng edin";

$_LANG['cpaneltext'] = "Mətn";

$_LANG['cpanelchat'] = "Chat";

$_LANG['cpanelphone'] = "Telefon";



/*plesk Hosting Page*/

$_LANG['pleskbannerhead'] = "<span> Plesk </span> ilə Web Hosting";

$_LANG['pleskbannertext'] = "HostCluster, web sitenizle ilgili bütün ihtiyaçlarınızı halledebileceğiniz bir yönetilen WordPress barındırma sağlayıcısıdır. Xidmətlərimizi ən qabaqcıl texnologiyaya yönəldirik və ciddi şəkildə dəstəkləyirik";

$_LANG['pleskeasysetup'] = "Asan Quraşdırma Təqdimatı Orta İstifadəçilərə";



/*Window Hosting Page*/

$_LANG['windowbannerhead'] = "<span> Pencere </span> Hosting";

$_LANG['windowbannertext'] = "HostCluster, web sitenizle ilgili bütün ihtiyaçlarınızı halledebileceğiniz bir yönetilen WordPress barındırma sağlayıcısıdır. Xidmətlərimizi ən qabaqcıl texnologiyaya yönəldirik və ciddi şəkildə dəstəkləyirik";

$_LANG['windoweasysetup'] = "Asan Quraşdırma Təqdimatı Orta İstifadəçilərə";



/*Wordpress Hosting Page*/

$_LANG['wordpressbannerhead'] = "Ucuzdur <span> Wordpress </span> Hosting";

$_LANG['wordpressopensource'] = "Açıq mənbə CMS";

$_LANG['wordpressbannertext'] = "HostCluster, web sitenizle ilgili bütün ihtiyaçlarınızı halledebileceğiniz bir yönetilen WordPress barındırma sağlayıcısıdır. Xidmətlərimizi ən qabaqcıl texnologiyaya yönəldirik və ciddi şəkildə dəstəkləyirik";



/*VPS Hosting Page*/

$_LANG['vpsbannerhead'] = "Yüksək performanslı VPS münasib qiymətə bir performans / qiymət nisbəti, SSD sürücüləri, KVM OpenStack";

$_LANG['vpsbannertext'] = "Xüsusi əlaqələr idarəçiliyi (CRM) vasitəsi qurulması üçün nəzərdə tutulmuş yüksək performanslı peşəkar serverlər";

$_LANG['vpslivesupport'] = "HƏYATA 24/7 CANLI DƏSTƏK";

$_LANG['vpsuptimeguarantee'] = "99,9% UPTIME GARANTİ";

$_LANG['vpsriskfree'] = "30 GÜN RİSKİ PULSUZ TƏLƏB EDİN!";

$_LANG['vpstransparentprice'] = "Sadə və şəffaf qiymətlər";

$_LANG['vpstransparentpricetext'] = "Erkən müəssisədən, biz sizi əhatə etdiniz. 14 gün pulsuz olaraq başlayın. İllik ödəniş iki ay pulsuz qazanır!";

$_LANG['vpschoosehosting'] = "Niyə VPS Hosting Seçin";

$_LANG['vpsfullaccess'] = "FULL KÖK ACCESS";

$_LANG['vpsfullaccesstext'] = "Virtual serverlər hər hansı bir məhdudiyyət olmadan xüsusi proqram yükləmək imkanı ilə yanaşı administratorun barındırma mühitinizə daxil olmasına imkan verən tam kök girişi ilə gəlir. Bundan əlavə, Server İdarəetmə Paneli sizi Start, Stop, Rebuild və daha çox kimi tədbirlər ilə serverin tam nəzarətini təmin edir";

$_LANG['vpsintegratedcpanel'] = "INTEGRATED CPANEL";

$_LANG['vpsintegratedcpaneltext'] = "Sizin VPS (virtual fərdi server) planı əvvəlcədən quraşdırılmış cPanel ilə gəlir, bu da sizin hosting mühitinizi səmərəli idarə etməyə kömək edir.";

$_LANG['vpsintegratedcpaneltext2'] = "CPanel-də Softaculous avtomatik yükləyicisinin köməyi ilə WordPress, Joomla, Drupal, Magento və daha bir neçə dəqiqə ərzində yükləyə bilərsiniz.";

$_LANG['vpsinstantprovision'] = "YARANIN ƏN YAXŞI TƏHLÜKƏSİZLİK";

$_LANG['vpsinstantprovisiontext'] = "Sizin VPS (virtual fərdi server) planı əvvəlcədən quraşdırılmış cPanel ilə gəlir, bu da sizin hosting mühitinizi səmərəli idarə etməyə kömək edir";

$_LANG['vpsinstantprovisiontext2'] = "Bəzi xidmət təminatçıları serverinizi gündəmə gətirməyə və işləməyə davam edirlər. VPS serverlərimiz bir neçə dəqiqə ərzində təmin olunacaq! <br> Hindistanda bir çox VPS xidmət təminatçısının xidmətindən fərqli olaraq, hər hansı quraşdırma haqqını ödəmirik";

$_LANG['vpssearchvps'] = "Hələ də <b> ən yaxşı VPS serverini axtarın? </b> <br> Linux buludla gedin";

$_LANG['vpsfastsimple'] = "FAST & SIMPLE";

$_LANG['vpsfastsimpletext'] = "Bu VPS üçün Cloud texnologiyası aktivləşdirildikdə, serverləriniz artan rahatlıq və nəzarəti təmin edir";

$_LANG['vpseasypanel'] = "EASY NƏZARƏT PANELİ";

$_LANG['vpseasypaneltext'] = "Sizin KVM VPS veb-saytı idarə etmək üçün cPanel, e-poçt və DNS kimi əlaqəli xidmətləri təqdim edir";

$_LANG['vpsawardwinsupport'] = "AWARD WINNING DƏSTƏK";

$_LANG['vpsawardwinsupporttext'] = "Biz sizin üçün hər hansı bir sualınızla kömək etmək üçün 24/7/365 telefonunuz, LiveChat və E-poçt vasitəsilə sizin üçün buradayız";

$_LANG['vpsedgehardware'] = "KESİM DİSTRİKSİYASI";

$_LANG['vpsedgehardwaretext'] = "Bütün əsas fiziki serverlərimiz son prosessorlar və RAM ilə təchiz olunmuşdur";

$_LANG['vpsprivateserver'] = "PRIVATE MANAGEMENT SERVER";

$_LANG['vpsprivateservertext'] = "Bulud VPS serverlərinizlə hosting istədiyinizi demək olar ki, hər şey yarada bilər";

$_LANG['vpshighcloudserver'] = "HIGH END CLOUD SERVER";

$_LANG['vpshighcloudservertext'] = "Cloud-based infrastrukturumuz, yüksək səviyyəli virtual serverlərimizlə birlikdə, veb-saytınızın hər hansı bir sualına cavabdır";

$_LANG['vpsguarantee'] = "RISK-FREE TƏLƏB PROQRAMI. 30-GÜN NO-RİSK GARANTİ";

$_LANG['vpsguaranteetext'] = "30 gündür tamamilə risksiz olduğumuz üçün cəhd edin! Siz tamamilə risksiz zəmanət proqramımızla qorunuruq. Hər hansı bir şəkildə hesabınızı növbəti 30 gün ərzində ləğv etmək qərarına gəlsəniz, ani geri qaytarılacaqsınız, heç bir sual sorulmayacaq";

$_LANG['vpstechnicalspeci'] = "Texniki şərtlər";

$_LANG['vpsguaranteeresour'] = "Zəmanətli Sərvətlər";

$_LANG['vpsguaranteeresourtext'] = "Bizim Linux KVM VPS bazlı hipervizor texnologiyası ardıcıl top-notch performansını təmin edir və serverinizin qaynaqları * işiniz genişləndikcə ölçülür";

$_LANG['vpssecureenvironment'] = "Təhlükəsiz Ətraf";

$_LANG['vpssecureenvironmenttext'] = "Hypervisor əsasında virtualizasiya bir VPS mühitində daha yaxşı izolyasiya və təhlükəsizlik gətirir";

$_LANG['vpsedgeserverhard'] = "Edge Server Donanımını Kesme";

$_LANG['vpsedgeserverhardtext'] = "Sunucunuzun ayrılmaz hissələrindən biri disk oxumaq / yazır, buna görə də, Solid State Drives ilə serverlərimizi qurduq *";

$_LANG['vpstopnetwork'] = "Xəttin şəbəkəsinin yuxarı hissəsi";

$_LANG['vpstopnetworktext'] = "Bizim şəbəkəmiz, yüksək sabitliyi təmin etmək üçün birdən çox tanınmış ISP-lərlə işlənmişdir, heç bir əlavə dəyərdə inteqrasiya edilmiş DDoS qorunması ilə birbaşa uğursuzluq nöqtəsini aradan qaldırmışdır!";

$_LANG['vpsaskque'] = "SORULAN SORULAR VERƏCƏ VERİR!";



/*VPS Private Page*/

$_LANG['vpspcbannerhead'] = "VPS <span> Şəxsi Cloud </span>";

$_LANG['vpspcbannerhead2'] = "Buludun mövcudluğu ilə bir VPS-nin performansını gətirir";

$_LANG['vpspcbannertext'] = "Xüsusi əlaqələr idarəçiliyi (CRM) vasitəsi qurulması üçün nəzərdə tutulmuş yüksək performanslı peşəkar serverlər";



$_LANG['vpsplcbannerhead'] = "VPS <span> İctimai Bulud </span>";

$_LANG['vpsplcbannerhead2'] = "Buludun mövcudluğu ilə bir VPS-nin performansını gətirir";

$_LANG['vpsplcbannertext'] = "Xüsusi əlaqələr idarəçiliyi (CRM) vasitəsi qurulması üçün nəzərdə tutulmuş yüksək performanslı peşəkar serverlər.";



$_LANG['dedicatedgmbannerhd'] = "<span> Oyun </span> Servers";

$_LANG['dedicatedgmbannerhd2'] = "Onlayn oyun üçün ən yaxşı performans";

$_LANG['dedicatedgmbannertext'] = "Oyunumuz xüsusi server diapazonu, xüsusi olaraq səsli chat proqramları kimi əlaqədar proqramlara ev sahibliyi etmək üçün nəzərdə tutulmuş oyun serverləri təklif edir. OVH-nin xüsusi serverləri ilə, oyunçuların performans və sabitlik baxımından heç bir məhdudiyyət olmadan sevimli online oyunlar oynaya bilər.";



$_LANG['dedicatedepbannerhd'] = "<span> Enterprise </ span> Servers";

$_LANG['dedicatedepbannerhd2'] = "Layihələriniz üçün yüksək hesablama gücü";

$_LANG['dedicatedepbannertext'] = "Yüksək performanslı peşəkar serverlər, xüsusilə müəssisələr üçün nəzərdə tutulmuşdur. Çox məqsədli bir həll olaraq, onlar geniş tələblərə cavab verirlər: kompleks biznes applications, virtual maşın quraşdırma və hətta müştəri əlaqələri idarə edilməsi (CRM) alət qurma.";



$_LANG['dedicateddfbannerhd'] = "Developer <span> Dostluq </span>";

$_LANG['dedicateddfbannerhd2'] = "Onlayn oyun üçün ən yaxşı performans";

$_LANG['dedicateddfbannertext'] = "Oyunumuz xüsusi server diapazonu, xüsusi olaraq səsli chat proqramları kimi əlaqədar proqramlara ev sahibliyi etmək üçün nəzərdə tutulmuş oyun serverləri təklif edir. OVH-nin xüsusi serverləri ilə, oyunçuların performans və sabitlik baxımından heç bir məhdudiyyət olmadan sevimli online oyunlar oynaya bilər.";





/*Dedicated Server Page*/

$_LANG['dedicatedbannerhead'] = "<span> Hosting </ span> Sunucular";

$_LANG['dedicatedbannerhead2'] = "Etibarlı serverlər online mağazalara ev sahibliyi edəcək, vitrinləri veb";

$_LANG['dedicatedbannerheadtext'] = "Web serverlərin tam bir sıra kəşf edin. Dedicated serverlər, paylaşılan barındırma kifayət etmədikdə layihələrinizi yerləşdirmək üçün mükəmməl bir həlldir. Özəl serverinizi idarə etmək üçün tam azadlıq onu öz ehtiyaclarınıza uyğunlaşdırmağa imkan verir";

$_LANG['dedicatedserver'] = "Bizim Dedicated Servers";

$_LANG['dedicatedservertext'] = "Dedicated Servers ilə veb saytınızı daha sürətli artırın. <br> Gereksinimlerinize uyğun bir plan seçin.";

$_LANG['dedicatedfeature'] = "Bütün xüsusiyyətləri daxil edin";

$_LANG['dedicatedfeaturetext'] = "Wordwide infrastrukturu, yenilikçi cloud computing və mütəxəssis təcrübəsi";

$_LANG['dedicatedddosprotect'] = "DDOS qorunması";

$_LANG['dedicatedddosprotecttext'] = "Bizim serverlərimiz və infrastrukturumuz xidmətlərə qarşı atılan hücumların (DDoS) inkar edilməsinə qarşı qorunur.";

$_LANG['dedicatedrpn'] = "RPN";

$_LANG['dedicatedrpntext'] = "RPN İnternet şəbəkə interfeysindən ayrılmış və fiziki olaraq ayrılmış xüsusi bir şəbəkə funksiyasıdır.";

$_LANG['dedicatedvmware'] = "VMWare Ready ®";

$_LANG['dedicatedvmwaretext'] = "Bizim Dedibox® serverlərimiz VMWare Ready® sertifikatlaşdırılmışdır.";

$_LANG['dedicatedkvmip'] = "IP üzərində KVM";

$_LANG['dedicatedkvmiptext'] = "Demək olar ki, bütün Dedibox ® standart olaraq IP və uzaq virtual media üzərində hardware KVM ilə gəlir.";

$_LANG['dedicatedraid'] = "RAID";

$_LANG['dedicatedraidtext'] = "Dedibox serverlərinin əksəriyyəti etibarlılıq və performans təmin edən RAID-ni dəstəkləyir.";

$_LANG['dedicatesupport'] = "Kömək 24/7";

$_LANG['dedicatesupporttext'] = "Texniki yardımımız həftədə 7 gün 24 saat, bilet və telefon, Fransız, ingilis və alman dilində mövcuddur.";

$_LANG['dedicatecertifiedcenter'] = "Sertifikatlaşdırılmış Datacenter";

$_LANG['dedicatecertifiedcentertext'] = "Sizin infrastrukturunuzun dayanıqlığına dair heç bir kompromisə yol verməyin.";

$_LANG['dedicatedpremiumnetwork'] = "Premium şəbəkə";

$_LANG['dedicatedpremiumnetworktext'] = "Biz sadə, ultra sürətli və etibarlı şəbəkə fəaliyyət göstərir. AS12876 şəbəkəmiz çoxsaylı tranzit və mübadilə nöqtələri ilə böyük imkanlara malikdir.";

$_LANG['dedicatedmonitroing'] = "Managment & Monitroing";

$_LANG['dedicatedlicence'] = "Lisenziya və Proqram təminatı";

$_LANG['dedicatedos'] = "Mövcud Əməliyyat sistemi";

$_LANG['dedicatedostext'] = "Müasir alətlər, incə rəngli nəzarət və yenilənmiş həyat sayəsində, istifadəçilərimizə xüsusi serverlər və linux xüsusi serverlər üçün Windows üçün ən son təklif təklif edirik";

$_LANG['dedicatedcentos'] = "Centos";

$_LANG['dedicatedubuntu'] = "Ubuntu";

$_LANG['dedicatedcloudlinux'] = "Cloudlinux";

$_LANG['dedicatedfedora'] = "Fedora";

$_LANG['dedicateddebian'] = "Debian";

$_LANG['dedicatedcpanel'] = "cPanel";

$_LANG['dedicatedplesk'] = "Plesk";

$_LANG['dedicatedwindows'] = "Windows";

$_LANG['dedicatedpricing'] = "Pricing";

$_LANG['dedicatedfree'] = "Free";

$_LANG['dedicatedwebpro'] = "WebPro";

$_LANG['dedicatedwhychoose'] = "Niyə bizi seçir?";

$_LANG['dedicatedwhychoosetext'] = "Wordwide infrastrukturu, yenilikçi cloud computing və mütəxəssis təcrübəsi";

$_LANG['dedicatedsolutions'] = "Çözümler";

$_LANG['dedicatedsolutionstext'] = "Bizim xüsusi serverlərimiz Dell, HP və Supermicro kimi qabaqcıl oyunçuların yüksək keyfiyyətli, korporativ dərəcəli donanımı ilə təchiz edilmişdir. Sürət və misilsiz performans üçün tikilmişdir.";

$_LANG['dedicatedspeed'] = "sürət";

$_LANG['dedicatedspeedtext'] = "Sunucularımız, üstün sürət təmin etmək üçün qurulub və hətta ən tələbkar web server tətbiqlərinin heç bir problem olmadan düzgün çalışmasını təmin edir.";

$_LANG['dedicatedsupport'] = "DƏSTƏK";

$_LANG['dedicatedsupporttext'] = "Bizim komanda proqram təminatı və hardware ilə bağlı problemlərdə İT mütəxəssislərindən ibarətdir və bu dünya səviyyəsində birinci sinifdə dəstək keyfiyyətimizi saxlayır.";

$_LANG['dedicateduptime'] = "UPTIME GARANTİ";

$_LANG['dedicateduptimetext'] = "Biz ən yüksək şəbəkə uptime zəmanət (99.95%) birini təqdim etməkdən qürur duyuruq. Veb saytınız həmişə işləyəcək və işləyəcəkdir.";

$_LANG['dedicatedaskques'] = "ÇOX SORULAN";

$_LANG['dedicatedaskquesans'] = "SORU & CAVABLAR!";

$_LANG['dedicateserver'] = "Dedicated Server";

$_LANG['dedicateservertext'] = "Sunucunuzu birbaşa kirayəyə götürmək həm praktik, həm də əlverişli deyil. Proqramın hər hansı bir qurğusu serverin məzmununu dəyişdiyimizdə pozarsızdır.";

$_LANG['dedicateserv'] = "SERV. 1";

$_LANG['dedicatedintel'] = "Intel Xeon <span> 1 Karna";

$_LANG['dedicatedram'] = "RAM";

$_LANG['dedicatedmbit'] = "Mbit/s";

$_LANG['dedicatedgstart'] = "BAŞLAMAQ";

$_LANG['dedicatedpackage'] = "Bilmək və ya fərqli paketləri istəyirsiniz?";

$_LANG['dedicatedpackage2'] = "Daha çox məlumat əldə edin və bütün paketləri baxın";



/*Banner Page*/

$_LANG['bannerhead'] = "SİZİN SİTE İSTİFADƏ OLUNUR";

$_LANG['bannerhead2'] = "HEDİYƏ";

$_LANG['bannerheadtext'] = "Veb sayta özünə həsr olunmuş server ilə zirvə potensialında fəaliyyət göstərmək üçün lazım olan resursları verin. Tez web serverlər köklərə çıxış və 100% Uptime Zəmanəti ilə ərizələrinizi idarə etmək üçün.";

$_LANG['bannervpshead'] = "VPS Hosting";

$_LANG['bannervpshead2'] = "Lazım olan performansı qazanmaq üçün dəqiqə qurun.";

$_LANG['bannervpsheadtext'] = "Biz hər bir müştəriyə tam funksional bir paylaşıma ehtiyac duyduqları vasitələrlə təmin edirik.";



$_LANG['banner4head'] = "<span> BÜYÜK YAZ SATIŞ </span> <br> Yalnızca £ 1.00 / aydan Paylaşılan Hostinq *";

$_LANG['banner4truebussnes'] = "İngilis biznesinin 20 ildir güvəndiyi";

$_LANG['banner4webspace'] = "Limitsiz Veb Space";

$_LANG['banner4freedomain'] = "Pulsuz Domain";

$_LANG['banner4ub'] = "Limitsiz Bandwidth";





// language variable for navigation bar

$_LANG['clientAreaNavCustomHome'] = "Ev";

$_LANG['clientAreaNavCustomMyServices'] = "Xidmətlərim";

$_LANG['clientAreaNavCustomMyAccount'] = "Mənim Hesabım";

$_LANG['clientAreaNavCustomShopingCart'] = "Alış-veriş kartı";

$_LANG['findyour'] = "Sizin tapın";
$_LANG['mymessages'] = "Mənim Mesajlarım";
$_LANG['welcometo'] = "xoş gəlmisiniz";
$_LANG['newdomain'] = "Yeni Domain";
$_LANG['choosemoreproduct'] = "Daha çox məhsul seçin";

// language variable for home page domain block
$_LANG['domainBlockFindDomain'] = "Sizin üçün ən yaxşı domain tapın";
$_LANG['domainBlockPlaceHolder'] = "Burada domen adınızı daxil edin";
$_LANG['domainBlockTldCom'] = "ilə";
$_LANG['domainBlockTldCo'] = "co";
$_LANG['domainBlockTldNet'] = "net";
$_LANG['domainBlockTldInfo'] = "info";

// language variable for manage ssl page
$_LANG['manageSslDomain'] = "Domain";
$_LANG['manageSslProduct'] = "SSL Məhsulu";
$_LANG['manageSslOrderDate'] = "Sifariş tarixi";
$_LANG['manageSslRenewDate'] = "Yeniləmə tarixi";
$_LANG['manageSslAction'] = "Tədbirlər";
/*** V1.0.6 ******/
$_LANG['dedicatetabcontentantiddosc'] = "Anti-DDoS protection";
$_LANG['dedicatetabcontentantiddoshead'] = "infrastructures protected against DDoS attacks";
$_LANG['dedicatetabcontentantiddos'] = "All of our dedicated servers come with the powerful GNOME anti-DDoS protection. It absorbs distributed denial-of-service attacks, and ensures that your services are always available. Anti-DDoS protection is included with all of our servers";
$_LANG['antiddosprotection'] = "Keep your dedicated infrastructures protected against DDoS attacks.<br>GNOME offers the most 
powerful anti-DDoS solution on the market<br>It provides your services with round-the-clock protection against all types of DDoS attack, 
without any limitations in terms of volume or duration.";

/* for v2.2.0 */
$_LANG['contactuspagemainhead'] = "Bizimlə əlaqə saxlayın";
$_LANG['contactuspagemainsubhead'] = "Daha ətraflı məlumat üçün";
$_LANG['contactuscompanyname'] = "Şirkət Adı Hostx Pvt Ltd.";
$_LANG['contactusaddress'] = "abcdd, Mərhələ 123, IND sahəsi <br> Otelin yaxınlığında, <br> XYZ, XYZ, XYZ 123456";
$_LANG['contactushotlinesale'] = "<b> Qaynar xətt: </b> +91 8360944358";
$_LANG['contactusbusinesshoursale'] = "<b> Xidmət </b> Saatları: 9:00 - 18:00 (Bazar - Şən)";
$_LANG['contactusemailssale'] = "<b> E-poçt: </b> info@gmail.com";
$_LANG['contactushotlinecustomer'] = "<b> Qaynar xətt: </b> +91 8360944358";
$_LANG['contactusbusinesshourcustomer'] = "<b> Xidmət </b> Saatları: 9:00 - 18:00 (Bazar - Şən)";
$_LANG['contactusemailscustomer'] = "<b> E-poçt: </b> info@gmail.com";
$_LANG['contactushotlinetechnical'] = "<b> Qaynar xətt: </b> +91 8360944358";
$_LANG['contactusbusinesshourtechnical'] = "<b> Xidmət </b> Saatları: 9:00 - 18:00 (Bazar - Şən)";
$_LANG['contactusemailstechnical'] = "<b> E-poçt: </b> info@gmail.com";
$_LANG['contactusemailssaleticket'] = "Satış bileti";
$_LANG['contactusemailscustomerticket'] = "Müştəri Xidmətləri Bileti";
$_LANG['contactusemailstechnicalticket'] = "Texniki Dəstək Bileti";
$_LANG['contactuslivechat'] = "Canlı Chat";
$_LANG['contactussalemain'] = "Satış";
$_LANG['contactuscustomerservicemain'] = "Müştəri xidməti";
$_LANG['contactustechnicalmain'] = "Texniki Dəstək (24/7)";
$_LANG['contactussaleenquery'] = "Satışa dəstək sorğusu:";
$_LANG['contactuscustomerenquery'] = "Müştəri Xidmətlərinə Dəstək Sorğu:";
$_LANG['contactustechenquery'] = "Texniki dəstək sorğusu: yoxlayın";
$_LANG['contactushotlinesale1'] = "<b> Qaynar xətt: </b>";
$_LANG['contactushotlinecustomer1'] = "<b> Qaynar xətt: </b>";
$_LANG['contactushotlinetechnical1'] = "<b> Qaynar xətt: </b>";

$_LANG['activedomiantitle'] = "Aktiv Domenlər";
$_LANG['activedomiandesc'] = "Yeni bir domen əldə edin və ya mövcud qeydiyyatdan keçmiş domenlərin vəziyyətini nəzərdən keçirin.";
$_LANG['opentickettitle'] = "Açıq biletlər";
$_LANG['openticketdesc'] = "Yeni biletləri qaldırın və ya mövcud biletlərin detallarını və vəziyyətini yoxlayın.";
$_LANG['unpaidinvoicetitle'] = "Ödənilməmiş fakturalar";
$_LANG['unpaidinvoicedesc'] = "Fakturaların vəziyyətini və gözləyən fakturaların təfərrüatlarını yoxlayın.";
$_LANG['activeservicetitle'] = "Aktiv xidmətlər";
$_LANG['activeservicedesc'] = "Əlavə alın və ya bu hesaba təyin edilmiş mövcud xidmətləri nəzərdən keçirin.";
$_LANG['addnewproducttitle'] = "Səbətinizə yeni məhsullar əlavə edin və ya alış-verişə davam edəcəkləri gözləyin.";
$_LANG['mydomaintitle'] = "Mənim Domenlərim";
$_LANG['registernewdomain'] = "Yeni Domain Qeydiyyatdan Keçin";
$_LANG['myaffilates'] = "İştirakçılarım";
$_LANG['mydashboard'] = "İdarə paneli";
$_LANG['myquotes'] = "Qiymətlərim";
$_LANG['activquotes'] = "Aktiv Sitatlar";
$_LANG['myquotesdescp'] = "Mövcud xidmətlərin ətraflı məlumatları ilə qiymətlərinizi yoxlayın.";
$_LANG['mytickets'] = "Biletlərim";
$_LANG['affilatedescription'] = "Defolt WHMCS BY öz filial bağlantısını təqdim etdi. Hansı ki, sizinlə bölüşmək lazımdır
dostlar və ya ailə üzvü. Həmin əlaqə bağlantısından istifadə edərək veb saytınıza gələcəklərsə, onda WHMCS özünü idarə edir.";
$_LANG['dedicatedSideBarRegions'] = "Bütün Bölgələr";
$_LANG['dedicatedSideBarRegionsMenu'] = "Bütün Bölgələr";
$_LANG['dedicatedSideBarServices'] = "XİDMƏTLƏR";
$_LANG['dedicatedSideBarPriceRange'] = "Qiymət içindədir";
$_LANG['dedicatedSideBarRam'] = "ram:";
$_LANG['dedicatedSideBarDisk'] = "Disklər:";
/* for v2.2.0 */
$_LANG['activedomiantitle'] = "Aktiv Domenlər";
$_LANG['activedomiandesc'] = "Yeni bir domen əldə edin və ya mövcud qeyd edilmiş domenlərin vəziyyətini nəzərdən keçirin.";
$_LANG['opentickettitle'] = "Biletləri açın";
$_LANG['openticketdesc'] = "Yeni biletləri qaldırın və ya mövcud biletlərin məlumatlarını və vəziyyətini yoxlayın.";
$_LANG['unpaidinvoicetitle'] = "Ödənilməmiş Faturalar";
$_LANG['unpaidinvoicedesc'] = "Fakturaların vəziyyətini və gözləyən fakturaların təfərrüatlarını yoxlayın.";
$_LANG['activeservicetitle'] = "Aktiv xidmətlər";
$_LANG['activeservicedesc'] = "Bu hesaba təyin edilmiş əlavə xidmətləri satın alın və ya mövcud xidmətləri nəzərdən keçirin.";
$_LANG['addnewproducttitle'] = "Səbətinizə yeni məhsullar əlavə edin və ya alış-verişə davam etməyi gözləyənləri yoxlayın.";
$_LANG['mydomaintitle'] = "Mənim Domenlərim";
$_LANG['registernewdomain'] = "Yeni Domeni qeydiyyatdan keçirin";
$_LANG['myaffilates'] = "Mənim tərəfdaşlarım";
$_LANG['mydashboard'] = "İdarə paneli";
$_LANG['myquotes'] = "Mənim Sitatlar";
$_LANG['activquotes'] = "Aktiv Sitatlar";
$_LANG['myquotesdescp'] = "Mövcud xidmətlərin ətraflı məlumatları ilə kotirovkalarınızı yoxlayın.";
$_LANG['mytickets'] = "Mənim biletlərim";
$_LANG['affilatedescription'] = "Varsayılan WHMCS tərəfindən öz tərəfdaşlığı bağlantısı təmin edilmişdir. Hansı ki, dostlarınız və ya ailə üzvlərinizlə bölüşməlisiniz. Veb saytınıza bu tərəfdaşlıq bağlantısını istifadə edərək gəldikdə, WHMCS onu özü idarə edir.";
$_LANG['dedicatedSideBarRegions'] = "Bütün bölgələr";
$_LANG['dedicatedSideBarRegionsMenu'] = "Bütün bölgələr";
$_LANG['dedicatedSideBarServices'] = "XİDMƏTLƏR";
$_LANG['dedicatedSideBarPriceRange'] = "Qiymət";
$_LANG['dedicatedSideBarRam'] = "ram:";
$_LANG['dedicatedSideBarDisk'] = "Disklər:";
$_LANG['dedicatetabcontent'] = "Ultra sürətli bulud yerləşdirmə";
$_LANG['dedicatetabcontentsimplicity'] = "Buludun üstünlükləri + Paylaşılan Hostinqin sadəliyi";
$_LANG['primarySideBarText'] = "İbtidai";
$_LANG['secondarySideBarText'] = "İkincisi";
$_LANG['domainAlreadyExist'] = "Domain Onsuz da səbətdə başqası ilə cəhd edin.";
$_LANG['domainTldPreffer'] = "Tercih olunan tld mövcud deyil.";
$_LANG['fullDomainPricingTxt'] = "Tam domen qiymətləri";
$_LANG['promotionPriceTxt'] = "* Promosyon qiymətləri yalnız 1-ci il üçün tətbiq olunur";
$_LANG['domainNoHiddenFee'] = "Gizli ödəniş yoxdur!";
$_LANG['domain24Seven'] = "7/24 dəstək";
$_LANG['domainFreeDnsHost'] = "PULSUZ DNS Hosting";
$_LANG['domainFreeUrlForward'] = "PULSUZ URL yönləndirmə";
$_LANG['domainFreeEmailForward'] = "PULSUZ E-poçt yönləndirməsi";
$_LANG['domainFindOutMore'] = "Daha çox məhsula baxın";
$_LANG['fullReview'] = "Baxış-icmal";
/* for v2.2.2 */
$_LANG['deliver_in'] = "Çatdırılır:";
$_LANG['configure_btn'] = "Konfiqurasiya edin";
$_LANG['result_found'] = "Nəticələr tapıldı";
$_LANG['dedicated_cpu'] = "CPU";
$_LANG['dedicated_ram'] = "Ram";
$_LANG['dedicated_disk'] = "Disklər";
