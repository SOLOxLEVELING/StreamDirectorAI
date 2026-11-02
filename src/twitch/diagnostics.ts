export type FailureCategory = 'timeout' | 'network' | 'authorization' | 'forbidden' | 'rate_limited' | 'upstream' | 'http' | 'invalid_response' | 'storage' | 'unknown';
export type IntegrationOperation = 'connection_setup' | 'socket_tick' | 'token_validation' | 'stream_lookup' | 'subscription_create' | 'notification_ingest' | 'detector_tick' | 'coverage_persistence' | 'manual_mark' | 'capability_probe' | 'caption_job' | 'background_tick' | 'http_request';
const categories: FailureCategory[] = ['timeout','network','authorization','forbidden','rate_limited','upstream','http','invalid_response','storage','unknown'];
export class IntegrationFailure extends Error {
  category: FailureCategory; httpStatus?: number;
  constructor(category: FailureCategory, message: string, httpStatus?: number) { super(message); this.category=category; this.httpStatus=httpStatus; }
}
export function httpCategory(status: number): FailureCategory {
  return status===401?'authorization':status===403?'forbidden':status===429?'rate_limited':status>=500?'upstream':'http';
}
// Never serialize messages, stacks, causes, URLs, headers or provider response bodies.
export function failureFields(error: unknown): { category: FailureCategory; httpStatus?: number } {
  try {
    if(error instanceof IntegrationFailure) return {category:categories.includes(error.category)?error.category:'unknown',
      ...(Number.isInteger(error.httpStatus)&&error.httpStatus!>=100&&error.httpStatus!<=599?{httpStatus:error.httpStatus}:{} )};
    if(error instanceof Error && ['TimeoutError','AbortError'].includes(error.name)) return {category:'timeout'};
    const code=error&&typeof error==='object'?Object.getOwnPropertyDescriptor(error,'code')?.value:null;
    if(['SQLITE_BUSY','SQLITE_FULL','SQLITE_IOERR','SQLITE_READONLY','ERR_SQLITE_ERROR','ENOSPC','EIO','EACCES'].includes(code))return {category:'storage'};
    if(['ECONNRESET','ECONNREFUSED','ENOTFOUND','EAI_AGAIN','ETIMEDOUT'].includes(code))return {category:code==='ETIMEDOUT'?'timeout':'network'};
  } catch { /* Even an error with hostile getters is untrusted. */ }
  return {category:'unknown'};
}
export async function fetchSafe(fetcher:(url:string,init?:RequestInit)=>Promise<Response>, url:string, init:RequestInit) {
  try{return await fetcher(url,init);}catch(error){
    const category=failureFields(error).category==='timeout'?'timeout':'network';
    throw new IntegrationFailure(category,'Twitch network request failed');
  }
}
export async function jsonSafe(response:Response):Promise<unknown>{
  try{return await response.json();}catch{throw new IntegrationFailure('invalid_response','Invalid Twitch response',response.status);}
}
const publicMessages=new Set([
  'Set TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET in .env','OAuth state missing, expired or invalid; start sign-in again',
  'Different broadcaster; disconnect first','Twitch sign-in required','Twitch sign-in changed; start sign-in again',
  'Twitch sign-in requires validation','A verified active Twitch stream is required','Sign in with Twitch first',
  'Token belongs to a different application or is not a valid user token','Invalid token response',
]);
export function publicFailure(error:unknown){
  if(error instanceof IntegrationFailure){const safe=failureFields(error);return `Twitch operation failed: ${safe.category}${safe.httpStatus?` (HTTP ${safe.httpStatus})`:''}; inspect local diagnostics.`;}
  if(error instanceof Error&&publicMessages.has(error.message))return error.message;
  return 'Operation failed; inspect local setup and sanitized integration diagnostics';
}
