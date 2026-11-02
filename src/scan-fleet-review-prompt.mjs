import {scanFleetSignature} from '../scan-fleet-assignment.mjs';

// Corrections change the signature; the prompt belongs to the whole card.
export const fleetReviewKey=card=>card.id;

export function nextFleetReviewPrompt(cards,dismissed){
 return cards.find(card=>['review','approved','error'].includes(card.status)
  &&card.raw_fields?.fleetReview?.issues?.length>0
  &&!card.raw_fields.fleetReview.error
  &&card.raw_fields.fleetReview.signature===scanFleetSignature(card.draft)
  &&card.raw_fields.fleetReview.decision!=='transfer-pending'
  &&!dismissed.has(fleetReviewKey(card)));
}
