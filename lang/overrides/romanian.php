<?php

if (!defined("WHMCS"))
    die("This file cannot be accessed directly");
/* Header Variables */
$_LANG = json_decode('{
  "aboutPageTitle": "Despre noi",
  "aboutPageGetStartButton": "Începeți acum",
  "aboutPageFooterTagLine": "Alegeți cea mai bună experiență <b> Cloud Hosting </b> pentru afacerea dvs.!",
  "aboutPageSubTitle": "Etiam condimentum metus rhoncus pharetra tempor.",
  "aboutPageSubTitleP": "Cele mai recente actualizări Google Chrome afișează acum vizitatorilor un mesaj \"Nesigur\" în adresa URL dacă site-ul dvs. nu este https (adică nu există certificat SSL).",
  "aboutPageOurStoryTitle": "<span> Loream </span> consecvent în procesul de adunare a elitei. labore et dolore magna aliqua, Ut enim. quis exercițiu ullamco și gazdă cillum dolore eu fugiat.",
  "aboutPageOurStorySee": "<span> Vedeți povestea noastră </span>",
  "aboutPageOurStorySeeP": "Este un fapt dovedit de multă vreme că un cititor va fi distras de conținutul lizibil al unei pagini atunci când se uită la aspectul său. Punctul de folosire a Lorem Ipsum este acela că are mai mult sau mai puțin normal",
  "aboutPageMeetUs": "Despre metus rhoncus pharetra",
  "aboutPageMeetUsP": "Lorem Ipsum este pur și simplu textul fals al tipăririi și tipăririi și al industriei. Lorem Ipsum a fost standardul <span> de tip text al industriei încă din anii 1500, când o imprimantă necunoscută a luat o bucătărie de tip și a amestecat-o pentru a face o carte de specimene de tip. </Span>",
  "aboutPageMeetUsLi1": "Suspendisse în plin placerat, porta velit eu, luctus felis.",
  "aboutPageMeetUsLi2": "Nunc eu odio mollis, dictum lectus ac, luctus neque.",
  "aboutPageMeetUsLi3": "Praesent moleculă lectus eu porttitor pharetra.",
  "aboutPagewhychoose": "De ce să ne alegeți",
  "aboutPagewhychooseP": "Redefinirea interactivă a serviciilor sănătoase din punct de vedere economic, în timp ce",
  "aboutPagewhychoose1": "Calitate & Fiabilitate",
  "aboutPagewhychoose2": "Începeți prin achiziționarea certificatului SSL potrivit pentru nevoile dvs. Alegeți dintre cele trei tipuri de gazdă și de web listate.",
  "aboutPagewhychoose3": "Suport 24/7",
  "aboutPagewhychoose4": "Începeți prin achiziționarea certificatului SSL potrivit pentru nevoile dvs. Alegeți dintre cele trei tipuri de gazdă și de web listate.",
  "aboutPagewhychoose5": "Garanție 20 de zile",
  "aboutPagewhychoose6": "Începeți prin achiziționarea certificatului SSL potrivit pentru nevoile dvs. Alegeți dintre cele trei tipuri de gazdă și de web listate.",
  "aboutPageWeTakeCareHead": "Ne ocupăm de Upgradări, <span> Întreținere </span> și <span> Securitate </span>",
  "aboutPageWeTakeCareHeadP": "Cele mai recente actualizări Google Chrome afișează acum mesajul securizat în adresa URL dacă site-ul dvs. nu este https (adică nu există certificat SSL). Dacă nu este sigur, vizitatorii sunt mai predispuși să introducă informații, să facă achiziții sau chiar să semneze. <Span> Google va clasifica, de asemenea, site-urile web fără un certificat SSL mai mic pe pagina cu rezultatele căutării (SERP) trafic și venituri în același timp. </span>",
  "aboutPageAwardWiningHead": "Câștigată <span> 24/7 suport </span>",
  "aboutPageAwardWiningHeadP": "Cele mai recente actualizări Google Chrome afișează acum mesajul securizat în adresa URL dacă site-ul dvs. nu este https (adică nu există certificat SSL). Dacă nu este sigur, vizitatorii sunt mai predispuși să introducă informații, să facă achiziții sau chiar să semneze. <Span> Google va clasifica, de asemenea, site-urile web fără un certificat SSL mai mic pe pagina cu rezultatele căutării (SERP) trafic și venituri în același timp. </span>",
  "aboutPageAwardWiningHeadLi1": "Suspendisse în plin placerat, porta velit eu, luctus felis.",
  "aboutPageAwardWiningHeadLi2": "Nunc eu odio mollis, dictum lectus ac, luctus neque.",
  "aboutPageAwardWiningHeadLi3": "Praesent moleculă lectus eu porttitor pharetra.",
  "aboutPageWebsiteRateHead": "Evaluarea site-ului web gazdă",
  "aboutPageWebsiteRateNumber": "4.5",
  "aboutPageWebsiteRateReview": "Bazat pe 200 de recenzii în 28 lanuage",
  "aboutPageTeamHead": "În spatele fiecărui serviciu excelent, <span> Oameni buni </span>",
  "aboutPageTeamHeadMember1Name": "John Packet",
  "aboutPageTeamHeadMember1Position": "CEO & CO Fondator",
  "aboutPageTeamHeadMember2Name": "Mike Schillig",
  "aboutPageTeamHeadMember2Position": "Dezvoltatorul capului",
  "aboutPageTeamHeadMember3Name": "Lizy Dabars",
  "aboutPageTeamHeadMember3Position": "Administrator",
  "aboutPageTeamHeadMember4Name": "Ann Lecar",
  "aboutPageTeamHeadMember4Position": "CEO",
  "aboutPageTeamHeadMember5Name": "John Packet",
  "aboutPageTeamHeadMember5Position": "CEO & CO Fondator",
  "aboutPageTeamHeadMember6Name": "Mike Schillig",
  "aboutPageTeamHeadMember6Position": "Dezvoltatorul capului",
  "aboutPageTeamHeadMember7Name": "Lizy Dabars",
  "aboutPageTeamHeadMember7Position": "Administrator",
  "aboutPageTeamHeadMember8Name": "Ann Lecar",
  "aboutPageTeamHeadMember8Position": "CEO",
  "aboutPageFaqHead": "Întrebări frecvente <span> Întrebări </span>",
  "aboutPageFaqAccord1Head": "Ce este un certificat SSL?",
  "aboutPageFaqAccord1Body": "Animale de pariaturi cliche reprehenderit, enim eiusmod mare de viață accusamus terry richardson calmar ad.",
  "aboutPageFaqAccord2Head": "Care este beneficiul SSL?",
  "aboutPageFaqAccord2Body": "Da, toate site-urile create cu ajutorul site-ului Weebly sunt optimizate pentru mobil.",
  "aboutPageFaqAccord3Head": "SSL funcționează în toate browserele web?",
  "aboutPageFaqAccord3Body": "Da, toate site-urile create cu ajutorul site-ului Weebly sunt optimizate pentru mobil.",
  "aboutPageFaqAccord4Head": "Cum pot aplica pentru un SSL?",
  "aboutPageFaqAccord4Body": "Da, toate site-urile create cu ajutorul site-ului Weebly sunt optimizate pentru mobil.",
  "aboutPageFaqAccord5Head": "Cum pot genera o solicitare de semnare a certificatului (CSR)?",
  "aboutPageFaqAccord5Body": "Da, toate site-urile create cu ajutorul site-ului Weebly sunt optimizate pentru mobil.",
  "sslPageMainTitle": "Certificatele SSL",
  "sslPageSubHeadTitle": "Protejați datele utilizatorilor online prin intermediul securității SSL",
  "sslPageHeadLi1": "Rock-solid de securitate",
  "sslPageHeadLi1Span": "30 de zile de garantare a returnării banilor",
  "sslPageHeadLi2": "Comodo Secure Seal",
  "sslPageHeadLi2Span": "Creșteți încrederea clienților",
  "sslPageViewPlanStartH6": "Începând de la",
  "sslPageViewPlanStartH5": "<Span> $ </span> 13.99 <sup> USD / mo </sup>",
  "sslPageViewPlanButtonText": "Vizualizați planul",
  "sslPageHowSsl": "Cum funcționează SSL pe site-ul dvs.?",
  "sslPageHowSslP": "Un certificat SSL creează un tunel securizat prin care informațiile, inclusiv numele de utilizator, parolele și numerele cărților de credit, trec în siguranță.",
  "sslPageHowSslLi1": "Blocul verde mic",
  "sslPageHowSslLi2": "Blocul verde mic",
  "sslPageHowSslLi3": "Obțineți un certificat de încredere SSL",
  "sslPageHowSslLi4": "Obțineți un certificat de încredere SSL",
  "sslPageHowSslLi5": "Protejează serverele nelimitate",
  "sslPageHowSslLi6": "Protejează serverele nelimitate",
  "sslPageHowSslLi7": "Compatibil cu toate marile",
  "sslPageHowSslLi8": "Compatibil cu toate marile",
  "sslPageEasyStepHead": "Certificare SSL în patru pași simpli",
  "sslPageEasyStepHeadP": "După ce achiziționați un certificat SSL, trebuie să fie activat.",
  "sslPageEasyStepBox1Span": "1",
  "sslPageEasyStepBox1H5": "Cumpar-o",
  "sslPageEasyStepBox1P": "Începeți prin achiziționarea certificatului SSL potrivit pentru nevoile dvs. Alegeți dintre cele trei tipuri listate.",
  "sslPageEasyStepBox2Span": "2",
  "sslPageEasyStepBox2H5": "Activați-l",
  "sslPageEasyStepBox2P": "Veți putea activa imediat certificatul dvs. SSL din panoul Account.",
  "sslPageEasyStepBox3Span": "3",
  "sslPageEasyStepBox3H5": "Instalați-l",
  "sslPageEasyStepBox3P": "Veți primi instrucțiuni despre modul în care certificatul dvs. SSL va fi validat.",
  "sslPageEasyStepBox4Span": "4",
  "sslPageEasyStepBox4H5": "Descurca-te",
  "sslPageEasyStepBox4P": "Aveți dreptul să gestionați certificate SSL (inclusiv reînnoire și reeditare) în panoul.",
  "sslPageEffectSiteH4": "Cum modificările recente ale Google vă afectează",
  "sslPageEffectSiteP": "Cele mai recente actualizări Google Chrome afișează acum vizitatorilor un mesaj \"Nesigur\" în adresa URL dacă site-ul dvs. nu este https (adică nu există certificat SSL). Dacă nu este sigur, vizitatorii sunt mai predispuși să introducă informații, să facă achiziții sau chiar să se înscrie pentru lista de e-mailuri.",
  "sslPageEffectSitePSpan": "Google va clasifica, de asemenea, site-urile web fără un certificat SSL mai jos pe pagina cu rezultatele căutării (SERP), afectând în același timp eforturile dvs. SEO, traficul și veniturile.",
  "sslPageFaqHead": "Întrebări frecvente <span> Întrebări </span>",
  "sslPageFaqAccord1Head": "Ce este un certificat SSL?",
  "sslPageFaqAccord1Body": "Animale de pariaturi cliche reprehenderit, enim eiusmod mare de viață accusamus terry richardson calmar ad.",
  "sslPageFaqAccord2Head": "Care este beneficiul SSL?",
  "sslPageFaqAccord2Body": "Da, toate site-urile create cu ajutorul site-ului Weebly sunt optimizate pentru mobil.",
  "sslPageFaqAccord3Head": "SSL funcționează în toate browserele web?",
  "sslPageFaqAccord3Body": "Da, toate site-urile create cu ajutorul site-ului Weebly sunt optimizate pentru mobil.",
  "sslPageFaqAccord4Head": "Cum pot aplica pentru un SSL?",
  "sslPageFaqAccord4Body": "Da, toate site-urile create cu ajutorul site-ului Weebly sunt optimizate pentru mobil.",
  "sslPageFaqAccord5Head": "Cum pot genera o solicitare de semnare a certificatului (CSR)?",
  "sslPageFaqAccord5Body": "Da, toate site-urile create cu ajutorul site-ului Weebly sunt optimizate pentru mobil.",
  "sslPageGetStartButton": "Începeți acum",
  "sslPageFooterTagLine": "Alegeți cea mai bună experiență <b> Cloud Hosting </b> pentru afacerea dvs.!"
  }',true);
  
