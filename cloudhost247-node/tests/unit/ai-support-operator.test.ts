import {describe,expect,it,vi} from 'vitest';
import {decideSupportResponse} from '../../src/services/ai-support-operator';
const db={query:vi.fn(async(sql: string)=>({rows:sql.includes('AS latest_status') ? [{indexed:'1',incomplete:'0',latest_status:'succeeded'}] : [{name:'Cloud VPS'}],rowCount:1}))} as any;
describe('embedded AI support operator',()=>{
 it('immediately escalates explicit human requests',async()=>{const result=await decideSupportResponse(db,'Please let me speak to a human agent');expect(result.kind).toBe('ESCALATE');expect(result.reason).toBe('USER_REQUESTED_HUMAN')});
 it('refuses to invent account-specific state',async()=>{const result=await decideSupportResponse(db,'Why is my server offline?');expect(result.kind).toBe('ESCALATE');expect(result.reason).toBe('ACCOUNT_SPECIFIC_REQUEST')});
 it('answers known platform questions from internal knowledge',async()=>{const result=await decideSupportResponse(db,'How do I update a DNS record for my domain?');expect(result.kind).toBe('ANSWER');expect(result.sources[0]).toContain('DNS');expect(result.body).toContain('DNS Management')});
 it('offers the distinct newsletter workflow',async()=>{const result=await decideSupportResponse(db,'Subscribe me to the newsletter');expect(result.kind).toBe('NEWSLETTER')});
 it('keeps newsletter consent in the conversation context',async()=>{const result=await decideSupportResponse(db,'yes',{previousMessages:[{author_type:'AI',body:'Would you like to subscribe to CloudHost247 updates?'}]});expect(result.kind).toBe('NEWSLETTER')});
 it('conservatively escalates unknown questions',async()=>{const result=await decideSupportResponse(db,'Can you forecast the weather next month?');expect(result.kind).toBe('ESCALATE');expect(result.reason).toBe('AI_UNABLE_TO_ANSWER')});
});

/**
 * Conversational openers were previously answered from retrieval, which has nothing to match on:
 * "hi" returned a business-hosting paragraph and "ok" returned VPS deployment runbook steps. These
 * tests pin the conversational handling so a future change cannot silently reintroduce that.
 */
describe('embedded AI support operator — conversational replies',()=>{
 const answer=async(message:string,context={})=>decideSupportResponse(db,message,context);
 it.each(['hi','hello','hey there','good morning','Hello!'] )('greets back instead of answering from retrieval: %s',async(greeting)=>{
  const result=await answer(greeting);
  expect(result.kind).toBe('ANSWER');
  expect(result.intent).toBe('greeting');
  expect(result.body).toMatch(/welcome to CloudHost247/i);
 });
 it.each(['thanks','thank you','thanks so much','cheers'])('acknowledges thanks: %s',async(thanks)=>{
  const result=await answer(thanks);
  expect(result.kind).toBe('ANSWER');
  expect(result.intent).toBe('thanks');
 });
 it.each(['ok','okay','got it','perfect','nice'])('acknowledges a bare acknowledgement: %s',async(ack)=>{
  const result=await answer(ack);
  expect(result.kind).toBe('ANSWER');
  expect(result.intent).toBe('acknowledgement');
 });
 it('does not treat a greeting that carries a real question as small talk',async()=>{
  const result=await answer('hi, do you offer wordpress hosting?');
  expect(result.intent).not.toBe('greeting');
 });
 it('still treats "ok" as newsletter consent when a subscription was just offered',async()=>{
  const result=await answer('ok',{previousMessages:[{author_type:'AI',body:'Would you like to subscribe to CloudHost247 updates?'}]});
  expect(result.kind).toBe('NEWSLETTER');
 });
 it('offers verified destinations in a greeting',async()=>{
  const result=await answer('hello');
  expect(result.links?.length).toBeGreaterThan(0);
  for(const link of result.links ?? []) expect(link.url.startsWith('/')).toBe(true);
 });
});

/**
 * A message that reports a fault without naming the subject ("it is not working") used to be
 * answered from retrieval with whatever page happened to share a word — Google Workspace marketing
 * copy, in one measured case. A good agent asks which service instead of guessing.
 */
