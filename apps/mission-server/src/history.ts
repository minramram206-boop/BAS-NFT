import type { MissionSpec } from './catalog.js';
import type { ClaimRecord } from './store.js';

/** What the chat worker needs to add one line to a citizen's public history. */
export interface HistoryEvent {
  readonly asset: string;
  /** Stable per event, so a claim confirmed twice produces one line. */
  readonly eventKey: string;
  readonly line: string;
}

/** `streetLamp` -> `street lamp`. Mission ids are camelCase keys of the web copy catalog. */
function readable(id: string): string {
  return id.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
}

/**
 * The public history line for a mission the chain has confirmed. It states
 * only what the receipt already makes public: which mission, where, and when.
 * It never names the stat, the owner, or anything the owner said.
 */
export function describeClaim(record: ClaimRecord, mission: MissionSpec): HistoryEvent {
  const kind = mission.event ? 'district event task' : 'mission';
  return {
    asset: record.asset,
    eventKey: `claim-${record.seasonId}-${record.day}-${record.missionId}`,
    line: `Finished the "${readable(record.missionId)}" ${kind} in the ${mission.district} district on day ${record.day} of season ${record.seasonId}.`,
  };
}
