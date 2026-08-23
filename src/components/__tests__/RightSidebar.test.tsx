import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

import { RightSidebar } from '@/components/RightSidebar';
import { useAppStore } from '@/store';

function atSize(width: number, height: number) {
  window.innerWidth = width;
  window.innerHeight = height;
  window.dispatchEvent(new Event('resize'));
}

function sidebar(): HTMLElement {
  const el = document.querySelector('[data-e2e="sidebar-nav"]');
  if (!el) throw new Error('no sidebar');
  return el as HTMLElement;
}

describe('RightSidebar', () => {
  beforeEach(() => {
    useAppStore.getState().resetPlasma();
    useAppStore.setState({ plasmaAvailable: true });
  });

  it('gives width back on the narrower formats', () => {
    atSize(1348, 866);
    const { unmount } = render(<RightSidebar selectedIndex={0} onSelect={vi.fn()} />);
    expect(sidebar().className).toContain('w-40');
    unmount();

    atSize(1002, 816);
    const second = render(<RightSidebar selectedIndex={0} onSelect={vi.fn()} />);
    expect(sidebar().className).toContain('w-24');
    second.unmount();

    atSize(750, 1302);
    render(<RightSidebar selectedIndex={0} onSelect={vi.fn()} />);
    expect(sidebar().className).toContain('w-20');
  });

  it('sizes the SVG itself rather than scaling a 24px icon with CSS', () => {
    atSize(1348, 866);
    render(<RightSidebar selectedIndex={0} onSelect={vi.fn()} />);

    const icon = document.querySelector('[data-e2e="sidebar-nav-home"] svg') as SVGElement;
    expect(icon.getAttribute('width')).toBe('48');
    // Stroke thinned in proportion, so a 48px icon does not look drawn with a marker pen.
    expect(Number(icon.getAttribute('stroke-width'))).toBeLessThan(2);
  });

  it('the plasma tab is a torch, not a flame', () => {
    atSize(1348, 866);
    render(<RightSidebar selectedIndex={0} onSelect={vi.fn()} />);

    // The torch icon is ours; lucide's Flame has a single path, this has five.
    const icon = document.querySelector('[data-e2e="sidebar-nav-plasma"] svg') as SVGElement;
    expect(icon.querySelectorAll('path').length).toBeGreaterThan(3);
  });

  it('the selected tab takes the theme highlight, not a colour of its own', () => {
    atSize(1348, 866);
    render(<RightSidebar selectedIndex={2} onSelect={vi.fn()} />);

    const selected = document.querySelector('[data-e2e="sidebar-nav-program"]') as HTMLElement;
    expect(selected.className).toContain('bg-primary');
    expect(selected.getAttribute('style') ?? '').not.toContain('gradient');
  });

  it('the selected tab does not keep the surface background under its icon', () => {
    // `.surface` sets a background through a plain class, which beats a `bg-primary` utility
    // on source order: the icon went dark while the background stayed grey.
    atSize(1348, 866);
    render(<RightSidebar selectedIndex={2} onSelect={vi.fn()} />);

    const selected = document.querySelector('[data-e2e="sidebar-nav-program"]') as HTMLElement;
    const idle = document.querySelector('[data-e2e="sidebar-nav-home"]') as HTMLElement;

    expect(selected.className).not.toContain('surface');
    expect(selected.className).toContain('text-primary-foreground');
    expect(idle.className).toContain('surface');
  });

  it('hides the plasma tab on a machine that is not one', () => {
    useAppStore.setState({ plasmaAvailable: false });
    atSize(1348, 866);
    render(<RightSidebar selectedIndex={0} onSelect={vi.fn()} />);

    expect(document.querySelector('[data-e2e="sidebar-nav-plasma"]')).toBeNull();
  });
});