describe('embedded AI support operator — vague messages',()=>{
 it.each(['I have a problem','it is not working','something is broken','this is not working','I got an error'])('asks what is affected instead of guessing: %s',async(message)=>{
  const result=await decideSupportResponse(db,message);
  expect(result.kind).toBe('CLARIFY');
  expect(result.intent).toBe('vague_problem');
 });
 it.each(['help','I need help','can you help me','I need help with something'])('asks for the subject when help is requested without one: %s',async(message)=>{
  const result=await decideSupportResponse(db,message);
  expect(result.kind).toBe('CLARIFY');
  expect(result.intent).toBe('vague_help');
 });
 it('does not claim the knowledge system is down when nothing was asked',async()=>{
  const result=await decideSupportResponse(db,'?');
  expect(result.kind).toBe('CLARIFY');
  expect(result.reason).toBeUndefined();
  expect(result.body).not.toMatch(/knowledge system/i);
 });
 it('still escalates an account-specific fault rather than merely clarifying',async()=>{
  const result=await decideSupportResponse(db,'my website is not working');
  expect(result.kind).toBe('ESCALATE');
 });
});

/**
 * A defect reported against the customer's own service ("my website is slow") was previously
 * answered from retrieval with "Do I need hosting to use the website builder?" at 0.55 confidence —
 * a confident, irrelevant answer about something nobody asked. It is account-specific, so it must
 * escalate and hand over the destinations that actually help.
 */
describe('embedded AI support operator — owned-service faults',()=>{
 it.each([
  'my website is slow',
  'my email is not arriving',
  'my website is down',
  'my vps keeps crashing',
  'my domain is not resolving',
 ])('escalates a fault reported against the customer\'s own service: %s',async(message)=>{
  const result=await decideSupportResponse(db,message);
  expect(result.kind).toBe('ESCALATE');
  expect(result.reason).toBe('TECHNICAL_SUPPORT_REQUIRED');
 });
 it('offers the status page and help centre with the escalation',async()=>{
  const result=await decideSupportResponse(db,'my website is slow');
  const urls=(result.links ?? []).map((link)=>link.url);
  expect(urls).toContain('/status');
  expect(urls).toContain('/help');
 });
 it('keeps a how-to question procedural instead of treating it as an owned-service fault',async()=>{
  // "how do I make my site faster" asks about the platform; it is not a report about an account.
  // Asserted on the classified branch, not the final kind: this harness has no knowledge index, so
  // a non-fault question legitimately fails closed as "could not answer" here.
  const result=await decideSupportResponse(db,'how do I make my website faster');
  expect(result.intent).toBe('how_to');
  expect(result.reason).not.toBe('TECHNICAL_SUPPORT_REQUIRED');
 });
 it('does not answer a plain platform question as an owned-service fault',async()=>{
  const result=await decideSupportResponse(db,'do you offer ssl certificates');
  expect(result.intent).not.toBe('owned_service_incident');
 });
});

/**
 * The refund guard is meant for demands on an account, not for questions about the published
 * policy. Before this, "what is the refund policy" refused to answer even though /refund-policy is
 * a public page the retrieval layer can quote.
 */
describe('embedded AI support operator — refund policy vs refund demand',()=>{
 it.each(['what is the refund policy','refund policy','tell me about your refund policy'])('routes a question about the published policy to retrieval, not the refund guard: %s',async(message)=>{
  // The refund guard must not claim it. In this harness retrieval then fails closed for lack of an
  // index, so the assertion is on the branch (it must not be the REFUND_REQUEST escalation) rather
  // than on kind. The live-corpus behaviour is covered by the integration suite.
  const result=await decideSupportResponse(db,message);
  expect(result.reason).not.toBe('REFUND_REQUEST');
 });
 it.each(['I want a refund','can you refund my invoice','refund my payment','give me a refund'])('still escalates a first-person refund demand: %s',async(message)=>{
  const result=await decideSupportResponse(db,message);
  expect(result.kind).toBe('ESCALATE');
  expect(result.reason).toBe('REFUND_REQUEST');
 });
});
