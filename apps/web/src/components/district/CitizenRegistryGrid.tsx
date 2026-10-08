'use client';

import React, { useState } from 'react';
import { useBasStore } from '@/stores/useBasStore';

export const CitizenRegistryGrid: React.FC = () => {
  const { citizens, selectedCitizenId, selectCitizen } = useBasStore();
  const [filter, setFilter] = useState<'all' | 'registered' | 'unregistered'>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const pageSize = 9;

  const filtered = citizens.filter((c) => {
    if (filter === 'registered' && !c.registered) return false;
    if (filter === 'unregistered' && c.registered) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        c.role.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages - 1);
  const paginated = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize);

  return (
    <div
      id="citizen-registry-section"
      className="relative w-full h-full min-h-0 bg-[#c8dbe9] border-2 border-[#182635] rounded-xl p-2 md:p-2.5 shadow-[inset_0_1px_0_#fff] flex flex-col justify-between gap-1.5"
    >
      {/* Top Section Header: Tab Badge [REGISTRI] & Controls */}
      <div className="flex-shrink-0 flex flex-wrap items-center justify-between gap-2 border-b border-[#a6bfd4] pb-1.5">
        {/* Authentic Tab Header Coded in Pure CSS */}
        <div className="flex items-center gap-1.5 bg-[#bdcddc] border-2 border-[#182635] px-2.5 py-0.5 rounded-lg shadow-xs">
          <span className="text-xs">📖</span>
          <span className="font-heading text-xs font-bold text-[#102232] tracking-wider">
            REGISTRI
          </span>
          <span className="text-[9px] text-[#3c566e] font-heading font-medium">({filtered.length})</span>
        </div>

        {/* Search & Filter Controls */}
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder="Cari warga..."
            className="px-2 py-0.5 rounded-md bg-[#ffffff] border border-[#577085] text-xs font-pixel text-[#102232] outline-none focus:border-[#182635] w-24 md:w-32"
          />

          <div className="flex items-center gap-1 font-heading text-[9px] md:text-[10px]">
            <button
              onClick={() => { setFilter('all'); setPage(0); }}
              className={`px-1.5 py-0.5 rounded transition-colors ${
                filter === 'all'
                  ? 'bg-[#182635] text-white'
                  : 'bg-[#ffffff] text-[#334b60] border border-[#7e99ab] hover:bg-[#edf5fb]'
              }`}
            >
              ALL
            </button>
            <button
              onClick={() => { setFilter('registered'); setPage(0); }}
              className={`px-1.5 py-0.5 rounded transition-colors ${
                filter === 'registered'
                  ? 'bg-[#182635] text-white'
                  : 'bg-[#ffffff] text-[#334b60] border border-[#7e99ab] hover:bg-[#edf5fb]'
              }`}
            >
              TERDAFTAR
            </button>
          </div>
        </div>
      </div>

      {/* 3x3 Grid of Citizens (9 Cards Matching Mockup with Pure White Background) */}
      <div className="flex-1 min-h-0 grid grid-cols-3 grid-rows-3 gap-1.5 md:gap-2">
        {paginated.map((citizen) => {
          const isSelected = citizen.id === selectedCitizenId;
          return (
            <div
              key={citizen.id}
              onClick={() => selectCitizen(citizen.id)}
              className={`group bg-[#ffffff] border-2 rounded-lg p-1 md:p-1.5 flex flex-col items-center justify-between cursor-pointer transition-all duration-150 hover:-translate-y-0.5 shadow-xs h-full min-h-0 ${
                isSelected
                  ? 'border-[#182635] ring-2 ring-[#182635] bg-[#f2f8fd]'
                  : 'border-[#7e99ab] hover:border-[#182635]'
              }`}
            >
              {/* Citizen Sprite Container */}
              <div className="flex-1 min-h-0 w-full flex items-center justify-center py-0.5">
                <img
                  src={citizen.image}
                  alt={citizen.name}
                  className="max-w-full max-h-full max-h-[46px] md:max-h-[58px] object-contain filter drop-shadow-[0_2px_4px_rgba(0,0,0,0.2)] transition-transform group-hover:scale-105"
                  style={{ imageRendering: 'pixelated' }}
                  loading="lazy"
                />
              </div>

              {/* White Name Pill Capsule matching original mockup */}
              <div
                className="w-full max-w-[110px] bg-[#ffffff] border border-[#182635] rounded py-0.5 px-1 font-heading text-[9px] md:text-[10px] font-bold text-[#102232] text-center truncate shadow-xs mt-0.5"
                title={`${citizen.name} (${citizen.role})`}
              >
                {citizen.name}
              </div>
            </div>
          );
        })}
      </div>

      {/* Pagination Footer Bar */}
      <div className="flex-shrink-0 flex items-center justify-between pt-1 border-t border-[#a6bfd4] font-heading text-[10px] md:text-xs text-[#334b60]">
        <button
          disabled={currentPage === 0}
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          className="px-2 py-0.5 rounded bg-[#ffffff] disabled:opacity-40 hover:bg-[#edf5fb] transition-colors border border-[#7e99ab] font-bold text-[#102232]"
        >
          ◀ PREV
        </button>

        <span className="font-bold text-[10px] md:text-[11px] text-[#102232]">
          HALAMAN {currentPage + 1} / {totalPages}
        </span>

        <button
          disabled={currentPage >= totalPages - 1}
          onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
          className="px-2 py-0.5 rounded bg-[#ffffff] disabled:opacity-40 hover:bg-[#edf5fb] transition-colors border border-[#7e99ab] font-bold text-[#102232]"
        >
          NEXT ▶
        </button>
      </div>
    </div>
  );
};