$_LANG['headerphone'] = '+1(929)8002575';
$_LANG['headerallproduct'] = 'Toate produsele';
$_LANG['headerdomains'] = 'domenii';
$_LANG['headerdomain'] = 'Domeniu';
$_LANG['headerregisterdomain'] = 'Înregistrați un domeniu';
$_LANG['headertransferdomain'] = 'Transferați un domeniu';
$_LANG['headervpsssd'] = 'VPS SSD';
$_LANG['headervpspubliccloud'] = 'VPS Public Cloud';
$_LANG['headervpsprivatecloud'] = 'VPS Cloud privat';
$_LANG['headerenterpriseserver'] = 'Servere de întreprinderi';
$_LANG['headerdeveloperfriendly'] = 'Programator prietenos';
$_LANG['headergaming'] = 'Gaming servere';
$_LANG['headerhosting'] = 'Hosting';
$_LANG['headerhostings'] = 'Hostings';
$_LANG['headerhostingtext'] = "Gazduire este ceea ce face site-ul dvs. vizibil pe web. Oferim planuri rapide și fiabile pentru fiecare nevoie - de la un blog de bază la un site de mare putere. Designer? Dezvoltator? Și tu te-am acoperit.";
$_LANG['headerhostingserver'] = 'Gazduire servere';
$_LANG['headerservers'] = 'Servere';
$_LANG['headerserverstext'] = 'Luați control virtual sau alegeți server complet dedicat. Plesk și cPanel au reușit să găzduiască scalabile cu acces la rădăcini, IP unic, actualizări automate, backup și securitate.';
$_LANG['headerwebhosting'] = 'Web hosting';
$_LANG['headercpanelhosting'] = 'cPanel Hosting';
$_LANG['headerpleskhosting'] = 'Plesk Hosting';
$_LANG['headerwindowhosting'] = 'Windows Hosting';
$_LANG['headerwordpresshosting'] = 'Wordpress Hosting';
$_LANG['headercom'] = 'com';
$_LANG['headercomtext'] = 'Obțineți <b> domeniu </b> care <b> niciodată </b> nu va ieși din stil.';
$_LANG['headerregister'] = 'Inregistreaza-te';
$_LANG['headerdomaintext'] = 'Căutați domenii noi și înregistrați-vă numele înaintea altcuiva. Domeniile .COM sunt doar 9.95 USD / an și includ o înregistrare privată GRATUITĂ, 400+ TLD-uri, unică ca și compania dvs.';
$_LANG['headerlearnmore'] = 'Aflați mai multe';
$_LANG['headerdedicatedservers'] = 'Servere dedicate';
$_LANG['headervpsservers'] = 'Servere VPS';
$_LANG['headersupport'] = 'A sustine';
$_LANG['headersupporttext'] = 'Ne sprijinim cu mândrie numeroasele noastre produse și ne străduim să răspundem la întrebări și să-i împuterniciți pe clienți. Asistența tehnică profesionistă este întotdeauna disponibilă 24 de ore pe zi. Clienții pot crea bilete, pot accesa forumuri și baze de cunoștințe, pot citi întrebări frecvente și pot viziona videoclipuri instructive.';
$_LANG['headeropensupportticket'] = 'Deschideți un bilet de asistență';
$_LANG['headercontactus'] = 'Contacteaza-ne';
$_LANG['headerknowledgebase'] = 'Bază de cunoștințe';
$_LANG['headerwebsite'] = 'website';
$_LANG['headerwebsitetext'] = 'Un site web este vital pentru orice afacere modernă. Chiar dacă vindeți pe cale locală sau pe cale orală, clienții dvs. vă caută pe web - doar pentru a vă verifica orele. Găsiți tot ce aveți nevoie aici.';
$_LANG['headerdesignnewwebsite'] = 'Proiectați un nou site web';
$_LANG['headercustomchanges'] = 'Aveți nevoie de modificări personalizate în site';
$_LANG['headerelements'] = 'element';
$_LANG['headerpricetables'] = 'Tabele de prețuri';
$_LANG['headerhomepage'] = 'Pagina principala';
$_LANG['headerbanners'] = 'bannere';
$_LANG['headerpagenotfound'] = 'Pagina nu a fost gasita';
$_LANG['headercomingsoon'] = 'In curand';
$_LANG['headerdomainsearch'] = 'Căutarea de domenii';
$_LANG['headerwas'] = 'a fost';

