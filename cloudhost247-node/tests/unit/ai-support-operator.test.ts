import {describe,expect,it,vi} from 'vitest';
import {decideSupportResponse} from '../../src/services/ai-support-operator';
const db={query:vi.fn(async()=>({rows:[{name:'Cloud VPS'}],rowCount:1}))} as any;
describe('embedded AI support operator',()=>{
 it('immediately escalates explicit human requests',async()=>{const result=await decideSupportResponse(db,'Please let me speak to a human agent');expect(result.kind).toBe('ESCALATE');expect(result.reason).toBe('USER_REQUESTED_HUMAN')});
 it('refuses to invent account-specific state',async()=>{const result=await decideSupportResponse(db,'Why is my server offline?');expect(result.kind).toBe('ESCALATE');expect(result.reason).toBe('ACCOUNT_SPECIFIC_REQUEST')});
 it('answers known platform questions from internal knowledge',async()=>{const result=await decideSupportResponse(db,'How do I update a DNS record for my domain?');expect(result.kind).toBe('ANSWER');expect(result.sources[0]).toContain('DNS');expect(result.body).toContain('DNS Management')});
 it('offers the distinct newsletter workflow',async()=>{const result=await decideSupportResponse(db,'Subscribe me to the newsletter');expect(result.kind).toBe('NEWSLETTER')});
 it('keeps newsletter consent in the conversation context',async()=>{const result=await decideSupportResponse(db,'yes',{previousMessages:[{author_type:'AI',body:'Would you like to subscribe to CloudHost247 updates?'}]});expect(result.kind).toBe('NEWSLETTER')});
 it('conservatively escalates unknown questions',async()=>{const result=await decideSupportResponse(db,'Can you forecast the weather next month?');expect(result.kind).toBe('ESCALATE');expect(result.reason).toBe('AI_UNABLE_TO_ANSWER')});
});
