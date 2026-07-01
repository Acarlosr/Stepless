// ════════════════════════════════════════════════════════════════════════════
//  ♿ Stepless — Goldsky Subgraph Mapping (AssemblyScript)
//  Indexes events from RewardDistributor, SteplessOracle, and X402API.
// ════════════════════════════════════════════════════════════════════════════

import {
  RewardPaid as RewardPaidEvent,
  RewardFailed as RewardFailedEvent,
  TreasuryFunded as TreasuryFundedEvent,
  TreasuryWithdrawn as TreasuryWithdrawnEvent,
  VerifierRegistered as VerifierRegisteredEvent,
  VerifierSlashed as VerifierSlashedEvent,
} from "../generated/RewardDistributor/RewardDistributor";

import {
  LocationRegistered as LocationRegisteredEvent,
  ContributionSubmitted as ContributionSubmittedEvent,
  ContributionVerified as ContributionVerifiedEvent,
  ContributionRejected as ContributionRejectedEvent,
} from "../generated/SteplessOracle/SteplessOracle";

import {
  QueryExecuted as QueryExecutedEvent,
  SubscriptionPurchased as SubscriptionPurchasedEvent,
} from "../generated/X402API/X402API";

import {
  RewardPayment, Contributor, TreasuryEvent, VerifierEvent,
  Location, Contribution, APIQuery, Subscription,
} from "../generated/schema";

// ── Helpers ──────────────────────────────────────────────────────────────────

function getOrCreateContributor(address: Bytes): Contributor {
  let c = Contributor.load(address);
  if (c == null) {
    c = new Contributor(address);
    c.totalEarned = BigInt.fromI32(0);
    c.contributionCount = BigInt.fromI32(0);
    c.verificationCount = BigInt.fromI32(0);
    c.isVerifier = false;
    c.save();
  }
  return c as Contributor;
}

// ── RewardDistributor Handlers ───────────────────────────────────────────────

export function handleRewardPaid(event: RewardPaidEvent): void {
  let contrib = getOrCreateContributor(event.params.recipient);

  let reward = new RewardPayment(event.params.contributionId);
  reward.recipient = contrib.id;
  reward.amount = event.params.amount;
  reward.rewardType = event.params.rewardType;
  reward.blockNumber = event.params.blockNumber;
  reward.txHash = event.transaction.hash;
  reward.failed = false;
  reward.save();

  contrib.totalEarned = contrib.totalEarned.plus(event.params.amount);
  if (event.params.rewardType === 1) { // Verification
    contrib.verificationCount = contrib.verificationCount.plus(BigInt.fromI32(1));
  } else {
    contrib.contributionCount = contrib.contributionCount.plus(BigInt.fromI32(1));
  }
  contrib.save();
}

export function handleRewardFailed(event: RewardFailedEvent): void {
  let reward = new RewardPayment(event.params.contributionId);
  reward.recipient = event.params.recipient;
  reward.amount = event.params.amount;
  reward.rewardType = 0;
  reward.blockNumber = event.block.number;
  reward.txHash = event.transaction.hash;
  reward.failed = true;
  reward.failReason = event.params.reason.toString();
  reward.save();
}

export function handleTreasuryFunded(event: TreasuryFundedEvent): void {
  let id = event.transaction.hash.concatI32(event.logIndex.toI32());
  let tx = new TreasuryEvent(id);
  tx.type = "Funded";
  tx.amount = event.params.amount;
  tx.actor = event.params.funder;
  tx.newBalance = event.params.newBalance;
  tx.blockNumber = event.block.number;
  tx.save();
}

export function handleTreasuryWithdrawn(event: TreasuryWithdrawnEvent): void {
  let id = event.transaction.hash.concatI32(event.logIndex.toI32());
  let tx = new TreasuryEvent(id);
  tx.type = "Withdrawn";
  tx.amount = event.params.amount;
  tx.actor = event.params.admin;
  tx.newBalance = event.params.newBalance;
  tx.blockNumber = event.block.number;
  tx.save();
}