/* Home Page */
$_LANG['homebig'] = 'MARE';
$_LANG['homesummersale'] = 'REDUCERI DE VARĂ';
$_LANG['homesharedhostingfrm'] = 'Shared Hosting de la';
$_LANG['homeonly'] = 'numai';
$_LANG['homemonth'] = 'lună';
$_LANG['hometrusbusiness'] = 'Încredere de afaceri pentru servicii globale, relații locale';
$_LANG['homeyears'] = 'Ani';
$_LANG['homeunlimitedws'] = 'Spațiu Web nelimitat';
$_LANG['homefreedomain'] = 'Domeniu gratuit';
$_LANG['homeunlimitedbandwidth'] = 'Bandwidth nelimitat';
$_LANG['homeunlimitedemail'] = 'E-mail nelimitat';
$_LANG['homegetstarted'] = 'Începeți acum';
$_LANG['homeourproducts'] = 'Produsele noastre';
$_LANG['homeourproductstext'] = 'Performanța excelentă satisface scalabilitatea completă';
$_LANG['homevpshosting'] = 'VPS Hosting';
$_LANG['homevpshostingtext'] = 'Serverele și infrastructura noastră sunt, în mod implicit, protejate împotriva atacurilor de refuz al serviciilor (DDoS)';
$_LANG['homevirtualserver'] = 'Server virtual';
$_LANG['homevirtualservertext'] = 'RPN este o funcție de rețea privată, dedicată și separată fizic de interfața dvs. de rețea Internet.';
$_LANG['homewebhostcert'] = 'Serverele noastre Dedibox® sunt certificate VMWare Ready®';
$_LANG['homesharehost'] = 'Gazduire comună';
$_LANG['homesharehosttext'] = 'Aproape toata Dedibox® vine cu un hardware KVM prin IP si media virtuala de la distanta ca standard.';
$_LANG['homewordpresshosting'] = 'Wordpress Hosting';
$_LANG['homewordpresshostingtext'] = 'Majoritatea serverelor Dedibox suportă RAID, oferind fiabilitate și performanță';
$_LANG['homecloudhosting'] = 'Cloud Hosting';
$_LANG['homecloudhostingtext'] = 'Asistența noastră tehnică este disponibilă 24 de ore pe zi, 7 zile pe săptămână cu bilet și telefon, în franceză, engleză și germană';
$_LANG['homehostxwebhost'] = 'HostX Web Hosting';
$_LANG['homehostxwebhosttext'] = "Avem planul perfect de găzduire pentru următorul server, site, aplicație, platformă sau blog - toate susținute de suportul dvs. câștigat 24 de ore din 24,";
$_LANG['homestartup'] = "linux hosting";
$_LANG['homesplan2'] = "vps hosting";
$_LANG['homesplan3'] = "server dedicat";
$_LANG['homestartfrom'] = "Începând de la";
$_LANG['homemo'] = "Mo";
$_LANG['homenoofsites'] = "Începe cu site-ul <b> 1 </b>";
$_LANG['homesiteenvironment'] = "medii / site-";
$_LANG['homevisitmonth'] = "vizite / luna";
$_LANG['homebandwidth'] = "lățime de bandă";
$_LANG['homecdnandssl'] = "<b> CDN & SSl </b> incluse";
$_LANG['homemigrations'] = "<b> Migrații </b>";
$_LANG['homepagepreform'] = "<b> Performanța paginii </b> este gratuită";
$_LANG['homepowerfultools'] = "Sunt disponibile <b> instrumentele </b> disponibile";
$_LANG['homeannualprepay'] = "Obțineți 2 luni gratuite cu o plată anticipată anuală";
$_LANG['homeordernow'] = "COMANDA ACUM";
$_LANG['homecustomplan'] = "PLANUL CUVINTELOR";
$_LANG['homecustomplantext'] = "Personalizați-vă planul de găzduire în funcție de cerințele dvs.";
$_LANG['homehighperform'] = "Performanța <b> ridicată </b>";
$_LANG['homeriskfree'] = "Fără riscuri timp de 60 de zile";
$_LANG['homehighredundanc'] = "<b> Disponibilitate ridicată </b> / redundanță";
$_LANG['homeonboarding'] = "<b> Gestionat </b> la bord";
$_LANG['homefastrepons'] = "<b> Răspunsul cel mai rapid </b>";
$_LANG['homecallus'] = "Apel";
$_LANG['hometalksalep'] = "pentru a discuta cu un specialist în vânzări";
$_LANG['homehostsolution4you'] = "Avem o soluție de găzduire pentru dvs.";
$_LANG['homechooseplatform'] = "Alegeți o platformă";
$_LANG['homehackersecur'] = "SECURITATEA DE SECURITATE";
$_LANG['homehackersecurtext'] = "Serverele și infrastructura noastră sunt, în mod implicit, protejate împotriva atacurilor de refuz al serviciilor (DDoS)";
$_LANG['homeblazingspeed'] = "PORNIREA VITEZELOR RAPIDE";
$_LANG['homeblazingspeedtext'] = "RPN este o funcție de rețea privată, dedicată și separată fizic de interfața dvs. de rețea Internet";
$_LANG['homenightlybackup'] = "BACKUPS NICIODATĂ";
$_LANG['homenightlybackuptext'] = "Serverele noastre Dedibox® sunt certificate VMWare Ready®";
$_LANG['homeglobalavailty'] = "DISPONIBILITATEA GLOBALĂ";
$_LANG['homeglobalavailtytext'] = "Aproape toata Dedibox® vine cu un hardware KVM prin IP si media virtuala de la distanta ca standard";
$_LANG['homereimaginedsetp'] = "SFTP REIMAGINAT";
$_LANG['homereimaginedsetptext'] = "Majoritatea serverelor Dedibox suportă RAID, oferind fiabilitate și performanță";
$_LANG['hometunedwordpress'] = "TUNED FOR WORDPRESS";
$_LANG['hometunedwordpresstext'] = "Asistența noastră tehnică este disponibilă 24 de ore pe zi, 7 zile pe săptămână cu bilet și telefon, în franceză, engleză și germană";
$_LANG['hometestimonials'] = "Marturii";
$_LANG['hometestimhead'] = "Aflați ce spun clienții noștri despre produsele și serviciile noastre";
$_LANG['hometestimname'] = "Natalie Smith";
$_LANG['hometestimtext'] = "Lorem Ipsum este pur și simplu un text fals al industriei de imprimare și de tipărire. Lorem Ipsum a fost textul standard al industriei de manechin încă din anii 1500, atunci când o imprimantă necunoscută a luat o bucătărie de tip și a amestecat-o pentru a face o carte tip specimen";
$_LANG['homededicatenvrmnt'] = "Dedicat <b> mediului </b>";
/*Footer*/
$_LANG['footerchoosebest'] = "Alegeți cea mai bună experiență <b> Cloud Hosting </b> pentru afacerea dvs.!";
$_LANG['footeraboutus'] = "DESPRE NOI";
$_LANG['footeraboutustext'] = "Cloud Hosting oferă servicii superioare, fiabile și accesibile de găzduire web pentru persoane fizice și întreprinderi mici și mijlocii din întreaga lume";
$_LANG['footergettouch'] = "ATINGE";
$_LANG['footercontactinfo'] = "Informatii de contact";
$_LANG['footer24support'] = "Suport 24/7";
$_LANG['footeremail'] = "E-mail";
$_LANG['footerfollowus'] = "Urmează-ne";
$_LANG['footerusefullinks'] = "Link-uri utile";
$_LANG['footerlinuxservers'] = "Serverele Linux";
$_LANG['footerprivacypolicy'] = "Politica de confidentialitate";
$_LANG['footerclose'] = "Închide";
$_LANG['footertitle'] = "Titlu";
$_LANG['footersubmit'] = "A depune";

