/** Server/Worker only. A private voice must use its verified owning application. */
export type VolcengineApplication = {appId:string;accessKey:string};
export type VolcengineApplicationEnvironment = {appId?:string;accessKey?:string;registry?:string};
const validPair=(value:unknown):value is VolcengineApplication=>{
    if(!value||typeof value!=='object'||Array.isArray(value))return false;
    const pair=value as VolcengineApplication;
    return Object.keys(pair).sort().join(',')==='accessKey,appId'
        &&typeof pair.appId==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(pair.appId)
        &&typeof pair.accessKey==='string'&&/^[\x21-\x7e]{1,2048}$/.test(pair.accessKey);
};
export async function volcengineApplicationSha256(appId:string):Promise<string>{
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(appId));
    return Array.from(new Uint8Array(digest)).map(value=>value.toString(16).padStart(2,'0')).join('');
}

/** No fallback to the default or another app when a private application is missing. */
export async function resolveVolcengineApplication(env:VolcengineApplicationEnvironment,expectedSha256:string):Promise<VolcengineApplication|null>{
    if(!/^[a-f0-9]{64}$/.test(expectedSha256))throw Error('Invalid voice application identity');
    const pairs:VolcengineApplication[]=[];
    const defaults={appId:env.appId,accessKey:env.accessKey};
    if(validPair(defaults))pairs.push(defaults);
    if(env.registry){
        if(env.registry.length>32768)throw Error('Voice application configuration is invalid');
        let value:any;try{value=JSON.parse(env.registry);}catch{throw Error('Voice application configuration is invalid');}
        if(!value||Object.keys(value).sort().join(',')!=='applications,version'||value.version!==1
            ||!Array.isArray(value.applications)||value.applications.length>16||!value.applications.every(validPair))
            throw Error('Voice application configuration is invalid');
        for(const pair of value.applications){
            const existing=pairs.find(item=>item.appId===pair.appId);
            if(existing)throw Error('Voice application configuration is ambiguous');
            pairs.push(pair);
        }
    }
    for(const pair of pairs)if(await volcengineApplicationSha256(pair.appId)===expectedSha256)return pair;
    return null;
}
