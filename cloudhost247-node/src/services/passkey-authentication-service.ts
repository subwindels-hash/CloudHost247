import { createHash, createHmac, randomUUID } from 'node:crypto';
import { generateAuthenticationOptions, verifyAuthenticationResponse, type AuthenticationResponseJSON } from '@simplewebauthn/server';
import type { Env } from '../config/env';
import type { Queryable } from '../db/types';
import { withTransaction } from '../db/transaction';
import { relyingParty } from './passkey-service';

const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
const challenge=(secret:string,id:string)=>createHmac('sha256',secret).update(`cloudhost247:webauthn-authentication:v1:${id}`).digest('base64url');
export async function beginPasskeyAuthentication(db:Queryable,env:Pick<Env,'APP_URL'|'JWT_SECRET'>,user:{id:string;authSessionVersion:number}) {
 const {rpID}=relyingParty(env); const keys=await db.query<{credential_id:string;transports:string[]}>(`SELECT credential_id,transports FROM user_passkeys WHERE user_id=$1`,[user.id]); if(!keys.rows.length)return null;
 const id=randomUUID(), raw=challenge(env.JWT_SECRET,id); const options=await generateAuthenticationOptions({rpID,challenge:raw,userVerification:'required',allowCredentials:keys.rows.map(k=>({id:k.credential_id,transports:k.transports}))});
 await db.query(`INSERT INTO webauthn_authentication_challenges (id,user_id,challenge_hash,session_version,expires_at) VALUES ($1,$2,$3,$4,now() + interval '5 minutes')`,[id,user.id,hash(raw),user.authSessionVersion]); return {challengeId:id,options};
}
export async function finishPasskeyAuthentication(db:Queryable,env:Pick<Env,'APP_URL'|'JWT_SECRET'>,challengeId:string,response:AuthenticationResponseJSON) {
 const {rpID,origin}=relyingParty(env); return withTransaction(db,async tx=>{const c=(await tx.query<{user_id:string;session_version:number;expires_at:string;used_at:string|null}>(`SELECT * FROM webauthn_authentication_challenges WHERE id=$1 FOR UPDATE`,[challengeId])).rows[0]; if(!c||c.used_at||new Date(c.expires_at).getTime()<=Date.now())return null;
 const current=(await tx.query<{auth_session_version:number}>(`SELECT auth_session_version FROM users WHERE id=$1 FOR UPDATE`,[c.user_id])).rows[0]; if(!current||current.auth_session_version!==c.session_version){await tx.query(`UPDATE webauthn_authentication_challenges SET used_at=now() WHERE id=$1`,[challengeId]);return null;}
 const key=(await tx.query<{credential_id:string;public_key:Buffer;counter:number;transports:string[]}>(`SELECT credential_id,public_key,counter,transports FROM user_passkeys WHERE user_id=$1 AND credential_id=$2 FOR UPDATE`,[c.user_id,response.id])).rows[0]; if(!key)return null;
 const verification=await verifyAuthenticationResponse({response,expectedChallenge:challenge(env.JWT_SECRET,challengeId),expectedOrigin:origin,expectedRPID:rpID,requireUserVerification:true,credential:{id:key.credential_id,publicKey:new Uint8Array(key.public_key),counter:key.counter,transports:key.transports}});if(!verification.verified)return null;
 await tx.query(`UPDATE webauthn_authentication_challenges SET used_at=now() WHERE id=$1`,[challengeId]);await tx.query(`UPDATE user_passkeys SET counter=$2,last_used_at=now(),updated_at=now() WHERE credential_id=$1`,[key.credential_id,verification.authenticationInfo.newCounter]);return {userId:c.user_id,sessionVersion:c.session_version};});
}