/*Domain*/
$_LANG['domainregister'] = "REGISTAȚI UN DOMENIU";
$_LANG['domainfindideal'] = "Găsiți numele dvs. de domeniu ideal";
$_LANG['domainsecureyourdmn'] = "Asigurați-vă domeniul prin înregistrarea domeniului dvs. cu noi!";
$_LANG['domainsearch'] = "Căutare";
$_LANG['domainyr'] = "an";
$_LANG['domainchecktld'] = "Verificați toate TLD-urile noastre de mai jos";
$_LANG['domainchecktldtext'] = "Verificați lista cu TLD-urile disponibile pentru a vă da startul site-ului dvs. de afaceri!";
$_LANG['domaingtldcctld'] = "GTLD și CCTLD";
$_LANG['domainfreeemail'] = "2 Contul de e-mail gratuit";
$_LANG['domainprice'] = "Preț";
$_LANG['domainyear'] = "An";
$_LANG['domainrenewalprice'] = "Preț de reînnoire";
$_LANG['domainowndomain'] = "Deja dețineți <b> numele de domeniu perfect? </b> <br> Construiți un site web pentru el!";
$_LANG['domainowndomaintext'] = "Doriți să creați un site web unic pentru afacerea dvs.? <br> Vă ajutăm să construiți site-ul dvs. pentru a concura cu lumea";
$_LANG['domainclickstart'] = "Faceți clic pentru a începe";
$_LANG['domainsimplesteps'] = "Obțineți online în trei pași simpli";
$_LANG['domainchoosename'] = "Alegeți un nume de domeniu";
$_LANG['domainchoosenametext'] = "Alegeți o gamă largă de extensii de domenii, cum ar fi .com, .in și multe moale";
$_LANG['domainselecthostplan'] = "Selectați un plan de găzduire";
$_LANG['domainselecthostplantext'] = "Oferim cele mai bune servicii de găzduire la cele mai accesibile prețuri de pe piață";
$_LANG['domainsetupwebsite'] = "Configurați un site web";
$_LANG['domainsetupwebsitetext'] = "Aflați cum să configurați site-ul dvs. din baza noastră de cunoștințe";
$_LANG['domaincallus'] = "CALL US";
$_LANG['domaintollfree'] = "Fără taxă";
$_LANG['domainchatwith'] = "CHAT CU NOI";
$_LANG['domainexperts'] = "DOMENIILE EXPERȚILOR";
$_LANG['domaingetemailaddress'] = "Obțineți adresa de e-mail personalizată: <br> Construiți încrederea în afacerea dvs.";
$_LANG['domaingetemailtext'] = "Trimiteți mesajul potrivit clienților și potențialilor dvs. clienți, utilizând o adresă de e-mail proafesională, cum ar fi numele@example.com. Adăugarea de adrese de e-mail personalizate în domeniul dvs. este ușoară și adaugă credibilitate companiei dvs. Consultați opțiunile de e-mail";
$_LANG['domainregister'] = "INREGISTREAZA-TE";
$_LANG['domainfrequentlyask'] = "S-au solicitat frecvent";
$_LANG['domainquesanss'] = "ÎNTREBĂRI ȘI RĂSPUNSURI!";
$_LANG['domainque1'] = "Ce fel de plan de găzduire web am nevoie?";
$_LANG['domainque2'] = "Cum pot achiziționa o hosting dedicat?";
$_LANG['domainque3'] = "a cumpărat o găzduire, acum ce fac?";
$_LANG['domainque4'] = "Cum transfer de pagini web pe server?";
$_LANG['domainqueans'] = "Lorem ipsum dolor stai în ordine, consecutiv, în timp ce se ascultă, în timp ce lucrați în timpul muncii și alături de magna aliqua. Ut enim ad minim veniam, quis exerciții de muncă ultima lucrătoare aliquip ex a commodo consequat. Duis aute irure dolor în republicarea în voluptate comandă esse cillum dolore eu fugiat nulla pariatur.";
$_LANG['domaincustomersay'] = "Ce <b> Clienții </b> trebuie să spună?";
$_LANG['domaincustomername'] = "ZAFER TUNCA";
$_LANG['domaincustomername2'] = "ATAKAN OZOLMEZ";
$_LANG['domaincustomername3'] = "TUGCE YILMAZ";
$_LANG['domaincustomername4'] = "ELIF ERDURAN";
$_LANG['domaincustomerdata'] = "Kurucu Ortak, Rixos și Medya";
$_LANG['domaincustomerdata2'] = "Program Manager la <br> Ontan Grup";
$_LANG['domaincustomerdata3'] = "Program Manager la <br> Haber 3";
$_LANG['domaincustomerdata4'] = "Program Manager la Venus <br> Ajans";
$_LANG['domaincustomereview'] = "Construiți-vă site-ul sau blogul cu WordPress, cel mai popular site din lume și un instrument de gestionare a blogurilor. Este ușor de utilizat și vă oferă libertatea de a ...";

