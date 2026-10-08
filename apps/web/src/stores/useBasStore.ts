import { create } from 'zustand';
import { Citizen, DistrictViewMode, StatCategory } from '../types/citizen';
import { retroAudio } from '../audio/RetroAudioSynthesizer';
import initialCitizens from '../../../../content/en/citizens.json';

interface BasState {
  viewMode: DistrictViewMode;
  citizens: Citizen[];
  selectedCitizenId: number;
  supplyCount: number;
  tokensBurned: number;
  sfxEnabled: boolean;
  isLoggedIn: boolean;
  walletAddress: string;
  trainingLog: string;
  modal: {
    isOpen: boolean;
    title: string;
    message: string;
  };

  // Actions
  setViewMode: (mode: DistrictViewMode) => void;
  selectCitizen: (id: number) => void;
  trainStat: (stat: StatCategory, targetElement?: HTMLElement | null) => void;
  mintCitizen: () => void;
  toggleLogin: () => void;
  toggleSfx: () => void;
  openModal: (title: string, message: string) => void;
  closeModal: () => void;
}

export const useBasStore = create<BasState>((set, get) => ({
  viewMode: 'district',
  citizens: initialCitizens as Citizen[],
  selectedCitizenId: 9, // Kang Asep by default (matching mockup)
  supplyCount: 100,
  tokensBurned: 0,
  sfxEnabled: true,
  isLoggedIn: false,
  walletAddress: "7xKX...4C1d",
  trainingLog: "pelatihan selesai.<br>satu skor bertambah.",
  modal: {
    isOpen: false,
    title: "",
    message: ""
  },

  setViewMode: (mode) => {
    retroAudio.play('switch');
    set({ viewMode: mode });
  },

  selectCitizen: (id) => {
    retroAudio.play('click');
    set({ selectedCitizenId: id });
  },

  trainStat: (stat, targetElement) => {
    const { citizens, selectedCitizenId, tokensBurned } = get();
    const citizen = citizens.find(c => c.id === selectedCitizenId);
    if (!citizen) return;

    if (citizen[stat] >= 20) {
      get().openModal("STAT MAXED", `${citizen.name} has already reached maximum score (20) in ${stat}.`);
      return;
    }

    const updatedCitizens = citizens.map(c => {
      if (c.id === selectedCitizenId) {
        return { ...c, [stat]: Math.min(20, c[stat] + 1) };
      }
      return c;
    });

    retroAudio.play('train');

    set({
      citizens: updatedCitizens,
      tokensBurned: tokensBurned + 1,
      trainingLog: `pelatihan selesai.<br>satu skor ${stat} bertambah.`
    });

    if (targetElement) {
      const rect = targetElement.getBoundingClientRect();
      const fx = document.createElement('div');
      fx.className = 'floating-stat-fx';
      fx.textContent = `+1 ${stat.toUpperCase().slice(0, 3)}`;
      fx.style.left = `${rect.left + rect.width / 2 - 20}px`;
      fx.style.top = `${rect.top - 10}px`;
      document.body.appendChild(fx);
      setTimeout(() => fx.remove(), 800);
    }
  },

  mintCitizen: () => {
    retroAudio.play('click');
    const { supplyCount, citizens } = get();
    if (supplyCount <= 0) {
      get().openModal("SUPPLY EXHAUSTED", "All 100 citizen slots have been minted!");
      return;
    }

    const unreg = citizens.find(c => !c.registered);
    if (unreg) {
      retroAudio.play('mint');
      const updatedCitizens = citizens.map(c => c.id === unreg.id ? { ...c, registered: true } : c);
      set({
        citizens: updatedCitizens,
        supplyCount: supplyCount - 1,
        selectedCitizenId: unreg.id
      });

      get().openModal(
        "MINT SUCCESSFUL! 🥚✨",
        `<strong>${unreg.name} (${unreg.code})</strong> has officially registered into District 01!<br><br>Role: <em>${unreg.role}</em><br>Remaining Supply: <strong>${supplyCount - 1} / 100</strong>`
      );
    } else {
      get().openModal("ALL REGISTERED", "All 20 citizens currently in the registry directory are already registered!");
    }
  },

  toggleLogin: () => {
    retroAudio.play('click');
    const { isLoggedIn, walletAddress } = get();
    if (!isLoggedIn) {
      set({ isLoggedIn: true });
      get().openModal("WALLET CONNECTED", `Connected with address:<br><strong>${walletAddress}</strong><br>District L2 Online.`);
    } else {
      set({ isLoggedIn: false });
      get().openModal("WALLET DISCONNECTED", "Wallet connection terminated.");
    }
  },

  toggleSfx: () => {
    const next = !get().sfxEnabled;
    retroAudio.enabled = next;
    set({ sfxEnabled: next });
    if (next) retroAudio.play('click');
  },

  openModal: (title, message) => {
    set({ modal: { isOpen: true, title, message } });
  },

  closeModal: () => {
    retroAudio.play('click');
    set({ modal: { isOpen: false, title: "", message: "" } });
  }
}));
