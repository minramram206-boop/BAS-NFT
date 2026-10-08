export interface Citizen {
  id: number;
  name: string;
  code: string;
  role: string;
  roleKey: string;
  image: string;
  avatar: string;
  intelligence: number;
  alignment: number;
  composure: number;
  registered: boolean;
  lore: string;
}

export type StatCategory = 'intelligence' | 'alignment' | 'composure';

export type DistrictViewMode = 'district' | 'training';