/*cPanel Hosting Page*/
$_LANG['cpanelwebhosting'] = "Cel mai bun <span> Cpanel </ span> Gazduire Web";
$_LANG['cpanelessyinstall'] = "Instalați în minute în medie la utilizatorii experimentați";
$_LANG['cpanelessyinstalltext'] = "De la început la întreprindere, te-am acoperit. Începeți cu 14 zile libere. Plata anuală vă aduce două luni libere!";
$_LANG['cpanelPricing'] = "Prețuri";
$_LANG['cpanelourfeature'] = "Caracteristica noastră";
$_LANG['cpanelwhychoose'] = "De ce să ne alegeți";
$_LANG['cpanelwhychoosehd'] = "Prețuri simple și transparente";
$_LANG['cpanelwhychoosetext'] = "De la început la întreprindere, te-am acoperit. Începeți cu 14 zile libere. Plata anuală vă câștigă două luni libere!";
$_LANG['cpanelserverlocation'] = "Locația serverului";
$_LANG['cpanelcountry1'] = "Regatul Unit";
$_LANG['cpanelrussian'] = "Rusă";
$_LANG['cpanelspanish'] = "Spaniolă";
$_LANG['cpanelsave25'] = "salvați 25%";
$_LANG['cpanelperfectstart'] = "Punctul de plecare perfect pentru creșterea prezenței online";
$_LANG['cpanelpersonal'] = "Personal";
$_LANG['cpanelpermonth'] = "Pe luna";
$_LANG['productmonthly'] = "Pe luna";
$_LANG['productquarterly'] = "Trimestrial";
$_LANG['productsemiannually'] = "Semi anual";
$_LANG['productannually'] = "Pe an";
$_LANG['cpanelvat'] = "Toate prețurile exclud TVA la 20% <b> Comparați caracteristicile </b>";
$_LANG['cpanelovercharge'] = "Da, pentru că, cum ar fi tarifele pentru telefoanele mobile, depășiri de bandă depășesc chiar mai mult!";
$_LANG['cpanelmorefeature'] = "Gazduirea noastră vă oferă mai multă facilitate";
$_LANG['cpanelmorefeaturetext'] = "Rularea unei afaceri poate fi o provocare, pentru a vă ajuta să oferim un GRATUIT site constructor cu GRATUIT GRATUIT imagini stoc și GRATUIT e-mail cu fiecare nume de domeniu.";
$_LANG['cpanelfreename'] = "Domeniu gratuit de domeniu";
$_LANG['cpanelfreenametext'] = "Toate planurile noastre includ cel puțin un domeniu .co.uk gratuit, astfel încât să obțineți tot ce aveți nevoie pentru a vă lua noul website de afaceri online, deja inclus în prețul pachetului dvs. de găzduire";
$_LANG['cpanelfreepersonalised'] = "E-mail personal personalizat";
$_LANG['cpanelfreepersonalisedtext'] = "Creați o adresă de e-mail care să corespundă domeniului dvs. pentru a oferi companiei dvs. un aspect profesional. Este foarte ușor să cumpărați cutii poștale suplimentare dacă aveți nevoie de mai mult de unul";
$_LANG['cpanelfreeencreypt'] = "Gratuit Să ștergeți codul SSL";
$_LANG['cpanelfreeencreypttext'] = "Certificat SSL gratuit cu Let's Criptare pentru toate site-urile web gestionate în pachetul dvs. de găzduire";
$_LANG['cpanelfreebackup'] = "Backup săptămânal gratuit";
$_LANG['cpanelfreebackuptext'] = "Asigurați-vă că aveți întotdeauna o copie a site-ului dvs. în cazul în care ceva nu merge bine. Alegeți cât spațiu aveți nevoie la casă, cu 5 GB începând cu doar 15 £ / an, ajungând până la 200GB pentru 375 £ / an";
$_LANG['cpanelfreemigration'] = "Migrarea gratuită a site-ului";
$_LANG['cpanelfreemigrationtext'] = "Experții noștri vor migra orice cont de gazduire web partajat, fără probleme și gratuit";
$_LANG['cpaneloneclickhosting'] = "One-Click WordPress hosting";
$_LANG['cpaneloneclickhostingtext'] = "Instalați WordPress, Joomla, Drupal și peste 200 de aplicații web. Instalarea rapidă și nu necesită cunoștințe tehnice avansate";
$_LANG['cpanelchallengin'] = "Rularea unei afaceri poate fi o provocare, astfel încât să vă ajutăm să oferim un GRATUIT site builder§ cu imagini GRATUITE și GRATUIT cu fiecare nume de domeniu";
$_LANG['cpanelinfratechno'] = "Infrastructură și tehnologie utilizate";
$_LANG['cpanelfreeclickintalls'] = "70 de instalări gratuite cu un singur clic";
$_LANG['cpanelsslcertificate'] = "Certificat SSl";
$_LANG['cpanelultrahosting'] = "Gazduire ultra cloud";
$_LANG['cpanelcloudsimplicity'] = "Beneficii ale Cloud + Simplitatea găzduirii comune";
$_LANG['cpaneldualprocess'] = "Procesor dual Xeon 2.40GHz";
$_LANG['cpanelram'] = "Berbec";
$_LANG['cpanelSupport'] = "A sustine";
$_LANG['cpanelraidos'] = "RAID 1 Drive OS";
$_LANG['cpanelcacheddrive'] = "Cache Client Drive";
$_LANG['cpanelapache'] = "Apache";
$_LANG['cpanelphpversion'] = "PHP 5.3x, 5.4x, Perl, Python";
$_LANG['cpanelfreednsmanage'] = "Gestionare DNS gratuită";
$_LANG['cpanelmysql'] = "MySQL";
$_LANG['cpanelrubyrail'] = "Ruby On Rails";
$_LANG['cpanelantiprotect'] = "Protecție Anti Spam & Virus";
$_LANG['cpanelsecureftp'] = "Asigurați accesul FTP";
$_LANG['cpanelleechprotect'] = "Protecție Hotlink & Leech";
$_LANG['cpanelphpmyadmin'] = "Accesul phpMyAdmin";
$_LANG['cpanelemailaddress'] = "Agenda de e-mail online";
$_LANG['cpanelvarnishcach'] = "Acum, cu Caching-ul cu lacuri";
$_LANG['cpanelreliablepower'] = "Putere fiabilă";
$_LANG['cpaneluninterrup'] = "Proiectat pentru operațiuni neîntrerupte";
$_LANG['cpanelnetworksecurity'] = "Securitatea retelei";
$_LANG['cpanelmustability'] = "Timp maxim de funcționare &<br> Stabilitate";
$_LANG['cpanelhvacprotection'] = "Protecția HVAC";
$_LANG['cpanelresilience'] = "Rezistența și redundanța <br> la toate nivelurile";
$_LANG['cpanelinstallapp'] = "instalați aplicații populare în câteva secunde";
$_LANG['cpanelinstallapptext'] = "Alegeți dintre cele peste 70 de instalări gratuite cu un singur clic, inclusiv sisteme de gestionare a conținutului populare și cum ar fi WordPress, joomla !, și Drupal; soluții de comerț electronic, cum ar fi osCommerce, OpenCart și PrestaShop; și o mare varietate de alte titluri populare de software, inclusiv phpBB, Open Web Analytics și Moodle. Toate acestea și altele sunt disponibile ca standard cu pachetele Home Pro și Business Pro";
$_LANG['cpaneloneclickapp'] = "Vedeți APPS-urile noastre ON-CLICK";
$_LANG['cpanelsitesecure'] = "Păstrați site-urile dvs. securizate cu un";
$_LANG['cpanelfreessl'] = "certificat SSL gratuit";
$_LANG['cpanelfreessltext'] = "Un certificat SSL creează un tunel securizat prin care informațiile care includ nume de utilizator, parole, numere de cărți de credit și multe altele pot trece în siguranță";
$_LANG['cpanelgetout'] = "Scoate-o";
$_LANG['cpanelyoulove'] = "Suportul pe care îl știm că îl veți iubi";
$_LANG['cpanelyoulovetext'] = "Experții noștri de sprijin științific sunt la îndemână pentru a vă ajuta chiar de la început. Cu migrații gratuite de site-uri, asistență prietenoasă de concierge și asistență continuă 24x7 - veți avea tot ajutorul de care aveți nevoie oricând aveți nevoie";
$_LANG['cpanelactivebackup'] = "Apelați pentru a activa copii de siguranță";
$_LANG['cpaneltext'] = "Text";
$_LANG['cpanelchat'] = "conversație";
$_LANG['cpanelphone'] = "Telefon";

/*plesk Hosting Page*/
$_LANG['pleskbannerhead'] = "Gazduire web cu <span> Plesk </ span>";
$_LANG['pleskbannertext'] = "HostCluster este un furnizor de gazduire gestionat WordPress unde ne ocupam de toate nevoile dumneavoastra in ceea ce priveste site-ul dumneavoastra. Ne conducem serviciile pe o tehnologie de ultimă generație și luăm serios sprijinul";
$_LANG['pleskeasysetup'] = "Setare ușoară pentru utilizatorii medii";

/*Window Hosting Page*/
$_LANG['windowbannerhead'] = "<span> Fereastră </ span> Gazduire";
$_LANG['windowbannertext'] = "HostCluster este un furnizor de gazduire gestionat WordPress unde ne ocupam de toate nevoile dumneavoastra in ceea ce priveste site-ul dumneavoastra. Ne conducem serviciile pe o tehnologie de ultimă generație și luăm serios sprijinul";
$_LANG['windoweasysetup'] = "Setare ușoară pentru utilizatorii medii";

/*Wordpress Hosting Page*/
$_LANG['wordpressbannerhead'] = "Cumpărați <span> Wordpress </ span> Gazduire ieftină";
$_LANG['wordpressopensource'] = "Open source CMS";
$_LANG['wordpressbannertext'] = "HostCluster este un furnizor de gazduire gestionat WordPress unde ne ocupam de toate nevoile dumneavoastra in ceea ce priveste site-ul dumneavoastra. Ne conducem serviciile pe o tehnologie de ultimă generație și luăm serios sprijinul";

