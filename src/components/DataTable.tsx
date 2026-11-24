import React, { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Search } from 'lucide-react';

export interface ColumnDef<T> {
  key: string;
  header: string;
  sortable?: boolean;
  align?: 'right' | 'left' | 'center';
  render: (row: T) => React.ReactNode;
  sortValue?: (row: T) => string | number;
  mobileHidden?: boolean;
}

interface DataTableProps<T> {
  rows: T[];
  columns: ColumnDef<T>[];
  rowKey: (row: T) => string | number;
  searchPlaceholder?: string;
  searchFilter?: (row: T, query: string) => boolean;
  pageSize?: number;
  emptyTitle?: string;
  emptyDescription?: string;
  toolbarExtra?: React.ReactNode;
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  searchPlaceholder = 'بحث في السجلات...',
  searchFilter,
  pageSize = 10,
  emptyTitle = 'لا توجد سجلات مطابقة',
  emptyDescription = 'لم يتم العثور على بيانات مطابقة لمعايير البحث الحالية.',
  toolbarExtra,
}: DataTableProps<T>) {
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !searchFilter) return rows;
    return rows.filter((r) => searchFilter(r, q));
  }, [rows, query, searchFilter]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.sortValue) return filtered;
    const copy = [...filtered];
    copy.sort((a, b) => {
      const va = col.sortValue!(a);
      const vb = col.sortValue!(b);
      if (typeof va === 'number' && typeof vb === 'number') {
        return sortDir === 'asc' ? va - vb : vb - va;
      }
      return sortDir === 'asc'
        ? String(va).localeCompare(String(vb), 'ar')
        : String(vb).localeCompare(String(va), 'ar');
    });
    return copy;
  }, [filtered, sortKey, sortDir, columns]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paged = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  return (
    <div className="bg-white dark:bg-[#192735] border border-[#DFE6EC] dark:border-[#2C3D4D] rounded-lg">
      {(searchFilter || toolbarExtra) && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 border-b border-[#DFE6EC] dark:border-[#2C3D4D]">
          {searchFilter ? (
            <div className="relative flex-1 max-w-md">
              <Search
                className="w-4 h-4 text-[#718096] dark:text-[#A9B7C4] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <input
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                className="w-full pr-9 pl-3 py-2 min-h-[40px] text-sm rounded-md bg-[#F3F6F9] dark:bg-[#101A24] border border-[#DFE6EC] dark:border-[#2C3D4D] text-[#233747] dark:text-[#E8EEF3] placeholder:text-[#718096] focus:border-[#078C8C] focus:outline-none"
              />
            </div>
          ) : (
            <div />
          )}
          {toolbarExtra && <div className="flex flex-wrap items-center gap-2">{toolbarExtra}</div>}
        </div>
      )}

      {paged.length === 0 ? (
        <div className="py-12 px-6 text-center">
          <p className="text-base font-semibold text-[#102638] dark:text-[#E8EEF3]">{emptyTitle}</p>
          <p className="text-sm text-[#718096] dark:text-[#A9B7C4] mt-1">{emptyDescription}</p>
        </div>
      ) : (
        <>
          {/* Desktop / Tablet horizontal-safe table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-[#F3F6F9] dark:bg-[#14202C] border-b border-[#DFE6EC] dark:border-[#2C3D4D]">
                  {columns.map((col) => (
                    <th
                      key={col.key}
                      className={`px-4 py-3 text-xs font-semibold text-[#66869A] dark:text-[#A9B7C4] whitespace-nowrap ${
                        col.align === 'left'
                          ? 'text-left'
                          : col.align === 'center'
                            ? 'text-center'
                            : 'text-right'
                      }`}
                    >
                      {col.sortable && col.sortValue ? (
                        <button
                          type="button"
                          onClick={() => toggleSort(col.key)}
                          className="inline-flex items-center gap-1 hover:text-[#102638] dark:hover:text-white transition-colors"
                        >
                          <span>{col.header}</span>
                          {sortKey === col.key &&
                            (sortDir === 'asc' ? (
                              <ArrowUp className="w-3.5 h-3.5" />
                            ) : (
                              <ArrowDown className="w-3.5 h-3.5" />
                            ))}
                        </button>
                      ) : (
                        col.header
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#DFE6EC] dark:divide-[#2C3D4D]">
                {paged.map((row) => (
                  <tr
                    key={rowKey(row)}
                    className="hover:bg-[#F3F6F9]/70 dark:hover:bg-[#203C50]/30 transition-colors"
                  >
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={`px-4 py-3 text-[#233747] dark:text-[#E8EEF3] align-middle ${
                          col.align === 'left'
                            ? 'text-left'
                            : col.align === 'center'
                              ? 'text-center'
                              : 'text-right'
                        }`}
                      >
                        {col.render(row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile responsive cards */}
          <div className="md:hidden divide-y divide-[#DFE6EC] dark:divide-[#2C3D4D]">
            {paged.map((row) => (
              <div key={rowKey(row)} className="p-4 space-y-2">
                {columns
                  .filter((c) => !c.mobileHidden)
                  .map((col) => (
                    <div key={col.key} className="flex items-start justify-between gap-3 text-sm">
                      <span className="text-xs font-medium text-[#718096] dark:text-[#A9B7C4] shrink-0">
                        {col.header}
                      </span>
                      <div className="text-left font-medium text-[#233747] dark:text-[#E8EEF3]">
                        {col.render(row)}
                      </div>
                    </div>
                  ))}
              </div>
            ))}
          </div>

          {/* Pagination */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-[#DFE6EC] dark:border-[#2C3D4D] text-xs text-[#718096] dark:text-[#A9B7C4]">
            <span className="tabular-nums">
              عرض {(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, sorted.length)} من أصل{' '}
              {sorted.length} سجل
            </span>
            {totalPages > 1 && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={safePage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  aria-label="الصفحة السابقة"
                  className="p-2 min-w-[36px] min-h-[36px] inline-flex items-center justify-center rounded border border-[#DFE6EC] dark:border-[#2C3D4D] disabled:opacity-40 hover:bg-[#F3F6F9] dark:hover:bg-[#203C50]"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
                <span className="px-3 tabular-nums font-medium text-[#233747] dark:text-[#E8EEF3]">
                  {safePage} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  aria-label="الصفحة التالية"
                  className="p-2 min-w-[36px] min-h-[36px] inline-flex items-center justify-center rounded border border-[#DFE6EC] dark:border-[#2C3D4D] disabled:opacity-40 hover:bg-[#F3F6F9] dark:hover:bg-[#203C50]"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