export function handleVerifierRegistered(event: VerifierRegisteredEvent): void {
  let contrib = getOrCreateContributor(event.params.verifier);
  contrib.isVerifier = true;
  contrib.save();

  let id = event.transaction.hash.concatI32(event.logIndex.toI32());
  let v = new VerifierEvent(id);
  v.verifier = event.params.verifier;
  v.eventType = "Registered";
  v.blockNumber = event.params.blockNumber;
  v.slashedAmount = BigInt.fromI32(0);
  v.save();
}

export function handleVerifierSlashed(event: VerifierSlashedEvent): void {
  let contrib = getOrCreateContributor(event.params.verifier);
  contrib.isVerifier = false;
  contrib.totalEarned = BigInt.fromI32(0);
  contrib.save();

  let id = event.transaction.hash.concatI32(event.logIndex.toI32());
  let v = new VerifierEvent(id);
  v.verifier = event.params.verifier;
  v.eventType = "Slashed";
  v.blockNumber = event.block.number;
  v.slashedAmount = event.params.slashedAmount;
  v.reason = event.params.reason;
  v.save();
}

// ── SteplessOracle Handlers ──────────────────────────────────────────────────

export function handleLocationRegistered(event: LocationRegisteredEvent): void {
  let loc = new Location(event.params.locationHash);
  loc.firstContributor = event.params.contributor;
  loc.registeredBlock = event.params.blockNumber;
  loc.verificationCount = BigInt.fromI32(0);
  loc.save();
}

export function handleContributionSubmitted(event: ContributionSubmittedEvent): void {
  let contrib = new Contribution(event.params.contributionId);
  let loc = Location.load(event.params.locationHash);
  if (loc != null) {
    contrib.location = loc.id;
  }
  contrib.contributor = event.params.contributor;
  contrib.contributionType = event.params.contributionType;
  contrib.dataHash = event.params.dataHash;
  contrib.verified = false;
  contrib.verifier = null;
  contrib.verifiedBlock = null;
  contrib.rejected = false;
  contrib.rejectReason = "";
  contrib.rewardClaimed = false;
  contrib.rewardAmount = null;
  contrib.rewardType = null;
  contrib.rewardPaidBlock = null;
  contrib.save();
}

export function handleContributionVerified(event: ContributionVerifiedEvent): void {
  let contrib = Contribution.load(event.params.contributionId);
  if (contrib != null) {
    contrib.verified = true;
    contrib.verifier = event.params.verifier;
    contrib.verifiedBlock = event.params.blockNumber;
    contrib.save();
  }

  // Increment location verification count
  if (contrib != null) {
    let loc = Location.load(contrib.location);
    if (loc != null) {
      loc.verificationCount = loc.verificationCount.plus(BigInt.fromI32(1));
      loc.save();
    }
  }
}

export function handleContributionRejected(event: ContributionRejectedEvent): void {
  let contrib = Contribution.load(event.params.contributionId);
  if (contrib != null) {
    contrib.rejected = true;
    contrib.rejectReason = event.params.reason;
    contrib.save();
  }
}

// ── X402API Handlers ─────────────────────────────────────────────────────────

export function handleQueryExecuted(event: QueryExecutedEvent): void {
  let id = event.transaction.hash.concatI32(event.logIndex.toI32());
  let q = new APIQuery(id);
  q.consumer = event.params.consumer;
  q.queryType = event.params.queryType;
  q.feePaid = event.params.feePaid;
  q.locationHash = event.params.locationHash;
  q.blockNumber = event.params.blockNumber;
  q.save();
}

export function handleSubscriptionPurchased(event: SubscriptionPurchasedEvent): void {
  let id = event.transaction.hash.concatI32(event.logIndex.toI32());
  let s = new Subscription(id);
  s.consumer = event.params.consumer;
  s.planId = event.params.planId;
  s.startBlock = event.params.startBlock;
  s.endBlock = event.params.endBlock;
  s.feePaid = event.params.feePaid;
  s.save();
}