/*VPS Hosting Page*/
$_LANG['vpsbannerhead'] = "VPS de înaltă performanță la un preț accesibil Un raport performanță / preț, unități SSD, KVM OpenStack";
$_LANG['vpsbannertext'] = "Servere profesionale de înaltă performanță, special concepute pentru configurarea instrumentului de gestionare a relațiilor (CRM)";
$_LANG['vpslivesupport'] = "DEDICAT 24/7 LIVE SUPORT";
$_LANG['vpsuptimeguarantee'] = "99,9% GARANȚIE UPTIME";
$_LANG['vpsriskfree'] = "TRECE PENTRU 30 DE ZILE RISCUL GRATUIT!";
$_LANG['vpstransparentprice'] = "Prețuri simple și transparente";
$_LANG['vpstransparentpricetext'] = "De la început la întreprindere, te-am acoperit. Începeți cu 14 zile libere. Plata anuală vă câștigă două luni libere!";
$_LANG['vpschoosehosting'] = "De ce să alegeți Gazduire VPS";
$_LANG['vpsfullaccess'] = "ACCESUL COMPLET";
$_LANG['vpsfullaccesstext'] = "Serverele virtuale au acces complet la root, ceea ce permite accesul administratorului în mediul dvs. de găzduire, împreună cu posibilitatea de a instala software personalizat fără restricții. În plus, panoul nostru de administrare a serverului vă oferă control complet asupra serverului cu acțiuni precum Start, Stop, Rebuild și multe altele";
$_LANG['vpsintegratedcpanel'] = "CLANUL INTEGRAT";
$_LANG['vpsintegratedcpaneltext'] = "Planul dvs. VPS (server privat virtual) vine cu un cPanel preinstalat, care vă ajută să gestionați eficient mediul dvs. de găzduire.";
$_LANG['vpsintegratedcpaneltext2'] = "Cu ajutorul programului de auto-instalare Softaculous din cPanel, puteți instala WordPress, Joomla, Drupal, Magento și multe altele într-un minut.";
$_LANG['vpsinstantprovision'] = "NEOR-INSTANT PROVIZING";
$_LANG['vpsinstantprovisiontext'] = "Planul dvs. VPS (server privat virtual) vine cu un cPanel preinstalat, care vă ajută să gestionați eficient mediul dvs. de găzduire";
$_LANG['vpsinstantprovisiontext2'] = "În timp ce unii furnizori de servicii au nevoie de ore sau de zile pentru a-ți face serverele să funcționeze. Serverele noastre VPS sunt concepute pentru a fi furnizate în câteva minute! <br> Spre deosebire de mulți furnizori de servicii de găzduire VPS din India, nu plătim nicio taxă de instalare";
$_LANG['vpssearchvps'] = "Căutați în continuare serverul <b> cel mai bun VPS? </b> <br> Mergeți cu norul Linux";
$_LANG['vpsfastsimple'] = "FAST & SIMPLE";
$_LANG['vpsfastsimpletext'] = "Cu tehnologia Cloud activată pentru acest VPS, serverele dvs. sunt alimentate cu o flexibilitate sporită și control";
$_LANG['vpseasypanel'] = "CABLU DE CONTROL UȘOS";
$_LANG['vpseasypaneltext'] = "VPS dvs. KVM vine cu cPanel, pentru a vă gestiona site-ul și serviciile asociate cu serviciul de e-mail și DNS";
$_LANG['vpsawardwinsupport'] = "PREMIUL DE CÂȘTIGAREA AWARDULUI";
$_LANG['vpsawardwinsupporttext'] = "Suntem aici pentru tine 24/7/365 prin intermediul telefonului, LiveChat și e-mail pentru a ajuta la orice întrebări pe care le aveți";
$_LANG['vpsedgehardware'] = "CUTTING HARDWARE EDGE";
$_LANG['vpsedgehardwaretext'] = "Toate serverele noastre fizice care stau la baza sunt echipate cu cele mai noi Processors și RAM";
$_LANG['vpsprivateserver'] = "SERVICII PRIVATE MANCRAFT";
$_LANG['vpsprivateservertext'] = "Puteți crea aproape orice doriți pe care îl doriți cu serverele dvs. de găzduire cloud VPS";
$_LANG['vpshighcloudserver'] = "SERVERUL CLOUD END END";
$_LANG['vpshighcloudservertext'] = "Infrastructura bazată pe cloud combinată cu servere virtuale high-end este răspunsul la oricare din întrebările dvs. de web hosting";
$_LANG['vpsguarantee'] = "RISK-FREE TRIAL PROGRAM. GARANTAREA RISCULUI DE 30 DE ZILE";
$_LANG['vpsguaranteetext'] = "Încercați-ne timp de 30 de zile fără riscuri! Sunteți complet protejați de programul nostru de garantare fără riscuri. Dacă prin orice mijloace vă decideți să vă anulați contul în următoarele 30 de zile, veți primi o rambursare instantanee, fără întrebări";
$_LANG['vpstechnicalspeci'] = "Specificatii tehnice";
$_LANG['vpsguaranteeresour'] = "Resurse garantate";
$_LANG['vpsguaranteeresourtext'] = "Tehnologia noastră HP KVM HP VPS bazată pe hipervisor asigură o performanță consistentă, iar resursele * serverului pot fi scalate pe măsura extinderii afacerii dvs.";
$_LANG['vpssecureenvironment'] = "Mediul sigur";
$_LANG['vpssecureenvironmenttext'] = "Virtualizarea virtualizată bazată pe virtuți aduce o mai bună izolare și securitate într-un mediu VPS";
$_LANG['vpsedgeserverhard'] = "Hardware pentru servere de margine";
$_LANG['vpsedgeserverhardtext'] = "Una dintre părțile integrale ale serverului dvs. este citirea / scrierea pe disc, motiv pentru care am construit serverele noastre cu Solid State Drives *";
$_LANG['vpstopnetwork'] = "Începutul rețelei de linii";
$_LANG['vpstopnetworktext'] = "Rețeaua noastră este proiectată cu mai mulți ISP-i de renume pentru a asigura o stabilitate ridicată, pentru a elimina un singur punct de eșec cu o protecție integrată DDoS, fără costuri suplimentare!";
$_LANG['vpsaskque'] = "INTRODUCEȚI ÎNTREBĂRILE, RĂSPUNS!";

/*VPS Private Page*/
$_LANG['vpspcbannerhead'] = "VPS <span> Cloud privat </ span>";
$_LANG['vpspcbannerhead2'] = "Aduceți performanța unui VPS cu disponibilitatea opțiunii cloud Native High și Windows";
$_LANG['vpspcbannertext'] = "Servere profesionale de înaltă performanță, special concepute pentru configurarea instrumentului de gestionare a relațiilor (CRM)";

$_LANG['vpsplcbannerhead'] = "VPS <span> Cloud public </ span>";
$_LANG['vpsplcbannerhead2'] = "Aduceți performanța unui VPS cu disponibilitatea opțiunii cloud Native High și Windows";
$_LANG['vpsplcbannertext'] = "Servere profesionale de înaltă performanță, special concepute pentru configurarea instrumentului de gestionare a relațiilor (CRM).";

$_LANG['dedicatedgmbannerhd'] = "<span> Joc </ span> Servere";
$_LANG['dedicatedgmbannerhd2'] = "Cea mai bună performanță pentru jocurile online";
$_LANG['dedicatedgmbannertext'] = "Gama de servere dedicate jocurilor noastre oferă servere de jocuri special concepute pentru a găzdui programe asociate, cum ar fi programe de chat vocal. Cu servere dedicate OVH, jucătorii pot juca jocurile lor online preferate fără limite în termeni de performanță și stabilitate.";

$_LANG['dedicatedepbannerhd'] = "<span> Enterprise </ span> Servere";
$_LANG['dedicatedepbannerhd2'] = "Putere mare de calcul pentru proiectele dvs.";
$_LANG['dedicatedepbannertext'] = "Servere profesionale de înaltă performanță, concepute special pentru companii. Ca soluție multifuncțională, acestea se potrivesc cu o gamă largă de nevoi: găzduirea de aplicații complexe de afaceri, configurarea mașinilor virtuale și configurarea instrumentului pentru gestionarea relațiilor cu clienții (CRM).";

$_LANG['dedicateddfbannerhd'] = "Dezvoltator <span> Prietenos </ span>";
$_LANG['dedicateddfbannerhd2'] = "Cea mai bună performanță pentru jocurile online";
$_LANG['dedicateddfbannertext'] = "Gama de servere dedicate jocurilor noastre oferă servere de jocuri special concepute pentru a găzdui programe asociate, cum ar fi programe de chat vocal. Cu servere dedicate OVH, jucătorii pot juca jocurile lor online preferate fără limite în termeni de performanță și stabilitate.";


