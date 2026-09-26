import {readDoubaoClientFrame} from './doubao-frame-guard';
import {signLiveVoiceProof,LIVE_VOICE_PROOF_TTL_MS,type LiveVoiceProof} from './live-voice-proof';
import type {LiveVoiceGrant} from './live-voice-grant';

type ServerFrame={event:number;sessionId:string;payload:Uint8Array;json:Record<string,unknown>|null};
const tracked=new Set([150,152,153,350,351,352,359,599]),id=/^[A-Za-z0-9_-]{1,128}$/;
function frame(data:unknown):ServerFrame|'ignored'|null {
    if(!(data instanceof ArrayBuffer)||data.byteLength<8||data.byteLength>1048576+256)return null;
    const view=new DataView(data),type=view.getUint8(1);
    if(view.getUint8(0)!==0x11||![0x94,0xb4].includes(type)||view.getUint8(3)!==0)return null;
    const event=view.getUint32(4);if(!tracked.has(event))return 'ignored';
    const encoding=view.getUint8(2);if(encoding!==(event===352?0:0x10)||type!==(event===352?0xb4:0x94))return null;
    try{
        let offset=8;const length=view.getUint32(offset);offset+=4;
        if(length<1||length>128||offset+length+4>data.byteLength)return null;
        const sessionId=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(new Uint8Array(data,offset,length));offset+=length;
        if(!id.test(sessionId))return null;
        const size=view.getUint32(offset);offset+=4;if(offset+size!==data.byteLength||event!==352&&size>16384)return null;
        const payload=new Uint8Array(data,offset,size);
        if(event===352)return size>0&&size%2===0?{event,sessionId,payload,json:null}:null;
        const json=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(payload));
        return json&&typeof json==='object'&&!Array.isArray(json)?{event,sessionId,payload,json}:null;
    }catch{return null;}
}

/** Observes only admitted client frames and the authenticated supplier socket. Never modifies transport. */
export function createPrivateVoiceProofObserver({grant,secret,providerLogId,onProof,now=Date.now}:{
    grant:LiveVoiceGrant;secret:string;providerLogId:string|null;onProof:(token:string)=>void;now?:()=>number;
}){
    let sessionId:string|null=null,ready=false,replyId:string|null=null,chunks:Uint8Array[]=[],bytes=0,nonzero=false;
    let disabled=false,closed=false,issued=false,pending=Promise.resolve();
    const interrupted=new Set<string>();
    const clearReply=()=>{chunks=[];bytes=0;nonzero=false;replyId=null;};
    const disable=()=>{disabled=true;ready=false;clearReply();};
    if(!grant.assetId||!grant.providerAppSha256||!/^S_[A-Za-z0-9_]{1,126}$/.test(grant.speakerId)||grant.model!=='2.2.0.0')disable();
    return {
        client(data:unknown){
            if(disabled||closed||issued)return;
            const incoming=readDoubaoClientFrame(data);if(!incoming){disable();return;}
            if(incoming.event===100){
                const config=incoming.json?.tts as Record<string,unknown>|undefined;
                const extra=(incoming.json?.dialog as Record<string,unknown>|undefined)?.extra as Record<string,unknown>|undefined;
                if(sessionId||config?.speaker!==grant.speakerId||extra?.model!==grant.model){disable();return;}
                const audio=config.audio_config as Record<string,unknown>|undefined;
                if(audio?.format!=='pcm_s16le'||audio.sample_rate!==24000||audio.channel!==1){disable();return;}
                sessionId=incoming.sessionId;ready=false;clearReply();
            }else if(incoming.event===515){if(!replyId){disable();return;}interrupted.add(replyId);clearReply();if(interrupted.size>8)disable();}
            else if(incoming.event===102||incoming.event===2){sessionId=null;ready=false;clearReply();}
        },
        server(data:unknown){
            if(disabled||closed||issued)return;
            const incoming=frame(data);if(incoming===null){disable();return;}if(incoming==='ignored')return;
            if(!sessionId||incoming.sessionId!==sessionId){disable();return;}
            if(incoming.event===153||incoming.event===599){disable();return;}
            if(incoming.event===150){if(ready){disable();return;}ready=true;return;}
            if(incoming.event===152){sessionId=null;ready=false;clearReply();return;}
            if(!ready){disable();return;}
            if(incoming.event===350){
                const next=incoming.json?.reply_id;
                if(typeof next!=='string'||!id.test(next)){disable();return;}
                if(interrupted.has(next)){clearReply();return;}
                if(next!==replyId){clearReply();replyId=next;}return;
            }
            if(incoming.event===352){
                if(!replyId||bytes+incoming.payload.length>1048576){disable();return;}
                const copy=incoming.payload.slice();chunks.push(copy);bytes+=copy.length;nonzero=nonzero||copy.some(value=>value!==0);return;
            }
            if(incoming.event!==359)return;
            if(!replyId||incoming.json?.reply_id!==replyId||incoming.json?.no_content!==false||!nonzero||bytes<9600){clearReply();return;}
            const pcm=new Uint8Array(bytes);let offset=0;for(const part of chunks){pcm.set(part,offset);offset+=part.length;}
            const selected={sessionId,replyId,audioBytes:bytes};clearReply();issued=true;
            // At most one bounded hash/sign operation per connection; audio forwarding remains synchronous.
            pending=(async()=>{
                const digest=await crypto.subtle.digest('SHA-256',pcm),issuedAt=now();
                const proof:LiveVoiceProof={aud:'doubao-realtime-proof',sub:grant.sub,assetId:grant.assetId!,speakerId:grant.speakerId,
                    providerAppSha256:grant.providerAppSha256!,model:'2.2.0.0',...selected,
                    audioSha256:Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join(''),
                    issuedAt,expiresAt:issuedAt+LIVE_VOICE_PROOF_TTL_MS,
                    providerLogId:providerLogId&&/^[A-Za-z0-9_-]{1,160}$/.test(providerLogId)?providerLogId:null};
                const token=await signLiveVoiceProof(secret,proof,issuedAt);if(!closed)onProof(token);
            })().catch(()=>{disabled=true;});
        },
        close(){closed=true;ready=false;clearReply();interrupted.clear();},
        idle(){return pending;},
    };
}
