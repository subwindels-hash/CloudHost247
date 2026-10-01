import type { Queryable } from '../db/types';

export type EscalationReason='USER_REQUESTED_HUMAN'|'AI_UNABLE_TO_ANSWER'|'ACCOUNT_SPECIFIC_REQUEST'|'BILLING_SUPPORT_REQUIRED'|'TECHNICAL_SUPPORT_REQUIRED'|'SERVER_SUPPORT_REQUIRED'|'COMPLAINT'|'REFUND_REQUEST'|'SECURITY_RELATED'|'OTHER';
export interface OperatorDecision{kind:'ANSWER'|'ESCALATE'|'NEWSLETTER';body:string;intent:string;confidence:number;sources:string[];reason?:EscalationReason}

const HUMAN=/\b(human|real person|live agent|support (agent|representative)|speak to (someone|support)|talk to (someone|support)|transfer (me|this chat)|human assistance)\b/i;
const NEWSLETTER=/\b(newsletter|mailing list|subscribe|service announcements|updates and offers)\b/i;
const ACCOUNT=/\b(my (account|invoice|payment|order|refund)|password|credential|api key|why (was|is) my|payment status|server status)\b/i;
const SECURITY=/\b(hacked|breach|compromised|stolen password|security incident|abuse)\b/i;
const REFUND=/\b(refund|chargeback|money back|cancel.*payment)\b/i;

const knowledge=[
 {intent:'domain_dns',match:/\b(domain|dns|nameserver|a record|mx record)\b/i,body:'You can manage domains and DNS from your CloudHost247 dashboard. Open Domains, select the domain, then use DNS Management to add or update records. DNS changes can take time to propagate. Use only the record values supplied by the service you are connecting.',source:'CloudHost247 domain and DNS management'},
 {intent:'support',match:/\b(ticket|support|help desk|contact support)\b/i,body:'Authenticated customers can open and track support tickets from the Support area. I can also transfer this conversation to the support queue.',source:'CloudHost247 support workflow'},
 {intent:'vps',match:/\b(vps|cloud server|dedicated server|reinstall|reboot|console|snapshot)\b/i,body:'CloudHost247 server customers can view supported operations from the server dashboard. Available actions depend on the configured provider and product. Reinstalling an operating system is destructive and must be explicitly confirmed.',source:'CloudHost247 server management'},
 {intent:'ssl',match:/\b(ssl|certificate|https|tls)\b/i,body:'SSL certificates and their status are managed from the SSL area of the CloudHost247 dashboard. Certificate availability and validation depend on the selected service and domain configuration.',source:'CloudHost247 SSL management'},
 {intent:'hosting',match:/\b(web hosting|wordpress|cpanel|control panel|website deployment|hosting plan)\b/i,body:'CloudHost247 offers hosting products through its live service catalog. Current plans, published prices, and features are shown on the relevant product page; I will not quote unpublished or unavailable plans.',source:'CloudHost247 service catalog'},
 {intent:'email',match:/\b(business email|smtp|mailbox|email hosting)\b/i,body:'CloudHost247 email and SMTP offerings are listed in the live service catalog. For account-specific delivery or mailbox problems, I should transfer you to support rather than guess.',source:'CloudHost247 email services'},
 {intent:'billing',match:/\b(billing|invoice|renewal|payment method|pay invoice)\b/i,body:'Invoices, payments, and renewal details are available in the authenticated Billing area. I cannot infer an individual payment or refund status from chat; account-specific billing questions require support.',source:'CloudHost247 billing workflow'},
];

export async function decideSupportResponse(db:Queryable,message:string):Promise<OperatorDecision>{
 const text=message.trim();
 if(HUMAN.test(text))return{kind:'ESCALATE',body:'I’ll check whether a CloudHost247 support representative is available.',intent:'human_request',confidence:1,sources:[],reason:'USER_REQUESTED_HUMAN'};
 if(SECURITY.test(text))return{kind:'ESCALATE',body:'Security-related requests need a human support representative. I will preserve this conversation and escalate it.',intent:'security',confidence:1,sources:[],reason:'SECURITY_RELATED'};
 if(REFUND.test(text))return{kind:'ESCALATE',body:'Refund decisions require CloudHost247 Support. I will preserve this conversation and connect it to the support queue.',intent:'refund',confidence:1,sources:[],reason:'REFUND_REQUEST'};
 if(NEWSLETTER.test(text))return{kind:'NEWSLETTER',body:'Would you like to subscribe to CloudHost247 updates, offers and service announcements? Please provide your full name and email in the subscription form.',intent:'newsletter',confidence:1,sources:['CloudHost247 newsletter']};
 if(ACCOUNT.test(text))return{kind:'ESCALATE',body:'I cannot safely determine account-specific information from a general chat response. I can transfer this conversation to CloudHost247 Support.',intent:'account_specific',confidence:.98,sources:[],reason:'ACCOUNT_SPECIFIC_REQUEST'};
 const item=knowledge.find(k=>k.match.test(text));
 if(item){
   // Confirm that the answer's product family exists in the platform catalog where applicable.
   const catalog=await db.query<{name:string}>(`SELECT name FROM products WHERE status='active' AND visibility='public' ORDER BY name LIMIT 100`);
   return{kind:'ANSWER',body:item.body,intent:item.intent,confidence:.88,sources:[item.source,...catalog.rows.slice(0,3).map(r=>`Catalog: ${r.name}`)]};
 }
 return{kind:'ESCALATE',body:"I don’t have enough verified CloudHost247 information to answer that accurately. I can transfer this conversation to CloudHost247 Support.",intent:'unknown',confidence:.15,sources:[],reason:'AI_UNABLE_TO_ANSWER'};
}
