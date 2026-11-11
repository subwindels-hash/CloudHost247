/** Safe verification states, not calibrated answer probabilities or raw backend errors. */
export type KnowledgeFailure = 'INDEX_NOT_READY' | 'INDEX_STATUS_UNAVAILABLE' | 'SEARCH_UNAVAILABLE' | 'TRUST_METADATA_UNAVAILABLE' | 'SOURCE_CONFLICT' | 'SOURCE_NOT_CURRENT';

export const KNOWLEDGE_UNAVAILABLE_MESSAGE =
  'I’m temporarily unable to verify this against CloudHost247’s published information because the knowledge system is unavailable or updating. '
  + 'That does not mean the information is missing from the website. I will not guess. '
  + 'I can pass this conversation to CloudHost247 Support for verification.';

export function knowledgeFailureMessage(failure: KnowledgeFailure): string {
  if (failure === 'SOURCE_CONFLICT') return 'I found conflicting published information and cannot safely determine which statement applies. I will not guess. I can pass this conversation to CloudHost247 Support for verification.';
  if (failure === 'SOURCE_NOT_CURRENT') return 'I could not verify that the relevant information is current and approved for this revision. I will not present outdated information as current. I can pass this conversation to CloudHost247 Support for verification.';
  return KNOWLEDGE_UNAVAILABLE_MESSAGE;
}
