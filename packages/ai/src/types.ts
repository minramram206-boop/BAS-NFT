/** The three stats a citizen has, named as on chain. */
export interface Scores {
  readonly intelligence: number;
  readonly alignment: number;
  readonly compute: number;
}

/** What the model may know about a citizen: public data only. */
export interface CitizenContext {
  readonly asset: string;
  readonly name: string;
  readonly roleKey: string;
  readonly role: string;
  readonly lore: string;
  readonly scores: Scores;
}

/** One turn of the conversation the client sends back with each message. */
export interface ChatTurn {
  readonly from: 'owner' | 'citizen';
  readonly text: string;
}