/*Dedicated Server Page*/
$_LANG['dedicatedbannerhead'] = "<span> Gazduire </ span> Servere";
$_LANG['dedicatedbannerhead2'] = "Servere fiabile pentru a găzdui magazine online, site-uri de prezentare";
$_LANG['dedicatedbannerheadtext'] = "Descoperiți o gamă completă de servere de găzduire web. Serverele dedicate sunt soluția perfectă pentru a vă adapta la proiectele dvs. atunci când gazdele partajate nu mai sunt suficiente. Libertatea completă de administrare a serverului dvs. dedicat vă permite să vă adaptați la nevoile proprii";
$_LANG['dedicatedserver'] = "Serverele noastre Dedicate";
$_LANG['dedicatedservertext'] = "Creșteți site-ul dvs. mai repede cu serverele noastre dedicate. <br> Alegeți un plan care să corespundă cerințelor dvs.";
$_LANG['dedicatedfeature'] = "Includeți toate caracteristicile";
$_LANG['dedicatedfeaturetext'] = "Infrastructură la nivel mondial, cloud computing inovatoare și expertiză specializată";
$_LANG['dedicatedddosprotect'] = "Protecția DDOS";
$_LANG['dedicatedddosprotecttext'] = "Serverele și infrastructura noastră sunt, în mod implicit, protejate împotriva atacurilor de refuz al serviciilor (DDoS).";
$_LANG['dedicatedrpn'] = "RPN";
$_LANG['dedicatedrpntext'] = "RPN este o funcție de rețea privată, dedicată și separată fizic de interfața dvs. de rețea Internet.";
$_LANG['dedicatedvmware'] = "VMWare Ready®";
$_LANG['dedicatedvmwaretext'] = "Serverele noastre Dedibox® sunt certificate VMWare Ready®.";
$_LANG['dedicatedkvmip'] = "KVM pe IP";
$_LANG['dedicatedkvmiptext'] = "Aproape toata Dedibox® vine cu un hardware KVM prin IP si media virtuala de la distanta ca standard.";
$_LANG['dedicatedraid'] = "RAID";
$_LANG['dedicatedraidtext'] = "Majoritatea serverelor Dedibox suportă RAID, oferind fiabilitate și performanță.";
$_LANG['dedicatesupport'] = "Asistență 24/7";
$_LANG['dedicatesupporttext'] = "Asistența noastră tehnică este disponibilă 24 de ore pe zi, 7 zile pe săptămână cu bilet și telefon, în franceză, engleză și germană.";
$_LANG['dedicatecertifiedcenter'] = "Datacenter certificat";
$_LANG['dedicatecertifiedcentertext'] = "Nu faceți niciodată vreun compromis cu privire la durabilitatea infrastructurii dvs.";
$_LANG['dedicatedpremiumnetwork'] = "Rețea premium";
$_LANG['dedicatedpremiumnetworktext'] = "Operăm o rețea simplă, ultra rapidă și fiabilă. Rețeaua noastră AS12876 are capacități mari, cu numeroase puncte de tranzit și puncte de schimb.";
$_LANG['dedicatedmonitroing'] = "Management și monitorizare";
$_LANG['dedicatedlicence'] = "Licență și software";
$_LANG['dedicatedos'] = "Sistem de operare disponibil";
$_LANG['dedicatedostext'] = "Cu instrumentele actualizate, comenzile cu granulație fină și viața reîncărcată, oferim utilizatorilor noștri cea mai recentă ofertă pentru Windows și servere dedicate și linux dedicated servers";
$_LANG['dedicatedcentos'] = "CentOS";
$_LANG['dedicatedubuntu'] = "Ubuntu";
$_LANG['dedicatedcloudlinux'] = "CloudLinux";
$_LANG['dedicatedfedora'] = "Fedora";
$_LANG['dedicateddebian'] = "Debian";
$_LANG['dedicatedcpanel'] = "cPanel";
$_LANG['dedicatedplesk'] = "Plesk";
$_LANG['dedicatedwindows'] = "ferestre";
$_LANG['dedicatedpricing'] = "Prețuri";
$_LANG['dedicatedfree'] = "Liber";
$_LANG['dedicatedwebpro'] = "WebPro";
$_LANG['dedicatedwhychoose'] = "De ce să ne alegeți?";
$_LANG['dedicatedwhychoosetext'] = "Infrastructură la nivel mondial, cloud computing inovatoare și expertiză specializată";
$_LANG['dedicatedsolutions'] = "soluţii";
$_LANG['dedicatedsolutionstext'] = "Serverele noastre dedicate sunt alimentate de hardware de înaltă calitate, de înaltă calitate, de la jucători de vârf precum Dell, HP și Supermicro. Construit pentru performanță rapidă și fără egal.";
$_LANG['dedicatedspeed'] = "viteză";
$_LANG['dedicatedspeedtext'] = "Serverele noastre sunt construite pentru a oferi o viteză superioară și pentru a asigura că și cele mai solicitante aplicații de servere web rulează fără probleme.";
$_LANG['dedicatedsupport'] = "A SUSTINE";
$_LANG['dedicatedsupporttext'] = "Echipa noastră este formată din profesioniști IT în probleme legate de software și hardware și acest lucru păstrează calitatea noastră de asistență în lumea de primă clasă.";
$_LANG['dedicateduptime'] = "GARANȚIA UPTIME";
$_LANG['dedicateduptimetext'] = "Suntem mândri că oferim unul dintre cele mai înalte standarde de garanție a rețelei de uptime (99,95%). Site-ul dvs. Web va funcționa întotdeauna.";
$_LANG['dedicatedaskques'] = "S-au solicitat frecvent";
$_LANG['dedicatedaskquesans'] = "ÎNTREBĂRI ȘI RĂSPUNSURI!";
$_LANG['dedicateserver'] = "Server dedicat";
$_LANG['dedicateservertext'] = "Închirierea serverului direct de la noi este practică și accesibilă. În cazul în care orice hardware pe serverul se va rupe, pe măsură ce schimbăm cursul, acesta va fi gratuit.";
$_LANG['dedicateserv'] = "SERV. 1";
$_LANG['dedicatedintel'] = "Intel Xeon <span> 1 Karna";
$_LANG['dedicatedram'] = "Berbec";
$_LANG['dedicatedmbit'] = "Mbit / s";
$_LANG['dedicatedgstart'] = "INCEPE";
$_LANG['dedicatedpackage'] = "Doriți să știți sau diferite pachete?";
$_LANG['dedicatedpackage2'] = "Aflați mai multe și consultați toate pachetele";

/*Banner Page*/
$_LANG['bannerhead'] = "ACCESAȚI-VĂ SAU SITE-UL Cu";
$_LANG['bannerhead2'] = "DEDICAT HOSTING ";
$_LANG['bannerheadtext'] = "Dați site-ul dvs. resursele de care are nevoie pentru a funcționa la un potențial de vârf cu propriul server dedicat. Servere rapide web pentru a rula aplicațiile cu acces root și garanție de Uptime de 100%.";
$_LANG['bannervpshead'] = "VPS Hosting";
$_LANG['bannervpshead2'] = "Configurați în câteva minute pentru a obține performanța de care aveți nevoie.";
$_LANG['bannervpsheadtext'] = "Oferim tuturor clienților instrumentele necesare pentru a obține o<br>pe deplin funcțional.";

$_LANG['banner4head'] = "<span> VÂNZARE VARĂ BIG </ span> <br> Gazduire comună de la numai £ 1.00 / lună *";
$_LANG['banner4truebussnes'] = "Încredere de afaceri britanice timp de 20 de ani";
$_LANG['banner4webspace'] = "Spațiu web nelimitat";
$_LANG['banner4freedomain'] = "Domeniu gratuit";
$_LANG['banner4ub'] = "Bandwidth nelimitat";


// language variable for navigation bar
$_LANG['clientAreaNavCustomHome'] = "Acasă";
$_LANG['clientAreaNavCustomMyServices'] = "Serviciile mele";
$_LANG['clientAreaNavCustomMyAccount'] = "Contul meu";
$_LANG['clientAreaNavCustomShopingCart'] = "Cărucior de cumpărături";

$_LANG['findyour'] = "Găsiți-vă";
$_LANG['mymessages'] = "Mesajele mele";
$_LANG['welcometo'] = "Bun venit la";
$_LANG['newdomain'] = "Domeniu nou";
$_LANG['choosemoreproduct'] = "Alegeți mai multe produse";

// language variable for home page domain block
$_LANG['domainBlockFindDomain'] = "Găsiți cel mai bun domeniu pentru dvs.";
$_LANG['domainBlockPlaceHolder'] = "Introduceți numele domeniului aici";
$_LANG['domainBlockTldCom'] = "com";
$_LANG['domainBlockTldCo'] = "co";
$_LANG['domainBlockTldNet'] = "net";
$_LANG['domainBlockTldInfo'] = "info";

// language variable for manage ssl page
$_LANG['manageSslDomain'] = "Domeniu";
$_LANG['manageSslProduct'] = "Produs SSL";
$_LANG['manageSslOrderDate'] = "Data comandă";
$_LANG['manageSslRenewDate'] = "Data reînnoirii";
$_LANG['manageSslAction'] = "acţiuni";
/*** V1.0.6 ******/
$_LANG['dedicatetabcontentantiddosc'] = "Anti-DDoS protection";
$_LANG['dedicatetabcontentantiddoshead'] = "infrastructures protected against DDoS attacks";
$_LANG['dedicatetabcontentantiddos'] = "All of our dedicated servers come with the powerful GNOME anti-DDoS protection. It absorbs distributed denial-of-service attacks, and ensures that your services are always available. Anti-DDoS protection is included with all of our servers";
$_LANG['antiddosprotection'] = "Keep your dedicated infrastructures protected against DDoS attacks.<br>GNOME offers the most powerful anti-DDoS solution on 
the market<br>It provides your services with round-the-clock protection against all types of DDoS attack, without any limitations in terms of volume or
 duration.";
 
 
 
 /* for v2.2.0 */
