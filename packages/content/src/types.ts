/** Content language directories under `content/`. Only English exists today. */
export type ContentLocale = 'en';

export interface CitizenRecord {
  id: number;
  name: string;
  code: string;
  role: string;
  roleKey: string;
  /** Public path of the full-body sprite, e.g. `/characters/1.png`. */
  image: string;
  /** Public path of the small portrait used in lists, e.g. `/avatars/1.png`. */
  avatar: string;
  intelligence: number;
  alignment: number;
  composure: number;
  registered: boolean;
  lore: string;
}

/** Citizen attributes that progression can raise. */
export type StatKey = 'intelligence' | 'alignment' | 'composure';
