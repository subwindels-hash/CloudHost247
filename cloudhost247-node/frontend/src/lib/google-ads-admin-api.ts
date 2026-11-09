import { apiFetch } from './api';
export const GOOGLE_ADS_ADMIN_API='/api/v1/admin/marketing-integrations/google-ads';
export const GOOGLE_ADS_ACTIONS=['purchase','lead','sign_up','contact','begin_checkout','add_to_cart','subscription','renewal','upgrade'] as const;
export type GoogleAdsAction=typeof GOOGLE_ADS_ACTIONS[number];
export interface GoogleAdsAdminConfiguration {
  providerKey:'google_ads';displayName:string;websiteDomain:string;enabled:boolean;customerId:string;conversionId:string;defaultCurrency:string;
  remarketingEnabled:boolean;enhancedConversionsEnabled:false;actions:Record<GoogleAdsAction,{label:string;primary:boolean}>;revision:number;
  lastConfigurationUpdate:string|null;lastConfigurationTestAt:string|null;lastConfigurationTestStatus:string|null;linkerStatus:string;diagnostic:string;
  dynamicRemarketing:false;lastConversionDeliveryStatus:string;
}
export function getGoogleAdsConfiguration(){return apiFetch<{configuration:GoogleAdsAdminConfiguration}>(GOOGLE_ADS_ADMIN_API);}
export function googleAdsAdminSend<T>(method:'PUT'|'POST',path:string,body:unknown){return apiFetch<T>(`${GOOGLE_ADS_ADMIN_API}${path}`,{method,body:JSON.stringify(body)});}
