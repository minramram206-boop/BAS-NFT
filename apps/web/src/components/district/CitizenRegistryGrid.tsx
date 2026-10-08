'use client';

import React, { useMemo, useState } from 'react';
import type { CitizenRecord } from '@bas/content';
import { REGISTRY_PAGE_SIZE, REGISTRY_SECTION_ID, UI } from '@/config/constants';
import { MESSAGES, formatMessage } from '@/messages';
import { useCitizens, useSelectCitizen, useSelectedCitizenId } from '@/stores/selectors';
import type { RegistryFilter } from '@/stores/basStore';
import { cn } from '@/lib/utils/cn';
import { PixelSprite } from '@/components/ui/PixelSprite';

const FILTERS: ReadonlyArray<{ key: RegistryFilter; label: string }> = [
  { key: 'all', label: MESSAGES.district.filterAll },
  { key: 'registered', label: MESSAGES.district.filterRegistered },
  { key: 'unregistered', label: MESSAGES.district.filterUnregistered },
];

function matchesFilter(citizen: CitizenRecord, filter: RegistryFilter): boolean {
  if (filter === 'registered') return citizen.registered;
  if (filter === 'unregistered') return !citizen.registered;
  return true;
}

function matchesSearch(citizen: CitizenRecord, query: string): boolean {
  if (!query) return true;
  const needle = query.toLowerCase();
  return (
    citizen.name.toLowerCase().includes(needle) ||
    citizen.code.toLowerCase().includes(needle) ||
    citizen.role.toLowerCase().includes(needle)
  );
}

/** Paginated 3x3 registry of every citizen in District 01. */
export const CitizenRegistryGrid: React.FC = () => {
  const citizens = useCitizens();
  const selectedCitizenId = useSelectedCitizenId();
  const selectCitizen = useSelectCitizen();

  const [filter, setFilter] = useState<RegistryFilter>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  const filtered = useMemo(
    () => citizens.filter((citizen) => matchesFilter(citizen, filter) && matchesSearch(citizen, search.trim())),
    [citizens, filter, search],
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / REGISTRY_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const visible = filtered.slice(currentPage * REGISTRY_PAGE_SIZE, (currentPage + 1) * REGISTRY_PAGE_SIZE);

  const resetToFirstPage = () => setPage(0);

  return (
    <section
      id={REGISTRY_SECTION_ID}
      className="relative flex h-full min-h-0 w-full flex-col justify-between gap-1.5 rounded-xl border-2 border-[#182635] bg-[#c8dbe9] p-2 shadow-[inset_0_1px_0_#fff] md:p-2.5"
    >
      <header className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[#a6bfd4] pb-1.5">
        <span className="flex items-center gap-1.5 rounded-lg border-2 border-[#182635] bg-[#bdcddc] px-2.5 py-0.5 shadow-xs">
          <span className="text-xs">📖</span>
          <span className="font-heading text-xs font-bold tracking-wider text-[#102232]">
            {UI.registryHeading}
          </span>
          <span className="font-heading text-[9px] font-medium text-[#3c566e]">
            ({filtered.length})
          </span>
        </span>

        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              resetToFirstPage();
            }}
            placeholder={MESSAGES.district.searchPlaceholder}
            aria-label={MESSAGES.district.searchLabel}
            className="w-24 rounded-md border border-[#577085] bg-[#ffffff] px-2 py-0.5 font-pixel text-xs text-[#102232] outline-none focus:border-[#182635] md:w-32"
          />

          <div className="flex items-center gap-1 font-heading text-[9px] md:text-[10px]">
            {FILTERS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => {
                  setFilter(option.key);
                  resetToFirstPage();
                }}
                className={cn(
                  'rounded px-1.5 py-0.5 transition-colors',
                  filter === option.key
                    ? 'bg-[#182635] text-white'
                    : 'border border-[#7e99ab] bg-[#ffffff] text-[#334b60] hover:bg-[#edf5fb]',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-3 grid-rows-3 gap-1.5 md:gap-2">
        {visible.map((citizen) => (
          <RegistryCard
            key={citizen.id}
            citizen={citizen}
            isSelected={citizen.id === selectedCitizenId}
            onSelect={selectCitizen}
          />
        ))}
      </div>

      <footer className="flex flex-shrink-0 items-center justify-between border-t border-[#a6bfd4] pt-1 font-heading text-[10px] font-bold text-[#334b60] md:text-xs">
        <PaginationButton
          label={MESSAGES.district.previousPage}
          disabled={currentPage === 0}
          onClick={() => setPage((value) => Math.max(0, value - 1))}
        />
        <span className="text-[10px] font-bold text-[#102232] md:text-[11px]">
          {formatMessage(MESSAGES.district.pageCount, {
            current: currentPage + 1,
            total: totalPages,
          })}
        </span>
        <PaginationButton
          label={MESSAGES.district.nextPage}
          disabled={currentPage >= totalPages - 1}
          onClick={() => setPage((value) => Math.min(totalPages - 1, value + 1))}
        />
      </footer>
    </section>
  );
};

interface RegistryCardProps {
  citizen: CitizenRecord;
  isSelected: boolean;
  onSelect: (id: number) => void;
}

const RegistryCard: React.FC<RegistryCardProps> = ({ citizen, isSelected, onSelect }) => (
  <button
    type="button"
    onClick={() => onSelect(citizen.id)}
    aria-pressed={isSelected}
    className={cn(
      'group flex h-full min-h-0 cursor-pointer flex-col items-center justify-between rounded-lg border-2 bg-[#ffffff] p-1 shadow-xs transition-all duration-150 hover:-translate-y-0.5 md:p-1.5',
      isSelected
        ? 'border-[#182635] bg-[#f2f8fd] ring-2 ring-[#182635]'
        : 'border-[#7e99ab] hover:border-[#182635]',
    )}
  >
    <span className="flex min-h-0 w-full flex-1 items-center justify-center py-0.5">
      <PixelSprite
        src={citizen.image}
        alt={citizen.name}
        width={96}
        height={96}
        className="flex max-h-full max-w-full items-center justify-center overflow-hidden"
        imageClassName="max-h-[46px] drop-shadow-[0_2px_4px_rgba(0,0,0,0.2)] transition-transform group-hover:scale-105 md:max-h-[58px]"
      />
    </span>

    <span
      title={`${citizen.name} (${citizen.role})`}
      className="mt-0.5 w-full max-w-[110px] truncate rounded border border-[#182635] bg-[#ffffff] px-1 py-0.5 text-center font-heading text-[9px] font-bold text-[#102232] shadow-xs md:text-[10px]"
    >
      {citizen.name}
    </span>
  </button>
);

interface PaginationButtonProps {
  label: string;
  disabled: boolean;
  onClick: () => void;
}

const PaginationButton: React.FC<PaginationButtonProps> = ({ label, disabled, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="rounded border border-[#7e99ab] bg-[#ffffff] px-2 py-0.5 font-bold text-[#102232] transition-colors hover:bg-[#edf5fb] disabled:opacity-40"
  >
    {label}
  </button>
);
