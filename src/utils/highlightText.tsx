import React from 'react';

export function splitSearchTerms(input: string): string[] {
  return Array.from(new Set(String(input || '').split(/\s+/).map(term => term.trim()).filter(Boolean)));
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function highlightText(text: React.ReactNode, terms: string[]): React.ReactNode {
  const raw = String(text ?? '');
  const activeTerms = terms.filter(Boolean);
  if (!raw || activeTerms.length === 0) return raw;

  const pattern = activeTerms.map(escapeRegExp).join('|');
  const regex = new RegExp(`(${pattern})`, 'gi');
  const parts = raw.split(regex);

  return parts.map((part, index) => {
    const matched = activeTerms.some(term => part.toLowerCase() === term.toLowerCase());
    return matched ? (
      <mark key={`${part}-${index}`} style={{ background: '#fff1b8', padding: '0 2px', borderRadius: 2 }}>
        {part}
      </mark>
    ) : part;
  });
}
