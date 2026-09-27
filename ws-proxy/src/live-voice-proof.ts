/** Shared byte-for-byte with the isolated Worker's live-voice-proof.ts. Web Crypto only. */
export const LIVE_VOICE_PROOF_TTL_MS=900_000;
export interface LiveVoiceProof {
    aud:'doubao-realtime-proof';sub:string;assetId:string;speakerId:string;providerAppSha256:string;model:'2.2.0.0';
    sessionId:string;replyId:string;audioSha256:string;audioBytes:number;issuedAt:number;expiresAt:number;providerLogId:string|null;
}
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const digest=/^[a-f0-9]{64}$/,id=/^[A-Za-z0-9_-]{1,128}$/;
function valid(value:unknown,now:number,allowExpired=false):value is LiveVoiceProof {
    if(!value||typeof value!=='object'||Array.isArray(value)||!Number.isSafeInteger(now))return false;
    const r=value as LiveVoiceProof;
    return Object.keys(r).sort().join(',')==='assetId,aud,audioBytes,audioSha256,expiresAt,issuedAt,model,providerAppSha256,providerLogId,replyId,sessionId,speakerId,sub'
        &&r.aud==='doubao-realtime-proof'&&typeof r.sub==='string'&&uuid.test(r.sub)&&typeof r.assetId==='string'&&uuid.test(r.assetId)
        &&typeof r.speakerId==='string'&&/^S_[A-Za-z0-9_]{1,126}$/.test(r.speakerId)
        &&typeof r.providerAppSha256==='string'&&digest.test(r.providerAppSha256)&&r.model==='2.2.0.0'
        &&typeof r.sessionId==='string'&&id.test(r.sessionId)&&typeof r.replyId==='string'&&id.test(r.replyId)
        &&typeof r.audioSha256==='string'&&digest.test(r.audioSha256)&&Number.isSafeInteger(r.audioBytes)
        &&r.audioBytes>=9600&&r.audioBytes<=1048576&&r.audioBytes%2===0
        &&Number.isSafeInteger(r.issuedAt)&&Number.isSafeInteger(r.expiresAt)&&r.issuedAt>0&&r.issuedAt<=now+5000
        &&(allowExpired||r.expiresAt>now)&&r.expiresAt>r.issuedAt&&r.expiresAt-r.issuedAt<=LIVE_VOICE_PROOF_TTL_MS
        &&(r.providerLogId===null||typeof r.providerLogId==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(r.providerLogId));
}
function encode(bytes:Uint8Array):string {let value='';for(let i=0;i<bytes.length;i++)value+=String.fromCharCode(bytes[i]);return btoa(value).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function decode(value:string):Uint8Array|null {
    if(!/^[A-Za-z0-9_-]+$/.test(value))return null;
    try{const binary=atob(value.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-value.length%4)%4));
        const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));return encode(bytes)===value?bytes:null;
    }catch{return null;}
}
async function key(secret:string,usage:'sign'|'verify'){
    if(typeof secret!=='string'||secret.length<32||secret.length>4096)throw Error('Voice proof signing is unavailable.');
    return crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,[usage]);
}
export async function signLiveVoiceProof(secret:string,value:LiveVoiceProof,now=Date.now()):Promise<string>{
    if(!valid(value,now))throw Error('Invalid private realtime voice proof.');
    const body=encode(new TextEncoder().encode(JSON.stringify(value))),message='vr1.'+body;
    const signature=new Uint8Array(await crypto.subtle.sign('HMAC',await key(secret,'sign'),new TextEncoder().encode(message)));
    return message+'.'+encode(signature);
}
export async function verifyLiveVoiceProof(secret:string,token:string,now=Date.now()):Promise<LiveVoiceProof|null>{
    const proof=await verifyLiveVoiceProofForReconciliation(secret,token,now);
    return proof&&proof.expiresAt>now?proof:null;
}
/** Expired signatures are useful only to read an already accepted receipt. Never authorize a new write. */
export async function verifyLiveVoiceProofForReconciliation(secret:string,token:string,now=Date.now()):Promise<LiveVoiceProof|null>{
    try{
        if(typeof token!=='string'||token.length>4096)return null;
        const parts=token.split('.');if(parts.length!==3||parts[0]!=='vr1')return null;
        const bytes=decode(parts[1]),signature=decode(parts[2]);if(!bytes||!signature||signature.length!==32)return null;
        if(!await crypto.subtle.verify('HMAC',await key(secret,'verify'),new Uint8Array(signature).buffer,new TextEncoder().encode('vr1.'+parts[1])))return null;
        const raw=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes),value=JSON.parse(raw);
        if(JSON.stringify(value)!==raw||!valid(value,now,true))return null;return value;
    }catch{return null;}
}