$_LANG['contactuspagemainhead'] = "Contactează-ne";
$_LANG['contactuspagemainsubhead'] = "pentru mai multe informatii";
$_LANG['contactuscompanyname'] = "Hostx Pvt Ltd.";
$_LANG['contactusaddress'] = "abcdd, Phase 123, Zona IND - Hotel Aproape Hotel Abcd, <br> XYZ, XYZ, XYZ 123456";
$_LANG['contactushotlinesale'] = "<b>Hotline:</b> +91 8360944358";
$_LANG['contactusbusinesshoursale'] = "<b>Serviciu </b> Ore: 9:00 - 18:00 (Luni - Sat)";
$_LANG['contactusemailssale'] = "<b>E-mail: </b> info@gmail.com";
$_LANG['contactushotlinecustomer'] = "<b> Linie directă: </b> +91 8360944358";
$_LANG['contactusbusinesshourcustomer'] = "<b> Serviciu </b> Ore: 9:00 - 18:00 (Luni - Sat)";
$_LANG['contactusemailscustomer'] = "<b>Email:</b> info@gmail.com";
$_LANG['contactushotlinetechnical'] = "<b>Hotline:</b> +91 8360944358";
$_LANG['contactusbusinesshourtechnical'] = "<b> Serviciu </b> Ore: 9:00 - 18:00 (Luni - Sat)";
$_LANG['contactusemailstechnical'] = "<b>Email:</b> info@gmail.com";
$_LANG['contactusemailssaleticket'] = "Bilet de vânzare";
$_LANG['contactusemailscustomerticket'] = "Bilet de servicii pentru clienți";
$_LANG['contactusemailstechnicalticket'] = "Bilet de asistență tehnică";
$_LANG['contactuslivechat'] = "Chat live";
$_LANG['contactussalemain'] = "Vânzări";
$_LANG['contactuscustomerservicemain'] = "Serviciu clienți";
$_LANG['contactustechnicalmain'] = "Asistență tehnică (24/7)";
$_LANG['contactussaleenquery'] = "Cerere de asistență pentru vânzări:";
$_LANG['contactuscustomerenquery'] = "Solicitare de asistență pentru clienți:";
$_LANG['contactustechenquery'] = "Cerere de asistență tehnică: verificați";
$_LANG['contactushotlinesale1'] = "<b>Hotline:</b>";
$_LANG['contactushotlinecustomer1'] = "<b>Hotline:</b>";
$_LANG['contactushotlinetechnical1'] = "<b>Hotline:</b>";

$_LANG['activedomiantitle'] = "Domenii active";
$_LANG['activedomiandesc'] = "Obțineți un domeniu nou sau consultați starea domeniilor înregistrate existente.";
$_LANG['opentickettitle'] = "Bilete deschise";
$_LANG['openticketdesc'] = "Ridicați bilete noi sau verificați detaliile și starea biletelor existente.";
$_LANG['unpaidinvoicetitle'] = "Facturi neplatite";
$_LANG['unpaidinvoicedesc'] = "Verificați starea facturilor și detaliile facturilor în așteptare.";
$_LANG['activeservicetitle'] = "Servicii active";
$_LANG['activeservicedesc'] = "Cumpărați suplimentar sau consultați serviciile existente alocate acestui cont.";
$_LANG['addnewproducttitle'] = "Adăugați produse noi în coș sau verificați ce așteaptă să continuați cumpărăturile.";
$_LANG['mydomaintitle'] = "Domeniile mele";
$_LANG['registernewdomain'] = "Înregistrează un domeniu nou";
$_LANG['myaffilates'] = "Afiliații mei";
$_LANG['mydashboard'] = "Bord";
$_LANG['myquotes'] = "Citatele mele";
$_LANG['activquotes'] = "Citate active";
$_LANG['myquotesdescp'] = "Verificați ofertele cu informații detaliate despre serviciile existente.";
$_LANG['mytickets'] = "Biletele mele";
$_LANG['affilatedescription'] = "În mod implicit, WHMCS a furnizat link-ul propriu de afiliere. Pe care trebuie să le împărtășiți cu prietenii sau membrii familiei.
 Când vor veni pe site-ul dvs. utilizând acel link de afiliere, atunci WHMCS îl gestionează singur.";
$_LANG['dedicatedSideBarRegions'] = "Toate regiunile";
$_LANG['dedicatedSideBarRegionsMenu'] = "Toate regiunile";
$_LANG['dedicatedSideBarServices'] = "SERVICII";
$_LANG['dedicatedSideBarPriceRange'] = "Pret in";
$_LANG['dedicatedSideBarRam'] = "RAM:";
$_LANG['dedicatedSideBarDisk'] = "discuri:";
/* for v2.2.0 */
$_LANG['activedomiantitle'] = "Domenii active";
$_LANG['activedomiandesc'] = "Obțineți un domeniu nou sau examinați starea domeniilor înregistrate existente.";
$_LANG['opentickettitle'] = "Bilete deschise";
$_LANG['openticketdesc'] = "Ridicați bilete noi sau verificați detaliile și starea biletelor existente.";
$_LANG['unpaidinvoicetitle'] = "Facturi neplatite";
$_LANG['unpaidinvoicedesc'] = "Verificați starea facturilor și detaliile facturilor în așteptare.";
$_LANG['activeservicetitle'] = "Servicii active";
$_LANG['activeservicedesc'] = "Cumpărați suplimentar sau examinați serviciile existente atribuite acestui cont.";
$_LANG['addnewproducttitle'] = "Adăugați produse noi în coș sau verificați ce așteaptă pentru a continua cumpărăturile.";
$_LANG['mydomaintitle'] = "Domeniile mele";
$_LANG['registernewdomain'] = "Înregistrați un domeniu nou";
$_LANG['myaffilates'] = "Afiliații mei";
$_LANG['mydashboard'] = "Bord";
$_LANG['myquotes'] = "Citatele mele";
$_LANG['activquotes'] = "Citate active";
$_LANG['myquotesdescp'] = "Verificați ofertele cu informații detaliate despre serviciile existente.";
$_LANG['mytickets'] = "Biletele mele";
$_LANG['affilatedescription'] = "WHMCS a furnizat implicit un link de afiliat propriu. Cu care trebuie să partajați
prietenii sau membrii familiei. Când vor veni pe site-ul dvs. folosind acel link de afiliere, atunci WHMCS îl gestionează singur.";
$_LANG['dedicatedSideBarRegions'] = "Toate regiunile";
$_LANG['dedicatedSideBarRegionsMenu'] = "Toate regiunile";
$_LANG['dedicatedSideBarServices'] = "SERVICII";
$_LANG['dedicatedSideBarPriceRange'] = "Preț în";
$_LANG['dedicatedSideBarRam'] = "Berbec:";
$_LANG['dedicatedSideBarDisk'] = "Discuri:";
$_LANG['dedicatetabcontent'] = "Găzduire cloud ultra rapidă";
$_LANG['dedicatetabcontentsimplicity'] = "Avantajele Cloud + Simplitatea găzduirii partajate";
$_LANG['primarySideBarText'] = "Primar";
$_LANG['secondarySideBarText'] = "Secundar";
$_LANG['domainAlreadyExist'] = "Domeniul deja în coș încearcă cu altul.";
$_LANG['domainTldPreffer'] = "TLD preferat nu este disponibil.";
$_LANG['fullDomainPricingTxt'] = "Tarifare completă a domeniului";
$_LANG['promotionPriceTxt'] = "* Prețurile promoționale se aplică numai în primul an";
$_LANG['domainNoHiddenFee'] = "Fără taxe ascunse!";
$_LANG['domain24Seven'] = "Suport 24/7";
$_LANG['domainFreeDnsHost'] = "Gazduire DNS GRATUITA";
$_LANG['domainFreeUrlForward'] = "Redirecționare URL GRATUITĂ";
$_LANG['domainFreeEmailForward'] = "Expediere GRATUITĂ de e-mail";
$_LANG['domainFindOutMore'] = "Vedeți mai multe produse";
$_LANG['fullReview'] = "Revizuire";
/* for v2.2.2 */
$_LANG['deliver_in'] = "Livrat in:";
$_LANG['configure_btn'] = "Configurați";
$_LANG['result_found'] = "Rezultate găsite";
$_LANG['dedicated_cpu'] = "CPU";
$_LANG['dedicated_ram'] = "Berbec";
$_LANG['dedicated_disk'] = "Discuri";